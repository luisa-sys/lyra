/**
 * SEC-64 (tamper-evidence leg, finding adminmcp-audit-1) — moderation_logs
 * hash-chain + append-only enforcement guard.
 *
 * Migration 20260707033000_sec64_moderation_logs_hash_chain.sql makes the
 * append-only admin audit trail tamper-EVIDENT (a per-row SHA-256 hash chain)
 * and tamper-RESISTANT (revoke service-role UPDATE/DELETE/TRUNCATE — service_role
 * bypasses RLS, so this is the real lock — plus a BEFORE UPDATE/DELETE trigger
 * that raises).
 *
 * These are static file-content checks: migrations are applied via the Supabase
 * MCP after review (per CLAUDE.md "Supabase Migration Rules"), not executed in
 * Jest. The behavioural proof (chain intact, content-edit + mid-chain-delete
 * both detected by verify_moderation_log_chain(), UPDATE/DELETE blocked) was run
 * against dev-lyra at apply time. This suite fails CI if the migration is
 * dropped or a future edit weakens any control.
 */

const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../../supabase/migrations');

function readMigration() {
  const files = fs.readdirSync(migrationsDir);
  const match = files.find((f) =>
    /_sec64_moderation_logs_hash_chain\.sql$/.test(f)
  );
  expect(match).toBeTruthy();
  expect(path.basename(match)).toMatch(/^\d{14}_/);
  return fs.readFileSync(path.join(migrationsDir, match), 'utf8');
}

// Collapse whitespace so multi-line SQL statements match single-line patterns.
function flat() {
  return readMigration().replace(/\s+/g, ' ');
}

describe('SEC-64 — moderation_logs hash-chain migration', () => {
  test('migration file exists with a 14-digit timestamp prefix', () => {
    expect(readMigration().length).toBeGreaterThan(0);
  });

  describe('(a) per-row hash chain', () => {
    test('adds the seq / prev_hash / row_hash chain columns', () => {
      const sql = flat();
      expect(sql).toMatch(/add column if not exists seq bigint/i);
      expect(sql).toMatch(/add column if not exists prev_hash text/i);
      expect(sql).toMatch(/add column if not exists row_hash text/i);
    });

    test('row-hash helper is a single source of truth, pinned search_path, sha256', () => {
      const sql = flat();
      expect(sql).toMatch(
        /create or replace function\s+public\.moderation_log_row_hash/i
      );
      expect(sql).toMatch(/set search_path = ''/i);
      expect(sql).toMatch(/extensions\.digest\(/i);
      expect(sql).toMatch(/'sha256'/i);
    });

    test('hash binds prev_hash so editing a row breaks every following row', () => {
      // The digest input must fold in the previous row's hash (chain linkage).
      expect(flat()).toMatch(/coalesce\(p_prev_hash, ?''\)\s*\|\|\s*chr\(30\)/i);
    });

    test('renders created_at in fixed UTC so the hash is timezone-independent', () => {
      expect(flat()).toMatch(/p_created_at at time zone 'UTC'/i);
    });

    test('backfills any pre-existing rows deterministically before the trigger', () => {
      const sql = flat();
      expect(sql).toMatch(/where row_hash is null/i);
      expect(sql).toMatch(/order by created_at asc, id asc/i);
    });

    test('seq + row_hash are NOT NULL and seq is unique', () => {
      const sql = flat();
      expect(sql).toMatch(/create unique index if not exists moderation_logs_seq_key/i);
      expect(sql).toMatch(/alter column seq set not null/i);
      expect(sql).toMatch(/alter column row_hash set not null/i);
    });

    test('BEFORE INSERT trigger, SECURITY DEFINER, serialized by an advisory lock', () => {
      const sql = flat();
      expect(sql).toMatch(
        /create or replace function\s+public\.moderation_logs_hash_chain\(\)\s+returns trigger/i
      );
      expect(sql).toMatch(/security definer/i);
      expect(sql).toMatch(/pg_advisory_xact_lock\(/i);
      expect(sql).toMatch(
        /create trigger moderation_logs_hash_chain_trg before insert on public\.moderation_logs/i
      );
    });

    test('trigger assigns seq/prev_hash/row_hash from the DB tip (client cannot forge)', () => {
      const sql = flat();
      expect(sql).toMatch(/order by ml\.seq desc limit 1/i);
      expect(sql).toMatch(/new\.seq\s*:=\s*coalesce\(v_prev_seq, ?0\) \+ 1/i);
      expect(sql).toMatch(/new\.row_hash\s*:=\s*public\.moderation_log_row_hash\(/i);
    });
  });

  describe('(b) append-only enforcement', () => {
    test('revokes UPDATE, DELETE, TRUNCATE from service_role (the RLS-bypassing role)', () => {
      expect(flat()).toMatch(
        /revoke update, delete, truncate on public\.moderation_logs from service_role/i
      );
    });

    test('also revokes those writes from authenticated and anon', () => {
      const sql = flat();
      expect(sql).toMatch(
        /revoke update, delete, truncate on public\.moderation_logs from authenticated/i
      );
      expect(sql).toMatch(
        /revoke update, delete, truncate on public\.moderation_logs from anon/i
      );
    });

    test('a BEFORE UPDATE/DELETE trigger raises so append-only survives grant drift', () => {
      const sql = flat();
      expect(sql).toMatch(
        /create or replace function\s+public\.moderation_logs_forbid_mutation\(\)/i
      );
      expect(sql).toMatch(/raise exception/i);
      expect(sql).toMatch(
        /create trigger moderation_logs_forbid_mutation_trg before update or delete on public\.moderation_logs/i
      );
    });
  });

  describe('(c) verifier', () => {
    test('verify_moderation_log_chain reports ok / first_bad_seq', () => {
      const sql = flat();
      expect(sql).toMatch(
        /create or replace function\s+public\.verify_moderation_log_chain\(\)\s+returns table\(ok boolean, rows_checked bigint, first_bad_seq bigint, detail text\)/i
      );
      expect(sql).toMatch(/security definer/i);
      // Catches content edits (row_hash) AND deletions/reordering (prev_hash link).
      expect(sql).toMatch(/row_hash mismatch/i);
      expect(sql).toMatch(/prev_hash linkage broken/i);
    });
  });

  describe('EXECUTE hygiene (no anon/authenticated on the new SECURITY DEFINER fns)', () => {
    test('trigger functions are not directly executable by any client role', () => {
      const sql = flat();
      expect(sql).toMatch(
        /revoke all on function public\.moderation_logs_hash_chain\(\) from public, anon, authenticated, service_role/i
      );
    });

    test('verify is service_role-only (revoked from anon + authenticated)', () => {
      const sql = flat();
      expect(sql).toMatch(
        /revoke all on function public\.verify_moderation_log_chain\(\) from public, anon, authenticated/i
      );
      expect(sql).toMatch(
        /grant execute on function public\.verify_moderation_log_chain\(\) to service_role/i
      );
    });
  });
});
