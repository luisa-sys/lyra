/**
 * KAN-414 F4 (KAN-417 §8 group 2) — behavioural replacement for the
 * "SEC-57 authorize page render guard" text scan in
 * tests/unit/sec57-issuance-suspension.test.ts.
 *
 * THE INVARIANT, IN WORDS
 * -----------------------
 * The OAuth consent screen must not render for a suspended user. On a POSITIVE
 * suspension the page redirects to /suspended before any consent UI is built.
 *
 * And the half the old test could not express at all: a TRANSIENT lookup error
 * must NOT redirect. `getAccountStanding` returns 'unknown' when the suspension
 * lookup fails, and sending a good-standing user to /suspended on a blip would
 * be a self-inflicted outage on the OAuth path. The deliberate posture is to
 * fail OPEN here for availability, because the actual credential mint in
 * submitConsent fails CLOSED on 'unknown' — that is where the security decision
 * is made. Both halves of that trade are now pinned.
 *
 * WHY THIS IS STRONGER THAN WHAT IT REPLACES
 * ------------------------------------------
 * The old block read page.tsx and asserted three substrings were present:
 * 'getAccountStanding', /standing === 'suspended'/ and "redirect('/suspended')".
 * All three can be present in a comment, in dead code, or in a branch that is
 * never reached — and the scan says nothing about which standing values do
 * what. It also could not distinguish 'suspended' from 'unknown', so the
 * availability trade above was entirely untested.
 *
 * MUTATION PROOF (required before the text block is deleted)
 * ----------------------------------------------------------
 * Confirmed 2026-07-31 and reverted:
 *   * deleting the `if (standing === 'suspended') redirect('/suspended')` block
 *     turns the suspended case red;
 *   * widening it to `if (standing !== 'ok')` — the plausible "tighten it up"
 *     edit — turns the 'unknown' case red, which is the regression the old
 *     text scan could not have caught.
 */
import { redirect } from 'next/navigation';
import { getAccountStanding } from '@/modules/access/account-status';
import { validateAuthorizeRequest } from '@/modules/oauth-as/lib/authorize';

jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    // Next's redirect throws to halt rendering; mimic that so execution stops
    // exactly where it would in production rather than falling through into
    // code the real request never reaches.
    const err = new Error(`NEXT_REDIRECT:${to}`);
    (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;${to}`;
    throw err;
  }),
}));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
  })),
}));

jest.mock('@/modules/access/account-status', () => ({
  getAccountStanding: jest.fn(),
}));

jest.mock('@/modules/oauth-as/lib/authorize', () => ({
  validateAuthorizeRequest: jest.fn(),
  buildErrorRedirect: jest.fn(() => '/oauth/error'),
}));

jest.mock('@/modules/oauth-as/lib/consents', () => ({ getConsent: jest.fn(async () => null) }));
jest.mock('@/modules/oauth-as/lib/client-trust', () => ({
  clientTrust: jest.fn(() => ({ level: 'unknown' })),
  redirectHost: jest.fn(() => 'example.test'),
}));
jest.mock('@/app/oauth/authorize/actions', () => ({
  submitConsent: jest.fn(),
  switchAccountAndContinue: jest.fn(),
}));

const mockedStanding = getAccountStanding as jest.MockedFunction<typeof getAccountStanding>;
const mockedValidate = validateAuthorizeRequest as jest.MockedFunction<
  typeof validateAuthorizeRequest
>;
const mockedRedirect = redirect as unknown as jest.Mock;

/** A minimal request that passes validation, so the standing check is reached. */
function validRequest() {
  mockedValidate.mockResolvedValue({
    ok: true,
    req: {
      client: { client_id: 'client-1', client_name: 'Test Client' },
      redirectUri: 'https://example.test/cb',
      scope: 'profile:read',
      state: 'st',
      codeChallenge: 'cc',
      codeChallengeMethod: 'S256',
    },
  } as unknown as Awaited<ReturnType<typeof validateAuthorizeRequest>>);
}

const searchParams = Promise.resolve({
  client_id: 'client-1',
  redirect_uri: 'https://example.test/cb',
  response_type: 'code',
  scope: 'profile:read',
  code_challenge: 'cc',
  code_challenge_method: 'S256',
});

async function renderPage() {
  // Imported lazily so the mocks above are in place first.
  const { default: AuthorizePage } = await import('@/app/oauth/authorize/page');
  return AuthorizePage({ searchParams } as never);
}

describe('SEC-57 — OAuth consent screen suspension guard (behavioural)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validRequest();
  });

  it('redirects a confirmed-suspended user to /suspended', async () => {
    mockedStanding.mockResolvedValue('suspended');

    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT:\/suspended/);
    expect(mockedRedirect).toHaveBeenCalledWith('/suspended');
  });

  it('does NOT redirect a good-standing user', async () => {
    mockedStanding.mockResolvedValue('ok');

    // It may fail later for unrelated reasons (this is a full RSC render with
    // most of its collaborators stubbed) — the claim is only that it did not
    // send the user to /suspended.
    await renderPage().catch(() => undefined);
    expect(mockedRedirect).not.toHaveBeenCalledWith('/suspended');
    // Prove the standing check was actually REACHED. Without this, an early
    // crash would satisfy "did not redirect" and the test would pass while
    // asserting nothing — the vacuous pass this whole programme keeps finding.
    expect(mockedStanding).toHaveBeenCalled();
  });

  it('does NOT redirect on a TRANSIENT lookup failure (standing unknown)', async () => {
    // The availability half of the SEC-57 trade. A blip in the suspension
    // lookup must not lock a good user out of OAuth; the credential mint in
    // submitConsent is where 'unknown' fails closed.
    mockedStanding.mockResolvedValue('unknown');

    await renderPage().catch(() => undefined);
    expect(mockedRedirect).not.toHaveBeenCalledWith('/suspended');
    expect(mockedStanding).toHaveBeenCalled();
  });
});
