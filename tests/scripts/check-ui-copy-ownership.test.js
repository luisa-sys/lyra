const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.resolve(REPO_ROOT, SRC.checkUiCopyOwnership);

// Build a throwaway git repo with a `develop` branch and a `feature` branch
// whose commits (ahead of develop) create/modify the supplied files with the
// supplied messages, then run the guard over develop..feature. Returns
// { status, output }.
//
// `commits` is an array of { files: string[], message: string }. Each file is
// created (parents made as needed) with unique content so it shows as changed.
function runOverCommits(commits, { baseRef = 'develop' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uicopy-'));
  const git = (args, opts = {}) =>
    execSync(`git ${args}`, { cwd: dir, stdio: 'pipe', ...opts }).toString();
  try {
    git('init -q');
    git('config user.email test@example.com');
    git('config user.name tester');
    git('config commit.gpgsign false');
    git('commit -q --allow-empty -m "chore: repo base"');
    git('branch -M develop');
    git('checkout -q -b feature');
    let n = 0;
    for (const c of commits) {
      for (const rel of c.files) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, `content ${rel} ${n++}\n`);
      }
      git('add -A');
      const msgFile = path.join(dir, `.msg${n}`);
      fs.writeFileSync(msgFile, c.message);
      git(`commit -q -F ${JSON.stringify(msgFile)}`);
      fs.rmSync(msgFile, { force: true });
    }
    let status = 0;
    let output = '';
    try {
      output = execSync(`bash "${SCRIPT}"`, {
        cwd: dir,
        stdio: 'pipe',
        env: { ...process.env, BASE_REF: baseRef, HEAD_REF: 'HEAD' },
      }).toString();
    } catch (err) {
      status = err.status || 1;
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }
    return { status, output };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe(SRC.checkUiCopyOwnership, () => {
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

  it('does not use mapfile (bash-4 only; macOS ships bash 3.2)', () => {
    expect(source).not.toMatch(/\bmapfile\b/);
  });

  it('PASSES a non-UI change with no trailer (scripts/docs only)', () => {
    const { status, output } = runOverCommits([
      { files: ['scripts/foo.sh', 'docs/NOTES.md'], message: 'chore: infra tweak' },
    ]);
    expect(status).toBe(0);
    expect(output).toMatch(/no founder-owned UI\/copy paths changed/);
  });

  it('FAILS a src/app page (.tsx) change with no trailer', () => {
    const { status, output } = runOverCommits([
      { files: [SRC.dashboardPage], message: 'change the dashboard' },
    ]);
    expect(status).not.toBe(0);
    expect(output).toMatch(/no approval trailer/);
    expect(output).toMatch(/src\/app\/dashboard\/page\.tsx/);
  });

  it('PASSES the same .tsx change when a UI-Change-Approved trailer is present', () => {
    const { status, output } = runOverCommits([
      {
        files: [SRC.dashboardPage],
        message: 'feat: new dashboard hero\n\nUI-Change-Approved: KAN-410',
      },
    ]);
    expect(status).toBe(0);
    expect(output).toMatch(/approval trailer is present/);
    expect(output).toMatch(/UI-Change-Approved: KAN-410/);
  });

  it('PASSES the same .tsx change with a UI-Bugfix-Only trailer (carve-out)', () => {
    const { status, output } = runOverCommits([
      {
        files: [SRC.dashboardPage],
        message: 'fix: correct a typo in the heading\n\nUI-Bugfix-Only: BUGS-70',
      },
    ]);
    expect(status).toBe(0);
    expect(output).toMatch(/approval trailer is present/);
  });

  it('accepts the trailer even when it lands in a LATER commit in the range', () => {
    const { status } = runOverCommits([
      { files: ['src/components/Hero.tsx'], message: 'wip: hero' },
      { files: ['README.md'], message: 'chore: note\n\nUI-Change-Approved: KAN-1' },
    ]);
    expect(status).toBe(0);
  });

  it('PASSES an admin-console change (carve-out) with no trailer', () => {
    const { status, output } = runOverCommits([
      { files: [SRC.featuresPage], message: 'admin: tweak' },
    ]);
    expect(status).toBe(0);
    expect(output).toMatch(/no founder-owned UI\/copy paths changed/);
  });

  it('PASSES an API route handler change (carve-out) with no trailer', () => {
    const { status } = runOverCommits([
      { files: ['src/app/api/search/route.ts'], message: 'api: add route' },
    ]);
    expect(status).toBe(0);
  });

  it('FAILS a named copy module change (src/modules/dashboard/invite-text.ts) with no trailer', () => {
    const { status, output } = runOverCommits([
      { files: [SRC.inviteText], message: 'reword the invite copy' },
    ]);
    expect(status).not.toBe(0);
    expect(output).toMatch(/invite-text\.ts/);
  });

  it('PASSES a non-copy src/lib logic change with no trailer', () => {
    const { status } = runOverCommits([
      { files: [SRC.resolveWidgets], message: 'logic: gate a widget' },
    ]);
    expect(status).toBe(0);
  });

  it('FAILS a globals.css / design-token change with no trailer', () => {
    const { status, output } = runOverCommits([
      { files: [SRC.globals], message: 'restyle tokens' },
    ]);
    expect(status).not.toBe(0);
    expect(output).toMatch(/globals\.css/);
  });

  it('requires a JIRA key on the trailer (bare trailer does not satisfy)', () => {
    const { status } = runOverCommits([
      {
        files: [SRC.appPage],
        message: 'change home\n\nUI-Change-Approved: yes please',
      },
    ]);
    expect(status).not.toBe(0);
  });

  it('WARNS and passes (fail-open) when the base ref cannot be resolved', () => {
    const { status, output } = runOverCommits(
      [{ files: [SRC.appPage], message: 'change home' }],
      { baseRef: 'origin/does-not-exist-xyz' },
    );
    expect(status).toBe(0);
    expect(output).toMatch(/::warning::/);
    expect(output).toMatch(/not found/);
  });
  // ─── KAN-474: --describe is DERIVED from is_protected(), not restated ───
  //
  // The surface used to live in two places — this guard and the Backlog
  // Autopilot's prompt, a SaaS routine no CI job can read. They drifted twice
  // (KAN-415 moved two copy modules; KAN-473 added src/modules/*.tsx), and
  // neither drift could go red because nothing in CI can see a prompt.
  //
  // The fix is removing the second copy: the autopilot reads --describe at
  // runtime. These cases exist to keep that promise honest — a hand-written
  // description would be a THIRD copy and would drift exactly as the second
  // did, so the load-bearing assertion is the last one, which adds a rule to
  // the function and requires it to appear with no other edit.
  describe('--describe (KAN-474)', () => {
    const describeOut = () =>
      execSync(`bash ${JSON.stringify(SCRIPT)} --describe`, { encoding: 'utf-8' });

    /** Every `[[ $f == X ]] && return N` in is_protected(), read from source. */
    function rulesInFunction() {
      const src = fs.readFileSync(SCRIPT, 'utf-8');
      const body = src.slice(src.indexOf('\nis_protected()')).split('\n}\n')[0];
      return [...body.matchAll(/^\s*\[\[\s*\$f\s*==\s*(.*?)\s*\]\]\s*&&\s*return\s*([01])/gm)]
        .map((m) => ({ glob: m[1], protected: m[2] === '0' }));
    }

    function emitted() {
      return describeOut()
        .split('\n')
        .filter((l) => l.startsWith('PROTECTED ') || l.startsWith('CARVE-OUT '))
        .map((l) => ({ glob: l.slice(l.indexOf(' ') + 1), protected: l.startsWith('PROTECTED ') }));
    }

    // Two-way ratchet on the SIZE of the surface. The equality case above
    // proves guard and description agree; it cannot tell "a rule was removed
    // deliberately" from "a rule was removed silently", because deleting it
    // from is_protected() removes it from BOTH and they still agree. Measured
    // by mutation: dropping `src/components/*` left all other cases green.
    //
    // So the count is pinned. RAISE it when you add a protection. If you are
    // LOWERING it you are removing founder ownership from a surface, which is
    // Luisa's call (KAN-411) and should not pass on a green diff.
    const EXPECTED_RULES = { carveOuts: 4, protected: 17 };

    it('emits a non-empty surface', () => {
      // Guards the vacuous case: a parser that matched nothing would make
      // every assertion below pass over an empty set.
      expect(emitted().length).toBeGreaterThanOrEqual(15);
    });

    it('⚠️ the surface has not SHRUNK — removing a protection must be deliberate', () => {
      const got = emitted();
      expect({
        carveOuts: got.filter((r) => !r.protected).length,
        protected: got.filter((r) => r.protected).length,
      }).toEqual(EXPECTED_RULES);
    });

    it('emits EXACTLY the rules in is_protected() — none missing, none invented', () => {
      const key = (r) => `${r.protected ? 'P' : 'C'} ${r.glob}`;
      const declared = rulesInFunction().map(key).sort();
      const got = emitted().map(key).sort();
      expect(got).toEqual(declared);
    });

    it('tolerates trailing comments and irregular spacing', () => {
      // The first cut anchored on `]] && return N$` and silently emitted 1
      // carve-out instead of 4, dropping src/*.css — several rules carry a
      // trailing comment. These three are the ones it missed.
      const globs = emitted().map((r) => r.glob);
      expect(globs).toContain('src/app/admin/*');   // trailing comment
      expect(globs).toContain('*/route.ts');        // comment + extra spacing
      expect(globs).toContain('src/*.css');         // trailing comment
    });

    it('carve-outs are emitted BEFORE protected rules, matching evaluation order', () => {
      const lines = emitted();
      const lastCarveOut = lines.map((r) => r.protected).lastIndexOf(false);
      const firstProtected = lines.map((r) => r.protected).indexOf(true);
      expect(lastCarveOut).toBeLessThan(firstProtected);
    });

    it('⚠️ a NEW rule appears with no other edit — this is what makes it derived', () => {
      // The whole claim of KAN-474 in one case. Add a rule to is_protected()
      // in a scratch copy; if --describe is truly parsed from the function it
      // shows up untouched. If anyone later replaces the parser with a
      // hand-written list, this goes red.
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kan474-')), 'guard.sh');
      const src = fs.readFileSync(SCRIPT, 'utf-8');
      const sentinel = 'src/kan474-sentinel/*.tsx';
      const mutated = src.replace(
        '  [[ $f == src/modules/*.tsx ]] && return 0',
        `  [[ $f == ${sentinel} ]] && return 0\n  [[ $f == src/modules/*.tsx ]] && return 0`,
      );
      expect(mutated).not.toBe(src); // the mutation actually applied
      fs.writeFileSync(tmp, mutated, { mode: 0o755 });

      const out = execSync(`bash ${JSON.stringify(tmp)} --describe`, { encoding: 'utf-8' });
      expect(out).toContain(`PROTECTED ${sentinel}`);
    });
  });
});
