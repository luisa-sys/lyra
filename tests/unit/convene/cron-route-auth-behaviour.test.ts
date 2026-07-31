/**
 * KAN-414 F4 (KAN-417 §8 group 2) — behavioural coverage for the Convene cron
 * route auth check.
 *
 * ADDITIVE, NOT A REPLACEMENT. The "cron routes use the constant-time helper"
 * block in cron-auth.test.ts is deliberately KEPT, and this file explains why.
 *
 * WHY THAT BLOCK CANNOT BE CONVERTED
 * ----------------------------------
 * It asserts two things a behavioural test cannot express:
 *
 *   1. That the insecure short-circuit comparison is ABSENT. You cannot execute
 *      your way to "no naive `!== \`Bearer ${expected}\`` exists in this file" —
 *      absence of a pattern across a file is a structural property.
 *   2. That the comparison is CONSTANT-TIME. A naive comparison and a
 *      timing-safe one reject a wrong secret identically; the difference is a
 *      timing side-channel, which is not observable from a unit test and would
 *      be flaky nonsense if you tried.
 *
 * That makes it category (c) in KAN-417's own taxonomy — "genuinely structural,
 * keep as text, manifest-routed" — not the category (b) the §2 ranking assumed.
 * Converting it would have replaced a real check with a weaker one that merely
 * looked more modern.
 *
 * WHAT THIS ADDS
 * --------------
 * The structural check proves the RIGHT COMPARISON IS USED. It says nothing
 * about whether the route actually refuses. These cases prove the refusal
 * happens and that a correct secret gets through — so a future edit that keeps
 * `timingSafeStrEqual` in the file but stops gating on its result is caught,
 * which neither check alone would do.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/convene/flags', () => ({ isConveneEnabled: jest.fn(() => true) }));
jest.mock('@/lib/convene/invites/dispatch', () => ({
  dispatchQueuedInvites: jest.fn(async () => ({ sent: 0, failed: 0 })),
}));

const SECRET = 'correct-horse-battery-staple';

function reqWith(auth?: string) {
  return new NextRequest('https://example.test/api/convene/cron/send-invites', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('Convene cron route auth (behavioural, KAN-414 F4)', () => {
  const prev = process.env.CRON_SECRET;

  beforeEach(() => {
    jest.resetModules();
    process.env.CRON_SECRET = SECRET;
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  async function GET(auth?: string) {
    const mod = await import('@/app/api/convene/cron/send-invites/route');
    return mod.GET(reqWith(auth));
  }

  it('rejects a request with no Authorization header', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('rejects a WRONG secret of the SAME LENGTH', async () => {
    // Same length on purpose: a length check alone would pass this, so it
    // proves the content is compared and not merely the size.
    const wrong = 'x'.repeat(SECRET.length);
    expect(wrong).toHaveLength(SECRET.length);
    const res = await GET(`Bearer ${wrong}`);
    expect(res.status).toBe(401);
  });

  it('rejects a correct secret sent without the Bearer prefix', async () => {
    const res = await GET(SECRET);
    expect(res.status).toBe(401);
  });

  it('accepts the correct Bearer secret', async () => {
    // The direction that makes the three refusals meaningful: without it, a
    // route that rejected everything would satisfy all of the above.
    const res = await GET(`Bearer ${SECRET}`);
    expect(res.status).not.toBe(401);
  });

  it('refuses when CRON_SECRET is unset rather than allowing everything', async () => {
    // Fail closed. An unset secret must not turn the route into an open
    // endpoint — the `!expected ||` half of the guard.
    delete process.env.CRON_SECRET;
    const res = await GET('Bearer anything');
    expect(res.status).toBe(401);
  });
});
