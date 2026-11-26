/**
 * KAN-485 — spec v0.8 profile rules.
 *
 * Both copies of the rules — the database's (migration 20261123090000) and the
 * app's (src/modules/profile/profile-rules.ts) — are compared against the
 * SPEC's values, written out below as literals. Neither copy is the oracle for
 * the other (CLAUDE.md failure mode 10).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  itemRuleFor,
  checkLyraId,
  RESERVED_LYRA_IDS,
  PROFILE_FIELD_MAX,
  AFFILIATION_RULES,
} from '@/modules/profile/profile-rules';
import { memberFacingDbError, GENERIC_DB_ERROR } from '@/modules/profile/db-error-copy';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const migrationFile = readdirSync(MIGRATIONS).find((f) => /_kan485_profile_model_v08\.sql$/.test(f));
if (!migrationFile) throw new Error('KAN-485 migration not found');
const raw = readFileSync(join(MIGRATIONS, migrationFile), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');

// Spec v0.8 §2, transcribed: [category, cap group, cap, title max, description max]
const SPEC: ReadonlyArray<readonly [string, string, number, number, number]> = [
  ['causes', 'causes', 6, 250, 250],
  ['proud_of', 'proud_of', 6, 250, 250],
  ['gift_ideas', 'gifts_user', 25, 100, 250],
  ['gifts_to_avoid', 'not_for_me', 15, 100, 200],
  ['quotes', 'fav_quotes', 15, 500, 120],
  ['favourite_media', 'fav_screen', 15, 120, 300],
  ['plays', 'fav_screen', 15, 120, 300],
  ['favourite_tv', 'fav_screen', 15, 120, 300],
  ['favourite_books', 'fav_books', 15, 120, 300],
  ['favourite_places', 'fav_places', 15, 120, 300],
  ['favourite_venues', 'fav_places', 15, 120, 300],
  ['favourite_music', 'fav_others', 15, 120, 300],
  ['favourite_custom', 'fav_others', 15, 120, 300],
  ['life_hacks', 'tips', 15, 120, 500],
  ['current_problems', 'problems', 10, 120, 500],
];

function sqlRuleRows(): Map<string, [string, number, number, number]> {
  const rows = new Map<string, [string, number, number, number]>();
  for (const m of sql.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/g)) {
    rows.set(m[1], [m[2], Number(m[3]), Number(m[4]), Number(m[5])]);
  }
  return rows;
}

describe('KAN-485 item rules match spec v0.8', () => {
  it('the spec table is non-empty (corpus guard)', () => {
    expect(SPEC.length).toBe(15);
  });

  it.each(SPEC)('app rule for %s', (category, group, cap, titleMax, descriptionMax) => {
    expect(itemRuleFor(category)).toEqual({ capGroup: group, cap, titleMax, descriptionMax });
  });

  it('database rule table has exactly the spec rows', () => {
    const rows = sqlRuleRows();
    expect(rows.size).toBe(SPEC.length);
    for (const [category, group, cap, titleMax, descriptionMax] of SPEC) {
      expect(rows.get(category)).toEqual([group, cap, titleMax, descriptionMax]);
    }
  });

  it('AI gift suggestions: 10 retained, separate from the 25 member gifts (both copies)', () => {
    expect(itemRuleFor('gift_ideas', 'ai')).toEqual({ capGroup: 'gifts_ai', cap: 10, titleMax: 100, descriptionMax: 250 });
    expect(sql).toMatch(/select 'gifts_ai', 10, 100, 250\s+where p_category = 'gift_ideas' and p_origin = 'ai'/);
  });

  it('AI may only suggest gifts, and a member entry is always approved', () => {
    expect(itemRuleFor('life_hacks', 'ai')).toBeNull();
    expect(sql).toMatch(/\(origin = 'ai' or approved\)/);
    expect(sql).toMatch(/\(origin = 'user' or category = 'gift_ideas'\)/);
  });

  it('a legacy category has no rule (left to KAN-490)', () => {
    expect(itemRuleFor('likes')).toBeNull();
    expect(itemRuleFor('__proto__')).toBeNull();
  });

  it('links must be http(s) and at most 2048 characters', () => {
    expect(sql).toMatch(/length\(new\.url\) > 2048 or new\.url !~\* '\^https\?:\/\/'/);
  });
});

describe('KAN-485 fixed field limits match spec v0.8', () => {
  it('profile fields (app copy)', () => {
    expect(PROFILE_FIELD_MAX).toEqual({
      display_name: 60, headline: 100, city: 80, country: 80, bio_short: 500,
      gift_voucher_hint: 350, billboard: 200,
    });
  });

  it.each([
    ['display_name', 60], ['headline', 100], ['city', 80], ['country', 80],
    ['bio_short', 500], ['billboard', 200], ['gift_voucher_hint', 350],
  ])('profiles.%s <= %i (database copy)', (col, max) => {
    const check = sql.match(/constraint profiles_v08_lengths check \(([\s\S]*?)\n\);/);
    expect(check).not.toBeNull();
    const limits = new Map([...check![1].matchAll(/length\(([a-z_]+)\)\s+<= (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(limits.get(col)).toBe(max);
  });

  it('affiliations: 7 per group, 120/120/250, school postcode 12 (both copies)', () => {
    expect(AFFILIATION_RULES).toEqual({ capPerType: 7, nameMax: 120, locationMax: 120, schoolPostcodeMax: 12, descriptionMax: 250 });
    expect(sql).toMatch(/v_count >= 7 then\s+raise exception 'Section limit \(7\) reached'/);
    expect(sql).toMatch(/length\(new\.school_name\) > 120/);
    expect(sql).toMatch(/length\(new\.description\) > 250/);
    expect(sql).toMatch(/length\(new\.school_location\) > 12 then/);
  });

  it('manual of me: 500 each, 1000 for the house prompt', () => {
    const check = sql.match(/constraint manual_of_me_v08_lengths check \(([\s\S]*?)\n\);/);
    expect(check).not.toBeNull();
    const limits = Object.fromEntries([...check![1].matchAll(/length\(([a-z_]+)\)\s+<= (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(limits).toEqual({
      good_to_know: 500, boundaries: 500, communication_style: 500,
      working_preferences: 1000, energises_me: 500, drains_me: 500,
    });
  });
});

describe('KAN-485 CheckLyra ID', () => {
  it.each([
    ['Grace_Bennett', 'grace_bennett'],
    ['  abc ', 'abc'],
    ['a'.repeat(30), 'a'.repeat(30)],
    ['user_123', 'user_123'],
  ])('accepts %p as %p', (input, id) => {
    expect(checkLyraId(input)).toEqual({ ok: true, id });
  });

  it.each(['ab', 'a'.repeat(31), 'grace-bennett', 'rosa martínez', "o'connor", 'émile', '', null])(
    'rejects %p',
    (input) => {
      expect(checkLyraId(input).ok).toBe(false);
    },
  );

  it.each(['admin', 'Dashboard', 'privacy', 'login', 'lyra'])('rejects reserved %p', (input) => {
    expect(checkLyraId(input)).toEqual({ ok: false, error: 'That ID is reserved. Please choose another.' });
  });

  it('every single-word top-level route is reserved, in BOTH copies', () => {
    const app = resolve(ROOT, SRC.srcApp);
    const names: string[] = [];
    for (const entry of readdirSync(app)) {
      const full = join(app, entry);
      if (!statSync(full).isDirectory()) continue;
      if (/^\(.*\)$/.test(entry)) {
        // route group: its children are top-level URLs
        for (const child of readdirSync(full)) {
          if (statSync(join(full, child)).isDirectory()) names.push(child);
        }
      } else {
        names.push(entry);
      }
    }
    // `_name` folders are Next.js private folders — never routed.
    const collidable = names.filter((n) => !n.startsWith('_') && /^[a-z0-9_]{3,30}$/.test(n));
    // KAN-493 removed seven legal routes (17 remain); the floor only guards
    // against the directory scan silently finding nothing.
    expect(collidable.length).toBeGreaterThan(15);
    const sqlList = new Set([...sql.matchAll(/'([a-z0-9_-]+)'/g)].map((m) => m[1]));
    for (const name of collidable) {
      expect({ name, inApp: RESERVED_LYRA_IDS.has(name) }).toEqual({ name, inApp: true });
      expect({ name, inDb: sqlList.has(name) }).toEqual({ name, inDb: true });
    }
  });

  it('the database reserved list equals the app list exactly', () => {
    const m = sql.match(/= any \(array\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    const dbList = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(dbList).toEqual([...RESERVED_LYRA_IDS].sort());
  });

  it('the database enforces format, reserved words, immutability and lower-case', () => {
    expect(sql).toContain("new.slug := lower(new.slug);");
    expect(sql).toMatch(/new\.slug !~ '\^\[a-z0-9_\]\{3,30\}\$' then\s+raise exception 'Invalid CheckLyra ID'/);
    expect(sql).toMatch(/is_reserved_lyra_id\(new\.slug\) then\s+raise exception 'Reserved CheckLyra ID'/);
    expect(sql).toMatch(/old\.first_published_at is not null[\s\S]{0,80}raise exception 'CheckLyra ID cannot be changed after publishing'/);
    expect(sql).toContain('create unique index if not exists profiles_slug_lower_key on public.profiles (lower(slug));');
  });

  it('a new account gets an unconfirmed placeholder ID that fits the format', () => {
    expect(sql).toMatch(/'user_' \|\| substr\(replace\(new\.id::text, '-', ''\), 1, 10\),\s+false/);
    expect(checkLyraId('user_0123456789').ok).toBe(true);
    expect(sql).toMatch(/left\(coalesce\([\s\S]{0,140}\), 60\)/);
  });
});

describe('KAN-485 publish requirements', () => {
  it('publishing needs photo, display name and a confirmed ID', () => {
    expect(sql).toMatch(/raise exception 'Publishing needs a profile photo'/);
    expect(sql).toMatch(/raise exception 'Publishing needs a display name'/);
    expect(sql).toMatch(/not new\.slug_confirmed or new\.slug !~ [^\n]+ then\s+raise exception 'Publishing needs a CheckLyra ID'/);
  });

  it('a published profile cannot lose its photo', () => {
    expect(sql).toMatch(/new\.is_published and old\.avatar_url is not null[\s\S]{0,120}raise exception 'A published profile needs a profile photo'/);
  });
});

describe('KAN-485 privileges and RLS', () => {
  it.each([
    'is_reserved_lyra_id(text)',
    'enforce_profile_identity_rules()',
    'handle_new_user()',
    'profile_item_rule(text, text)',
    'enforce_profile_item_rules()',
    'enforce_affiliation_rules()',
  ])('revokes EXECUTE on %s from public, anon and authenticated (gotcha #26)', (fn) => {
    expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
  });

  it('only the two pure lookups are re-granted to authenticated', () => {
    const grants = [...sql.matchAll(/grant execute on function public\.([a-z_]+)\([^)]*\) to ([^;]+);/g)];
    const toAuthenticated = grants.filter((g) => /\bauthenticated\b/.test(g[2])).map((g) => g[1]).sort();
    expect(toAuthenticated).toEqual(['is_reserved_lyra_id', 'profile_item_rule']);
  });

  it('both public read policies on profile_items require approved', () => {
    const policies = [...sql.matchAll(/create policy "([^"]+)"\s+on public\.profile_items for select\s+using \(\s*approved\b/g)];
    expect(policies.map((p) => p[1]).sort()).toEqual([
      'Anyone can read public items from published profiles',
      'Members can read members_only items from published profiles',
    ]);
  });
});

describe('KAN-485 every new database message has member-facing copy', () => {
  const messages = [...raw.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1].replace(/%/g, '6'));

  it('the migration raises at least 15 distinct messages (corpus guard)', () => {
    expect(new Set(messages).size).toBeGreaterThanOrEqual(15);
  });

  it.each([...new Set(messages)])('%s', (message) => {
    expect(memberFacingDbError({ message })).not.toBe(GENERIC_DB_ERROR);
  });
});
