/**
 * SEC-18 (F-07) — regression guard for the availability-consent column
 * migration. Applied live across dev/staging/prod via the Supabase MCP on
 * 2026-06-21; this pins the column shape (opt-in, default false = deny).
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
  '20260621140000_sec18_availability_consent.sql'
);

describe('SEC-18 availability-consent migration', () => {
  test('migration file exists', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  const sql = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';

  test('adds share_availability_with_contacts as NOT NULL DEFAULT false (deny)', () => {
    expect(sql).toMatch(
      /add column if not exists share_availability_with_contacts boolean not null default false/i
    );
  });

  test('is additive/idempotent (no destructive DROP in the forward migration)', () => {
    // The forward migration must not drop anything; rollback is documented in a comment.
    const body = sql.replace(/--.*$/gm, '');
    expect(body).not.toMatch(/drop\s+(table|column)/i);
  });
});
