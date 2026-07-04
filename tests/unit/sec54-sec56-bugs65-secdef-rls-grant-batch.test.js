/**
 * SEC-54 / SEC-56 / BUGS-65 — SECURITY DEFINER + RLS + grant hygiene batch guard.
 *
 * One migration (20260704180000_sec54_sec56_bugs65_secdef_rls_grant_batch.sql)
 * carries three defence-in-depth findings from the 2026-06-30 review (KAN-350):
 *
 *   SEC-54  handle_new_user SECURITY DEFINER trigger had a mutable search_path
 *           (function_search_path_mutable priv-esc vector). Re-create it with
 *           `set search_path = ''` and a fully schema-qualified body.
 *   SEC-56  oauth_connections UPDATE RLS was column-unrestricted (cross-user
 *           Vault refresh-token theft primitive). Revoke direct INSERT/UPDATE/
 *           DELETE from authenticated + anon; legit writes use the service role.
 *   BUGS-65 Two SECURITY DEFINER trigger fns created after BUGS-48 closed still
 *           carried the default PUBLIC EXECUTE grant. Revoke PUBLIC/anon/
 *           authenticated; keep service_role.
 *
 * These are static file-content checks (migrations are applied via the Supabase
 * MCP after review, per CLAUDE.md "Supabase Migration Rules"), not DB-execution
 * tests — they fail CI if the migration is dropped or a future edit weakens any
 * of the three controls.
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../../supabase/migrations');

function readBatchMigration() {
  const files = fs.readdirSync(migrationsDir);
  const match = files.find((f) =>
    /_sec54_sec56_bugs65_secdef_rls_grant_batch\.sql$/.test(f)
  );
  expect(match).toBeTruthy();
  expect(path.basename(match)).toMatch(/^\d{14}_/);
  return fs.readFileSync(path.join(migrationsDir, match), 'utf8');
}

describe('SEC-54/56/BUGS-65 — SECURITY DEFINER + RLS + grant hygiene migration', () => {
  test('migration file exists with a 14-digit timestamp prefix', () => {
    // readBatchMigration asserts existence + prefix
    expect(readBatchMigration().length).toBeGreaterThan(0);
  });

  describe('SEC-54 — handle_new_user search_path pin', () => {
    test('re-creates handle_new_user', () => {
      expect(readBatchMigration()).toMatch(
        /create or replace function\s+public\.handle_new_user\s*\(\s*\)/i
      );
    });

    test('pins the search_path to empty', () => {
      expect(readBatchMigration()).toMatch(/set search_path\s*=\s*''/i);
    });

    test('body is schema-qualified (public.profiles), so search_path=\'\' is safe', () => {
      expect(readBatchMigration()).toMatch(/insert into\s+public\.profiles/i);
    });
  });

  describe('SEC-56 — oauth_connections write lockdown', () => {
    test('revokes INSERT/UPDATE/DELETE from authenticated', () => {
      expect(readBatchMigration()).toMatch(
        /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.oauth_connections\s+from\s+authenticated/i
      );
    });

    test('revokes INSERT/UPDATE/DELETE from anon', () => {
      expect(readBatchMigration()).toMatch(
        /revoke\s+insert,\s*update,\s*delete\s+on\s+public\.oauth_connections\s+from\s+anon/i
      );
    });

    test('does NOT revoke SELECT (owner read must survive)', () => {
      // guard against an over-broad revoke that also strips owner SELECT
      expect(readBatchMigration()).not.toMatch(
        /revoke[^;]*\bselect\b[^;]*on\s+public\.oauth_connections/i
      );
    });
  });

  describe('BUGS-65 — revoke PUBLIC execute on 2 newer trigger fns', () => {
    const fns = [
      'block_admin_is_suspended_self_set',
      'prevent_feature_entitlement_self_grant',
    ];

    fns.forEach((fn) => {
      test(`revokes EXECUTE on ${fn} from public/anon/authenticated`, () => {
        expect(readBatchMigration()).toMatch(
          new RegExp(
            `revoke execute on function\\s+public\\.${fn}\\s*\\(\\s*\\)\\s+from\\s+public,\\s*anon,\\s*authenticated`,
            'i'
          )
        );
      });

      test(`retains EXECUTE on ${fn} for service_role`, () => {
        expect(readBatchMigration()).toMatch(
          new RegExp(
            `grant execute on function\\s+public\\.${fn}\\s*\\(\\s*\\)\\s+to\\s+service_role`,
            'i'
          )
        );
      });
    });
  });
});
