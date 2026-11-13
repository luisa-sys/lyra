/**
 * Hidden affiliations — school_affiliations public-read RLS guard.
 *
 * An affiliation with show_on_profile = false is "searchable but hidden" and
 * must never be returned to a visitor. Both public SELECT policies on
 * school_affiliations omitted the show_on_profile predicate, so anyone with
 * the public anon key could read every hidden affiliation of every published
 * profile via PostgREST. Same defect family as SEC-45 (profile_items).
 *
 * These are static file-content checks (migrations are applied via the
 * Supabase MCP after review, per CLAUDE.md "Supabase Migration Rules"), not
 * DB-execution tests. Group 2 replays every migration to model the FINAL
 * effective policy set, so any FUTURE migration re-creating an over-broad
 * public-read policy fails CI. SQL comments are stripped before matching so a
 * comment that quotes a predicate cannot satisfy an assertion (CLAUDE.md
 * "Writing a test that can actually fail", failure mode 2).
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');
const migrationsDir = path.join(root, SRC.migrations);

const OVERBROAD_TRACKED = 'Anyone can read schools from published non-suspended profiles';
const OVERBROAD_ADHOC = 'Read schools from published profiles';
const CANONICAL = 'Anyone can read visible affiliations from published profiles';
const OWNER_POLICY = 'Manage own school affiliations';

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, '');
}

function findFixMigration() {
  const files = fs.readdirSync(migrationsDir);
  const match = files.find((f) => /hidden_affiliations_public_read_rls\.sql$/.test(f));
  return match ? path.join(migrationsDir, match) : null;
}

function readFix() {
  return stripSqlComments(fs.readFileSync(findFixMigration(), 'utf8'));
}

describe('hidden affiliations — public-read RLS fix migration', () => {
  test('migration file exists with a 14-digit timestamp prefix', () => {
    const filePath = findFixMigration();
    expect(filePath).not.toBeNull();
    expect(path.basename(filePath)).toMatch(/^\d{14}_/);
  });

  test('drops the repo-tracked policy that lacked a show_on_profile predicate', () => {
    expect(readFix()).toMatch(
      new RegExp(`drop policy if exists\\s+"${OVERBROAD_TRACKED}"\\s+on\\s+public\\.school_affiliations`, 'i')
    );
  });

  test('drops the out-of-band duplicate public-read policy', () => {
    expect(readFix()).toMatch(
      new RegExp(`drop policy if exists\\s+"${OVERBROAD_ADHOC}"\\s+on\\s+public\\.school_affiliations`, 'i')
    );
  });

  test('creates the canonical policy carrying show_on_profile, is_published AND is_suspended', () => {
    const block = readFix().match(
      new RegExp(`create policy\\s+"${CANONICAL}"\\s+on\\s+public\\.school_affiliations\\s+for\\s+select([\\s\\S]*?);`, 'i')
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/show_on_profile\s*=\s*true/);
    expect(block[1]).toMatch(/is_published\s*=\s*true/);
    expect(block[1]).toMatch(/is_suspended\s*=\s*false/);
  });

  test('does NOT drop or alter the owner policy', () => {
    const sql = readFix();
    expect(sql).not.toMatch(new RegExp(`drop\\s+policy[^;]*"${OWNER_POLICY}"`, 'i'));
    expect(sql).not.toMatch(new RegExp(`alter\\s+policy[^;]*"${OWNER_POLICY}"`, 'i'));
  });
});

describe('hidden affiliations — cross-migration invariant: no anon-reachable school_affiliations read policy may omit show_on_profile', () => {
  // Replay every migration in timestamp order (drop / create) to model the
  // FINAL effective policy set. A policy reachable by anonymous callers (not
  // gated on auth.uid(), not restricted `to authenticated`) that can return
  // rows via SELECT (FOR SELECT, FOR ALL, or no FOR clause) MUST require
  // show_on_profile = true — otherwise it leaks hidden affiliations.
  const effective = new Map();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));

    const dropRe = /drop policy if exists\s+"([^"]+)"\s+on\s+public\.school_affiliations/gi;
    let d;
    while ((d = dropRe.exec(sql)) !== null) {
      effective.delete(d[1]);
    }

    const createRe = /create policy\s+"([^"]+)"\s+on\s+public\.school_affiliations([\s\S]*?);/gi;
    let c;
    while ((c = createRe.exec(sql)) !== null) {
      const body = c[2];
      const hasForClause = /\bfor\s+(select|all|insert|update|delete)\b/i.test(body);
      const forSelectOrAll = /\bfor\s+(select|all)\b/i.test(body) || !hasForClause;
      const authGated = /auth\.uid\(\)/i.test(body);
      const restrictedToAuthed =
        /\bto\s+authenticated\b/i.test(body) && !/\bto\s+[^\n]*\banon\b/i.test(body);
      effective.set(c[1], {
        canSelect: forSelectOrAll,
        publicReachable: !authGated && !restrictedToAuthed,
        requiresShown: /show_on_profile\s*=\s*true/i.test(body),
        file,
      });
    }
  }

  test('the replay found the policy set (corpus is non-empty)', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(effective.has(CANONICAL)).toBe(true);
  });

  test('every anon-reachable school_affiliations read policy requires show_on_profile = true', () => {
    const offenders = [];
    for (const [name, p] of effective.entries()) {
      if (p.canSelect && p.publicReachable && !p.requiresShown) {
        offenders.push(`"${name}" (created in ${p.file})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('neither over-broad policy is present in the final effective set', () => {
    expect(effective.has(OVERBROAD_TRACKED)).toBe(false);
    expect(effective.has(OVERBROAD_ADHOC)).toBe(false);
  });
});
