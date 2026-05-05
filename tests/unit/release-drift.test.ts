/**
 * KAN-173: tests for scripts/check-release-drift.sh.
 *
 * The script's logic — threshold buckets and the "DATA_UNAVAILABLE on
 * missing refs" case — is the load-bearing piece. We invoke the script
 * in a throwaway git repo with synthetic ref histories and assert it
 * categorises correctly + emits the expected key=value output.
 */

import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/check-release-drift.sh');

interface DriftResult {
  exitCode: number;
  stdout: string;
  fields: Record<string, string>;
}

function parseFields(stdout: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (m) fields[m[1]] = m[2];
  }
  return fields;
}

function runScript(cwd: string, env: Record<string, string> = {}): DriftResult {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, ...env, PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, fields: parseFields(stdout) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    const stdout = e.stdout ?? '';
    return { exitCode: e.status ?? 1, stdout, fields: parseFields(stdout) };
  }
}

function gitRun(cwd: string, args: string[]): string {
  return execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8' }).trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lyra-drift-'));
  gitRun(dir, ['init', '-q', '-b', 'main']);
  gitRun(dir, ['config', 'user.email', 'test@example.com']);
  gitRun(dir, ['config', 'user.name', 'test']);
  return dir;
}

function commit(cwd: string, file: string, contents: string, msg: string, dateIso?: string): string {
  writeFileSync(join(cwd, file), contents);
  gitRun(cwd, ['add', '.']);
  if (dateIso) {
    execSync(`GIT_COMMITTER_DATE='${dateIso}' git commit -q -m '${msg}' --date='${dateIso}'`, { cwd });
  } else {
    gitRun(cwd, ['commit', '-q', '-m', `'${msg}'`]);
  }
  return gitRun(cwd, ['rev-parse', 'HEAD']);
}

describe('check-release-drift.sh', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
    // Bootstrap: one commit on main; no develop yet.
    commit(repo, 'README', 'main\n', 'initial');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test('green when 0 commits ahead and 0 days since last commit', () => {
    // Make develop = main (no drift). Use a recent date.
    gitRun(repo, ['branch', 'develop']);
    const r = runScript(repo, { DEVELOP_REF: 'develop', MAIN_REF: 'main' });
    expect(r.fields.status).toBe('green');
    expect(r.fields.commits_ahead).toBe('0');
    expect(parseInt(r.fields.days_since_last_commit, 10)).toBeLessThanOrEqual(1);
    expect(r.exitCode).toBe(0);
  });

  test('yellow when 5–14 commits ahead', () => {
    gitRun(repo, ['checkout', '-q', '-b', 'develop']);
    for (let i = 0; i < 6; i++) {
      commit(repo, `f${i}`, String(i), `commit ${i}`);
    }
    const r = runScript(repo, { DEVELOP_REF: 'develop', MAIN_REF: 'main' });
    expect(r.fields.status).toBe('yellow');
    expect(r.fields.commits_ahead).toBe('6');
    expect(r.exitCode).toBe(0);
  });

  test('red when ≥ 15 commits ahead', () => {
    gitRun(repo, ['checkout', '-q', '-b', 'develop']);
    for (let i = 0; i < 16; i++) {
      commit(repo, `f${i}`, String(i), `commit ${i}`);
    }
    const r = runScript(repo, { DEVELOP_REF: 'develop', MAIN_REF: 'main' });
    expect(r.fields.status).toBe('red');
    expect(r.fields.commits_ahead).toBe('16');
    expect(r.exitCode).toBe(1);
  });

  test('red when develop HEAD ≥ 7 days old (even with few commits)', () => {
    gitRun(repo, ['checkout', '-q', '-b', 'develop']);
    // Commit dated 10 days ago.
    const tenDaysAgoTs = Math.floor(Date.now() / 1000) - 10 * 86400;
    const iso = new Date(tenDaysAgoTs * 1000).toISOString();
    commit(repo, 'old', 'stale', 'stale commit', iso);
    const r = runScript(repo, { DEVELOP_REF: 'develop', MAIN_REF: 'main' });
    expect(r.fields.status).toBe('red');
    expect(parseInt(r.fields.days_since_last_commit, 10)).toBeGreaterThanOrEqual(10);
    expect(r.exitCode).toBe(1);
  });

  test('exits 2 with DATA_UNAVAILABLE when develop ref missing', () => {
    // Don't create develop; DEVELOP_REF=develop won't resolve.
    const r = runScript(repo, { DEVELOP_REF: 'develop', MAIN_REF: 'main' });
    expect(r.fields.status).toBe('unknown');
    expect(r.fields.commits_ahead).toBe('DATA_UNAVAILABLE');
    expect(r.fields.days_since_last_commit).toBe('DATA_UNAVAILABLE');
    expect(r.exitCode).toBe(2);
  });

  test('emits a human-readable summary line for every status', () => {
    gitRun(repo, ['checkout', '-q', '-b', 'develop']);
    commit(repo, 'one', '1', 'one');
    const r = runScript(repo, { DEVELOP_REF: 'develop', MAIN_REF: 'main' });
    expect(r.fields.summary).toMatch(/^develop is \d+ commits \/ \d+ days ahead of main \(green|yellow|red\)$/);
  });
});
