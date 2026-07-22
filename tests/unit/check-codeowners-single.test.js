/**
 * Unit tests for scripts/check-codeowners-single.sh
 * SEC-3 (GOV-01): CODEOWNERS single-source-of-truth guard.
 *
 * GitHub uses only the first CODEOWNERS it finds (.github/ > root > docs/) and
 * silently ignores the rest. Two CODEOWNERS files means the lower-precedence
 * one is dead. This guard fails the PR on that condition so the audit's
 * per-path "second pair of eyes" ownership can never be silently defeated
 * again (as it was before 2026-07-13). The tests exercise each fixture:
 * one valid file (either location), multiple files, no file, no default owner.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-codeowners-single.sh');
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'codeowners');

function runScript(root) {
  return spawnSync('bash', [SCRIPT, root], { encoding: 'utf8' });
}

describe('check-codeowners-single.sh', () => {
  describe('single CODEOWNERS in .github/ (canonical)', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'single-github'));
    });
    test('exits 0', () => {
      expect(result.status).toBe(0);
    });
    test('reports the winning file', () => {
      expect(result.stdout).toMatch(/exactly one file \(\.github\/CODEOWNERS\)/);
    });
  });

  describe('single CODEOWNERS at repository root', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'single-root'));
    });
    test('exits 0 (root-only is valid — no shadowing)', () => {
      expect(result.status).toBe(0);
    });
    test('reports CODEOWNERS as the winner', () => {
      expect(result.stdout).toMatch(/exactly one file \(CODEOWNERS\)/);
    });
  });

  describe('multiple CODEOWNERS files (shadowing)', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'multiple'));
    });
    test('exits 1 (non-zero)', () => {
      expect(result.status).toBe(1);
    });
    test('flags multiple files with an ::error annotation', () => {
      expect(result.stdout).toMatch(/::error::Multiple CODEOWNERS files found/);
    });
    test('names both offending files', () => {
      expect(result.stdout).toMatch(/\.github\/CODEOWNERS/);
      expect(result.stdout).toMatch(/(?:^|[^/])CODEOWNERS/);
    });
  });

  describe('no CODEOWNERS file', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'none'));
    });
    test('exits 1 (non-zero)', () => {
      expect(result.status).toBe(1);
    });
    test('flags the absence', () => {
      expect(result.stdout).toMatch(/::error::No CODEOWNERS file found/);
    });
  });

  describe('CODEOWNERS without a default owner', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'no-default'));
    });
    test('exits 1 (non-zero)', () => {
      expect(result.status).toBe(1);
    });
    test('flags the missing catch-all owner', () => {
      expect(result.stdout).toMatch(/no default-owner line/);
    });
  });

  describe('the real repository', () => {
    let result;
    beforeAll(() => {
      // No arg → script infers the repo root from its own path.
      result = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    });
    test('passes — the repo has exactly one CODEOWNERS with a default owner', () => {
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/single-source-of-truth OK/);
    });
  });
});
