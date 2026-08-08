/**
 * Guard test for CTL-040 (scripts/check-design-baseline.py) — KAN-457.
 *
 * SEC-79 is the standing precedent for why a control needs its own test rather
 * than trusting the workflow step that invokes it: `health-check.yml` and
 * `weekly-report.yml` sat disabled for over a month while reporting green.
 *
 * The load-bearing case here is "FIRES on a move with no re-baseline". This
 * control exists precisely because the thing it replaces — a prose attestation
 * a developer satisfies by typing `done` — could not be seen to fail. A gate
 * that has never been observed failing is indistinguishable from no gate, and
 * shipping this one without that proof would repeat the defect it was written
 * to close.
 *
 * Everything runs against a SYNTHETIC repo built in tmpdir, not this one. That
 * is deliberate: CTL-038's and CTL-039's guard tests staged probes into the
 * real `.git/index` and collided on `index.lock` under CI's worker count
 * (PR #693). A throwaway repo has no shared index to contend over, and it also
 * lets the base commit carry a baseline — which this branch's own merge-base
 * cannot, since it is the PR that introduces the file.
 */
const { spawnSync, execFileSync } = require('node:child_process');
const { resolve, join } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SRC } = require('../support/source-paths.json');

const ROOT = resolve(__dirname, '../..');
const REGISTRY = 'controls/registry.json';
const SCRIPT = resolve(ROOT, SRC.checkDesignBaseline);
const BASELINE = SRC.baseline;
// Fixture paths are the REAL design surfaces on purpose: this test asserts that
// `src/components/**` is design-bearing, so if that path ever moves, this file
// must be revisited. Naming them through the manifest is what makes that true.
const CARD = `${SRC.components}/card.tsx`;
const CARD_MOVED = `${SRC.components}/card-new.tsx`;

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf-8',
  });

/**
 * A repo with a baseline and a component already committed on `base-branch`,
 * plus a copy of the control at the same relative path so its own
 * `parents[1]` root resolution is exercised rather than stubbed.
 */
function makeRepo() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ctl040-'));
  fs.mkdirSync(join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(join(dir, 'design'), { recursive: true });
  fs.mkdirSync(join(dir, SRC.components), { recursive: true });
  fs.mkdirSync(join(dir, SRC.libOauth), { recursive: true });

  fs.copyFileSync(SCRIPT, join(dir, SRC.checkDesignBaseline));
  fs.writeFileSync(
    join(dir, BASELINE),
    JSON.stringify({ baseline_ref: 'aaaaaaaaaaaa1111' }),
  );
  fs.writeFileSync(join(dir, CARD), 'export const C = 1;\n');
  fs.writeFileSync(join(dir, SRC.jwt), 'export const j = 1;\n');

  git(dir, 'init', '-q', '.');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'branch', '-q', 'base-branch');
  return dir;
}

const run = (dir) =>
  spawnSync('python3', [join(dir, SRC.checkDesignBaseline)], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, BASE_REF: 'base-branch' },
  });

const setBaseline = (dir, ref) =>
  fs.writeFileSync(join(dir, BASELINE), JSON.stringify({ baseline_ref: ref }));

describe('CTL-040 — design re-baseline gate', () => {
  let dir;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('passes its own self-test', () => {
    const r = spawnSync('python3', [SCRIPT, '--self-test'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(r.stdout).toContain('self-test: OK');
    expect(r.status).toBe(0);
  });

  it('FIRES (exit 1) when a design-bearing file moves and the baseline does not', () => {
    // The case the prose attestation could not catch: the move happened, the
    // human typed nothing, and nothing in the repo records a re-baseline.
    dir = makeRepo();
    git(dir, 'mv', CARD, CARD_MOVED);
    git(dir, 'commit', '-qm', 'move card');

    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('still points at aaaaaaaaaaaa');
    expect(r.stdout).toContain(CARD);
  });

  it('passes when the same PR records a new baseline_ref', () => {
    dir = makeRepo();
    git(dir, 'mv', CARD, CARD_MOVED);
    setBaseline(dir, 'bbbbbbbbbbbb2222');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'move card + re-baseline');

    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('aaaaaaaaaaaa -> bbbbbbbbbbbb');
  });

  it('is INERT for a move that cannot break a design pointer', () => {
    // If a lib move demanded a re-baseline, every extraction PR would need one
    // and people would reach for the escape hatch by reflex — which is how a
    // gate becomes noise and then becomes ignored.
    dir = makeRepo();
    git(dir, 'mv', SRC.jwt, `${SRC.libOauth}/tokens.ts`);
    git(dir, 'commit', '-qm', 'move lib');

    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('not a re-baseline PR');
  });

  it('does not fire on a pure EDIT of a design-bearing file', () => {
    // Editing a component changes the design, but the design system's pointer
    // still resolves. This gate is about relocation; claiming more than that
    // would be a scope it cannot actually verify.
    dir = makeRepo();
    fs.writeFileSync(join(dir, CARD), 'export const C = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'edit card');

    expect(run(dir).status).toBe(0);
  });

  it('honours an attributed escape hatch, and prints it loudly', () => {
    dir = makeRepo();
    git(dir, 'mv', CARD, CARD_MOVED);
    git(dir, 'commit', '-qm', 'move card\n\nDesign-Baseline-Ok: KAN-457 test-only helper');

    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('EXCEPTION in force');
    expect(r.stdout).toContain('KAN-457');
  });

  it('ignores a hatch with no reason — a bare key must not suppress', () => {
    // `Design-Baseline-Ok: KAN-1` with no reason is the zero-effort bypass. If
    // it worked, the gate would degrade back into the prose attestation it
    // replaced.
    dir = makeRepo();
    git(dir, 'mv', CARD, CARD_MOVED);
    git(dir, 'commit', '-qm', 'move card\n\nDesign-Baseline-Ok: KAN-457');

    expect(run(dir).status).toBe(1);
  });

  it('fails CLOSED (exit 2) when the baseline is unparseable', () => {
    dir = makeRepo();
    git(dir, 'mv', CARD, CARD_MOVED);
    fs.writeFileSync(join(dir, BASELINE), 'not json');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'move card + break baseline');

    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('Failing closed');
  });

  it('fails CLOSED (exit 2) when baseline_ref is emptied', () => {
    // Blanking the field is the cheapest way to make a ref "change". It must
    // read as unverifiable, not as a fresh baseline.
    dir = makeRepo();
    git(dir, 'mv', CARD, CARD_MOVED);
    setBaseline(dir, '');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'move card + empty ref');

    expect(run(dir).status).toBe(2);
  });

  it('is registered and wired into CI', () => {
    const registry = JSON.parse(fs.readFileSync(resolve(ROOT, REGISTRY), 'utf-8'));
    const ctl = registry.controls.find((c) => c.id === 'CTL-040');
    expect(ctl).toBeDefined();
    expect(ctl.implementation).toBe(SRC.checkDesignBaseline);
    expect(ctl.prevents).toContain('KAN-457');

    const wf = fs.readFileSync(resolve(ROOT, SRC.prChecks), 'utf-8');
    expect(wf).toContain(`${SRC.checkDesignBaseline} --self-test`);
  });

  it('ships a baseline that names a real design repo and a full-length ref', () => {
    const b = JSON.parse(fs.readFileSync(resolve(ROOT, BASELINE), 'utf-8'));
    expect(b.design_repo).toContain('lyra-design-system');
    // A short or placeholder ref would make drift undetectable by inspection.
    expect(b.baseline_ref).toMatch(/^[0-9a-f]{40}$/);
  });
});
