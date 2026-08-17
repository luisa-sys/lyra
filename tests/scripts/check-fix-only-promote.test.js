const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.resolve(REPO_ROOT, SRC.checkFixOnlyPromote);

// Build a throwaway git repo with a `main` branch and a `beta` branch whose
// commits (ahead of main) are the supplied subjects, then run the guard over
// the main..beta range. Returns { status, output }.
//
// Each entry in `betaCommits` is either a string (a normal commit subject) or
// { merge: [subjectA, subjectB] } to fabricate a real merge commit (2 parents)
// on beta — used to prove merge commits are skipped.
function runOverHistory(mode, betaCommits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixonly-'));
  const git = (args) =>
    execSync(`git ${args}`, { cwd: dir, stdio: 'pipe' }).toString();
  try {
    git('init -q');
    git('config user.email test@example.com');
    git('config user.name tester');
    git('config commit.gpgsign false');
    git('commit -q --allow-empty -m "chore: repo base"');
    git('branch -M main');
    git('checkout -q -b beta');
    for (const c of betaCommits) {
      if (typeof c === 'object' && c.merge) {
        // Make a side branch with one commit, then merge it into beta with
        // --no-ff so the merge commit (2 parents) actually materialises.
        git('checkout -q -b side main');
        git(`commit -q --allow-empty -m ${JSON.stringify(c.merge[1])}`);
        git('checkout -q beta');
        git(
          `merge --no-ff -q side -m ${JSON.stringify(c.merge[0])}`,
        );
        git('branch -q -D side');
      } else {
        git(`commit -q --allow-empty -m ${JSON.stringify(c)}`);
      }
    }
    let status = 0;
    let output = '';
    try {
      output = execSync(`bash "${SCRIPT}" ${JSON.stringify(mode)}`, {
        cwd: dir,
        stdio: 'pipe',
        env: { ...process.env, BASE: 'main', HEAD: 'beta' },
      }).toString();
    } catch (err) {
      status = err.status || 1;
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }
    return { status, output };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe(SRC.checkFixOnlyPromote, () => {
  let source = '';

  beforeAll(() => {
    source = fs.readFileSync(SCRIPT, 'utf8');
  });

  it('exists and is a bash script', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('is syntactically valid (bash -n)', () => {
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened with set -euo pipefail', () => {
    expect(source).toMatch(/set -euo pipefail/);
  });

  describe('manual mode (the gate is a no-op)', () => {
    it('exits 0 without inspecting commits when mode != auto-fix-only', () => {
      const { status, output } = runOverHistory('manual', [
        'feat(x): a brand new feature',
      ]);
      expect(status).toBe(0);
      expect(output).toMatch(/not applicable/i);
      // It must NOT have walked the range / flagged the feature.
      expect(output).not.toMatch(/features must not auto-promote/);
    });

    it('exits 0 for an unknown mode string too (fail-open only for manual paths)', () => {
      const { status } = runOverHistory('', ['feat: x']);
      expect(status).toBe(0);
    });
  });

  describe('auto-fix-only mode', () => {
    it('PASSES when every pending commit is a fix-family change', () => {
      const { status, output } = runOverHistory('auto-fix-only', [
        'fix(SEC-1): patch a real bug',
        'docs: clarify runbook',
        'chore(deps): bump a patch dependency',
        'test: add a regression test',
        'revert: undo a bad fix',
      ]);
      expect(status).toBe(0);
      expect(output).toMatch(/fix-only — auto-promote may proceed/);
    });

    it('FAILS when any pending commit is a feature (feat)', () => {
      const { status, output } = runOverHistory('auto-fix-only', [
        'fix(SEC-1): patch a real bug',
        'feat(profile): add a shiny new capability',
      ]);
      expect(status).not.toBe(0);
      expect(output).toMatch(/features must not auto-promote/);
      expect(output).toMatch(/BLOCKED/);
    });

    it('FAILS on a breaking change even if typed as fix (fix!)', () => {
      const { status, output } = runOverHistory('auto-fix-only', [
        'fix!: drop a legacy column',
      ]);
      expect(status).not.toBe(0);
      expect(output).toMatch(/breaking change/);
    });

    it('FAILS on a commit with no conventional-commit type (ambiguous → stop)', () => {
      const { status, output } = runOverHistory('auto-fix-only', [
        'just did some stuff',
      ]);
      expect(status).not.toBe(0);
      expect(output).toMatch(/no conventional-commit type/);
    });

    it('FAILS on a recognised-but-non-allowlisted type (e.g. perf/refactor → stop)', () => {
      const { status, output } = runOverHistory('auto-fix-only', [
        'refactor: reshape a module',
      ]);
      expect(status).not.toBe(0);
      expect(output).toMatch(/not in the fix-only allow-list/);
    });

    it('SKIPS merge commits — a fix-only release with merge commits still passes', () => {
      const { status, output } = runOverHistory('auto-fix-only', [
        'fix(SEC-2): a bug fix',
        { merge: ['Merge pull request #123 from some/branch', 'fix(SEC-3): another fix'] },
      ]);
      expect(status).toBe(0);
      expect(output).toMatch(/fix-only — auto-promote may proceed/);
    });

    it('FAILS closed on an empty promote range (nothing to promote)', () => {
      const { status, output } = runOverHistory('auto-fix-only', []);
      expect(status).not.toBe(0);
      expect(output).toMatch(/no non-merge commits/);
    });

    it('FAILS closed when the base ref does not exist', () => {
      // Drive the script directly with a bogus BASE so the fail-closed ref
      // guard fires.
      let status = 0;
      let output = '';
      try {
        output = execSync(`bash "${SCRIPT}" auto-fix-only`, {
          cwd: REPO_ROOT,
          stdio: 'pipe',
          env: { ...process.env, BASE: 'origin/does-not-exist-xyz', HEAD: 'HEAD' },
        }).toString();
      } catch (err) {
        status = err.status || 1;
        output = `${err.stdout || ''}${err.stderr || ''}`;
      }
      expect(status).not.toBe(0);
      expect(output).toMatch(/not found/);
    });
  });
});
