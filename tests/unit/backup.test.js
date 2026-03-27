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
