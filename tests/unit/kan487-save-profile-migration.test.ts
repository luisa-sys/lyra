/**
 * KAN-487 — the v0.8 editor backend migration
 * (supabase/migrations/20261123100000_kan487_profile_editor.sql):
 * `public.save_profile(jsonb, text)` and `public.suggest_affiliation_names`.
 *
 * Static checks on the migration file, because migrations are applied via the
 * Supabase MCP after review rather than executed by CI (same approach as the
 * KAN-484 / KAN-485 / SEC-112 suites). SQL comments are stripped before every
 * match, so the prose explaining a rule can never satisfy the assertion for it
 * (CLAUDE.md failure mode 2) — except the rollback check, which by design
 * reads the raw header comment.
 *
 * Expected values (role lists, copy, allowlisted columns, the mode names) are
 * LITERALS from the KAN-487 brief / plan §B and the SEC-103 rule, never read
 * back from the migration (failure mode 10).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const file = readdirSync(MIGRATIONS).find((f) => /^20261123100000_kan487_profile_editor\.sql$/.test(f));
if (!file) throw new Error('KAN-487 migration not found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
const sql = stripSqlComments(raw);

/** Everything from `create or replace function public.<name>(` to its closing `$$;`. */
function fnBlock(name: string): string {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`function ${name} has no closing $$;`);
  return sql.slice(start, end + 3);
}

/** The part of a function definition before its body (`as $$`). */
function fnHeader(block: string): string {
  const i = block.indexOf('$$');
  return block.slice(0, i);
}

const save = fnBlock('save_profile');
const suggest = fnBlock('suggest_affiliation_names');

const FUNCTIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['save_profile', 'jsonb, text', save],
  ['suggest_affiliation_names', 'text, text, int', suggest],
];

const MISSING_ROWS = 'Some entries no longer exist. Reload to see your latest profile.';

