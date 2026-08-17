const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.resolve(REPO_ROOT, SRC.checkWorkflowIntegrity);

// Run the integrity script with a given working directory. Returns
// { status, output }. status 0 == clean; non-zero == integrity problem(s).
// The script echoes its ::error:: annotations to stdout, so we capture both.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfint-'));
  const wfDir = path.join(dir, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, name), contents);
  try {
    return runIn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe(SRC.checkWorkflowIntegrity, () => {
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
    // Integration guard: the repo's actual workflows (including the SEC-86
    // documented residual on promote-to-production.yml) must be clean.
    const { status, output } = runIn(REPO_ROOT);
    expect(output).toContain('No workflow integrity issues found');
    expect(status).toBe(0);
  });

  describe('Pattern 5 — prod-promote merge-to-main gate (SEC-86 Finding A)', () => {
    it('defines Pattern 5 keyed on the push-to-main promote action', () => {
      expect(source).toMatch(/Pattern 5/);
      expect(source).toMatch(/git push origin main/);
      expect(source).toMatch(/sec-86/i);
    });

    // A promote-style workflow: pushes to main, typed-confirm gate present.
    const confirmGate =
      "        run: |\n" +
      '          if [ "${{ github.event.inputs.confirm }}" != "PRODUCTION" ]; then\n' +
      '            exit 1\n' +
      '          fi\n' +
      '          git config user.name ci\n';
    const pushMain = '          git push origin main\n';

    it('5a: FAILS when the merge job has no environment gate and no waiver', () => {
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: { inputs: { confirm: { description: \'Type "PRODUCTION"\' } } } }\n' +
        'jobs:\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        '      - name: merge\n' +
        confirmGate +
        pushMain;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(status).not.toBe(0);
      expect(output).toMatch(/Pattern 5a/);
    });

    it('5a: PASSES when the residual is documented via an integrity-ok sec-86 waiver', () => {
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: { inputs: { confirm: { description: \'Type "PRODUCTION"\' } } } }\n' +
        'jobs:\n' +
        '  # integrity-ok: sec-86 residual documented in RELEASE_POLICY.md\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        '      - name: merge\n' +
        confirmGate +
        pushMain;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(output).not.toMatch(/Pattern 5a/);
      expect(status).toBe(0);
    });

    it('5a: PASSES when the merge job carries environment: production', () => {
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: { inputs: { confirm: { description: \'Type "PRODUCTION"\' } } } }\n' +
        'jobs:\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    environment: production\n' +
        '    steps:\n' +
        '      - name: merge\n' +
        confirmGate +
        pushMain;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(output).not.toMatch(/Pattern 5a/);
      expect(status).toBe(0);
    });

    it('5b: FAILS when the typed-confirm gate is removed (merge left ungated)', () => {
      // Environment gate present (so 5a is satisfied) but no inputs.confirm /
      // "PRODUCTION" typed-confirm control — 5b must catch the regression.
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: {} }\n' +
        'jobs:\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    environment: production\n' +
        '    steps:\n' +
        '      - name: merge\n' +
        '        run: |\n' +
        '          git config user.name ci\n' +
        pushMain;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(status).not.toBe(0);
      expect(output).toMatch(/Pattern 5b/);
    });

    it('does not fire on workflows that never push to main', () => {
      const wf =
        'name: CI\n' +
        'on: { push: { branches: [develop] } }\n' +
        'jobs:\n' +
        '  test:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        '      - run: npm test\n';
      const { status, output } = runWithWorkflow('ci.yml', wf);
      expect(output).not.toMatch(/Pattern 5/);
      expect(status).toBe(0);
    });
  });

  describe('Pattern 6 — broad long-lived PAT pushing to main (SEC-66 / SoD)', () => {
    it('defines Pattern 6 keyed on the broad-PAT push-to-main path', () => {
      expect(source).toMatch(/Pattern 6/);
      expect(source).toMatch(/git push origin main/);
      expect(source).toMatch(/LYRA_RELEASE_PAT/);
      expect(source).toMatch(/sec-66/i);
    });

    // A promote-style workflow whose merge job otherwise satisfies Pattern 5
    // (environment: production reviewer gate + typed-confirm control), so that
    // Pattern 6 is the ONLY thing under test. It checks out with the broad PAT
    // and pushes to main.
    const checkoutWithPat =
      '      - uses: actions/checkout@v6\n' +
      '        with:\n' +
      '          token: ${{ secrets.LYRA_RELEASE_PAT }}\n';
    const confirmGateAndPush =
      "        run: |\n" +
      '          if [ "${{ github.event.inputs.confirm }}" != "PRODUCTION" ]; then\n' +
      '            exit 1\n' +
      '          fi\n' +
      '          git config user.name ci\n' +
      '          git push origin main\n';

    it('FAILS when a workflow pushes to main with LYRA_RELEASE_PAT and no sec-66 waiver', () => {
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: { inputs: { confirm: { description: \'Type "PRODUCTION"\' } } } }\n' +
        'jobs:\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    environment: production\n' +
        '    steps:\n' +
        checkoutWithPat +
        '      - name: merge\n' +
        confirmGateAndPush;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(status).not.toBe(0);
      expect(output).toMatch(/Pattern 6/);
    });

    it('PASSES when the broad-PAT residual is documented via an integrity-ok sec-66 waiver', () => {
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: { inputs: { confirm: { description: \'Type "PRODUCTION"\' } } } }\n' +
        'jobs:\n' +
        '  # integrity-ok: sec-66 broad-PAT push-to-main residual documented in RELEASE_POLICY.md\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    environment: production\n' +
        '    steps:\n' +
        checkoutWithPat +
        '      - name: merge\n' +
        confirmGateAndPush;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(output).not.toMatch(/Pattern 6/);
      expect(status).toBe(0);
    });

    it('does not fire when a push-to-main workflow uses a non-broad token (the SEC-66 end state)', () => {
      // Fine-grained short-lived token instead of LYRA_RELEASE_PAT — Pattern 6
      // must not fire (Pattern 5 is satisfied by the environment gate + confirm).
      const wf =
        'name: Promote\n' +
        'on: { workflow_dispatch: { inputs: { confirm: { description: \'Type "PRODUCTION"\' } } } }\n' +
        'jobs:\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    environment: production\n' +
        '    steps:\n' +
        '      - uses: actions/checkout@v6\n' +
        '        with:\n' +
        '          token: ${{ steps.app-token.outputs.token }}\n' +
        '      - name: merge\n' +
        confirmGateAndPush;
      const { status, output } = runWithWorkflow('promote.yml', wf);
      expect(output).not.toMatch(/Pattern 6/);
      expect(status).toBe(0);
    });

    it('does not fire on a workflow that uses LYRA_RELEASE_PAT but never pushes to main', () => {
      // Uses the broad PAT to push a NON-main branch (e.g. staging/beta promote).
      // Pattern 6 is scoped to the irreversible push-to-main only, so it must
      // stay silent here.
      const wf =
        'name: Promote to beta\n' +
        'on: { workflow_dispatch: {} }\n' +
        'jobs:\n' +
        '  merge:\n' +
        '    runs-on: ubuntu-latest\n' +
        '    steps:\n' +
        checkoutWithPat +
        '      - name: merge\n' +
        '        run: |\n' +
        '          git config user.name ci\n' +
        '          git push origin beta\n';
      const { status, output } = runWithWorkflow('promote-beta.yml', wf);
      expect(output).not.toMatch(/Pattern 6/);
      expect(status).toBe(0);
    });
  });
});
