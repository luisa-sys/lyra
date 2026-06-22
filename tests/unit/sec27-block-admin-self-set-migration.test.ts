/**
 * SEC-27 (CRITICAL) — regression guard for the is_admin / is_suspended
 * self-elevation lockdown migration.
 *
 * Any signed-in user could PATCH their own profile row with {"is_admin": true}
 * (full admin privilege escalation) or {"is_suspended": false} (self-unsuspend)
 * because the "Update own profile" RLS policy carried no column restriction and
 * the expected blocking trigger had never been created. The migration installs a
 * BEFORE UPDATE trigger that raises 42501 when a JWT-bearing caller changes
 * either column, while leaving service-role (auth.uid() IS NULL) writes — the
 * admin console + approval flows — untouched.
 *
 * This test pins the migration's content so the protection can't be silently
 * weakened or deleted. (Applied live across dev/staging/prod via the Supabase MCP
 * on 2026-06-22; trigger byte-identical across all three.)
 */

import fs from 'fs';
import path from 'path';

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260622061545_sec27_block_admin_is_suspended_self_set.sql'
);

describe('SEC-27 is_admin / is_suspended self-elevation guard', () => {
  test('migration file exists', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  const sql = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';

  test('defines the guard function with a pinned search_path', () => {
    expect(sql).toMatch(/create or replace function public\.block_admin_is_suspended_self_set/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
    expect(sql).toMatch(/security definer/i);
  });

  test('exempts the service-role / backend caller (auth.uid() IS NULL)', () => {
    expect(sql).toMatch(/if auth\.uid\(\) is null then/i);
  });

  test('blocks changing is_admin and is_suspended', () => {
    expect(sql).toMatch(/new\.is_admin is distinct from old\.is_admin/i);
    expect(sql).toMatch(/new\.is_suspended is distinct from old\.is_suspended/i);
  });

  test('raises an insufficient_privilege (42501) error on violation', () => {
    expect(sql).toMatch(/raise exception/i);
    expect(sql).toMatch(/errcode = '42501'/i);
  });

  test('wires the guard as a BEFORE UPDATE row trigger on public.profiles', () => {
    expect(sql).toMatch(
      /create trigger profiles_block_admin_is_suspended_self_set\s+before update on public\.profiles\s+for each row/i
    );
  });

  test('documents a rollback path', () => {
    expect(sql).toMatch(/drop trigger if exists profiles_block_admin_is_suspended_self_set/i);
  });
});
