/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * source-text scans in tests/unit/convene/drain-route.test.ts.
 *
 * THE INVARIANTS, IN WORDS
 * -----------------------
 *  1. The route 404s when CONVENE_ENABLED is off. A feature gate that can be
 *     read but not enforced is not a gate.
 *  2. An unauthenticated or bad key is refused.
 *  3. The drain is SCOPED TO THE CALLER. `dispatchQueuedInvites` must be called
 *     with the authenticated user's id — one user must not be able to drain
 *     another's queue. This is the security property in the file, and the one a
 *     text scan can least support: `/hostUserId:\s*auth\.userId/` proves the
 *     characters are present, not that the value flowing through at runtime is
 *     the caller's.
 *  4. A malformed JSON body is handled, not a 500.
 *  5. The body `api_key` fallback authenticates equivalently to the header
 *     (KAN-240 symmetry), because a client that cannot set headers must not be
 *     silently locked out.
 *
 * WHY THIS IS STRONGER
 * --------------------
 * The old block asserted ~12 regexes over the route source, including shapes
 * like /try\s*\{\s*body\s*=\s*await req\.json\(\)/ — which pins the FORMATTING
 * of an error path rather than that the error path works. Reformat the file and
 * it breaks; break the behaviour while keeping the shape and it passes.
 *
 * MUTATION PROOF (2026-07-31, each reverted)
 *   * remove the isConveneEnabled guard      -> the 404 case reddens
 *   * pass a hardcoded id instead of auth.userId -> the scoping case reddens
 *     while every original regex still matches, since `hostUserId:` is present
 *   * remove the try/catch around req.json() -> the malformed-body case reddens
 */
import { NextRequest } from 'next/server';
import { isConveneEnabled } from '@/lib/convene/flags';
import { authenticateBearerApiKey } from '@/lib/convene/auth-bearer';
import { dispatchQueuedInvites } from '@/lib/convene/invites/dispatch';

jest.mock('@/lib/convene/flags', () => ({ isConveneEnabled: jest.fn(() => true) }));
jest.mock('@/lib/convene/auth-bearer', () => ({ authenticateBearerApiKey: jest.fn() }));
jest.mock('@/lib/convene/invites/dispatch', () => ({
  dispatchQueuedInvites: jest.fn(async () => ({ sent: 2, failed: 0 })),
}));

const mockedEnabled = isConveneEnabled as jest.MockedFunction<typeof isConveneEnabled>;
const mockedAuth = authenticateBearerApiKey as jest.MockedFunction<
  typeof authenticateBearerApiKey
>;
const mockedDispatch = dispatchQueuedInvites as jest.MockedFunction<
  typeof dispatchQueuedInvites
>;

const OK_USER = 'user-abc';
const authOk = { ok: true, userId: OK_USER } as unknown as Awaited<
  ReturnType<typeof authenticateBearerApiKey>
>;
const authBad = { ok: false, status: 401, error: 'invalid_key' } as unknown as Awaited<
  ReturnType<typeof authenticateBearerApiKey>
>;

function req(body?: string, headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/convene/admin/drain-queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body ?? JSON.stringify({}),
  });
}

async function POST(...args: Parameters<typeof req>) {
  const mod = await import('@/app/api/convene/admin/drain-queue/route');
  return mod.POST(req(...args));
}

describe('drain-queue route (behavioural, KAN-414 F4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnabled.mockReturnValue(true);
    mockedAuth.mockResolvedValue(authOk);
  });

  it('404s when Convene is disabled, before authenticating', async () => {
    mockedEnabled.mockReturnValue(false);

    const res = await POST(JSON.stringify({ api_key: 'lyra_good' }));

    expect(res.status).toBe(404);
    // The gate must come first: a disabled feature should not be doing key
    // lookups at all.
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('refuses a bad API key and never dispatches', async () => {
    mockedAuth.mockResolvedValue(authBad);

    const res = await POST(JSON.stringify({ api_key: 'lyra_bad' }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it('scopes the drain to the CALLING user, not globally', async () => {
    // The security property. A text scan can only show that the characters
    // `hostUserId: auth.userId` appear; this shows the caller's id is what
    // actually reaches the dispatcher.
    await POST(JSON.stringify({ api_key: 'lyra_good' }));

    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ hostUserId: OK_USER }),
    );
  });

  it('handles a malformed JSON body without a 500', async () => {
    // The header path still authenticates, so a broken body must degrade
    // gracefully rather than throwing out of the route.
    const res = await POST('{ not json', { authorization: 'Bearer lyra_good' });

    expect(res.status).toBeLessThan(500);
  });

  it('authenticates via the body api_key when no header is present (KAN-240)', async () => {
    // The header path must FAIL for the fallback to be reached at all — a mock
    // that succeeds unconditionally would short-circuit resolveAuth and this
    // test would pass without ever exercising the body path.
    mockedAuth.mockImplementation(async (header: string | null) =>
      header === 'Bearer lyra_from_body' ? authOk : authBad,
    );

    await POST(JSON.stringify({ api_key: 'lyra_from_body' }));

    expect(mockedAuth).toHaveBeenCalledWith(null); // header absent, tried first
    expect(mockedAuth).toHaveBeenCalledWith('Bearer lyra_from_body'); // fallback
    expect(mockedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ hostUserId: OK_USER }),
    );
  });
});
