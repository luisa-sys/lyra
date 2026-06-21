const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/security-alert-email.sh');

describe('scripts/security-alert-email.sh', () => {
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

  it('is hardened with set -uo pipefail', () => {
    expect(source).toMatch(/set -uo pipefail/);
  });

  it('fails LOUD when RESEND_API_KEY is missing (no silent-skip)', () => {
    // Run with an empty env so RESEND_API_KEY is unset; must exit non-zero.
    let exitCode = 0;
    try {
      execSync(`echo "x" | RESEND_API_KEY= bash "${SCRIPT}" "test"`, {
        stdio: 'pipe',
        env: { PATH: process.env.PATH },
      });
    } catch (e) {
      exitCode = e.status;
    }
    expect(exitCode).toBe(1);
  });

  it('does not silent-skip on missing secret (no "|| echo" placeholder pattern)', () => {
    expect(source).not.toMatch(/\|\|\s*echo\s*"/);
  });

  it('posts to the Resend API and checks the response code', () => {
    expect(source).toContain('https://api.resend.com/emails');
    expect(source).toMatch(/exit 1/);
  });
});
