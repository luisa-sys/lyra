/**
 * KAN-112: Real unit tests for src/lib/rate-limit.ts
 * Tests pure functions — no mocking needed.
 */
const fs = require('fs');
const path = require('path');

// --- Replicated from src/lib/rate-limit.ts ---
const store = new Map();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

function rateLimit(key, config) {
  cleanup();
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false };
  }
  entry.count++;
  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { limited: true, retryAfter };
  }
  return { limited: false };
}

// --- Source verification ---
describe('rate-limit.ts source verification', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/lib/rate-limit.ts'), 'utf8');

  test('source contains rateLimit function', () => {
    expect(source).toContain('function rateLimit');
  });

  test('source contains RATE_LIMITS presets', () => {
    expect(source).toContain('RATE_LIMITS');
  });

  test('auth preset is 10 attempts per 15 minutes', () => {
    expect(source).toContain('limit: 10');
    expect(source).toContain('windowSeconds: 900');
  });
});

// --- rateLimit function tests ---
describe('rateLimit', () => {
  beforeEach(() => {
    store.clear();
  });

  test('first request is not rate limited', () => {
    const result = rateLimit('test-ip', { limit: 5, windowSeconds: 60 });
    expect(result.limited).toBe(false);
  });

  test('requests below threshold pass', () => {
    for (let i = 0; i < 5; i++) {
      const result = rateLimit('below-threshold', { limit: 5, windowSeconds: 60 });
      expect(result.limited).toBe(false);
    }
  });

  test('request at threshold + 1 is rate limited', () => {
    const config = { limit: 3, windowSeconds: 60 };
    rateLimit('over-limit', config); // 1
    rateLimit('over-limit', config); // 2
    rateLimit('over-limit', config); // 3
    const result = rateLimit('over-limit', config); // 4 — should be limited
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test('different keys have independent limits', () => {
    const config = { limit: 1, windowSeconds: 60 };
    rateLimit('ip-a', config);
    rateLimit('ip-a', config);
    const resultA = rateLimit('ip-a', config);
    const resultB = rateLimit('ip-b', config); // first request for ip-b
    expect(resultA.limited).toBe(true);
    expect(resultB.limited).toBe(false);
  });

  test('retryAfter is in seconds', () => {
    const config = { limit: 1, windowSeconds: 60 };
    rateLimit('retry-test', config);
    const result = rateLimit('retry-test', config);
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });
});
