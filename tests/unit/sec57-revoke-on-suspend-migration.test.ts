/**
 * SEC-57 (retain leg) — suspension revokes credentials already issued.
 *
 * The "obtain" half shipped in PR #448 and is pinned by
 * `sec57-issuance-suspension.test.ts` and `oauth-authorize-suspension-guard.test.ts`.
 * This suite covers the retroactive half: an AFTER UPDATE OF is_suspended
 * trigger on public.profiles that stamps `revoked_at` / `used_at` across
 * api_keys and the three oauth_* tables for the transitioning user.
 *
 * ⚠️ WHAT THIS TEST CAN AND CANNOT PROVE.
 * It pins the migration's CONTENT. That is a source-text scan, which is the
 * weak instrument this repo keeps getting caught by (gotcha #29 / CTL-039), so
 * every assertion below matches on comment-STRIPPED SQL — the file explains the
 * threat at length and names every identifier it touches, and an unstripped
 * scan would be satisfied by the prose describing the fix long after the fix
 * itself was deleted.
 *
 * It cannot prove the trigger is RUNNING on any database. Migrations reach a
 * database through the Supabase MCP without passing through a pull request
 * (gotcha #9), which is the SEC-42 shape. There is no `tests/integration/`
 * harness in this repo (BUGS-51), so the behavioural half was proven by hand
 * against the dev database (ilprytcrnqyrsbsrfujj) and the evidence — including
 * the mutation run with the trigger dropped — is recorded on SEC-57. STATED
 * GAP: nothing re-checks that on a schedule yet. A live invariant in
 * `security_invariants_report()` is the natural home for it and is called out
 * in the ticket rather than left implicit here.
 */

import fs from 'fs';
import path from 'path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const REVOKE = path.join(
  MIGRATIONS,
  '20260819210000_sec57_revoke_credentials_on_suspend.sql'
);

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s--.*$/gm, '');
}

describe('SEC-57 revoke-on-suspend — migration', () => {
  test('migration file exists', () => {
    expect(fs.existsSync(REVOKE)).toBe(true);
  });

  const raw = fs.readFileSync(REVOKE, 'utf8');
  const sql = stripSqlComments(raw);

  test('the comment stripper actually removes this file’s prose', () => {
    // Failure mode 2 in CLAUDE.md's catalogue: an assertion satisfied by the
    // comment explaining the fix. Guard the guard — if stripSqlComments ever
    // stops working, every `not.toMatch` below silently inverts and every
    // `toMatch` starts passing for the wrong reason.
    expect(raw).toMatch(/WHY A TRIGGER AND NOT APPLICATION CODE/);
    expect(sql).not.toMatch(/WHY A TRIGGER AND NOT APPLICATION CODE/);
  });

  test('defines the revocation function as SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(
      /create or replace function public\.sec57_revoke_credentials_on_suspend/i
    );
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
  });

  test('revokes EXECUTE from all three roles, not just PUBLIC (gotcha #26)', () => {
    // `revoke ... from public` alone leaves anon and authenticated holding
    // Supabase's ALTER DEFAULT PRIVILEGES grants. That single mis-specified
    // revoke is the whole of SEC-28/29/42/43.
    expect(sql).toMatch(
      /revoke all on function public\.sec57_revoke_credentials_on_suspend\(\) from public, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.sec57_revoke_credentials_on_suspend\(\) to service_role;/i
    );
    expect(sql).not.toMatch(/grant execute[^;]*to[^;]*\b(anon|authenticated)\b/i);
  });

  test('fires as an AFTER UPDATE OF is_suspended row trigger on public.profiles', () => {
    expect(sql).toMatch(
      /create trigger profiles_revoke_credentials_on_suspend\s+after update of is_suspended on public\.profiles\s+for each row/i
    );
  });

  test('fires only on the false→true transition, so it is idempotent', () => {
    // Without this clause, re-suspending an already-suspended user (or any
    // bulk write touching the column) re-stamps timestamps, destroying the
    // forensic record of when the credential actually died.
    expect(sql).toMatch(
      /when \(new\.is_suspended is true and coalesce\(old\.is_suspended, false\) is false\)/i
    );
  });

  // Parameterised over the four credential tables. Each entry names the column
  // that actually kills the row on that table — oauth_refresh_tokens is the odd
  // one out and writing revoked_at there would fail at runtime.
  const TABLES: ReadonlyArray<readonly [string, string]> = [
    ['api_keys', 'revoked_at'],
    ['oauth_access_tokens', 'revoked_at'],
    ['oauth_refresh_tokens', 'used_at'],
    ['oauth_consents', 'revoked_at'],
  ];

  test('the credential-table corpus is non-empty', () => {
    // Failure mode 4: test.each over an empty list registers zero tests and an
    // empty suite is green.
    expect(TABLES.length).toBe(4);
  });

  test.each(TABLES)(
    'revokes public.%s via %s, scoped to the transitioning user only',
    (table, column) => {
      const stmt = new RegExp(
        `update public\\.${table}\\s+set ${column} = v_now\\s+where user_id = new\\.user_id\\s+and ${column} is null;`,
        'i'
      );
      expect(sql).toMatch(stmt);
    }
  );

  test('scopes every write to new.user_id and nothing broader', () => {
    // The threat this ticket introduces is a mis-scoped bulk revocation hitting
    // users who were never suspended. FOR EACH ROW plus a user_id equality
    // filter is what bounds it; an IN-list or an unfiltered update would not.
    const updates = sql.match(/update public\.\w+/gi) ?? [];
    expect(updates.length).toBe(4);
    const whereClauses = sql.match(/where user_id = new\.user_id/gi) ?? [];
    expect(whereClauses.length).toBe(4);
    expect(sql).not.toMatch(/where user_id in \(/i);
    // profiles.id and profiles.user_id are different columns; joining on the
    // wrong one revokes nothing while looking correct.
    expect(sql).not.toMatch(/user_id = new\.id\b/i);
  });

  test('revocation is one-way — nothing restores credentials on unsuspend', () => {
    // Deliberate: re-arming a credential that may be the reason for the
    // suspension is the wrong default. Documented in docs/RUNBOOK.md.
    expect(sql).not.toMatch(/set revoked_at = null/i);
    expect(sql).not.toMatch(/set used_at = null/i);
    expect(sql).not.toMatch(/is_suspended is false/i);
  });

  test('does not swallow errors — a failed revocation aborts the suspend', () => {
    // The Workflow & Backup Integrity Policy's forbidden pattern, in SQL form.
    // An EXCEPTION block here would record a suspension whose credentials are
    // still live, and report success.
    expect(sql).not.toMatch(/\bexception\s+when\b/i);
  });

  test('documents a rollback path', () => {
    expect(raw).toMatch(
      /drop trigger if exists profiles_revoke_credentials_on_suspend on public\.profiles;/i
    );
    expect(raw).toMatch(
      /drop function if exists public\.sec57_revoke_credentials_on_suspend/i
    );
  });
});
