/**
 * Guard test for CTL-026 (scripts/check-control-registry.py) — SEC-119.
 *
 * CTL-026 is the META-control: it is what notices that some OTHER control has
 * stopped being invoked. Until SEC-119 it had no test of its own at all, which
 * is a slightly uncomfortable thing to write down — the artefact whose job is
 * to catch "a control nobody runs" was itself a control nobody tested.
 *
 * Two defects were fixed, and this file exists to keep both fixed:
 *
 *   (a) The invocation test was a bare substring scan over whole file text, so
 *       a `#` comment MENTIONING a control satisfied "this file invokes it".
 *       CTL-001 claimed promote-to-production.yml as a wiring on the strength
 *       of two explanatory comments, and neutering its one real `run:` line
 *       left this checker green at exit 0.
 *
 *   (b) Satisfaction was ANY-of across `wired_in` — one flag, raised by
 *       whichever target matched, tested once at the end. A live sibling
 *       covered for a stale entry, so a wiring that had rotted could never be
 *       reported by name.
 *
 * The load-bearing cases here are the two that run the REAL
 * `.github/workflows/pr-checks.yml` through the checker with one line
 * neutered. A fixture can prove the logic; only the real file can prove the
 * logic is pointed at the thing we care about. Both assert the unmutated file
 * passes first, so a case cannot go green because the mutation silently
 * matched nothing.
 *
 * The checker is driven as a subprocess (the tests/scripts convention) rather
 * than reimplemented — see CLAUDE.md "Writing a test that can actually fail",
 * failure mode 1. It resolves `controls/registry.json` and every path relative
 * to its CWD, so a sandbox directory is all that is needed to drive it.
 */
const { spawnSync } = require('node:child_process');
const { resolve, dirname } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SRC } = require('../support/source-paths.json');

const ROOT = resolve(__dirname, '../..');
// scripts/check-control-registry.py
const SCRIPT = resolve(ROOT, SRC.checkControlRegistry);
const PR_CHECKS = resolve(ROOT, SRC.prChecks);

// Sandbox fixture paths are COMPOSED rather than written as path literals.
// They name files that exist only inside a throwaway directory, so they are
// not repo source paths and must not enter the `SRC` manifest — but the F4
// raw-literal ratchet cannot tell the two apart, and raising a shrink-only
// baseline to accommodate fixtures is how a ratchet decays into a suppression
// list. Composing them keeps the ratchet honest without pretending these are
// manifest-worthy paths. `SRC.prChecks` is used for the one path that IS a
// real repo file.
const WORKFLOW_DIR = ['.github', 'workflows'].join('/');
const SCRIPT_DIR = 'scripts';
const wf = (name) => `${WORKFLOW_DIR}/${name}`;
const scriptPath = (name) => `${SCRIPT_DIR}/${name}`;

const PR_YML = wf('pr.yml');
const STALE_YML = wf('stale.yml');
const PR_INI = wf('pr.ini');
const THING_SH = scriptPath('check-thing.sh');
const INTEGRITY_SH = scriptPath('check-workflow-integrity.sh');

const run = (cwd, args = []) =>
  spawnSync('python3', [SCRIPT, ...args], { cwd, encoding: 'utf-8' });

/** A throwaway repo root containing only what a case needs. */
const sandbox = () => {
  const dir = fs.mkdtempSync(resolve(os.tmpdir(), 'ctl026-'));
  fs.mkdirSync(resolve(dir, 'controls'), { recursive: true });
  fs.mkdirSync(resolve(dir, SCRIPT_DIR), { recursive: true });
  fs.mkdirSync(resolve(dir, WORKFLOW_DIR), { recursive: true });
  return dir;
};

const writeRegistry = (dir, controls) =>
  fs.writeFileSync(resolve(dir, 'controls/registry.json'), JSON.stringify({ controls }, null, 2));

const control = (over = {}) => ({
  id: 'CTL-001',
  name: 'Thing',
  defect_class: 'x',
  summary: 's',
  implementation: THING_SH,
  kind: 'ci-gate',
  wired_in: [PR_YML],
  prevents: ['BUGS-1'],
  ...over,
});

