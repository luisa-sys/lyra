const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.resolve(REPO_ROOT, 'scripts/check-action-pinning.sh');

// Run the guard with a given working directory. Returns { status, output }.
// status 0 == all actions pinned; non-zero == at least one un-pinned action.
// The script echoes ::error:: annotations to stdout, so capture both streams.
function runIn(cwd) {
  try {
    const output = execSync(`bash "${SCRIPT}"`, { cwd, stdio: 'pipe' }).toString();
    return { status: 0, output };
  } catch (err) {
    return {
      status: err.status || 1,
      output: `${err.stdout || ''}${err.stderr || ''}`,
    };
  }
}

// Build a throwaway repo root containing only .github/workflows/<name>.yml
// with the supplied contents, then run the script against it.
function runWithWorkflow(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
  const wfDir = path.join(dir, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, name), contents);
  try {
    return runIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A real 40-hex commit SHA (actions/checkout, as pinned across the tree).
const SHA = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd';

function wf(steps) {
  return (
    'name: T\n' +
    'on: { push: {} }\n' +
    'jobs:\n' +
    '  a:\n' +
    '    runs-on: ubuntu-latest\n' +
    '    steps:\n' +
    steps
  );
}

describe('scripts/check-action-pinning.sh', () => {
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

  it('passes cleanly against the real .github/workflows tree', () => {
    // Integration guard: every action in the repo's real workflows is already
    // SHA-pinned (SEC-20 #356), so the guard must be green on the live tree.
    const { status, output } = runIn(REPO_ROOT);
    expect(output).toContain('All workflow actions are SHA-pinned');
    expect(status).toBe(0);
  });

  it('FAILS on a mutable tag ref (@v4)', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf('      - uses: actions/checkout@v4\n')
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/un-pinned action/);
    expect(output).toMatch(/actions\/checkout@v4/);
  });

  it('FAILS on a mutable branch ref (@main)', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf('      - uses: some/action@main\n')
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/un-pinned action/);
  });

  it('FAILS on a nested-path action pinned to a tag (github/codeql-action/init@v4)', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf('      - uses: github/codeql-action/init@v4\n')
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/codeql-action\/init@v4/);
  });

  it('PASSES on a full 40-hex commit SHA (with a version comment)', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf(`      - uses: actions/checkout@${SHA} # v6\n`)
    );
    expect(output).not.toMatch(/un-pinned action/);
    expect(status).toBe(0);
  });

  it('PASSES on a full 40-hex commit SHA with no trailing comment', () => {
    const { status } = runWithWorkflow(
      't.yml',
      wf(`      - uses: actions/checkout@${SHA}\n`)
    );
    expect(status).toBe(0);
  });

  it('PASSES on a docker image sha256 digest', () => {
    const digest = '0'.repeat(64);
    const { status } = runWithWorkflow(
      't.yml',
      wf(`      - uses: docker://alpine@sha256:${digest}\n`)
    );
    expect(status).toBe(0);
  });

  it('exempts a local (./) reusable workflow', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf('      - uses: ./.github/workflows/reusable.yml\n')
    );
    expect(output).not.toMatch(/un-pinned action/);
    expect(status).toBe(0);
  });

  it('honours an explicit # integrity-ok: pin waiver on the offending line', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf('      - uses: foo/bar@v9 # integrity-ok: pin intentional floating tag\n')
    );
    expect(output).not.toMatch(/un-pinned action/);
    expect(status).toBe(0);
  });

  it('counts every un-pinned reference, not just the first', () => {
    const { status, output } = runWithWorkflow(
      't.yml',
      wf(
        '      - uses: actions/checkout@v4\n' +
          '      - uses: some/action@main\n' +
          `      - uses: actions/setup-node@${SHA} # v6\n`
      )
    );
    expect(status).not.toBe(0);
    // Two mutable refs; the SHA-pinned one is not counted.
    expect(output).toMatch(/Found 2 un-pinned action reference\(s\)/);
  });
});
