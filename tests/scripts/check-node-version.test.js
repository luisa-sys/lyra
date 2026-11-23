/**
 * SEC-174 — the Node-version preflight wired as jest globalSetup.
 * Tests the pure check, so it runs on any Node without faking the runtime.
 */
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkNodeVersion, majorOf } = require('../../scripts/check-node-version.cjs');

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'check-node-version.cjs');

describe('majorOf', () => {
  it.each([
    ['24', 24],
    ['v24', 24],
    ['24.11.0', 24],
    ['v25.8.1', 25],
    ['24\n', 24],
  ])('parses %j as %d', (input, expected) => {
    expect(majorOf(input)).toBe(expected);
  });

  it.each(['lts/*', 'node', '', 'x24'])('returns null for non-numeric %j', (input) => {
    expect(majorOf(input)).toBeNull();
  });
});

describe('checkNodeVersion', () => {
  it('accepts any release of the .nvmrc major', () => {
    expect(checkNodeVersion({ actual: '24.0.0', required: '24\n' }).ok).toBe(true);
    expect(checkNodeVersion({ actual: '24.11.1', required: '24\n' }).ok).toBe(true);
  });

  it('rejects Node 25 against a .nvmrc of 24 and names the fix', () => {
    const result = checkNodeVersion({ actual: '25.8.1', required: '24\n' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Node 24');
    expect(result.message).toContain('25.8.1');
    expect(result.message).toContain('brew install node@24');
  });

  it('rejects a lower major too (not just odd releases)', () => {
    expect(checkNodeVersion({ actual: '22.12.0', required: '24' }).ok).toBe(false);
    expect(checkNodeVersion({ actual: '26.0.0', required: '24' }).ok).toBe(false);
  });

  it('fails closed on a non-numeric .nvmrc', () => {
    const result = checkNodeVersion({ actual: '24.0.0', required: 'lts/*' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('lts/*');
  });
});

describe('wiring', () => {
  it('jest.config.js runs the preflight as globalSetup', () => {
    const config = require('../../jest.config.js');
    expect(config.globalSetup).toBe('<rootDir>/scripts/check-node-version.cjs');
  });

  // End to end: run the real script (which reads the real .nvmrc) under a
  // preloaded shim that fakes the runtime version, and assert the exit code.
  const runAs = (fakeVersion) => {
    const dir = mkdtempSync(join(tmpdir(), 'nodever-'));
    const shim = join(dir, 'shim.cjs');
    writeFileSync(
      shim,
      `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(fakeVersion)} });`,
    );
    const env = { ...process.env, NODE_OPTIONS: `--require ${shim}` };
    return spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  };

  it('the script exits 0 on the .nvmrc major (24)', () => {
    const r = runAs('24.11.1');
    expect(r.status).toBe(0);
  });

  it('the script exits 1 on Node 25 with the fix on stderr', () => {
    const r = runAs('25.8.1');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('brew install node@24');
  });
});
