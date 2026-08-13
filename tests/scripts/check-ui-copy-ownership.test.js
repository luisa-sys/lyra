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
});
