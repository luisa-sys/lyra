/**
 * KAN-414 F4 (KAN-417 §8 group 3) — real coverage for the maintenance worker's
 * email capture, replacing the vacuous half of tests/unit/maintenance-page.test.js.
 *
 * THIS ONE IS NOT A WEAK TEST BEING STRENGTHENED. IT IS A HOLE.
 * -------------------------------------------------------------
 * `maintenance-page.test.js` opens by re-declaring the worker's own logic
 * inside the test file —
 *
 *     // Extract validation logic from Worker for testing
 *     function isValidEmail(email) { ... }
 *     function createRateLimiter() { ... }
 *
 * — and then tests those copies. Its header says so plainly: *"The actual
 * Worker runs on Cloudflare, but we test the core logic here."*
 * `scripts/lyra-maintenance-worker.js` is never loaded by it.
 *
 * PROVEN VACUOUS (2026-08-01), by mutating the WORKER and re-running that suite:
 *
 *   | Mutation applied to the worker            | maintenance-page.test.js |
 *   |-------------------------------------------|--------------------------|
 *   | `isValidEmail`  -> `return true`          | 19/19 PASS               |
 *   | `isRateLimited` -> `return false`         | 19/19 PASS               |
 *
 * So the public maintenance page's email-capture form had **no effective
 * coverage on either its input validation or its abuse limiting**, while
 * reporting 19 green tests. That is the shape CLAUDE.md warns about: a control
 * that has never been seen to fail is indistinguishable from no control.
 *
 * It matters more this week than last: BUGS-19 closed 2026-07-31, making this
 * worker's repo-owned workflow the single live deploy path to production.
 *
 * HOW IT RUNS
 * -----------
 * The worker is an ES module and `jest.config.js` transforms only `.ts`/`.tsx`.
 * Adding a `.js` transform would change how ~100 existing `.js` test files
 * execute — a jest.config change affecting test behaviour, which the Test
 * Integrity Policy puts behind sign-off. So this follows the convention already
 * used throughout `tests/scripts/`: invoke the real thing in a subprocess.
 * `tests/support/maintenance-worker-harness.mjs` imports the actual worker,
 * exercises it, and prints observations as JSON. Assertions live here.
 */
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const HARNESS = resolve(__dirname, '../support/maintenance-worker-harness.mjs');

let obs;
beforeAll(() => {
  // One spawn for the whole suite: the worker's rate-limit map is
  // module-level, so scenarios are separated by IP inside the harness rather
  // than by process.
  obs = JSON.parse(
    execFileSync(process.execPath, [HARNESS], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
});

describe('maintenance worker — input validation (behavioural)', () => {
  it('refuses an invalid address with 400 and writes NOTHING to KV', () => {
    expect(obs.invalid.status).toBe(400);
    // The status is the symptom; the absent write is the property.
    expect(obs.invalid.kvSize).toBe(0);
  });

  it('refuses an address over 254 characters', () => {
    expect(obs.tooLong.status).toBe(400);
    expect(obs.tooLong.kvSize).toBe(0);
  });

  it('accepts a valid address and stores a well-formed record', () => {
    expect(obs.valid.status).toBe(200);
    expect(obs.valid.keys).toEqual(['ada@example.com']);
    expect(obs.valid.record).toMatchObject({
      email: 'ada@example.com',
      source: 'maintenance-page',
    });
  });

  it('normalises case and surrounding whitespace before storing', () => {
    // Without this the duplicate check below is bypassable with `Ada@…`.
    expect(obs.normalised.keys).toEqual(['ada@example.com']);
  });
});

describe('maintenance worker — storage semantics (behavioural)', () => {
  it('treats a duplicate as idempotent — 200, one row, unchanged', () => {
    expect(obs.duplicate.status).toBe(200);
    expect(obs.duplicate.kvSize).toBe(1);
    expect(obs.duplicate.unchanged).toBe(true);
  });

  it('fails CLOSED with 503 when the KV binding is absent', () => {
    // Reporting success for an address that was never stored is the failure
    // this guards: the visitor believes they are on the list and are not.
    expect(obs.noKvBinding.status).toBe(503);
  });
});

describe('maintenance worker — abuse limiting (behavioural)', () => {
  it('allows 5 requests from one IP then returns 429', () => {
    expect(obs.rateLimit.codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('sets Retry-After when it limits', () => {
    expect(obs.retryAfter).toBe('3600');
  });

  it('keeps budgets independent per IP', () => {
    // A new visitor must not inherit someone else's exhausted budget.
    expect(obs.perIpIsolation.freshStatus).toBe(200);
  });
});

describe('maintenance worker — notification escaping (SEC-21 F-23)', () => {
  it('escapes HTML metacharacters in the rendered email body', () => {
    expect(obs.escaping.calledResend).toBe(true);
    // `isValidEmail`'s local part is `[^\s@]+`, so `<b>x</b>@example.com` is a
    // VALID address by the worker's own rules and does reach the body.
    // escapeHtml is the only thing standing between it and markup injection
    // into the owner's inbox.
    expect(obs.escaping.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(obs.escaping.html).not.toContain('<b>x</b>');
  });

  it('leaves the subject line unescaped, which is correct for plain text', () => {
    // Pinned deliberately rather than left unstated: the subject is NOT
    // escaped, and that is fine because mail clients render it as plain text.
    // Recording it here means a future reader does not have to re-derive
    // whether the asymmetry is a bug.
    expect(obs.escaping.subject).toContain('<b>x</b>@example.com');
  });
});
