/**
 * Unit tests for scripts/check-backup-integrity.sh
 * KAN-167 Phase 4: backup integrity validation gate.
 *
 * The script's job is to fail loud on placeholder-string backups so the
 * weekly report (and the backup workflow's pre-upload gate) cannot post a
 * false-positive "all green" when the underlying artifact is corrupt.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-backup-integrity.sh');
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'backup-integrity');

function runScript(arg) {
  return spawnSync('bash', [SCRIPT, arg], { encoding: 'utf8' });
}

describe('check-backup-integrity.sh', () => {
  describe('valid backup fixture', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'valid'));
    });

    test('exits 0', () => {
      expect(result.status).toBe(0);
    });

    test('reports cloudflare-dns.json as ✅', () => {
      expect(result.stdout).toMatch(/✅ cloudflare-dns\.json:/);
      expect(result.stdout).not.toMatch(/❌ cloudflare-dns\.json/);
    });

    test('reports supabase-schema.sql as ✅ with CREATE TABLE evidence', () => {
      expect(result.stdout).toMatch(/✅ supabase-schema\.sql:.*contains CREATE TABLE/);
    });

    test('reports github-secrets-list.txt as ✅ with no failure markers', () => {
      expect(result.stdout).toMatch(/✅ github-secrets-list\.txt:.*no failure markers/);
    });
  });

  describe('placeholder backup fixture', () => {
    let result;
    beforeAll(() => {
      result = runScript(path.join(FIXTURES, 'placeholder'));
    });

    test('exits 1 (non-zero)', () => {
      expect(result.status).toBe(1);
    });

    test('flags cloudflare-dns.json success:false', () => {
      expect(result.stdout).toMatch(/❌ cloudflare-dns\.json:.*success=false/);
    });

    test('flags supabase-schema.sql invalid header (Schema export failed)', () => {
      expect(result.stdout).toMatch(/❌ supabase-schema\.sql: invalid header/);
    });

    test('flags github-secrets-list.txt placeholder marker', () => {
      expect(result.stdout).toMatch(/❌ github-secrets-list\.txt:.*placeholder marker/);
    });
  });

  describe('invocation errors', () => {
    test('exits 2 when given no argument', () => {
      const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/usage:/);
    });

    test('exits 2 when directory does not exist', () => {
      const result = runScript('/tmp/this-dir-should-not-exist-kan167');
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/does not exist/);
    });
  });

  describe('partial-failure isolation', () => {
    // If one file is bad and others are fine, the script should still flag
    // the bad one, report the good ones, and exit non-zero.
    let tmpDir;

    beforeAll(() => {
      const fs = require('fs');
      const os = require('os');
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kan167-partial-'));
      // Copy good DNS + good SQL, but use a placeholder secrets file.
      fs.copyFileSync(
        path.join(FIXTURES, 'valid', 'cloudflare-dns.json'),
        path.join(tmpDir, 'cloudflare-dns.json'),
      );
      fs.copyFileSync(
        path.join(FIXTURES, 'valid', 'supabase-schema.sql'),
        path.join(tmpDir, 'supabase-schema.sql'),
      );
      fs.copyFileSync(
        path.join(FIXTURES, 'placeholder', 'github-secrets-list.txt'),
        path.join(tmpDir, 'github-secrets-list.txt'),
      );
    });

    afterAll(() => {
      const fs = require('fs');
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('exits 1 because secrets file has placeholder', () => {
      const result = runScript(tmpDir);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/✅ cloudflare-dns\.json/);
      expect(result.stdout).toMatch(/✅ supabase-schema\.sql/);
      expect(result.stdout).toMatch(/❌ github-secrets-list\.txt/);
    });
  });
});
