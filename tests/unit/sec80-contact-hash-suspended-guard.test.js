/**
 * SEC-80 — search_by_contact_hash must exclude suspended profiles.
 *
 * Finding from the KAN-295 audit re-run (label security-audit-2026-07-11):
 * the SECURITY DEFINER function public.search_by_contact_hash(text, text)
 * bypasses RLS and filtered only is_published = true, so a published+suspended
 * profile was still discoverable (id + slug) by phone/postcode hash — a
 * deviation from the profiles public-read RLS contract
 * (is_published = true AND is_suspended = false) and from the SEC-44 suspended
 * guard. Safeguarding-relevant (the platform includes under-18 profiles).
 *
 * The fix (migration 20260713093000_sec80_contact_hash_suspended_guard.sql)
 * re-creates the function with `AND p.is_suspended = false` on BOTH the phone
 * and postcode branches. These are static file-content checks (migrations are
 * applied via the Supabase MCP after review, per CLAUDE.md "Supabase Migration
 * Rules") — they fail CI if the migration is dropped or a future edit weakens
 * the suspended guard on either branch.
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../../supabase/migrations');

function readMigration() {
  const files = fs.readdirSync(migrationsDir);
  const match = files.find((f) =>
    /_sec80_contact_hash_suspended_guard\.sql$/.test(f)
  );
  expect(match).toBeTruthy();
  expect(path.basename(match)).toMatch(/^\d{14}_/);
  return fs.readFileSync(path.join(migrationsDir, match), 'utf8');
}

describe('SEC-80 — search_by_contact_hash suspended guard migration', () => {
  test('migration file exists with a 14-digit timestamp prefix', () => {
    expect(readMigration().length).toBeGreaterThan(0);
  });

  test('re-creates the search_by_contact_hash function', () => {
    expect(readMigration()).toMatch(
      /create or replace function\s+public\.search_by_contact_hash\s*\(\s*p_kind text\s*,\s*p_hash text\s*\)/i
    );
  });

  test('keeps the function SECURITY DEFINER with a pinned search_path', () => {
    const sql = readMigration();
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path to 'public', 'pg_temp'/i);
  });

  test('is guarded so it is a no-op where the function is absent (prod-safe)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/if exists\s*\(/i);
    expect(sql).toMatch(/proname\s*=\s*'search_by_contact_hash'/i);
  });

  describe('suspended guard is present on BOTH discovery branches', () => {
    test('adds is_suspended = false exactly twice (phone + postcode)', () => {
      const sql = readMigration();
      // Count only inside the executable block; the header comments also mention
      // the predicate in prose (What/Fix/ROLLBACK) and must not inflate the count.
      const body = sql.slice(sql.indexOf('do $$'));
      const matches = body.match(/is_suspended\s*=\s*false/gi) || [];
      expect(matches.length).toBe(2);
    });

    test('phone branch filters discoverable_by_phone AND is_suspended = false', () => {
      const sql = readMigration();
      // the phone branch: from discoverable_by_phone up to (but not into) the elsif
      const phoneBranch = sql.slice(
        sql.indexOf('discoverable_by_phone'),
        sql.indexOf('elsif')
      );
      expect(phoneBranch).toMatch(/is_published\s*=\s*true/i);
      expect(phoneBranch).toMatch(/is_suspended\s*=\s*false/i);
    });

    test('postcode branch filters discoverable_by_postcode AND is_suspended = false', () => {
      const sql = readMigration();
      const postcodeBranch = sql.slice(sql.indexOf('discoverable_by_postcode'));
      expect(postcodeBranch).toMatch(/is_published\s*=\s*true/i);
      expect(postcodeBranch).toMatch(/is_suspended\s*=\s*false/i);
    });
  });
});
