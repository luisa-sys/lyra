const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/check-doc-mirror-content.sh');

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

// Build a throwaway repo root with a manifest file plus any fixture docs the
// manifest points at, so failure paths are exercised without touching the
// real tree. `docs` maps a relative repo path to its file body.
function scaffold(rows, docs = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-'));
  const manifestBody = [
    '# fixture',
    '',
    '<!-- doc-mirror-manifest:start -->',
    '| Repo path | x |',
    '|---|---|',
    ...rows,
    '<!-- doc-mirror-manifest:end -->',
    '',
  ].join('\n');
  const manifest = path.join(dir, 'manifest.md');
  fs.writeFileSync(manifest, manifestBody);
  for (const [rel, body] of Object.entries(docs)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return { dir, manifest };
}

// A substantial, valid doc: a heading plus well over MIN_NONBLANK content lines.
const GOOD_DOC = ['# Title', '', 'Line one.', 'Line two.', 'Line three.', 'Line four.', 'Line five.', 'Line six.'].join('\n');

describe('scripts/check-doc-mirror-content.sh', () => {
  let source = '';
  beforeAll(() => { source = fs.readFileSync(SCRIPT, 'utf8'); });

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened and never silent-skips', () => {
    expect(source).toMatch(/set -uo pipefail/);
    // no lossy "|| echo" data placeholders (KAN-167); the guarded `|| echo 0`
    // fallbacks are on counters, not on data, so assert no `|| echo "..."`.
    expect(source).not.toMatch(/\|\|\s*echo\s*"/);
  });

  it('PASSES against the real repo manifest (every listed .md mirror has real content)', () => {
    const { code, out } = run();
    expect(out).toMatch(/all \d+ checked \.md mirror\(s\) have real content/);
    expect(code).toBe(0);
  });

  it('PASSES (exit 0) when a listed .md mirror is a substantial doc', () => {
    const { dir, manifest } = scaffold(
      ['| `docs/good.md` | ok |'],
      { 'docs/good.md': GOOD_DOC }
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(0);
    expect(out).toMatch(/all 1 checked \.md mirror\(s\) have real content/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAILS (exit 1) when a listed .md mirror is empty / whitespace-only', () => {
    const { dir, manifest } = scaffold(
      ['| `docs/empty.md` | stub |'],
      { 'docs/empty.md': '\n   \n\t\n' }
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(1);
    expect(out).toMatch(/mirror is empty \(no non-blank lines\): docs\/empty\.md/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAILS (exit 1) when a listed .md mirror is a too-short stub', () => {
    const { dir, manifest } = scaffold(
      ['| `docs/short.md` | stub |'],
      { 'docs/short.md': '# Heading\n\nonly one real line\n' }
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(1);
    expect(out).toMatch(/looks like a stub — only \d+ non-blank line\(s\), need >= 5: docs\/short\.md/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAILS (exit 1) when a listed .md mirror has no Markdown heading', () => {
    const { dir, manifest } = scaffold(
      ['| `docs/noh.md` | noheading |'],
      { 'docs/noh.md': ['plain one', 'plain two', 'plain three', 'plain four', 'plain five', 'plain six'].join('\n') }
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(1);
    expect(out).toMatch(/has no Markdown heading .*: docs\/noh\.md/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FAILS (exit 1) when a listed .md mirror is missing from the tree', () => {
    const { dir, manifest } = scaffold(['| `docs/gone.md` | missing |']);
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(1);
    expect(out).toMatch(/missing from the repo: docs\/gone\.md/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('SKIPS non-markdown manifest entries (presence guard covers them) and still passes on the .md ones', () => {
    const { dir, manifest } = scaffold(
      ['| `docs/good.md` | ok |', '| `scripts/thing.sh` | script |'],
      { 'docs/good.md': GOOD_DOC, 'scripts/thing.sh': '#!/usr/bin/env bash\necho hi\n' }
    );
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(0);
    expect(out).toMatch(/skipping non-markdown manifest entry .*: scripts\/thing\.sh/);
    expect(out).toMatch(/all 1 checked \.md mirror\(s\) have real content \(1 non-markdown/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT false-positive on a doc that quotes a placeholder phrase in prose', () => {
    // Regression guard: docs/PROJECT_INSTRUCTIONS.md legitimately contains the
    // literal string "Schema export failed" (it mirrors the KAN-167 gotcha).
    // The content guard must pass it — structural checks only, no sentinel scan.
    const { dir, manifest } = scaffold(
      ['| `docs/quotes.md` | ok |'],
      { 'docs/quotes.md': ['# Gotchas', '', 'Never write `pg_dump ... || echo "Schema export failed"`.', 'This is the (failed to fetch) anti-pattern.', 'It masks real errors.', 'Fail loud instead.', 'See KAN-167.'].join('\n') }
    );
    const { code } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('errors (exit 2) when the manifest file is absent', () => {
    const { code, out } = run({ MANIFEST_FILE: '/nonexistent/kan363/manifest.md' });
    expect(code).toBe(2);
    expect(out).toMatch(/manifest file not found/);
  });

  it('errors (exit 2) when the manifest block markers are missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-'));
    const manifest = path.join(dir, 'manifest.md');
    fs.writeFileSync(manifest, '# no markers here\njust prose, no manifest block\n');
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(2);
    expect(out).toMatch(/block is empty or its start\/end markers are missing/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('errors (exit 2) when the block has no repo paths', () => {
    const { dir, manifest } = scaffold(['| just prose | no backtick paths |']);
    const { code, out } = run({ MANIFEST_FILE: manifest, REPO_ROOT: dir });
    expect(code).toBe(2);
    expect(out).toMatch(/no repo paths found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
