const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const SCRIPT = path.resolve(__dirname, '../../scripts/routine-watchdog.sh');

// A fixed "now" so day-of-week and freshness maths are deterministic.
// 2026-07-04 is a Saturday; 2026-07-01 is a Wednesday.
const SAT_NOON = '2026-07-04T12:00:00Z';
const WED_NOON = '2026-07-01T12:00:00Z';

// Run the watchdog with a pinned WATCHDOG_NOW. Returns { code, out }.
// The script is READ-ONLY and needs no network — timestamps are passed in.
function run(args, now = SAT_NOON) {
  const quoted = args.map((a) => `'${a}'`).join(' ');
  try {
    const out = execSync(`bash "${SCRIPT}" ${quoted}`, {
      stdio: 'pipe',
      env: { ...process.env, WATCHDOG_NOW: now },
    }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || Buffer.from('')).toString() };
  }
}

describe(SRC.routineWatchdog, () => {
  let source = '';
  beforeAll(() => { source = fs.readFileSync(SCRIPT, 'utf8'); });

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened and never silent-skips', () => {
    // Workflow & Backup Integrity Policy: set -uo pipefail, no `|| true`, no
    // `|| echo "..."` placeholder-masking. Unreadable input must be UNVERIFIED.
    // Strip comment lines first so a comment *describing* the absent pattern
    // (e.g. "There are no `|| true` guards.") doesn't trip the assertion —
    // we care about executable code, not prose.
    const code = source
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(source).toMatch(/set -uo pipefail/);
    expect(code).not.toMatch(/\|\|\s*true/);
    expect(code).not.toMatch(/\|\|\s*echo\s*"/);
  });

  it('is read-only: no mutating verbs', () => {
    // Defence-in-depth: the watchdog must not write anything.
    expect(source).not.toMatch(/curl[^\n]*-X\s*(POST|PUT|DELETE|PATCH)/);
    expect(source).not.toMatch(/gh\s+(pr|issue|api)[^\n]*(create|--method\s*P)/);
  });

  it('exit 0 + PASS when every routine is fresh', () => {
    const { code, out } = run([
      'daily-security|1800|2026-07-04T07:00:00Z|PASS',
      'weekly-health|11520|2026-07-01T06:30:00Z|PASS',
    ]);
    expect(out).toMatch(/PASS\tdaily-security/);
    expect(out).toMatch(/PASS\tweekly-health/);
    expect(out).toMatch(/# RESULT: PASS/);
    expect(code).toBe(0);
  });

  it('exit 2 + FAIL when a routine is OVERDUE past its budget', () => {
    // 1800m budget; last heartbeat ~2 days ago on a weekday routine.
    const { code, out } = run(['daily-security|1800|2026-07-02T07:00:00Z|PASS']);
    expect(out).toMatch(/FAIL\tdaily-security/);
    expect(out).toMatch(/OVERDUE/);
    expect(out).toMatch(/# RESULT: FAIL/);
    expect(code).toBe(2);
  });

  it('exit 2 + FAIL when the last recorded outcome was FAIL, even if fresh', () => {
    const { code, out } = run(['weekly-health|11520|2026-07-04T06:30:00Z|FAIL']);
    expect(out).toMatch(/FAIL\tweekly-health/);
    expect(out).toMatch(/last recorded outcome was FAIL/);
    expect(code).toBe(2);
  });

  it('exit 1 + UNVERIFIED when a timestamp is missing (never a silent PASS)', () => {
    const { code, out } = run([
      'daily-security|1800|2026-07-04T07:00:00Z|PASS',
      'doc-sync|2000|-|UNKNOWN',
    ]);
    expect(out).toMatch(/PASS\tdaily-security/);
    expect(out).toMatch(/UNVERIFIED\tdoc-sync/);
    expect(out).toMatch(/# RESULT: UNVERIFIED/);
    expect(code).toBe(1);
  });

  it('exit 1 + UNVERIFIED on an unparseable timestamp', () => {
    const { code, out } = run(['doc-sync|2000|not-a-date|PASS']);
    expect(out).toMatch(/UNVERIFIED\tdoc-sync/);
    expect(out).toMatch(/could not parse/);
    expect(code).toBe(1);
  });

  it('exit 1 + UNVERIFIED on a bad (non-integer) cadence', () => {
    const { code, out } = run(['doc-sync|abc|2026-07-04T07:00:00Z|PASS']);
    expect(out).toMatch(/UNVERIFIED\tdoc-sync/);
    expect(out).toMatch(/bad max_age_minutes/);
    expect(code).toBe(1);
  });

  it('exit 1 + UNVERIFIED on a future heartbeat (clock skew / bad row)', () => {
    const { code, out } = run(['daily-security|1800|2026-07-05T07:00:00Z|PASS']);
    expect(out).toMatch(/UNVERIFIED\tdaily-security/);
    expect(out).toMatch(/FUTURE/);
    expect(code).toBe(1);
  });

  it('weekend-graces a weekday-only routine (UNVERIFIED, not FAIL) on Sat', () => {
    // Overdue but the routine only runs weekdays and today is Saturday.
    const { code, out } = run(['doc-sync|2000|2026-07-02T08:15:00Z|PASS|weekday'], SAT_NOON);
    expect(out).toMatch(/UNVERIFIED\tdoc-sync/);
    expect(out).toMatch(/runs weekdays only/);
    expect(code).toBe(1);
  });

  it('does NOT grace a weekday-only routine when overdue on a weekday (FAIL)', () => {
    // Same routine, but "now" is a Wednesday — overdue must be a real FAIL.
    const { code, out } = run(['doc-sync|2000|2026-06-29T08:15:00Z|PASS|weekday'], WED_NOON);
    expect(out).toMatch(/FAIL\tdoc-sync/);
    expect(out).toMatch(/# RESULT: FAIL/);
    expect(code).toBe(2);
  });

  it('exit 1 + UNVERIFIED when no checks are supplied', () => {
    const { code, out } = run([]);
    expect(out).toMatch(/UNVERIFIED\targs/);
    expect(code).toBe(1);
  });

  it('emits a machine-readable summary line', () => {
    const { out } = run(['daily-security|1800|2026-07-04T07:00:00Z|PASS']);
    expect(out).toMatch(/# summary\tPASS=1\tFAIL=0\tUNVERIFIED=0/);
  });

  it('derives day-of-week from WATCHDOG_NOW (deterministic), not the live clock', () => {
    const sat = run(['daily-security|1800|2026-07-04T07:00:00Z|PASS'], SAT_NOON);
    expect(sat.out).toMatch(/\(Saturday\)/);
    const wed = run(['daily-security|1800|2026-07-01T07:00:00Z|PASS'], WED_NOON);
    expect(wed.out).toMatch(/\(Wednesday\)/);
  });

  // --- SEC-79: registry-named owner-workflow disabled detection (optional 6th field) ---

  it('exit 2 + FAIL when an owner workflow is disabled_manually, even if the heartbeat is fresh', () => {
    // health-check is fresh + last outcome PASS, but the WORKFLOW is disabled →
    // the liveness backstop is DARK. Must FAIL, not report a green PASS.
    const { code, out } = run(['health-check|540|2026-07-04T11:00:00Z|PASS||disabled_manually']);
    expect(out).toMatch(/FAIL\thealth-check/);
    expect(out).toMatch(/DISABLED \(disabled_manually\)/);
    expect(out).toMatch(/DARK/);
    expect(out).toMatch(/# RESULT: FAIL/);
    expect(code).toBe(2);
  });

  it('flags disabled_inactivity as FAIL too', () => {
    const { code, out } = run(['health-check|540|2026-07-04T11:00:00Z|PASS||disabled_inactivity']);
    expect(out).toMatch(/FAIL\thealth-check/);
    expect(out).toMatch(/DISABLED \(disabled_inactivity\)/);
    expect(code).toBe(2);
  });

  it('the disabled check wins over freshness — a stale AND disabled workflow reports DISABLED, not OVERDUE', () => {
    const { code, out } = run(['health-check|540|2026-06-01T00:00:00Z|PASS||disabled_manually']);
    expect(out).toMatch(/FAIL\thealth-check/);
    expect(out).toMatch(/DISABLED/);
    expect(out).not.toMatch(/OVERDUE/);
    expect(code).toBe(2);
  });

  it('treats an active workflow_state as normal — fresh still PASSes', () => {
    const { code, out } = run(['health-check|540|2026-07-04T11:00:00Z|PASS||active']);
    expect(out).toMatch(/PASS\thealth-check/);
    expect(out).toMatch(/# RESULT: PASS/);
    expect(code).toBe(0);
  });

  it('exit 1 + UNVERIFIED on an unrecognised workflow_state (a typo must not mask a real disable)', () => {
    const { code, out } = run(['health-check|540|2026-07-04T11:00:00Z|PASS||disabledd']);
    expect(out).toMatch(/UNVERIFIED\thealth-check/);
    expect(out).toMatch(/unrecognised workflow_state/);
    expect(code).toBe(1);
  });

  it('is backward-compatible: a 5-field token (weekday, no state field) still weekend-graces', () => {
    // Proves adding the 6th field did not shift weekday parsing.
    const { code, out } = run(['doc-sync|2000|2026-07-02T08:15:00Z|PASS|weekday'], SAT_NOON);
    expect(out).toMatch(/UNVERIFIED\tdoc-sync/);
    expect(out).toMatch(/runs weekdays only/);
    expect(code).toBe(1);
  });
});
