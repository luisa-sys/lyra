/**
 * Backup & Rollback infrastructure tests
 * KAN-30: Backup, Restore & Rollback Capabilities
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('Backup & Rollback', () => {
  test('rollback script exists and is executable', () => {
    const scriptPath = path.join(root, 'scripts/rollback-vercel.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeTruthy(); // executable
  });

  test('backup script exists and is executable', () => {
    const scriptPath = path.join(root, 'scripts/backup-database.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  test('restore script exists and is executable', () => {
    const scriptPath = path.join(root, 'scripts/restore-database.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  test('backup workflow exists for GitHub Actions', () => {
    const workflowPath = path.join(root, '.github/workflows/backup-database.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, 'utf8');
    expect(content).toContain('schedule');
    expect(content).toContain('SUPABASE_DB_URL');
    expect(content).toContain('upload-artifact');
  });

  test('runbook documentation exists', () => {
    const runbookPath = path.join(root, 'docs/RUNBOOK.md');
    expect(fs.existsSync(runbookPath)).toBe(true);
    const content = fs.readFileSync(runbookPath, 'utf8');
    expect(content).toContain('Deployment Rollback');
    expect(content).toContain('Database Backup');
    expect(content).toContain('Database Restore');
  });

  test('backups directory is in .gitignore', () => {
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(content).toContain('/backups');
  });
});

describe('SEC-23 — DR/backup coverage hardening', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const exists = (p) => fs.existsSync(path.join(root, p));
  const executable = (p) => Boolean(fs.statSync(path.join(root, p)).mode & 0o111);

  test('complete backup script exists, is executable, and captures auth+storage', () => {
    expect(exists('scripts/backup-database-complete.sh')).toBe(true);
    expect(executable('scripts/backup-database-complete.sh')).toBe(true);
    const s = read('scripts/backup-database-complete.sh');
    // The whole point: it must NOT be public-only like backup-database.sh.
    expect(s).toMatch(/SCHEMAS=\(public auth storage\)/);
    expect(s).toContain('pg_dumpall --roles-only');
  });

  test('complete-backup integrity validator exists and is executable', () => {
    expect(exists('scripts/check-complete-backup.sh')).toBe(true);
    expect(executable('scripts/check-complete-backup.sh')).toBe(true);
  });

  test('complete backup workflow: daily cadence documented, encrypts, write-only WORM cred, dispatchable', () => {
    expect(exists('.github/workflows/backup-complete.yml')).toBe(true);
    const w = read('.github/workflows/backup-complete.yml');
    // Daily cadence is documented; the schedule ships commented until the backup
    // is commissioned (SEC-23) so prod never goes nightly-red before secrets exist.
    expect(w).toMatch(/cron:\s*'0 1 \* \* \*'/);
    expect(w).toContain('workflow_dispatch'); // runnable on demand now
    expect(w).toContain('age -r'); // encrypted with an offline-held recipient key
    expect(w).toContain('R2_BACKUP_WRITEONLY_ACCESS_KEY_ID'); // separate write-only creds
    expect(w).toContain('check-complete-backup.sh'); // pre-upload integrity gate
  });

  test('restore drill actually restores (no silent-skip) and asserts round-trip', () => {
    const w = read('.github/workflows/backup-restore-test.yml');
    expect(w).toContain('image: postgres:17'); // clean-room restore target
    expect(w).toMatch(/Restore the backup/);
    expect(w).toMatch(/row count|round-trip/i);
    // The former silent-skip (`exit 0` on missing SUPABASE_DB_URL) must be gone.
    expect(w).not.toMatch(/SUPABASE_DB_URL.*\n.*exit 0/);
  });

  test('REST fallback enumerates tables dynamically (not a hardcoded short list)', () => {
    const s = read('scripts/backup-database-api.sh');
    expect(s).not.toMatch(/TABLES=\("profiles" "profile_items"/);
    expect(s).toMatch(/PostgREST|paths/);
  });

  test('restore script resets the whole public schema, not a hardcoded table list', () => {
    const s = read('scripts/restore-database.sh');
    expect(s).toContain('DROP SCHEMA IF EXISTS public CASCADE');
  });

  test('disaster recovery doc exists with a clean-room compromise procedure', () => {
    expect(exists('docs/DISASTER_RECOVERY.md')).toBe(true);
    const d = read('docs/DISASTER_RECOVERY.md');
    expect(d).toMatch(/clean-room|compromise/i);
    expect(d).toMatch(/RPO/);
    expect(d).toMatch(/RTO/);
  });
});
