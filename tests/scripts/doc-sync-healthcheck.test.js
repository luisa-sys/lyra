const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/doc-sync-healthcheck.sh');

function run(args) {
  // Returns { code, out }. Real SHAs are passed so the script needs no network.
  try {
    const out = execSync(`bash "${SCRIPT}" ${args}`, { stdio: 'pipe' }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || Buffer.from('')).toString() };
  }
}

describe('scripts/doc-sync-healthcheck.sh', () => {
  let source = '';
  beforeAll(() => { source = fs.readFileSync(SCRIPT, 'utf8'); });

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened and never silent-skips', () => {
    expect(source).toMatch(/set -uo pipefail/);
    expect(source).not.toMatch(/\|\|\s*echo\s*"/);
  });

  it('PASS when recorded SHAs equal real main SHAs', () => {
    const { code, out } = run('aaaaaaaa bbbbbbbb aaaaaaaa bbbbbbbb');
    expect(out).toMatch(/PASS\tlyra/);
    expect(out).toMatch(/PASS\tmcp/);
    expect(code).toBe(0);
  });

  it('FAILs (exit 2) when real main is ahead — using a forced weekday', () => {
    // Force a weekday via the `date` shim on PATH so the test is deterministic.
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsh-'));
    fs.writeFileSync(path.join(dir, 'date'), '#!/usr/bin/env bash\necho Monday\n');
    fs.chmodSync(path.join(dir, 'date'), 0o755);
    let code = 0;
    let out = '';
    try {
      out = execSync(`bash "${SCRIPT}" aaaaaaaa bbbbbbbb ffffffff bbbbbbbb`, {
        stdio: 'pipe',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      }).toString();
    } catch (e) {
      code = e.status;
      out = (e.stdout || Buffer.from('')).toString();
    }
    expect(out).toMatch(/FAIL\tlyra/);
    expect(code).toBe(2);
  });

  it('OK (exit 0) when real main is ahead on a forced weekend', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dsh-'));
    fs.writeFileSync(path.join(dir, 'date'), '#!/usr/bin/env bash\necho Sunday\n');
    fs.chmodSync(path.join(dir, 'date'), 0o755);
    const out = execSync(`bash "${SCRIPT}" aaaaaaaa bbbbbbbb ffffffff bbbbbbbb`, {
      stdio: 'pipe',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    }).toString();
    expect(out).toMatch(/OK\tlyra/);
    expect(out).toMatch(/RESULT: OK \(weekend/);
  });
});
