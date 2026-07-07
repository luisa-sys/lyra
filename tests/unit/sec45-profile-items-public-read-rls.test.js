/**
 * SEC-45 (finding web-rls-1) — profile_items public-read RLS visibility guard.
 *
 * A public anon SELECT policy on profile_items that lacks a `visibility`
 * predicate lets anonymous callers (public anon key, via PostgREST) read
 * members_only / draft / private items of any published profile. The
 * 20260516120000_admin_and_moderation.sql migration re-introduced exactly such
 * a policy ("Anyone can read items from published non-suspended profiles"),
 * silently defeating KAN-143 per-item visibility.
 *
 * These are static file-content checks (migrations are applied via the
 * Supabase MCP after review, per CLAUDE.md "Supabase Migration Rules"), not
 * DB-execution tests. Group 2 models the *final* effective policy set across
 * every migration so that any FUTURE migration re-creating an over-broad
 * public-read policy fails CI.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const migrationsDir = path.join(root, 'supabase/migrations');

const OVERBROAD_POLICY = 'Anyone can read items from published non-suspended profiles';
const ADHOC_DUPLICATE = 'Read public items from published profiles';

function findSec45Migration() {
  const files = fs.readdirSync(migrationsDir);
  const match = files.find((f) =>
    /sec45_profile_items_public_read_visibility\.sql$/.test(f)
  );
  return match ? path.join(migrationsDir, match) : null;
}

describe('SEC-45 — profile_items public-read RLS fix migration', () => {
  test('migration file exists with a 14-digit timestamp prefix', () => {
    const filePath = findSec45Migration();
    expect(filePath).not.toBeNull();
    expect(path.basename(filePath)).toMatch(/^\d{14}_/);
  });

  test('drops the over-broad policy that lacked a visibility predicate', () => {
    const sql = fs.readFileSync(findSec45Migration(), 'utf8');
    expect(sql).toMatch(
      new RegExp(`drop policy if exists\\s+"${OVERBROAD_POLICY}"\\s+on\\s+public\\.profile_items`, 'i')
    );
  });

  test('drops the untracked ad-hoc duplicate public-read policy', () => {
    const sql = fs.readFileSync(findSec45Migration(), 'utf8');
    expect(sql).toMatch(
      new RegExp(`drop policy if exists\\s+"${ADHOC_DUPLICATE}"\\s+on\\s+public\\.profile_items`, 'i')
    );
  });

  test('recreates the public-read policy carrying visibility AND is_suspended', () => {
    const sql = fs.readFileSync(findSec45Migration(), 'utf8');
    const block = sql.match(
      /create policy\s+"Anyone can read public items from published profiles"\s+on\s+public\.profile_items\s+for\s+select([\s\S]*?);/i
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/visibility = 'public'/);
    expect(block[1]).toMatch(/is_suspended = false/);
  });

  test('recreates the members_only policy: authenticated + members_only + non-suspended', () => {
    const sql = fs.readFileSync(findSec45Migration(), 'utf8');
    const block = sql.match(
      /create policy\s+"Members can read members_only items from published profiles"\s+on\s+public\.profile_items\s+for\s+select([\s\S]*?);/i
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/auth\.uid\(\) is not null/i);
    expect(block[1]).toMatch(/visibility = 'members_only'/);
    expect(block[1]).toMatch(/is_suspended = false/);
  });

  test('does NOT drop or alter the owner "Users can manage own profile items" policy', () => {
    const sql = fs.readFileSync(findSec45Migration(), 'utf8');
    expect(sql).not.toMatch(/drop\s+policy[^;]*"Users can manage own profile items"/i);
    expect(sql).not.toMatch(/alter\s+policy[^;]*"Users can manage own profile items"/i);
  });
});

describe('SEC-45 — cross-migration invariant: no public-reachable profile_items read policy may omit a visibility predicate', () => {
  // Model the FINAL effective set of profile_items policies by replaying every
  // migration in timestamp order (drop / create). A policy that is reachable by
  // anonymous callers (not gated by auth.uid(), not restricted `to authenticated`)
  // and can return rows via SELECT (FOR SELECT, FOR ALL, or no FOR clause) MUST
  // carry a `visibility` predicate — otherwise it leaks non-public items.
  const effective = new Map(); // policyName -> { canSelect, publicReachable, hasVisibility, file }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Drops: mark the policy as gone.
    const dropRe = /drop policy if exists\s+"([^"]+)"\s+on\s+public\.profile_items/gi;
    let d;
    while ((d = dropRe.exec(sql)) !== null) {
      effective.delete(d[1]);
    }

    // Creates: capture the full statement up to its terminating semicolon.
    const createRe = /create policy\s+"([^"]+)"\s+on\s+public\.profile_items([\s\S]*?);/gi;
    let c;
    while ((c = createRe.exec(sql)) !== null) {
      const name = c[1];
      const body = c[2];
      const hasForClause = /\bfor\s+(select|all|insert|update|delete)\b/i.test(body);
      const forSelectOrAll = /\bfor\s+(select|all)\b/i.test(body) || !hasForClause;
      const authGated = /auth\.uid\(\)/i.test(body);
      const restrictedToAuthed =
        /\bto\s+authenticated\b/i.test(body) && !/\bto\s+[^\n]*\banon\b/i.test(body);
      effective.set(name, {
        canSelect: forSelectOrAll,
        publicReachable: !authGated && !restrictedToAuthed,
        hasVisibility: /visibility\s*=/.test(body),
        file,
      });
    }
  }

  test('every anon-reachable profile_items read policy carries a visibility predicate', () => {
    const offenders = [];
    for (const [name, p] of effective.entries()) {
      if (p.canSelect && p.publicReachable && !p.hasVisibility) {
        offenders.push(`"${name}" (created in ${p.file})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the over-broad SEC-45 policy is not present in the final effective set', () => {
    expect(effective.has(OVERBROAD_POLICY)).toBe(false);
  });
});
