/**
 * SEC-43 — Admin RPC EXECUTE policy reconciliation + B9 CI guard.
 *
 * The daily B9 security probe (docs/DAILY_SECURITY_CHECK.md) repeatedly flagged
 * `admin_list_users` and `admin_filter_profile_ids` as `authenticated`-executable
 * SECURITY DEFINER functions and a new SEC ticket was filed each time
 * (SEC-29 -> SEC-42 -> SEC-43). All three were the SAME owner-accepted config:
 *
 *   BUGS-60 (Done) established that these two admin-console RPCs are INTENTIONALLY
 *   `authenticated`-executable. They self-gate internally on
 *   `auth.uid()` + `is_admin` (`... where user_id = auth.uid() and is_admin = true`),
 *   so a non-admin authenticated caller gets `admin only` (42501), never data. The
 *   admin pages (src/app/admin/users/page.tsx, actions.ts) MUST call them via the
 *   *authenticated* admin session, because a service-role call (auth.uid()=null)
 *   would fail the functions' own guard. A naive `REVOKE ... FROM authenticated`
 *   (which SEC-43's own literal "Implementation Steps" proposed) breaks the admin
 *   console with no security gain, and the grant just gets re-applied -> the probe
 *   re-files the finding. anon/PUBLIC stay revoked.
 *
 * The reconciliation (this ticket): the accepted ACL is allowlisted in the B9 spec
 * so the probe stops filing duplicates, and locked here so a future edit cannot
 * silently re-break the console (naive full-revoke) or silently drop the
 * anon/PUBLIC defence-in-depth.
 *
 * These are static file-content checks (migrations are applied via the Supabase
 * MCP after review, per CLAUDE.md "Supabase Migration Rules"), not DB-execution
 * tests. NB per the Test Integrity Policy: this is NET-NEW coverage — it changes
 * no existing assertion.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');
const migrationsDir = path.join(repoRoot, 'supabase/migrations');
const docPath = path.join(repoRoot, 'docs/DAILY_SECURITY_CHECK.md');

// The intended-ACL migration (BUGS-60). Its 14-digit timestamp prefix is the
// ordering fence: no LATER committed migration may revoke `authenticated`
// EXECUTE from these two RPCs, or a fresh-DB replay ends in the broken state.
const BUGS60_PREFIX = 20260628200000;

const ADMIN_RPCS = ['admin_list_users', 'admin_filter_profile_ids'];

function readBugs60Migration() {
  const files = fs.readdirSync(migrationsDir);
  const match = files.find((f) =>
    /_bugs60_grant_admin_rpc_authenticated\.sql$/.test(f)
  );
  expect(match).toBeTruthy();
  expect(path.basename(match)).toMatch(/^\d{14}_/);
  expect(parseInt(path.basename(match).slice(0, 14), 10)).toBe(BUGS60_PREFIX);
  return fs.readFileSync(path.join(migrationsDir, match), 'utf8');
}

function migrationPrefix(file) {
  return parseInt(path.basename(file).slice(0, 14), 10);
}

describe('SEC-43 — admin RPC ACL reconciliation (B9 CI guard)', () => {
  describe('intended ACL committed in the BUGS-60 migration', () => {
    test('migration exists with a 14-digit timestamp prefix', () => {
      expect(readBugs60Migration().length).toBeGreaterThan(0);
    });

    test.each(ADMIN_RPCS)(
      'revokes EXECUTE from anon + public on %s (defence-in-depth kept)',
      (fn) => {
        const sql = readBugs60Migration();
        // e.g. `revoke execute on function public.admin_list_users(...) from anon, public;`
        const re = new RegExp(
          `revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+anon,\\s*public`,
          'i'
        );
        expect(sql).toMatch(re);
      }
    );

    test.each(ADMIN_RPCS)(
      'grants EXECUTE to authenticated on %s (admin console needs it)',
      (fn) => {
        const sql = readBugs60Migration();
        const re = new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+authenticated`,
          'i'
        );
        expect(sql).toMatch(re);
      }
    );

    test.each(ADMIN_RPCS)(
      'never grants EXECUTE to anon or public on %s',
      (fn) => {
        const sql = readBugs60Migration();
        const re = new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+to\\s+[^;]*\\b(anon|public)\\b`,
          'i'
        );
        expect(sql).not.toMatch(re);
      }
    );
  });

  describe('no later migration re-breaks the console (naive revoke-from-authenticated)', () => {
    // The recurring regression: SEC-43's literal steps, or a future migration,
    // revoke `authenticated` EXECUTE on these RPCs. Guard that no committed
    // migration ordered AFTER BUGS-60 does so.
    const laterFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && migrationPrefix(f) > BUGS60_PREFIX);

    test.each(ADMIN_RPCS)(
      'no post-BUGS-60 migration revokes EXECUTE from authenticated on %s',
      (fn) => {
        const offenders = laterFiles.filter((f) => {
          const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
          // `revoke execute on function public.<fn>(...) from ... authenticated ...`
          const re = new RegExp(
            `revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\bauthenticated\\b`,
            'i'
          );
          return re.test(sql);
        });
        expect(offenders).toEqual([]);
      }
    );
  });

  describe('B9 spec allowlists the accepted exception (kills probe re-filing)', () => {
    const doc = fs.readFileSync(docPath, 'utf8');

    test('DAILY_SECURITY_CHECK.md exists and has a B9 section', () => {
      expect(doc).toMatch(/###\s+B9\b/);
    });

    test('B9 names an "Accepted exceptions" allowlist referencing SEC-43/BUGS-60', () => {
      expect(doc).toMatch(/Accepted exceptions/i);
      expect(doc).toMatch(/SEC-43\s*\/\s*BUGS-60/i);
    });

    test.each(ADMIN_RPCS)('allowlist names %s', (fn) => {
      expect(doc).toContain(fn);
    });

    test('allowlist records the self-gate as the real control', () => {
      expect(doc).toMatch(/self-gate/i);
      expect(doc).toMatch(/auth\.uid\(\)/i);
      expect(doc).toMatch(/is_admin/i);
    });

    test('allowlist documents the accepted steady state (anon_exec=false, auth_exec=true)', () => {
      expect(doc).toMatch(/anon_exec=false/i);
      expect(doc).toMatch(/auth_exec=true/i);
    });
  });
});
