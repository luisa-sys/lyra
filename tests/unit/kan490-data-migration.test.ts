/**
 * KAN-490 — the v0.8 data migration
 * (supabase/migrations/20261123130000_kan490_v08_data_migration.sql):
 * slug conversion + history + anti-hijack guard, external links copied into
 * gift ideas, legacy categories archived then mapped, post-checks.
 *
 * Static checks on the SQL file, because migrations are applied via the
 * Supabase MCP after review rather than executed by CI (same approach as the
 * KAN-484..489 suites; the behavioural run is the lead's dev dry run, whose
 * probes are listed in the migration header). SQL comments are stripped before
 * every match so the header prose can never satisfy an assertion (CLAUDE.md
 * failure mode 2) — except the header checks, which by design read the raw
 * header.
 *
 * Expected values (the ID format, 21 / 30 / 8-hex, cap 25, the category
 * mapping, role lists) are LITERALS from spec v0.8, the founder decisions of
 * 2026-11-23 and SEC-103 — never read back from the migration (failure mode 10).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { memberFacingDbError } from '@/modules/profile/db-error-copy';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const file = readdirSync(MIGRATIONS).find((f) => /^20261123130000_kan490_v08_data_migration\.sql$/.test(f));
if (!file) throw new Error('KAN-490 migration not found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
const sql = stripSqlComments(raw);
const lower = sql.toLowerCase();

function fnBlock(name: string): string {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`function ${name} has no closing $$;`);
  return sql.slice(start, end + 3);
}

function fnHeader(block: string): string {
  return block.slice(0, block.indexOf('$$'));
}

function tableBlock(name: string): string {
  const m = sql.match(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  if (!m) throw new Error(`table ${name} not found`);
  return m[1];
}

function doBlock(): string {
  const start = sql.indexOf('do $migration$');
  const end = sql.lastIndexOf('$migration$;');
  if (start < 0 || end < 0) throw new Error('DO block not found');
  return sql.slice(start, end);
}

const slugify = fnBlock('lyra_slugify');
const fromLegacy = fnBlock('lyra_id_from_legacy');
const guard = fnBlock('enforce_lyra_id_not_retired');
const migration = doBlock();

const FUNCTIONS: ReadonlyArray<readonly [string, string]> = [
  ['lyra_slugify', 'text'],
  ['lyra_id_from_legacy', 'text, uuid'],
  ['enforce_lyra_id_not_retired', ''],
];

describe('KAN-490 migration — grants (gotcha #26 / SEC-103)', () => {
  test.each(FUNCTIONS)('%s is revoked from public, anon AND authenticated and granted to service_role only', (name, args) => {
    const sig = `public\\.${name}\\(\\s*${args.replace(/, /g, '\\s*,\\s*')}\\s*\\)`;
    const revoke = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${sig}\\s+from\\s+([^;]+);`, 'i').exec(sql);
    expect(revoke).not.toBeNull();
    expect(new Set(revoke![1].split(',').map((r) => r.trim().toLowerCase()))).toEqual(
      new Set(['public', 'anon', 'authenticated']),
    );
    const grants = [...sql.matchAll(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${sig}\\s+to\\s+([^;]+);`, 'gi'))];
    expect(grants).toHaveLength(1);
    expect(grants[0][1].trim().toLowerCase()).toBe('service_role');
  });

  test('every function pins search_path to the empty string', () => {
    for (const block of [slugify, fromLegacy, guard]) {
      expect(fnHeader(block)).toMatch(/set\s+search_path\s+to\s+''/i);
    }
  });

  test('only the guard is SECURITY DEFINER; the two helpers are invoker', () => {
    expect(fnHeader(guard)).toMatch(/\bsecurity\s+definer\b/i);
    expect(fnHeader(slugify)).not.toMatch(/security\s+definer/i);
    expect(fnHeader(fromLegacy)).not.toMatch(/security\s+definer/i);
  });

  test('both new tables: RLS on, all revoked from public/anon/authenticated, no policies', () => {
    for (const t of ['profile_slug_history', 'profile_items_legacy_archive']) {
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      const revoke = new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${t}\\s+from\\s+([^;]+);`, 'i').exec(sql);
      expect(revoke).not.toBeNull();
      expect(new Set(revoke![1].split(',').map((r) => r.trim().toLowerCase()))).toEqual(
        new Set(['public', 'anon', 'authenticated']),
      );
    }
    expect(lower).not.toMatch(/create\s+policy/);
    expect(lower).not.toMatch(/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated)\b/);
  });
});

describe('KAN-490 migration — slug helpers', () => {
  test('unaccent is installed into the extensions schema and used with an explicit dictionary', () => {
    expect(sql).toMatch(/create\s+extension\s+if\s+not\s+exists\s+unaccent\s+with\s+schema\s+extensions\s*;/i);
    expect(slugify).toContain("extensions.unaccent('extensions.unaccent'::regdictionary,");
    expect(fnHeader(slugify)).toMatch(/\bimmutable\b/i);
  });

  test('lyra_slugify: lower-case, apostrophes dropped, other runs -> one underscore, trimmed', () => {
    expect(slugify).toMatch(/lower\(\s*extensions\.unaccent\(/);
    expect(slugify).toContain("'[''‘’`´]', '', 'g'");
    expect(slugify).toContain("'[^a-z0-9]+', '_', 'g'");
    expect(slugify).toMatch(/btrim\([\s\S]*'_'\);\s*\$\$;$/);
  });

  test('lyra_id_from_legacy: 8-hex suffix, name cut to 21, 30 without suffix, under-3 and reserved fallbacks', () => {
    expect(fromLegacy).toContain("regexp_match(v_base, '^(.*)_([0-9a-f]{8})$')");
    expect(fromLegacy).toContain("rtrim(left(v_match[1], 21), '_')");
    expect(fromLegacy).toContain("rtrim(left(v_base, 30), '_')");
    expect(fromLegacy).toMatch(/if\s+length\(v_base\)\s*>\s*30\s+then/);
    expect(fromLegacy).toMatch(/if\s+length\(v_base\)\s*<\s*3\s+then/);
    expect(fromLegacy).toContain("case when v_base = '' then 'user' else v_base end || '_' || v_fallback");
    expect(fromLegacy).toMatch(/elsif\s+public\.is_reserved_lyra_id\(v_base\)\s+then\s+v_base\s*:=\s*v_base\s*\|\|\s*'_'\s*\|\|\s*v_fallback/);
    expect(fromLegacy).toContain("substr(replace(p_profile_id::text, '-', ''), 1, 8)");
  });
});

describe('KAN-490 migration — slug history + guard', () => {
  test('profile_slug_history: old_slug, generated lower-case key (unique), profile fk cascade, created_at', () => {
    const cols = tableBlock('profile_slug_history');
    expect(cols).toMatch(/\bold_slug\s+text\s+not\s+null\b/i);
    expect(cols).toMatch(/\bold_slug_key\s+text\s+generated\s+always\s+as\s+\(lower\(old_slug\)\)\s+stored/i);
    expect(cols).toMatch(/\bprofile_id\s+uuid\s+not\s+null\s+references\s+public\.profiles\(id\)\s+on\s+delete\s+cascade/i);
    expect(cols).toMatch(/\bcreated_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
    expect(cols).toMatch(/unique\s*\(\s*old_slug_key\s*\)/i);
  });

  test("the guard refuses another profile's old slug (lower-cased), on insert and on a slug change", () => {
    expect(guard).toMatch(/tg_op\s*=\s*'INSERT'\s+or\s+new\.slug\s+is\s+distinct\s+from\s+old\.slug/i);
    expect(guard).toMatch(/h\.old_slug_key\s*=\s*lower\(new\.slug\)/);
    expect(guard).toMatch(/h\.profile_id\s*<>\s*new\.id/);
    expect(guard).toContain("raise exception 'Retired CheckLyra ID'");
  });

  test('the guard raises SQLSTATE 23505 so save_profile draft mode returns the "taken" warning', () => {
    // save_profile (kan487) catches only unique_violation in draft mode.
    expect(guard).toMatch(/raise\s+exception\s+'Retired CheckLyra ID'\s+using\s+errcode\s*=\s*'23505'\s*;/);
  });

  test('the guard trigger is BEFORE INSERT OR UPDATE on profiles and sorts after profiles_v08_identity', () => {
    const m = sql.match(/create\s+trigger\s+(\w+)\s+before\s+insert\s+or\s+update\s+on\s+public\.profiles\s+for\s+each\s+row\s+execute\s+function\s+public\.enforce_lyra_id_not_retired\(\)/i);
    expect(m).not.toBeNull();
    // BEFORE triggers fire in name order; the identity trigger lower-cases first.
    expect(m![1] > 'profiles_v08_identity').toBe(true);
  });

  test('the guard error reads as "already taken" to a member', () => {
    expect(memberFacingDbError({ message: 'Retired CheckLyra ID' })).toBe('That CheckLyra ID is already taken.');
  });
});

describe('KAN-490 migration — the conversion', () => {
  test('converts exactly the slugs that fail the v0.8 format, oldest first', () => {
    expect(migration).toMatch(/where\s+p\.slug\s+!~\s+'\^\[a-z0-9_\]\{3,30\}\$'\s+order\s+by\s+p\.created_at,\s*p\.id/);
  });

  test('de-duplicates against other profiles (case-insensitive) and other profiles\' old slugs', () => {
    expect(migration).toMatch(/p\.id\s*<>\s*r\.id\s+and\s+lower\(p\.slug\)\s*=\s*v_try/);
    expect(migration).toMatch(/h\.profile_id\s*<>\s*r\.id\s+and\s+h\.old_slug_key\s*=\s*v_try/);
    expect(migration).toContain("rtrim(left(v_candidate, 30 - 1 - length(v_n::text)), '_') || '_' || v_n");
  });

  test('writes the history row BEFORE changing the slug', () => {
    const ins = migration.search(/insert\s+into\s+public\.profile_slug_history/);
    const upd = migration.search(/update\s+public\.profiles\s+set\s+slug\s*=\s*v_try/);
    expect(ins).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(ins);
  });

  test('published profiles are confirmed; drafts keep their flag', () => {
    expect(migration).toMatch(/slug_confirmed\s*=\s*slug_confirmed\s+or\s+is_published/);
    // Was: not.toMatch(/slug_confirmed\s*=\s*true\s+where\s+(?!is_published)/) — the
    // review-M1 fix widens the confirm-only update to once-published profiles,
    // so the guard now pins the exact allowed WHERE instead.
    const confirms = [...migration.matchAll(/set\s+slug_confirmed\s*=\s*true\s+where\s+([^;)]*\)?[^;]*?)\s+returning/g)];
    expect(confirms).toHaveLength(1);
    expect(confirms[0][1]).toMatch(/^\(is_published\s+or\s+first_published_at\s+is\s+not\s+null\)\s+and\s+not\s+slug_confirmed\s+and\s+slug\s+~\s+'\^\[a-z0-9_\]\{3,30\}\$'$/);
  });

  // Review M1: a profile published once and later unpublished (admin action or
  // the member, after KAN-485) has first_published_at set, so save_profile
  // refuses any ID change and the identity trigger locks the converted ID. If
  // the conversion left slug_confirmed = false it could never publish again.
  test('M1: a once-published draft (first_published_at set) is confirmed by the conversion', () => {
    expect(migration).toMatch(
      /set\s+slug\s*=\s*v_try,\s*slug_confirmed\s*=\s*slug_confirmed\s+or\s+is_published\s+or\s+first_published_at\s+is\s+not\s+null\s+where\s+id\s*=\s*r\.id/,
    );
  });

  test('M1: post-check raises if any once-published profile is still unconfirmed', () => {
    expect(migration).toMatch(
      /where\s+first_published_at\s+is\s+not\s+null\s+and\s+not\s+slug_confirmed;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/,
    );
  });

  test('M1: the dry-run header probes once-published unconfirmed profiles (P0 and P3)', () => {
    const header = raw.slice(0, raw.indexOf('lock table'));
    const probes = header.match(/first_published_at is not null\s+(?:--\s+)?and not slug_confirmed/g) ?? [];
    expect(probes.length).toBeGreaterThanOrEqual(2);
  });

  test('confirmed-without-conversion ids are printed for the rollback', () => {
    expect(migration).toMatch(/string_agg\(id::text[^)]*\)\s+into\s+v_confirmed,\s*v_confirmed_ids/);
    expect(migration).toMatch(/raise\s+notice\s+'KAN-490: confirmed without conversion: %'/);
  });

  test('nobody is unpublished (no write to is_published)', () => {
    expect(lower).not.toMatch(/is_published\s*=\s*(false|true)\s*[,\n]/);
    expect(lower).not.toMatch(/set\s+is_published/);
  });
});

describe('KAN-490 migration — external links -> gift ideas', () => {
  const linkInsert = (() => {
    const start = migration.search(/insert\s+into\s+public\.profile_items\s*\(/);
    return migration.slice(start, migration.indexOf('get diagnostics v_links', start));
  })();

  test('inserts member gift rows only (origin user, approved), never AI rows', () => {
    expect(linkInsert).toMatch(/'gift_ideas'::public\.item_category/);
    expect(linkInsert).toMatch(/s\.max_sort\s*\+\s*s\.rn,\s*'user',\s*true/);
    expect(lower).not.toMatch(/'ai'/);
  });

  test('within the 25 cap and the gift limits (title 100, description 250, http(s) link <= 2048)', () => {
    expect(linkInsert).toMatch(/s\.existing\s*\+\s*s\.rn\s*<=\s*25/);
    expect(linkInsert).toMatch(/length\(btrim\(e\.title\)\)\s*<=\s*100/);
    expect(linkInsert).toMatch(/length\(e\.description\)\s*<=\s*250/);
    expect(linkInsert).toMatch(/length\(e\.url\)\s*<=\s*2048/);
    expect(linkInsert).toContain("e.url ~* '^https?://'");
  });

  test('a link held twice in external_links is copied once (distinct on profile + title + url)', () => {
    expect(linkInsert).toMatch(/select\s+distinct\s+on\s*\(\s*e\.profile_id,\s*btrim\(e\.title\),\s*e\.url\s*\)/);
  });

  test('idempotent: a link already present as the same gift is not copied again', () => {
    expect(linkInsert).toMatch(/not\s+exists\s*\([\s\S]*g\.title\s*=\s*btrim\(e\.title\)[\s\S]*g\.url\s+is\s+not\s+distinct\s+from\s+e\.url/);
  });
});

describe('KAN-490 migration — legacy categories', () => {
  test('the mapping (public items only)', () => {
    expect(migration).toMatch(/when\s+i\.visibility::text\s*<>\s*'public'\s+then\s+null/);
    expect(migration).toContain("when i.category::text in ('dislikes', 'allergies', 'dietary') then 'gifts_to_avoid'");
    expect(migration).toContain("when i.category::text = 'likes'                            then 'gift_ideas'");
    expect(migration).toContain("when i.category::text = 'questions'                        then 'current_problems'");
    expect(migration).toContain("when i.category::text = 'billboard'                        then 'billboard'");
    expect(migration).toContain("when i.category::text = 'helpful_to_know'                  then 'good_to_know'");
    expect(migration).toContain("when i.category::text = 'boundaries'                       then 'boundaries'");
  });

  test('legacy = no v0.8 rule, and not already archived (idempotent)', () => {
    expect(migration).toMatch(/where\s+not\s+exists\s*\(select\s+1\s+from\s+public\.profile_item_rule\(i\.category::text,\s*i\.origin\)\)\s+and\s+not\s+exists\s*\(select\s+1\s+from\s+public\.profile_items_legacy_archive\s+a\s+where\s+a\.id\s*=\s*i\.id\)/);
  });

  test('billboard only into an empty billboard and <= 200; manual of me only if total <= 500', () => {
    expect(migration).toMatch(/b\.rn\s*=\s*1\s+and\s+b\.empty_billboard\s+and\s+length\(b\.txt\)\s+between\s+1\s+and\s+200/);
    expect(migration).toMatch(/coalesce\(btrim\(p\.billboard\),\s*''\)\s*=\s*''/);
    expect(migration).toMatch(/length\(m\.combined\)\s*<=\s*500/);
  });

  test('moves respect the target cap and limits', () => {
    expect(migration).toMatch(/q\.fits\s+and\s+q\.existing\s*\+\s*q\.rn\s*<=\s*q\.cap/);
    expect(migration).toMatch(/length\(l2\.title\)\s*<=\s*rule\.title_max/);
    expect(migration).toMatch(/length\(l2\.description\)\s*<=\s*rule\.description_max/);
  });

  test('archive copy is written BEFORE anything is moved or merged', () => {
    const archive = migration.search(/insert\s+into\s+public\.profile_items_legacy_archive/);
    const move = migration.search(/update\s+public\.profile_items\s+i\s+set\s+category/);
    const billboard = migration.search(/update\s+public\.profiles\s+p\s+set\s+billboard/);
    const mom = migration.search(/insert\s+into\s+public\.profile_manual_of_me/);
    expect(archive).toBeGreaterThan(-1);
    for (const later of [move, billboard, mom]) expect(later).toBeGreaterThan(archive);
  });

  test('the archive keeps the full row and the action, cascades with the profile', () => {
    const cols = tableBlock('profile_items_legacy_archive');
    for (const c of ['id', 'profile_id', 'category', 'title', 'description', 'url', 'visibility', 'sort_order', 'group_label', 'origin', 'approved', 'item_created_at', 'kan490_action']) {
      expect(cols).toMatch(new RegExp(`^\\s*${c}\\s`, 'm'));
    }
    expect(cols).toMatch(/profile_id\s+uuid\s+not\s+null\s+references\s+public\.profiles\(id\)\s+on\s+delete\s+cascade/i);
  });
});

describe('KAN-490 migration — no deletions, post-checks, locking', () => {
  test('deletes nothing and drops no real table', () => {
    expect(lower).not.toMatch(/\bdelete\s+from\b/);
    expect(lower).not.toMatch(/\btruncate\b/);
    expect(lower).not.toMatch(/drop\s+column/);
    const drops = [...lower.matchAll(/drop\s+table\s+if\s+exists\s+([\w.]+)/g)].map((m) => m[1]);
    expect(drops).toEqual(['pg_temp.kan490_legacy']);
    expect(lower).not.toMatch(/drop\s+table\s+(?!if\s+exists\s+pg_temp\.)/);
  });

  test('post-checks raise on: invalid IDs, published unconfirmed, history count, hijack, archive', () => {
    expect(migration).toMatch(/where\s+slug\s+!~\s+'\^\[a-z0-9_\]\{3,30\}\$';\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/where\s+is_published\s+and\s+not\s+slug_confirmed;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/if\s+v_history\s*<>\s*v_converted\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/lower\(p\.slug\)\s*=\s*h\.old_slug_key\s+and\s+p\.id\s*<>\s*h\.profile_id;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/if\s+v_archived\s*<>\s*v_legacy\s+then\s+raise\s+exception/);
  });

  test('locks every table it writes or reads limits from for the duration', () => {
    for (const t of ['profiles', 'profile_items', 'profile_manual_of_me', 'external_links']) {
      expect(sql).toMatch(new RegExp(`lock\\s+table\\s+public\\.${t}\\s+in\\s+share\\s+row\\s+exclusive\\s+mode;`, 'i'));
    }
  });

  test('post-checks raise on the caps it writes into: 25 member gifts, manual of me 500, billboard 200, links copied', () => {
    expect(migration).toMatch(/having\s+count\(\*\)\s*>\s*25\)\s*x;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/length\(good_to_know\)\s*>\s*500\s+or\s+length\(boundaries\)\s*>\s*500;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/where\s+length\(billboard\)\s*>\s*200;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception/);
    expect(migration).toMatch(/<\s*25;\s*if\s+v_bad\s*>\s*0\s+then\s+raise\s+exception\s+'KAN-490 post-check: % eligible external links/);
  });

  test('stops with a clear error if unaccent already lives outside the extensions schema', () => {
    const create = sql.search(/create\s+extension\s+if\s+not\s+exists\s+unaccent/i);
    const check = sql.search(/from\s+pg_catalog\.pg_extension\s+where\s+extname\s*=\s*'unaccent'/i);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(create);
    expect(sql).toMatch(/v_schema\s+<>\s+'extensions'\s+then\s+raise\s+exception/);
  });

  test('the header carries the dry-run probes and the rollback (raw header, by design)', () => {
    const header = raw.slice(0, raw.indexOf('lock table'));
    expect(header).toContain('DRY RUN');
    expect(header).toContain('Rollback (manual');
    expect(header).toMatch(/disable trigger profiles_v08_identity/);
    expect(header).toMatch(/P3 invariants/);
  });
});