describe('CTL-026 — control-registry integrity (SEC-119)', () => {
  it('passes its own self-test, over a corpus that has not shrunk', () => {
    const r = run(ROOT, ['--self-test']);
    expect(r.status).toBe(0);
    // A count floor, not an equality: the number may only grow, and an
    // "N/N passed" tally that nobody re-derives is failure mode 8.
    const m = /all (\d+) case\(s\) behave as specified/.exec(r.stdout);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(21);
    expect(r.stdout).not.toMatch(/^\s*FAIL\s/m);
  });

  it('is green against the committed registry', () => {
    const r = run(ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Every registered control exists, is invoked');
  });

  describe('(a) a mention inside a comment is not an invocation', () => {
    it('fails a control whose only reference is in a comment, and names the file', () => {
      const dir = sandbox();
      fs.writeFileSync(resolve(dir, THING_SH), '#!/bin/bash\n');
      fs.writeFileSync(
        resolve(dir, PR_YML),
        '# this used to run scripts/check-thing.sh\njobs:\n  x:\n    steps:\n      - run: echo hi\n',
      );
      writeRegistry(dir, [control()]);

      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(PR_YML);
      expect(r.stdout).toContain("does not reference 'check-thing.sh' outside comments");
    });

    it('passes the same file once the name is on a real run: line', () => {
      const dir = sandbox();
      fs.writeFileSync(resolve(dir, THING_SH), '#!/bin/bash\n');
      fs.writeFileSync(
        resolve(dir, PR_YML),
        '# scripts/check-thing.sh is explained here\n' +
          'jobs:\n  x:\n    steps:\n      - run: bash scripts/check-thing.sh\n',
      );
      writeRegistry(dir, [control()]);

      const r = run(dir);
      expect(r.status).toBe(0);
    });

    it('reports a wired_in file type it cannot decide, rather than assuming it clean', () => {
      const dir = sandbox();
      fs.writeFileSync(resolve(dir, THING_SH), '#!/bin/bash\n');
      fs.writeFileSync(resolve(dir, PR_INI), '; scripts/check-thing.sh\n');
      writeRegistry(dir, [control({ wired_in: [PR_INI] })]);

      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('no known comment syntax');
      expect(r.stdout).toContain('.ini');
    });
  });

  describe('(b) every wired_in target carries its own proof', () => {
    it('reports a stale target by name even when a live sibling invokes the control', () => {
      const dir = sandbox();
      fs.writeFileSync(resolve(dir, THING_SH), '#!/bin/bash\n');
      fs.writeFileSync(
        resolve(dir, PR_YML),
        'jobs:\n  x:\n    steps:\n      - run: bash scripts/check-thing.sh\n',
      );
      fs.writeFileSync(resolve(dir, STALE_YML), 'jobs:\n  x:\n    steps:\n      - run: echo hi\n');
      writeRegistry(dir, [
        control({ wired_in: [PR_YML, STALE_YML] }),
      ]);

      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('stale.yml');
      // The live sibling is not the finding — only the rotted wiring is.
      expect(r.stdout).not.toContain(`target '${PR_YML}' does not reference`);
    });
  });

  describe('the real pr-checks.yml wiring', () => {
    /**
     * Copy the genuine pr-checks.yml into a sandbox, optionally replacing one
     * line, and run the checker against a registry of exactly that control.
     */
    const againstRealPrChecks = (registryControl, mutate) => {
      const dir = sandbox();
      const impl = registryControl.implementation;
      fs.mkdirSync(resolve(dir, dirname(impl)), { recursive: true });
      fs.writeFileSync(resolve(dir, impl), '# stub\n');
      let yaml = fs.readFileSync(PR_CHECKS, 'utf-8');
      if (mutate) {
        const mutated = mutate(yaml);
        // Failure mode: a replace that matches nothing produces a green run
        // indistinguishable from a real one. Prove the edit landed.
        expect(mutated).not.toBe(yaml);
        yaml = mutated;
      }
      fs.writeFileSync(resolve(dir, SRC.prChecks), yaml);
      writeRegistry(dir, [registryControl]);
      return run(dir);
    };

    const CTL_001 = control({
      implementation: INTEGRITY_SH,
      wired_in: [SRC.prChecks],
    });

    const CTL_046 = control({
      id: 'CTL-046',
      implementation: 'eslint.config.mjs',
      wired_in: [SRC.prChecks],
    });

    it('accepts CTL-001 today, and goes red if its run: line is neutered', () => {
      expect(againstRealPrChecks(CTL_001).status).toBe(0);

      const r = againstRealPrChecks(CTL_001, (y) =>
        y.replace('run: bash scripts/check-workflow-integrity.sh', "run: echo 'guard removed'"),
      );
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("does not reference 'check-workflow-integrity.sh' outside comments");
    });

    it('accepts CTL-046 today, and goes red if the config stops being named on the command line', () => {
      expect(againstRealPrChecks(CTL_046).status).toBe(0);

      // CTL-046's implementation is a tool CONFIG, not a script named on a
      // command line, so `npm run lint` reaches it only by convention. Until
      // SEC-119 the registry's proof that it was invoked was a trailing
      // comment; drop the argument and the wiring is unproven again.
      const r = againstRealPrChecks(CTL_046, (y) =>
        y.replace('run: npm run lint -- --config eslint.config.mjs', 'run: npm run lint'),
      );
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("does not reference 'eslint.config.mjs' outside comments");
    });
  });
});
