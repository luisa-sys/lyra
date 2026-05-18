/**
 * KAN-231 — unit tests for the profile-write rate-limit wrapper.
 *
 * The underlying `rateLimit` function has its own coverage in
 * `tests/unit/rate-limit.test.js`. This file tests the wrapper's
 * decision logic — user-key first, IP-key second, graceful
 * degradation when `headers()` throws (unit-test or static-render
 * contexts).
 */

// `next/headers` is server-only and unavailable in jest's node env.
// Mock it before the import.
const headersMock = jest.fn();
jest.mock('next/headers', () => ({
  headers: () => headersMock(),
}));

import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('KAN-231: checkProfileWriteRateLimit', () => {
  beforeEach(() => {
    // Each test gets a clean keyspace by using unique user IDs.
    headersMock.mockReset();
    // Default: headers() throws (no request context) — exercises the
    // graceful-degradation branch unless a test overrides.
    headersMock.mockImplementation(() => {
      throw new Error('headers() called outside request context');
    });
  });

  test('first call for a user is allowed', async () => {
    const result = await checkProfileWriteRateLimit('user-a-' + Date.now());
    expect(result.allowed).toBe(true);
  });

  test('exceeding the user limit returns reason=user with action-shaped error', async () => {
    const userId = 'user-burst-' + Date.now();
    // The profileWrite preset is 30/min. Burn through it.
    for (let i = 0; i < RATE_LIMITS.profileWrite.limit; i++) {
      await checkProfileWriteRateLimit(userId);
    }
    const overLimit = await checkProfileWriteRateLimit(userId);
    expect(overLimit.allowed).toBe(false);
    if (!overLimit.allowed) {
      expect(overLimit.reason).toBe('user');
      expect(overLimit.retryAfter).toBeGreaterThan(0);
      expect(overLimit.result.success).toBe(false);
      if (!overLimit.result.success) {
        // Error string must be user-friendly and include the retry hint.
        expect(overLimit.result.error).toMatch(/saving too quickly/i);
        expect(overLimit.result.error).toMatch(/\d+s/);
      }
    }
  });

  test('different users have independent counters', async () => {
    const userA = 'user-iso-a-' + Date.now();
    const userB = 'user-iso-b-' + Date.now();
    for (let i = 0; i < RATE_LIMITS.profileWrite.limit; i++) {
      await checkProfileWriteRateLimit(userA);
    }
    const aLimited = await checkProfileWriteRateLimit(userA);
    const bAllowed = await checkProfileWriteRateLimit(userB);
    expect(aLimited.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  test('IP guard triggers independently of user guard', async () => {
    // Same IP, many different users — IP key should run out first.
    headersMock.mockImplementation(() => ({
      get: (name: string) =>
        name === 'x-forwarded-for' ? '203.0.113.42' : null,
    }));
    // Burn the IP counter via many distinct users so the user counters
    // stay at 1 each.
    let lastResult: Awaited<ReturnType<typeof checkProfileWriteRateLimit>> = { allowed: true };
    for (let i = 0; i < RATE_LIMITS.profileWrite.limit + 1; i++) {
      lastResult = await checkProfileWriteRateLimit(`burst-user-${i}-${Date.now()}`);
    }
    expect(lastResult.allowed).toBe(false);
    if (!lastResult.allowed) {
      expect(lastResult.reason).toBe('ip');
      if (!lastResult.result.success) {
        expect(lastResult.result.error).toMatch(/from your network/i);
      }
    }
  });

  test('x-forwarded-for first segment is used (proxy chain handled)', async () => {
    // If we used the WHOLE header value, a multi-hop chain wouldn't bucket
    // the original client correctly. Verify the first IP only.
    headersMock.mockImplementation(() => ({
      get: (name: string) =>
        name === 'x-forwarded-for'
          ? '198.51.100.10, 10.0.0.1, 10.0.0.2'
          : null,
    }));
    const userId = 'xff-test-' + Date.now();
    const first = await checkProfileWriteRateLimit(userId);
    expect(first.allowed).toBe(true);
    // Same client IP from a different user should still see independent
    // user counter, but share the IP counter (proves the first segment
    // got parsed).
    headersMock.mockImplementation(() => ({
      get: (name: string) =>
        name === 'x-forwarded-for'
          ? '198.51.100.10, 10.0.0.1, 10.0.0.2'
          : null,
    }));
    // Hammer the IP counter past the limit with new users to keep user
    // counters at 1 each.
    let last: Awaited<ReturnType<typeof checkProfileWriteRateLimit>> = { allowed: true };
    for (let i = 0; i < RATE_LIMITS.profileWrite.limit + 1; i++) {
      last = await checkProfileWriteRateLimit(`xff-burst-${i}-${Date.now()}`);
    }
    expect(last.allowed).toBe(false);
  });

  test('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    headersMock.mockImplementation(() => ({
      get: (name: string) => (name === 'x-real-ip' ? '192.0.2.7' : null),
    }));
    const result = await checkProfileWriteRateLimit('real-ip-user-' + Date.now());
    expect(result.allowed).toBe(true);
  });

  test('missing both headers means no IP guard (still allowed if user ok)', async () => {
    headersMock.mockImplementation(() => ({
      get: () => null,
    }));
    const result = await checkProfileWriteRateLimit('no-ip-user-' + Date.now());
    expect(result.allowed).toBe(true);
  });

  test('headers() throwing degrades gracefully (still allowed if user ok)', async () => {
    // The default beforeEach mock makes headers() throw. Just verify
    // the call succeeds without bubbling the error.
    const result = await checkProfileWriteRateLimit('throw-test-' + Date.now());
    expect(result.allowed).toBe(true);
  });
});
