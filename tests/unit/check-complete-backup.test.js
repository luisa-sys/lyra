/**
 * Unit tests for scripts/check-complete-backup.sh
 * SEC-23: integrity gate for the daily COMPLETE backup (public+auth+storage).
 *
 * Sibling of check-backup-integrity.test.js. The script must fail loud when a
 * complete-backup directory is missing the auth schema, has a placeholder
 * dump, or lacks a manifest — the false-positive class the Backup Integrity
 * Policy exists to eliminate.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-complete-backup.sh');
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'complete-backup');

function runScript(arg) {
  return spawnSync('bash', [SCRIPT, arg], { encoding: 'utf8' });
}

describe('check-complete-backup.sh', () => {
  describe('valid complete-backup fixture', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'valid'));
    });

    test('exits 0', () => {
      expect(result.status).toBe(0);
    });

    test('manifest reports public + auth + storage schemas', () => {
      expect(result.stdout).toMatch(/✅ manifest:.*public,auth,storage/);
    });

    test('dump reported as a valid PGDMP archive', () => {
      expect(result.stdout).toMatch(/✅ complete dump: valid PGDMP archive/);
    });

    test('roles globals present', () => {
      expect(result.stdout).toMatch(/✅ roles:/);
    });
  });

  describe('placeholder / incomplete fixture', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'placeholder'));
    });

    test('exits 1 (non-zero)', () => {
      expect(result.status).toBe(1);
    });

    test('flags the missing auth schema (the headline gap)', () => {
      expect(result.stdout).toMatch(/❌ manifest:.*missing required schema 'auth'/);
    });

    test('flags the non-PGDMP dump header', () => {
      expect(result.stdout).toMatch(/❌ complete dump: not a pg_dump custom archive/);
    });
  });

  describe('invocation errors', () => {
    test('exits 2 when given no argument', () => {
      const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/usage:/);
    });

    test('exits 2 when directory does not exist', () => {
      const result = runScript('/tmp/this-dir-should-not-exist-sec23');
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/does not exist/);
    });
  });
});
