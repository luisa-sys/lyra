const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/check-macos-duplicate-files.sh');

// Run the guard from inside `cwd` (a throwaway git repo). Returns { code, out }.
function run(cwd) {
  try {
    const out = execSync(`bash "${SCRIPT}"`, { stdio: 'pipe', cwd }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${(e.stdout || '')}${(e.stderr || '')}` };
  }
}

// Build a minimal git repo containing `files` (map of relative path -> contents),
// all committed so `git ls-files` sees them.
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macdup-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  execSync('git add -A && git commit -q -m fixture', { cwd: dir });
  return dir;
}

describe('scripts/check-macos-duplicate-files.sh (KAN-357)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened (set -euo pipefail, no lossy || echo fallback)', () => {
    expect(source).toMatch(/set -euo pipefail/);
    expect(source).not.toMatch(/\|\|\s*echo\s*"/);
  });

  it('PASSES (exit 0) on a clean tree', () => {
    const dir = makeRepo({ 'src/app/route.ts': 'export const a = 1;\n', 'README.md': '# ok\n' });
    const { code, out } = run(dir);
    expect(code).toBe(0);
    expect(out).toMatch(/No macOS Finder-duplicate files committed/);
  });

  it('FAILS (exit 1) on a Finder-duplicate FILE ("<name> 2.cjs")', () => {
    const dir = makeRepo({ 'tests/unit/profile-sections 2.cjs': 'x\n' });
    const { code, out } = run(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/duplicated file: 'profile-sections 2\.cjs'/);
  });

  it('FAILS (exit 1) on a Finder-duplicate DIRECTORY ("[slug] 2/")', () => {
    const dir = makeRepo({ 'src/app/api/recommendations/[slug] 2/route.ts': 'export const x = 1;\n' });
    const { code, out } = run(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/duplicated directory component: '\[slug\] 2'/);
  });

  it('does NOT false-positive on legitimate names without a space-before-digit suffix', () => {
    const dir = makeRepo({
      'src/lib/step2.ts': 'export const a = 1;\n',
      'src/lib/v2/index.ts': 'export const b = 2;\n',
      'docs/RFC-2119.md': '# terms\n',
    });
    const { code } = run(dir);
    expect(code).toBe(0);
  });
});
