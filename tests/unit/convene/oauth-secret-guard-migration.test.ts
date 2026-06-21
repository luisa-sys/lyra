/**
 * SEC-06 / BUGS-28 — regression guard for the oauth_connections secret-column
 * lockdown migration.
 *
 * The migration installs a BEFORE INSERT/UPDATE trigger that blocks
 * authenticated/anon clients from inserting connection rows or rewriting the
 * Vault token-reference columns (refresh_token_secret_id /
 * access_token_secret_id) — while still allowing the service-role OAuth
 * callback and the authenticated disconnect (deleted_at/status) flow.
 *
 * This test pins the migration's content so the protection can't be silently
 * weakened. (Applied live across dev/staging/prod via the Supabase MCP on
 * 2026-06-21; the trigger function is byte-identical across all three.)
 */

import fs from 'fs';
import path from 'path';

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '20260621120000_sec06_oauth_connections_secret_columns_lockdown.sql'
);

describe('SEC-06 / BUGS-28 oauth_connections secret-column guard', () => {
  test('migration file exists', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  const sql = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';

  test('defines the guard function with a pinned search_path', () => {
    expect(sql).toMatch(/create or replace function public\.oauth_connections_guard_secret_cols/);
    expect(sql).toMatch(/set search_path = ''/);
  });

  test('exempts the service-role backend only', () => {
    expect(sql).toMatch(/auth\.role\(\)\s*=\s*'service_role'/);
  });

  test('blocks authenticated/anon INSERTs (service-role only)', () => {
    expect(sql).toMatch(/tg_op\s*=\s*'INSERT'/);
    expect(sql).toMatch(/inserts are service-role only/i);
  });

  test('blocks changing either Vault token-secret column', () => {
    expect(sql).toMatch(/refresh_token_secret_id is distinct from old\.refresh_token_secret_id/);
    expect(sql).toMatch(/access_token_secret_id is distinct from old\.access_token_secret_id/);
    expect(sql).toMatch(/token-secret columns are service-role only/i);
  });

  test('wires the guard as a BEFORE INSERT OR UPDATE row trigger', () => {
    expect(sql).toMatch(
      /create trigger oauth_connections_guard_secret_cols\s+before insert or update on public\.oauth_connections\s+for each row/
    );
  });

  test('documents a rollback path', () => {
    expect(sql).toMatch(/drop trigger if exists oauth_connections_guard_secret_cols/);
  });
});