describe('KAN-487 migration — function security posture', () => {
  it('declares exactly the two functions (corpus guard)', () => {
    expect(FUNCTIONS.length).toBe(2);
    expect(save.length).toBeGreaterThan(200);
    expect(suggest.length).toBeGreaterThan(50);
  });

  it('no function in this migration is SECURITY DEFINER', () => {
    expect(sql).not.toMatch(/security\s+definer/i);
  });

  it.each(FUNCTIONS)('%s is SECURITY INVOKER', (_name, _sig, block) => {
    expect(fnHeader(block)).toMatch(/\bsecurity\s+invoker\b/i);
  });

  it.each(FUNCTIONS)('%s pins search_path to public, pg_temp', (_name, _sig, block) => {
    expect(fnHeader(block)).toMatch(/\bset\s+search_path\s*=\s*public\s*,\s*pg_temp\s*\n/i);
  });

  it.each(FUNCTIONS)('%s is revoked from public, anon and authenticated (gotcha #26)', (name, sig) => {
    const re = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${sig.replace(/ /g, '\\s*')}\\)\\s+from\\s+([^;]+);`,
      'i',
    );
    const m = sql.match(re);
    expect(m).not.toBeNull();
    const roles = m![1].split(',').map((r) => r.trim().toLowerCase()).sort();
    expect(roles).toEqual(['anon', 'authenticated', 'public']);
  });

  it.each(FUNCTIONS)('%s is granted EXECUTE to authenticated only', (name, sig) => {
    const grants = [...sql.matchAll(new RegExp(`grant\\s+[^;]*?\\bon\\s+function\\s+public\\.${name}\\b[^;]*;`, 'gi'))].map(
      (m) => m[0].replace(/\s+/g, ' ').toLowerCase(),
    );
    expect(grants).toEqual([`grant execute on function public.${name}(${sig}) to authenticated;`]);
  });
});

describe('KAN-487 save_profile — body rules (plan §B)', () => {
  it('locks the caller’s own profile row FOR UPDATE by auth.uid()', () => {
    expect(save).toMatch(/where\s+p\.user_id\s*=\s*auth\.uid\(\)\s+for\s+update\s*;/i);
    expect(save).toMatch(/raise exception 'Profile not found' using errcode = '42501'/);
  });

  it('accepts exactly the three modes and checks mode against publication state', () => {
    expect(save).toMatch(/p_mode not in \('draft', 'publish', 'published'\)/);
    expect(save).toMatch(/\(p_mode = 'published'\) <> v_is_pub/);
  });

  it('rejects a stale base_updated_at with the approved copy', () => {
    expect(save).toMatch(/p_payload->>'base_updated_at'/);
    expect(save).toMatch(
      /v_base is distinct from v_updated_at then\s+raise exception 'Your profile was saved somewhere else\. Reload to see the latest version\.'/,
    );
  });

  it('never assigns is_published', () => {
    expect(sql).not.toMatch(/\bis_published\s*=/i);
    expect(sql).not.toMatch(/\bset\s+is_published\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.profiles\b/i);
  });

  it('every profile_items insert is origin user, approved, visibility public', () => {
    const inserts = [...save.matchAll(/insert\s+into\s+public\.profile_items\s*\(([^)]*)\)\s*values\s*([\s\S]*?)returning/gi)];
    expect(inserts.length).toBeGreaterThan(0);
    for (const [, cols, values] of inserts) {
      const names = cols.split(',').map((c) => c.trim());
      expect(names.slice(-3)).toEqual(['origin', 'approved', 'visibility']);
      expect(values).toMatch(/'user',\s*true,\s*'public'\)\s*$/);
    }
  });

  it('deletes run before any update or insert', () => {
    const firstDelete = save.search(/\bdelete\s+from\b/i);
    const firstInsert = save.search(/\binsert\s+into\b/i);
    const firstUpdate = save.search(/\bupdate\s+public\./i);
    expect(firstDelete).toBeGreaterThan(0);
    expect(firstDelete).toBeLessThan(firstInsert);
    expect(firstDelete).toBeLessThan(firstUpdate);
  });

  const DELETES: ReadonlyArray<readonly [string, string, string]> = [
    ['user items', 'profile_items', "origin = 'user' and "],
    ['AI gifts', 'profile_items', "origin = 'ai' and "],
    ['affiliations', 'school_affiliations', ''],
    ['questions', 'profile_conversation_starters', ''],
  ];

  it.each(DELETES)('the %s delete is owner-scoped and checks its row count', (_label, table, scope) => {
    // Compared as whitespace-collapsed literal text rather than an
    // interpolated RegExp (CodeQL js/incomplete-sanitization).
    const flat = save.replace(/\s+/g, ' ');
    const expected =
      `delete from public.${table} where profile_id = v_pid and ${scope}id = any(v_ids); ` +
      `get diagnostics v_n = row_count; ` +
      `if v_n <> cardinality(v_ids) then raise exception '${MISSING_ROWS}'`;
    expect(flat).toContain(expected);
  });

  it('an item update may not change origin or leave its cap group', () => {
    expect(save).toMatch(/if not found or v_old_origin <> 'user' then/);
    expect(save).toMatch(/if v_old_group is null or v_old_group <> v_new_group then/);
    expect(save).toMatch(/public\.profile_item_rule\(v_old_category, 'user'\)/);
  });

  it('a question update never writes prompt_id; an affiliation update never writes affiliation_type', () => {
    const updates = [...save.matchAll(/update public\.(profile_conversation_starters|school_affiliations)\s+set([\s\S]*?)\bwhere\b/g)];
    expect(updates.length).toBe(3);
    for (const [, , setClause] of updates) {
      expect(setClause).not.toMatch(/\bprompt_id\s*=/);
      expect(setClause).not.toMatch(/\baffiliation_type\s*=/);
    }
  });

  it('writes only the allowlisted profiles columns', () => {
    const ALLOWED = [
      'avatar_url',
      'billboard',
      'bio_short',
      'city',
      'country',
      'display_name',
      'gift_voucher_hint',
      'headline',
      'slug',
      'slug_confirmed',
      'updated_at',
    ];
    const updates = [...save.matchAll(/update public\.profiles\s+set([\s\S]*?)\bwhere\b/g)];
    // fields + updated_at, then the photo (own statement, review minor 5), then the slug.
    expect(updates.length).toBe(3);
    const written = new Set<string>();
    for (const [, setClause] of updates) {
      for (const m of setClause.matchAll(/(?:^|,)\s*([a-z_]+)\s*=(?!=)/gm)) written.add(m[1]);
    }
    expect([...written].sort()).toEqual(ALLOWED);
  });

  it('the CheckLyra ID is written only while unlocked, and confirms it', () => {
    expect(save).toMatch(
      /if v_first_pub is not null then\s+raise exception 'CheckLyra ID cannot be changed after publishing';/,
    );
    expect(save).toMatch(/set slug = v_prof->>'slug',\s*slug_confirmed = true/);
  });

  it('a taken ID is a warning in draft and re-raised otherwise', () => {
    expect(save).toMatch(
      /exception\s+when unique_violation then\s+if p_mode = 'draft' then\s+v_warn := v_warn \|\| jsonb_build_object\('lyra_id', 'taken'\);\s+else\s+raise;\s+end if;/,
    );
  });

  it('re-raises every error unchanged with {section, client_key} detail', () => {
    expect(save).toMatch(/exception\s+when others then/);
    expect(save).toMatch(/message\s*=\s*sqlerrm/);
    expect(save).toMatch(/errcode\s*=\s*sqlstate/);
    const details = [...save.matchAll(/\bdetail\s*=\s*([^\n]*)/g)].map((m) => m[1].trim());
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) {
      expect(d).toBe("jsonb_build_object('section', v_section, 'client_key', v_client_key)::text;");
    }
  });

  it('returns {updated_at, ids, warnings} plus the STORED identity read back from profiles (review M4)', () => {
    const m = save.match(/select jsonb_build_object\(([\s\S]*?)\)\s+into v_result\s+from public\.profiles p\s+where p\.id = v_pid;\s+return v_result;/);
    expect(m).not.toBeNull();
    const pairs = [...m![1].matchAll(/'([a-z_]+)',\s*([^,]+?(?:\([^)]*\))?)\s*(?:,|$)/g)].map((x) => [x[1], x[2].trim()]);
    expect(pairs).toEqual([
      ['updated_at', 'p.updated_at'],
      ['ids', 'v_map'],
      ['warnings', 'v_warn'],
      ['slug', 'p.slug'],
      ['slug_confirmed', 'coalesce(p.slug_confirmed, false)'],
      ['avatar_url', 'p.avatar_url'],
      ['is_published', 'coalesce(p.is_published, false)'],
      ['first_published_at', 'p.first_published_at'],
    ]);
  });

  it('Save Changes ("published") requires base_updated_at (review minor 3)', () => {
    expect(save).toMatch(
      /if p_mode = 'published' and v_base is null then\s+raise exception 'Editor is out of date\. Reload to continue\.';/,
    );
    // Still optional for draft / publish: the stale check only runs when present.
    expect(save).toMatch(/if v_base is not null and v_base is distinct from v_updated_at then/);
  });

  it('a published profile cannot be saved with a blank display_name (review M3)', () => {
    expect(save).toMatch(
      /if v_is_pub and v_prof \? 'display_name'\s+and btrim\(coalesce\(v_prof->>'display_name', ''\)\) = '' then\s+raise exception 'Add a display name';/,
    );
    // The guard runs before the profiles write.
    expect(save.search(/raise exception 'Add a display name'/)).toBeLessThan(save.search(/update public\.profiles\s+set display_name/));
  });

  it('the photo is written in its own statement under section "photo" (review minor 5)', () => {
    const photoSection = save.search(/v_section := 'photo';/);
    const photoUpdate = save.search(/update public\.profiles\s+set avatar_url = case v_action when 'remove' then null else v_photo->>'avatar_url' end\s+where id = v_pid;/);
    expect(photoSection).toBeGreaterThan(0);
    expect(photoUpdate).toBeGreaterThan(photoSection);
    // No other section label sits between them.
    expect(save.slice(photoSection + 1, photoUpdate)).not.toMatch(/v_section :=/);
    // avatar_url is not written by the profile-fields statement.
    const fields = save.match(/update public\.profiles\s+set display_name([\s\S]*?)\bwhere\b/);
    expect(fields).not.toBeNull();
    expect(fields![1]).not.toMatch(/avatar_url/);
  });

  it('AI gift approval also makes the row public (review minor 9)', () => {
    expect(save).toMatch(
      /update public\.profile_items\s+set approved = true,\s*visibility = 'public'\s+where profile_id = v_pid and origin = 'ai' and id = any\(v_ids\);/,
    );
  });
});

describe('KAN-487 suggest_affiliation_names', () => {
  it('only the three affiliation types, prefix of at least 3 characters', () => {
    expect(suggest).toMatch(/p_type in \('school', 'organisation', 'community'\)/);
    expect(suggest).toMatch(/length\(btrim\(coalesce\(p_prefix, ''\)\)\) >= 3/);
  });

  it('escapes LIKE metacharacters and clamps the limit to 1..10', () => {
    expect(suggest).toMatch(/'%', '\\%'/);
    expect(suggest).toMatch(/'_', '\\_'/);
    expect(suggest).toMatch(/escape '\\'/);
    expect(suggest).toMatch(/limit least\(greatest\(coalesce\(p_limit, 8\), 1\), 10\)/);
  });

  it('distinct case-insensitive names, by popularity then name', () => {
    expect(suggest).toMatch(/group by lower\(btrim\(a\.school_name\)\)/);
    expect(suggest).toMatch(/order by count\(distinct a\.profile_id\) desc, lower\(btrim\(a\.school_name\)\) asc/);
  });

  it('has the prefix index', () => {
    expect(sql).toMatch(
      /create index if not exists school_affiliations_type_name_prefix_idx\s+on public\.school_affiliations \(affiliation_type, lower\(btrim\(school_name\)\) text_pattern_ops\);/,
    );
  });
});

describe('KAN-487 migration header', () => {
  it('says plainly that a direct PostgREST call skips the action’s moderation (SEC-147)', () => {
    const header = raw.slice(0, raw.search(/^(?!--)\S/m));
    expect(header).toMatch(/SEC-147/);
    expect(header).toMatch(/directly via PostgREST skips/);
    expect(header).toMatch(/moderation \/ contact-detail filter/);
    expect(header).toMatch(/DB\s*--\s+triggers[\s\S]*remain the boundary for limits/);
  });

  it('carries the manual rollback SQL in the header comment', () => {
    const header = raw.slice(0, raw.search(/^(?!--)\S/m));
    expect(header).toMatch(/Rollback/);
    expect(header).toMatch(/--\s+drop function if exists public\.save_profile\(jsonb, text\);/);
    expect(header).toMatch(/--\s+drop function if exists public\.suggest_affiliation_names\(text, text, int\);/);
    expect(header).toMatch(/--\s+drop index if exists public\.school_affiliations_type_name_prefix_idx;/);
  });
});
