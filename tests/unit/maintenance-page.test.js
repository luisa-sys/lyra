/**
 * Maintenance page Worker logic tests
 * KAN-129: Email interest capture form
 *
 * Tests the validation and rate-limiting logic extracted from the Worker.
 * The actual Worker runs on Cloudflare, but we test the core logic here.
 */

// Extract validation logic from Worker for testing
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function createRateLimiter() {
  const map = new Map();
  return {
    isRateLimited(ip) {
      const now = Date.now();
      const entry = map.get(ip);
      if (!entry) {
        map.set(ip, { count: 1, windowStart: now });
        return false;
      }
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        map.set(ip, { count: 1, windowStart: now });
        return false;
      }
      if (entry.count >= RATE_LIMIT_MAX) {
        return true;
      }
      entry.count++;
      return false;
    },
    _map: map,
  };
}

describe('KAN-129: Maintenance page email validation', () => {
  test('accepts valid email addresses', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
  });

  test('rejects invalid email addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123)).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('@nolocal.com')).toBe(false);
    expect(isValidEmail('no@')).toBe(false);
    expect(isValidEmail('spaces in@email.com')).toBe(false);
  });

  test('rejects emails over 254 characters', () => {
    const longLocal = 'a'.repeat(250);
    expect(isValidEmail(`${longLocal}@example.com`)).toBe(false);
  });
});

describe('KAN-129: Rate limiter', () => {
  test('allows first request from an IP', () => {
    const limiter = createRateLimiter();
    expect(limiter.isRateLimited('1.2.3.4')).toBe(false);
  });

  test('allows up to RATE_LIMIT_MAX requests', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(limiter.isRateLimited('1.2.3.4')).toBe(false);
    }
  });

  test('blocks after RATE_LIMIT_MAX requests', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      limiter.isRateLimited('1.2.3.4');
    }
    expect(limiter.isRateLimited('1.2.3.4')).toBe(true);
  });

  test('different IPs have independent limits', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      limiter.isRateLimited('1.2.3.4');
    }
    expect(limiter.isRateLimited('1.2.3.4')).toBe(true);
    expect(limiter.isRateLimited('5.6.7.8')).toBe(false);
  });
});

describe('KAN-129: Worker code file integrity', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');
  const workerPath = path.join(root, 'scripts/lyra-maintenance-worker.js');

  test('worker script file exists', () => {
    expect(fs.existsSync(workerPath)).toBe(true);
  });

  test('worker contains app description for Google OAuth verification', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('Lyra is a profile platform');
    expect(content).toContain('class="app-description"');
  });

  test('worker does not contain mailto: links', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).not.toContain('mailto:');
  });

  test('worker contains email capture form', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('interestForm');
    expect(content).toContain('type="email"');
    expect(content).toContain('Notify me');
  });

  test('worker contains KV interaction code', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('INTEREST_EMAILS');
    expect(content).toContain('.put(email');
    expect(content).toContain('.get(email');
  });

  test('worker contains rate limiting', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('isRateLimited');
    expect(content).toContain('RATE_LIMIT_MAX');
  });

  test('worker handles missing KV binding gracefully', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('!env.INTEREST_EMAILS');
    expect(content).toContain('503');
  });

  // KAN-169: meta robots should be `noindex` only — `nofollow` may cause
  // OAuth verifiers and other crawlers to refuse to follow the privacy/terms
  // links, which in turn can cause Google OAuth verification to fail.
  test('meta robots tag uses noindex without nofollow', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    // Must include the noindex meta tag (we still don't want pre-launch page indexed)
    expect(content).toMatch(/<meta\s+name="robots"\s+content="noindex"\s*\/>/);
    // Must NOT include nofollow anywhere in the meta robots directive
    expect(content).not.toMatch(/<meta\s+name="robots"[^>]*nofollow/);
  });

  // KAN-169: privacy policy link must be present and reachable from the
  // homepage. This was the issue Google's OAuth verifier flagged on
  // 2026-04-05. Guard against accidental removal.
  test('homepage HTML contains a privacy policy link', () => {
    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('href="https://checklyra.com/privacy"');
    expect(content).toMatch(/>Privacy Policy</);
  });
});
