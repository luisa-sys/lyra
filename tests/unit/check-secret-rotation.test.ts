/**
 * KAN-170: smoke tests for scripts/check-secret-rotation.py.
 *
 * The Python parser is the load-bearing piece. We invoke the script as
 * a subprocess with synthetic --today values and assert the output
 * categorises correctly: errors, warnings, "Initial setup" stragglers,
 * and the all-clear path.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/check-secret-rotation.py');

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('python3', [SCRIPT, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 };
  }
}

describe('check-secret-rotation.py', () => {
  test('with today set right after rotation: no errors, no in-window warnings, only Initial-setup advisories', () => {
    const r = run(['--today', '2026-05-05', '--warn-days', '30']);
    // Some "Initial setup" rows are present in the doc, so we assert their
    // advisory line and that the script exits 0 (advisory only).
    expect(r.stdout).toMatch(/never rotated/);
    expect(r.stdout).not.toMatch(/rotation OVERDUE/);
    expect(r.stdout).not.toMatch(/rotation due 20\d\d-/);
    expect(r.exitCode).toBe(0);
  });

  test('within window of LYRA_RELEASE_PAT due date: warning + non-zero exit', () => {
    // PATs were rotated 28-29 April 2026 with annual cadence → due 2027-04-28/29.
    // 14 days before = 2027-04-15.
    const r = run(['--today', '2027-04-15', '--warn-days', '30']);
    expect(r.stdout).toMatch(/LYRA_RELEASE_PAT: rotation due 2027-04-29/);
    expect(r.stdout).toMatch(/LYRA_BACKUP_PAT: rotation due 2027-04-28/);
    expect(r.exitCode).toBe(1);
  });

  test('after due date: OVERDUE message + non-zero exit', () => {
    const r = run(['--today', '2027-05-15', '--warn-days', '30']);
    expect(r.stdout).toMatch(/LYRA_RELEASE_PAT: rotation OVERDUE by/);
    expect(r.exitCode).toBe(1);
  });

  test('with --warn-days=0: no in-window warnings unless overdue', () => {
    // The day OF rotation due is days_until=0 → marked overdue per script logic.
    // The day BEFORE is days_until=1, which with --warn-days=0 is not in window.
    const r = run(['--today', '2027-04-27', '--warn-days', '0']);
    expect(r.stdout).not.toMatch(/rotation due/);
    expect(r.stdout).not.toMatch(/OVERDUE/);
    expect(r.exitCode).toBe(0);
  });

  test('skips rows with "Only on suspicion" cadence (no-schedule path)', () => {
    // The Sentry DSN row uses "Only on suspicion" — should be skipped
    // entirely (no warning, no error). Verify by looking at a date well
    // past any annual rotation: the DSN row should NOT appear in any
    // category, but the annual-cadence rows would. We assert the DSN row
    // isn't flagged as overdue/in-window/unparseable.
    const r = run(['--today', '2027-04-15', '--warn-days', '30']);
    expect(r.stdout).not.toMatch(/Sentry DSN/);
    // sanity check: scheduled-cadence rows still get flagged
    expect(r.stdout).toMatch(/LYRA_RELEASE_PAT|LYRA_BACKUP_PAT/);
  });
});
