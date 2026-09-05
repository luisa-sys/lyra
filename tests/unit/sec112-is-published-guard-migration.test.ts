/**
 * SEC-112 — regression guard for the `is_published` self-write lockdown.
 *
 * `authenticated` holds a table-level UPDATE grant on public.profiles and the
 * "Update own profile" RLS policy carries no column restriction, so any
 * signed-in user could PATCH their own row with {"is_published": true} straight
 * at PostgREST and publish without passing publishProfile() — which is where the
 * KAN-408 provider age gate lives. The migration installs a BEFORE UPDATE
 * trigger that raises 42501 when a JWT-bearing caller changes the column, while
 * leaving service-role (auth.uid() IS NULL) writes — the real publish flow and
 * the admin console — untouched.
 *
 * ⚠️ WHAT THIS TEST CAN AND CANNOT PROVE.
 * It pins the migration's CONTENT, which is a source-text scan and therefore
 * the weak instrument this repo keeps getting caught by (gotcha #29). It cannot
 * prove the trigger is running on any database. That half is INV-9 in
 * `security_invariants_report()`, checked against dev/staging/production daily
 * by scripts/check-db-invariants.py — which matters more than usual here,
 * because migrations reach a database via the Supabase MCP without passing
 * through a PR (the SEC-42 shape).
 *
 * The behavioural half of the paired code change is covered by
 * `sec112-publish-profile-service-role.test.ts`, which asserts which client
 * receives the write rather than what the file says about it.
 */

import fs from 'fs';
import path from 'path';

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const GUARD = path.join(MIGRATIONS, '20260814150000_sec112_block_is_published_self_set.sql');
const INVARIANT = path.join(MIGRATIONS, '20260814150500_sec112_invariant_is_published_guard.sql');

/**
 * Strip SQL comments before matching. Both files explain the threat at length
 * and name every identifier they guard, so an unstripped scan would be
 * satisfied by the prose describing the fix even after the fix was deleted —
 * CTL-039 / gotcha #29, the SEC-100 `is_published` failure exactly.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s--.*$/gm, '');
}

describe('SEC-112 is_published self-write guard — migration', () => {
  test('migration file exists', () => {
    expect(fs.existsSync(GUARD)).toBe(true);
  });

  const sql = stripSqlComments(fs.readFileSync(GUARD, 'utf8'));

  test('defines the guard function as SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/create or replace function public\.block_is_published_self_set/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
  });

  test('exempts the service-role / backend caller (auth.uid() IS NULL)', () => {
    // This is the line that keeps publishProfile() and the admin console
    // working. BUGS-60 is what happens when it is missing.
    expect(sql).toMatch(/if auth\.uid\(\) is null then/i);
    expect(sql).toMatch(/return new;/i);
  });

  test('blocks changing is_published', () => {
    expect(sql).toMatch(/new\.is_published is distinct from old\.is_published/i);
  });

  test('raises insufficient_privilege (42501) on violation', () => {
    expect(sql).toMatch(/raise exception/i);
    expect(sql).toMatch(/errcode = '42501'/i);
  });

  test('wires the guard as a BEFORE UPDATE row trigger on public.profiles', () => {
    expect(sql).toMatch(
      /create trigger profiles_block_is_published_self_set\s+before update on public\.profiles\s+for each row/i
    );
  });

  test('documents a rollback path', () => {
    const raw = fs.readFileSync(GUARD, 'utf8');
    expect(raw).toMatch(/drop trigger if exists profiles_block_is_published_self_set/i);
    expect(raw).toMatch(/drop function if exists public\.block_is_published_self_set/i);
  });

  test('ships NO column-level revoke — it would be a no-op against the table grant', () => {
    // Not stylistic. `revoke update (col) ... from authenticated` cannot subtract
    // from the TABLE-level UPDATE grant authenticated holds on public.profiles:
    // Postgres warns and carries on, leaving pg_attribute.attacl NULL. SEC-27
    // shipped exactly that line and it has been inert since 2026-06-22.
    // Re-introducing it here would assert a second layer that does not exist.
    expect(sql).not.toMatch(/revoke\s+update\s*\(/i);
  });
});

describe('SEC-112 is_published self-write guard — INV-9 live invariant', () => {
  test('invariant migration file exists', () => {
    expect(fs.existsSync(INVARIANT)).toBe(true);
  });

  const inv = stripSqlComments(fs.readFileSync(INVARIANT, 'utf8'));

  test('re-declares the invariants RPC with a pinned search_path', () => {
    expect(inv).toMatch(/create or replace function public\.security_invariants_report\(\)/i);
    expect(inv).toMatch(/set search_path to 'pg_catalog', 'public'/i);
  });

  test('carries forward every earlier invariant — INV-1 through INV-8', () => {
    // CREATE OR REPLACE overwrites the whole body, so an omitted invariant is
    // silently DELETED from every environment this is applied to. Assert each
    // one survives rather than trusting that it was copied.
    for (const key of [
      'INV-1-secdef-anon-execute',
      'INV-2-secdef-duplicate-overload',
      'INV-3-secdef-unpinned-search-path',
      'INV-4-secdef-authed-execute-no-authz',
      'INV-5-table-rls-disabled',
      'INV-6-public-storage-bucket',
      'INV-7-secdef-view',
      'INV-8-public-profiles-view-missing',
      'INV-8-public-profiles-view-predicate',
      'INV-8-public-profiles-view-invoker',
    ]) {
      expect(inv).toContain(key);
    }
  });

  test('INV-9 fires when the trigger is ABSENT, not only when it is wrong', () => {
    // Fail-closed. The tempting "if it exists, verify it" shape reports clean on
    // precisely the environment where the migration was never applied — the
    // worst answer, since the app has already been cut over to rely on it.
    expect(inv).toContain('INV-9-is-published-guard-missing');
    expect(inv).toMatch(/where not exists \(\s*select 1 from pg_trigger/i);
    expect(inv).toMatch(/tgname = 'profiles_block_is_published_self_set'/i);
  });

  test('INV-9 treats a DISABLED trigger as missing', () => {
    // ALTER TABLE ... DISABLE TRIGGER leaves the row in pg_trigger, so an
    // existence-only test would pass a trigger that never fires.
    expect(inv).toMatch(/tgenabled = 'O'/);
  });

  test('INV-9 also fires if the body stops guarding the column or loses the exemption', () => {
    expect(inv).toContain('INV-9-is-published-guard-predicate');
    expect(inv).toMatch(/pg_get_functiondef\(p\.oid\) ~\* 'is_published'/i);
    expect(inv).toMatch(/pg_get_functiondef\(p\.oid\) ~\* 'auth\\\.uid\\\(\\\) is null'/i);
  });

  test('the RPC stays service-role only', () => {
    expect(inv).toMatch(/revoke all on function public\.security_invariants_report\(\) from anon/i);
    expect(inv).toMatch(
      /revoke all on function public\.security_invariants_report\(\) from authenticated/i
    );
    expect(inv).toMatch(
      /grant execute on function public\.security_invariants_report\(\) to service_role/i
    );
  });
});
