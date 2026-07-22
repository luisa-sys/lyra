const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/check-doc-mirror-manifest.sh');
const REPO_ROOT = path.resolve(__dirname, '../..');

// Run the guard with an optional env overlay. Returns { code, out }.
function run(env = {}) {
  try {
    const out = execSync(`bash "${SCRIPT}"`, {
      stdio: 'pipe',
      env: { ...process.env, ...env },
    }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || Buffer.from('')).toString() + (e.stderr || Buffer.from('')).toString() };
  }
}

// Build a throwaway repo root + manifest file so failure paths are exercised
// without touching the real tree.
function scaffold(manifestBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmm-'));
  const manifest = path.join(dir, 'manifest.md');
  fs.writeFileSync(manifest, manifestBody);
  return { dir, manifest };
}

const BLOCK = (rows) =>
  ['# fixture', '', '<!-- doc-mirror-manifest:start -->', '| Repo path | x |', '|---|---|', ...rows, '<!-- doc-mirror-manifest:end -->', ''].join('\n');

describe('scripts/check-doc-mirror-manifest.sh', () => {
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

  it('PASSES against the real repo manifest (every listed mirror exists)', () => {
    const { code, out } = run();
    expect(out).toMatch(/all \d+ listed mirror\(s\) present/);
    expect(code).toBe(0);
  });

  it('the real manifest lists the compliance pack and the runbook mirrors', () => {
    // Guards the manifest content itself so a mirror cannot be quietly dropped
    // from the index (which would make the presence check vacuously pass).
    const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs/DOC_SOURCE_OF_TRUTH.md'), 'utf8');
    for (const p of [
      'docs/RUNBOOK.md',
      'docs/DISASTER_RECOVERY.md',
      'docs/compliance/DPIA.md',
      'docs/compliance/ROPA.md',
      'docs/compliance/SUBPROCESSORS.md',
    ]) {
      expect(doc).toContain(p);
    }
  });

  it('FAILS (exit 1) when a manifest path is missing from the tree', () => {
    const present = path.join(REPO_ROOT, 'docs/RUNBOOK.md'); // real, exists
    const { dir, manifest } = scaffold(
      BLOCK([
        '| `docs/RUNBOOK.md` | present |',
        '| `docs/DOES_NOT_EXIST_KAN363.md` | missing |',
      ])
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT });
    expect(out).toMatch(/missing from the repo: docs\/DOES_NOT_EXIST_KAN363\.md/);
    expect(code).toBe(1);
    expect(fs.existsSync(present)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('PASSES (exit 0) when every manifest path exists', () => {
    const { dir, manifest } = scaffold(
      BLOCK(['| `docs/RUNBOOK.md` | a |', '| `docs/RELEASE_POLICY.md` | b |'])
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT });
    expect(code).toBe(0);
    expect(out).toMatch(/all 2 listed mirror\(s\) present/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('errors (exit 2) when the manifest file is absent', () => {
    const { code, out } = run({ MANIFEST_FILE: '/nonexistent/kan363/manifest.md' });
    expect(code).toBe(2);
    expect(out).toMatch(/manifest file not found/);
  });

  it('errors (exit 2) when the manifest block markers are missing', () => {
    const { dir, manifest } = scaffold('# no markers here\njust prose, no manifest block\n');
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT });
    expect(code).toBe(2);
    expect(out).toMatch(/block is empty or its start\/end markers are missing/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('errors (exit 2) when the block has no repo paths', () => {
    const { dir, manifest } = scaffold(BLOCK(['| just prose | no backtick paths |']));
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT });
    expect(code).toBe(2);
    expect(out).toMatch(/no repo paths found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
