/**
 * Backup & Rollback infrastructure tests
 * KAN-30: Backup, Restore & Rollback Capabilities
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');

describe('Backup & Rollback', () => {
  test('rollback script exists and is executable', () => {
    const scriptPath = path.join(root, SRC.rollbackVercel);
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeTruthy(); // executable
  });

  test('backup script exists and is executable', () => {
    const scriptPath = path.join(root, SRC.scriptsBackupDatabase);
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  test('restore script exists and is executable', () => {
    const scriptPath = path.join(root, SRC.restoreDatabase);
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stats = fs.statSync(scriptPath);
    expect(stats.mode & 0o111).toBeTruthy();
  });

  test('backup workflow exists for GitHub Actions', () => {
    const workflowPath = path.join(root, SRC.backupDatabase);
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
    expect(exists(SRC.backupDatabaseComplete)).toBe(true);
    expect(executable(SRC.backupDatabaseComplete)).toBe(true);
    const s = read(SRC.backupDatabaseComplete);
    // The whole point: it must NOT be public-only like backup-database.sh.
    // BUGS-91: supabase_migrations added. This script exists because
    // public-only dumps cannot reconstruct a working platform — and it had the
    // same shape of hole it was written to fix, capturing auth and storage but
    // not the migration lineage.
    expect(s).toMatch(/SCHEMAS=\(public auth storage supabase_migrations\)/);
    expect(s).toContain('pg_dumpall --roles-only');
  });

  test('complete-backup integrity validator exists and is executable', () => {
    expect(exists(SRC.checkCompleteBackup)).toBe(true);
    expect(executable(SRC.checkCompleteBackup)).toBe(true);
  });

  test('complete backup workflow: daily cadence documented, encrypts, write-only WORM cred, dispatchable', () => {
    expect(exists(SRC.backupComplete)).toBe(true);
    const w = read(SRC.backupComplete);
    // Daily cadence is documented; the schedule ships commented until the backup
    // is commissioned (SEC-23) so prod never goes nightly-red before secrets exist.
    expect(w).toMatch(/cron:\s*'0 1 \* \* \*'/);
    expect(w).toContain('workflow_dispatch'); // runnable on demand now
    expect(w).toContain('age -r'); // encrypted with an offline-held recipient key
    expect(w).toContain('R2_BACKUP_WRITEONLY_ACCESS_KEY_ID'); // separate write-only creds
    expect(w).toContain('check-complete-backup.sh'); // pre-upload integrity gate
  });

  test('restore drill actually restores (no silent-skip) and asserts round-trip', () => {
    const w = read(SRC.backupRestoreTest);
    expect(w).toContain('image: postgres:17'); // clean-room restore target
    expect(w).toMatch(/Restore the backup/);
    expect(w).toMatch(/row count|round-trip/i);
    // The former silent-skip (`exit 0` on missing SUPABASE_DB_URL) must be gone.
    expect(w).not.toMatch(/SUPABASE_DB_URL.*\n.*exit 0/);
  });

  test('REST fallback enumerates tables dynamically (not a hardcoded short list)', () => {
    const s = read(SRC.backupDatabaseApi);
    expect(s).not.toMatch(/TABLES=\("profiles" "profile_items"/);
    expect(s).toMatch(/PostgREST|paths/);
  });

  test('restore script resets the whole public schema, not a hardcoded table list', () => {
    const s = read(SRC.restoreDatabase);
    expect(s).toContain('DROP SCHEMA IF EXISTS public CASCADE');
  });

  /**
   * BUGS-91 (2026-08-09). The dump was `--schema=public` only, so NO backup we
   * had ever taken contained the migration lineage — 75 rows and 133 KB of
   * recorded `statements` on production when this was found.
   *
   * That is not a completeness nicety. A restore from a public-only dump gives
   * a database with no migration history, so `supabase db push` afterwards
   * considers every migration unapplied and replays the whole lineage against
   * the restored data. The backup that exists to prove DR could not, alone,
   * produce a database anyone could safely continue to migrate.
   *
   * Both halves are asserted because they must move together: a dump that
   * carries the schema and a restore that does not reset it would collide on
   * the existing rows, and a "successful" restore would leave a database
   * nobody can migrate. Backup and restore drifting apart is the failure mode.
   */
  test('backup captures the migration lineage, not just public', () => {
    const s = read(SRC.scriptsBackupDatabase);
    expect(s).toContain('--schema=public');
    expect(s).toContain('--schema=supabase_migrations');
  });

  test('restore resets the migration lineage too, so the two stay symmetric', () => {
    const s = read(SRC.restoreDatabase);
    expect(s).toContain('DROP SCHEMA IF EXISTS supabase_migrations CASCADE');
  });

  test('disaster recovery doc exists with a clean-room compromise procedure', () => {
    expect(exists('docs/DISASTER_RECOVERY.md')).toBe(true);
    const d = read('docs/DISASTER_RECOVERY.md');
    expect(d).toMatch(/clean-room|compromise/i);
    expect(d).toMatch(/RPO/);
    expect(d).toMatch(/RTO/);
  });
});
