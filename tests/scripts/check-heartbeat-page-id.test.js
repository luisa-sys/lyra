/**
 * Guard test for CTL-061 (scripts/check-heartbeat-page-id.py) — BUGS-81.
 *
 * SEC-79 is the precedent for why a control needs its own test rather than
 * trusting the workflow step that invokes it: `health-check.yml` and
 * `weekly-report.yml` sat disabled for over a month while reporting green.
 *
 * What this asserts, beyond "the self-test passes":
 *
 *   1. The guard is GREEN against the real tree — so a red here is a finding
 *      about the repo, not about the fixtures.
 *   2. It FIRES on the actual BUGS-81 defect, applied to the actual anchor doc
 *      in a sandbox copy. The self-test proves the matcher works on synthetic
 *      strings; this proves it works on the file it exists to protect. Those
 *      are different claims, and the second is the one that failed during
 *      development — R2's first cut passed every fixture and stayed GREEN on a
 *      one-line repoint of the live doc.
 *   3. It FAILS CLOSED (exit 2, never 0) when the anchor doc is absent. A guard
 *      that reports clean over a scan that never ran is gotcha #30.
 *   4. It is registered in controls/registry.json and wired into a workflow.
 */
const { spawnSync } = require('node:child_process');
const { resolve, join, dirname } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SRC } = require('../support/source-paths.json');

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, SRC.checkHeartbeatPageId);

// Named directly rather than via SRC: `docs/` is not one of the roots the
// source-path generator admits (see tests/support/source-path-seeds.ts), so a
// manifest key for it could never be regenerated.
const ANCHOR = 'docs/OPS_ROUTINES_CONTROL_ROOM.md';

const OPS_ROUTINES_PAGE_ID = '34275370';
const AUTOPILOT_PAGE_ID = '33554434';

const run = (args = [], opts = {}) =>
  spawnSync('python3', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    ...opts,
  });

/**
 * A throwaway git repo containing only the files the guard reads. The corpus
 * comes from `git ls-files`, so a sandbox has to be a real repo — and building
 * one is also what lets case 3 remove the anchor doc without touching the
 * working tree.
 */
function sandbox(anchorText) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ctl061-'));
  if (anchorText !== null) {
    fs.mkdirSync(dirname(join(dir, ANCHOR)), { recursive: true });
    fs.writeFileSync(join(dir, ANCHOR), anchorText);
  } else {
    // Something must be tracked, or the guard fails closed on the empty corpus
    // instead of on the missing anchor — a different assertion.
    fs.writeFileSync(join(dir, 'README.md'), '# placeholder\n');
  }
  for (const cmd of [
    ['init', '-q'],
    ['add', '-A'],
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'],
  ]) {
    spawnSync('git', ['-C', dir, ...cmd], { encoding: 'utf-8' });
  }
  return dir;
}

describe('CTL-061 — ops-heartbeat page-id guard (BUGS-81)', () => {
  it('passes its own self-test', () => {
    const r = run(['--self-test']);
    expect(r.stdout).toContain('behave as specified');
    expect(r.status).toBe(0);
  });

  it('is green against the real tree', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('consistent');
  });

  it('the anchor doc still names the ops-routines page as the heartbeat source', () => {
    const text = fs.readFileSync(resolve(ROOT, ANCHOR), 'utf-8');
    expect(text).toContain(OPS_ROUTINES_PAGE_ID);
  });

  // The mutation, run against the real doc rather than a synthetic string.
  it('FIRES when the anchor doc repoints the heartbeat ledger at the autopilot page', () => {
    const original = fs.readFileSync(resolve(ROOT, ANCHOR), 'utf-8');
    const mutated = original.replace(
      new RegExp(OPS_ROUTINES_PAGE_ID, 'g'),
      AUTOPILOT_PAGE_ID,
    );
    // Assert the mutation applied. A replace that silently matches nothing
    // produces a run indistinguishable from a clean one (CLAUDE.md).
    expect(mutated).not.toBe(original);

    const dir = sandbox(mutated);
    try {
      const r = run(['--root', dir]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('violation');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The single-line repoint that defeated this control's first cut. Kept as a
  // separate case from the wholesale one above because they fail differently:
  // this one leaves the disambiguation prose intact, so R1 is satisfied and
  // only R2 can see it.
  it('FIRES on a ONE-LINE repoint with the surrounding disambiguation intact', () => {
    const original = fs.readFileSync(resolve(ROOT, ANCHOR), 'utf-8');
    const line = original
      .split('\n')
      .find((l) => /Heartbeat \/ Run-ledger table lives on/.test(l));
    expect(line).toBeDefined();

    const mutated = original.replace(
      line,
      line.replace(OPS_ROUTINES_PAGE_ID, AUTOPILOT_PAGE_ID),
    );
    expect(mutated).not.toBe(original);
    // Everything except that one line is untouched, so the doc still says
    // 34275370 elsewhere — which is exactly what bought the false green.
    expect(mutated).toContain(OPS_ROUTINES_PAGE_ID);

    const dir = sandbox(mutated);
    try {
      const r = run(['--root', dir]);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('R2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAILS CLOSED (exit 2) when the anchor doc is missing, never reporting clean', () => {
    const dir = sandbox(null);
    try {
      const r = run(['--root', dir]);
      expect(r.status).toBe(2);
      expect(r.status).not.toBe(0);
      expect(r.stdout).toContain('failing closed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is registered in controls/registry.json and wired into a workflow', () => {
    const registry = JSON.parse(
      fs.readFileSync(resolve(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const ctl = registry.controls.find((c) => c.id === 'CTL-061');
    expect(ctl).toBeDefined();
    expect(ctl.implementation).toBe(SRC.checkHeartbeatPageId);
    expect(ctl.prevents).toContain('BUGS-81');
    expect(ctl.wired_in.length).toBeGreaterThan(0);

    for (const wf of ctl.wired_in) {
      const text = fs.readFileSync(resolve(ROOT, wf), 'utf-8');
      expect(text).toContain(SRC.checkHeartbeatPageId);
    }
  });
});
