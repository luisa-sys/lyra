/**
 * CTL-043 — shared code that exists as a copy in two repos must not diverge.
 *
 * The live check reaches another repo over the network, which a unit test must
 * not do. So this suite covers the two halves that can rot without leaving the
 * machine: the NORMALISER (via the script's own fixtures, plus its behaviour
 * asserted directly) and the MANIFEST (well-formed, entries real, nothing
 * quietly emptied). The network path runs for real on every CI run of
 * pr-checks.yml — that limitation is stated rather than papered over.
 *
 * The normaliser is the part worth guarding. It exists so a permanent, harmless
 * difference — the NodeNext '.js' import extension the MCP repos are REQUIRED
 * to write and the web app is required not to — does not produce a red build
 * nobody can fix. But a normaliser that removes too much reports agreement that
 * is not there, which is strictly worse than having no check at all. Both
 * directions are asserted below.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json');
const SCRIPT = path.join(ROOT, SRC.checkSharedCodeDrift);
// Repo-root file, like modules.json: outside every root the test-path
// manifest's harvest regex can reach, so named directly.
const MANIFEST = path.join(ROOT, 'shared-code-manifest.json');

function run(args) {
  try {
    return { exitCode: 0, stdout: execFileSync('python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('check-shared-code-drift.py (CTL-043)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  test('exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).toBeTruthy();
  });

  test('self-test passes in full', () => {
    const r = run(['--self-test']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/self-test: \d+\/\d+ passed/);
  });

  test('the normaliser ignores comments and the NodeNext extension', () => {
    // The difference that genuinely exists between the two live copies of
    // moderation-policy.ts. If this stopped holding, the gate would be red on
    // a difference nobody is allowed to fix.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok\s+differing headers \+ extension compare equal/);
    expect(r.stdout).toMatch(/ok\s+NodeNext \.js extension normalised/);
  });

  test('the normaliser still sees real changes — the direction that matters', () => {
    // A normaliser that is too eager reports agreement that is not there. These
    // three fixtures are what stop this control becoming decorative.
    const r = run(['--self-test']);
    expect(r.stdout).toMatch(/ok\s+a REAL logic change still differs/);
    expect(r.stdout).toMatch(/ok\s+a changed string literal still differs/);
    expect(r.stdout).toMatch(/ok\s+a double-slash inside a string literal survives/);
  });

  test('it fails CLOSED rather than reporting agreement it could not verify', () => {
    expect(source).toMatch(/def die_unverifiable/);
    expect(source).toMatch(/sys\.exit\(2\)/);
    expect(source).toMatch(/'could not look' must never print as 'they match'/);
    // A missing remote file is a FINDING, not a network blip — a manifest entry
    // pointing at a deleted file is dead cover that still reads as protection.
    expect(source).toMatch(/does not exist\. The manifest names a file that is not there/);
    expect(source).toMatch(/FETCH_ATTEMPTS/);
  });

  test('an empty shared list fails instead of passing vacuously', () => {
    expect(source).toMatch(/the manifest guards nothing/);
    expect(source).toMatch(/if the duplication is genuinely gone, delete this control/);
  });

  test('deferred entries are PRINTED on every run', () => {
    // A deferral nobody is reminded of is a deferral that becomes permanent.
    expect(source).toMatch(/DEFERRED, not guarded/);
  });

  test('the manifest is well-formed and guards at least one file', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    expect(Array.isArray(m.shared)).toBe(true);
    expect(m.shared.length).toBeGreaterThan(0);
    for (const e of m.shared) {
      expect(typeof e.local).toBe('string');
      expect(typeof e.remote).toBe('string');
      expect(['exact', 'normalised']).toContain(e.mode);
      expect(m.sources[e.source]).toBeDefined();
      // Every entry must justify itself. "why" is what tells a future reader
      // whether `normalised` was a considered choice or a way to go green.
      expect(String(e.why || '').trim().length).toBeGreaterThan(30);
    }
  });

  test('every guarded local file actually exists', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const e of m.shared) {
      expect(fs.existsSync(path.join(ROOT, e.local))).toBe(true);
    }
  });

  test('every deferred entry carries a reason', () => {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const e of m.deferred || []) {
      expect(String(e.why || '').trim().length).toBeGreaterThan(30);
    }
  });

  test('no source repo is marked public unless it really is readable without a token', () => {
    // The zero-secrets property this control is built on. If a source repo
    // stopped being public, CI would need a PAT and the surface we declined to
    // add would arrive by the back door — so the claim is written down and
    // asserted rather than assumed.
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const s of Object.values(m.sources)) {
      expect(typeof s.repo).toBe('string');
      expect(s.public).toBe(true);
    }
  });

  test('is wired into pr-checks.yml and registered', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf8');
    expect(wf).toContain('check-shared-code-drift.py');
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf8'));
    const entry = (reg.controls || reg).find((c) => c.id === 'CTL-043');
    expect(entry).toBeDefined();
    expect(entry.implementation).toContain('check-shared-code-drift.py');
  });
});
