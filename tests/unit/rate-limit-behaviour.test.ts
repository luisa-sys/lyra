/**
 * Real coverage for src/modules/guards/rate-limit.ts — the first test that executes it.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tests/unit/rate-limit.test.js` is titled *"Real unit tests for
 * src/modules/guards/rate-limit.ts"* and its line 8 reads:
 *
 *     // --- Replicated from src/modules/guards/rate-limit.ts ---
 *
 * It then re-declares `store`, `CLEANUP_INTERVAL`, `cleanup()` and
 * `rateLimit()` and asserts against those copies. Its only contact with the
 * real module is three `readFileSync` scans for the strings `function
 * rateLimit`, `RATE_LIMITS` and `limit: 10` / `windowSeconds: 900`.
 *
 * PROVEN VACUOUS (2026-08-01) — three mutations of the REAL module, each of
 * which compiles cleanly and each of which left all 8 of its tests green:
 *
 *   | Mutation to src/modules/guards/rate-limit.ts        | rate-limit.test.js |
 *   |------------------------------------------|--------------------|
 *   | `entry.count > config.limit + 1`         | 8/8 PASS           |
 *   | auth preset `limit: 10` -> `limit: 1000` | 8/8 PASS           |
 *   | `entry.count++` deleted                  | 8/8 PASS           |
 *
 * And no other test picked up the slack: `profile-rate-limit.test.ts` and
 * `oauth/sec62-rate-limit-shared.test.ts` import only the `RATE_LIMITS`
 * constant, and nothing anywhere calls `rateLimit()`. Verified by grep across
 * the whole tests tree.
 *
 * WHAT WAS UNGUARDED
 * ------------------
 * `rateLimit()` is the brute-force control behind `src/middleware.ts`,
 * `src/modules/guards/profile-rate-limit.ts`, `src/modules/guards/rate-limit-shared.ts` (the SEC-62
 * durable-degradation fallback) and the OAuth `token`, `revoke` and `register`
 * routes. An off-by-one or a raised preset there is a silent weakening of auth
 * protection on a service holding minors' personal data.
 *
 * NOTE ON STATE
 * -------------
 * `store` is module-scoped and mutable, so each case uses a fresh module
 * registry via `jest.isolateModulesAsync`. Sharing it would make results
 * order-dependent — and an order-dependent test that happens to pass is its own
 * kind of vacuous.
 */

type RateLimitModule = typeof import('@/modules/guards/rate-limit');

/** Load a pristine copy of the module, so `store` starts empty. */
async function freshModule(): Promise<RateLimitModule> {
  let mod!: RateLimitModule;
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/modules/guards/rate-limit');
  });
  return mod;
}

const CONFIG = { limit: 3, windowSeconds: 60 };

describe('rateLimit — the limit is actually enforced', () => {
  it('allows exactly `limit` requests, then blocks', async () => {
    const { rateLimit } = await freshModule();

    const verdicts = Array.from({ length: 5 }, () =>
      rateLimit('user-a', CONFIG).limited,
    );

    // The off-by-one mutation lives precisely here: `> limit` vs `> limit + 1`
    // is one extra free request per window, which a text scan cannot see.
    expect(verdicts).toEqual([false, false, false, true, true]);
  });

  it('counts each request — the counter is not a no-op', async () => {
    const { rateLimit } = await freshModule();

    for (let i = 0; i < 3; i++) rateLimit('user-b', CONFIG);

    // Deleting `entry.count++` leaves every call under the limit forever.
    expect(rateLimit('user-b', CONFIG).limited).toBe(true);
  });

  it('keys are independent — one caller cannot exhaust another', async () => {
    const { rateLimit } = await freshModule();

    for (let i = 0; i < 5; i++) rateLimit('noisy', CONFIG);

    expect(rateLimit('quiet', CONFIG).limited).toBe(false);
  });

  it('reports a positive retryAfter when it blocks', async () => {
    const { rateLimit } = await freshModule();

    for (let i = 0; i < 3; i++) rateLimit('user-c', CONFIG);
    const blocked = rateLimit('user-c', CONFIG);

    expect(blocked.limited).toBe(true);
    // A caller that is told to retry in 0 seconds will simply hammer.
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(CONFIG.windowSeconds);
  });

  it('allows again once the window has elapsed', async () => {
    jest.useFakeTimers();
    try {
      const { rateLimit } = await freshModule();
      for (let i = 0; i < 4; i++) rateLimit('user-d', CONFIG);
      expect(rateLimit('user-d', CONFIG).limited).toBe(true);

      jest.advanceTimersByTime((CONFIG.windowSeconds + 1) * 1000);

      // A limiter that never forgets is a permanent lockout, which is its own
      // availability defect — so this direction matters as much as blocking.
      expect(rateLimit('user-d', CONFIG).limited).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not block early — the window is not reset by unrelated traffic', async () => {
    const { rateLimit } = await freshModule();

    for (let i = 0; i < 2; i++) {
      rateLimit('victim', CONFIG);
      for (let j = 0; j < 10; j++) rateLimit(`other-${j}`, CONFIG);
    }

    // If cleanup() dropped non-expired entries, `victim`'s counter would reset
    // and this would silently grant unlimited attempts.
    expect(rateLimit('victim', CONFIG).limited).toBe(false);
    expect(rateLimit('victim', CONFIG).limited).toBe(true);
  });
});

describe('RATE_LIMITS presets — the values auth actually depends on', () => {
  it('auth allows 10 attempts per 15 minutes', async () => {
    const { RATE_LIMITS } = await freshModule();

    // Pinned as VALUES, not as a source-text match. The old scan asserted
    // toContain('limit: 10'), which stays green when the auth preset is raised
    // to 1000 — the string still appears in the other presets.
    expect(RATE_LIMITS.auth).toEqual({ limit: 10, windowSeconds: 900 });
  });

  it('enforces the auth preset end-to-end, not just declares it', async () => {
    const { rateLimit, RATE_LIMITS } = await freshModule();

    const verdicts = Array.from({ length: 11 }, () =>
      rateLimit('login:1.2.3.4', RATE_LIMITS.auth).limited,
    );

    expect(verdicts.slice(0, 10).every((v) => v === false)).toBe(true);
    expect(verdicts[10]).toBe(true);
  });

  it('keeps the OAuth registration preset tight (SEC-19/F-05)', async () => {
    const { RATE_LIMITS } = await freshModule();

    // 5 new clients/hour per IP. Loosening this is a DCR abuse vector.
    expect(RATE_LIMITS.oauthRegister).toEqual({ limit: 5, windowSeconds: 3600 });
  });
});
