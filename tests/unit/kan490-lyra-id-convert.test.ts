/**
 * KAN-490 — the pre-v0.8 slug → CheckLyra ID conversion rule
 * (src/modules/profile/lyra-id-convert.ts, the TypeScript mirror of
 * public.lyra_slugify / public.lyra_id_from_legacy and the de-duplication loop
 * in supabase/migrations/20261123130000_kan490_v08_data_migration.sql).
 *
 * DEV_MAPPING is every one of the 33 dev profiles (read-only query on dev,
 * 2026-11-23), oldest first, with the ID the SQL logic produced for it in a
 * read-only SELECT on dev (inline CTE running the same steps — the helper
 * functions themselves were not created there). Profile ids are not needed:
 * no dev slug reaches the under-3 / reserved fallback.
 *
 * Every expected value is a literal written here (CLAUDE.md failure mode 10).
 */
import {
  convertLegacySlugs,
  lyraIdFromLegacy,
  lyraSlugify,
} from '@/modules/profile/lyra-id-convert';

const DEV_MAPPING: ReadonlyArray<readonly [string, string]> = [
  ['luisa-632df5a4', 'luisa_632df5a4'],
  ['ben-e3798c06', 'ben_e3798c06'],
  ['ben-stephens-d57867e7', 'ben_stephens_d57867e7'],
  ['theo-adeyemi-a0000000', 'theo_adeyemi_a0000000'],
  ['frank-adeyemi-a0000000', 'frank_adeyemi_a0000000'],
  ['rosa-martínez-a0000000', 'rosa_martinez_a0000000'],
  ['aisha-khan-a0000000', 'aisha_khan_a0000000'],
  ["michael-o'connor-a0000000", 'michael_oconnor_a0000000'],
  ['grace-bennett-a0000000', 'grace_bennett_a0000000'],
  ['maya-patel-a0000000', 'maya_patel_a0000000'],
  ['daniel-mensah-a0000000', 'daniel_mensah_a0000000'],
  ['lucy-nguyen-a0000000', 'lucy_nguyen_a0000000'],
  ['fatima-hassan-a0000000', 'fatima_hassan_a0000000'],
  ['emily-watson-a0000000', 'emily_watson_a0000000'],
  ['peggy-whitfield-a0000000', 'peggy_whitfield_a0000000'],
  ['hannah-clarke-a0000000', 'hannah_clarke_a0000000'],
  ['david-reid-a0000000', 'david_reid_a0000000'],
  ['wei-chen-a0000000', 'wei_chen_a0000000'],
  ['margaret-doyle-a0000000', 'margaret_doyle_a0000000'],
  ['sarah-okonkwo-a0000000', 'sarah_okonkwo_a0000000'],
  ['sanjay-gupta-a0000000', 'sanjay_gupta_a0000000'],
  ['olu-adebayo-a0000000', 'olu_adebayo_a0000000'],
  ['george-osei-a0000000', 'george_osei_a0000000'],
  ['tom-bryce-a0000000', 'tom_bryce_a0000000'],
  ['priya-sharma-a0000000', 'priya_sharma_a0000000'],
  ["niamh-o'sullivan-a0000000", 'niamh_osullivan_a0000000'],
  ['jack-thompson-a0000000', 'jack_thompson_a0000000'],
  ['e2e-empty-user-d7be4e56', 'e2e_empty_user_d7be4e56'],
  ['e2e-drafted-user-1edde0e4', 'e2e_drafted_user_1edde0e4'],
  ['e2e-published-activate-user-68db5eb1', 'e2e_published_activat_68db5eb1'],
  ['e2e-published-grow-user-c6739445', 'e2e_published_grow_us_c6739445'],
  ['e2e-no-convene-user-77300a62', 'e2e_no_convene_user_77300a62'],
  ['e2e-age-none-user-5b225ac8', 'e2e_age_none_user_5b225ac8'],
];

const PID = '9f8e7d6c-0000-4000-8000-000000000001';

describe('KAN-490 — the 33 dev profiles', () => {
  test('the table is the whole dev estate (33 rows, 33 distinct old and new values)', () => {
    expect(DEV_MAPPING).toHaveLength(33);
    expect(new Set(DEV_MAPPING.map(([o]) => o)).size).toBe(33);
    expect(new Set(DEV_MAPPING.map(([, n]) => n)).size).toBe(33);
  });

  test.each(DEV_MAPPING)('%s -> %s', (oldSlug, expected) => {
    expect(lyraIdFromLegacy(oldSlug, PID)).toBe(expected);
  });

  test('converting the whole estate at once gives exactly the table (no de-dup suffix on dev)', () => {
    const profiles = DEV_MAPPING.map(([slug], i) => ({ id: `p-${i}`, slug }));
    expect([...convertLegacySlugs(profiles).entries()]).toEqual(DEV_MAPPING.map(([o, n]) => [o, n]));
  });

  test('every new ID meets the v0.8 format (3–30, a-z 0-9 _)', () => {
    for (const [, n] of DEV_MAPPING) expect(n).toMatch(/^[a-z0-9_]{3,30}$/);
  });
});

describe('KAN-490 — lyraSlugify', () => {
  test.each([
    ["José-O'Brien-1a2b3c4d", 'jose_obrien_1a2b3c4d'],
    ['niamh-o’sullivan-a0000000', 'niamh_osullivan_a0000000'], // curly apostrophe
    // Review minor 3: NFKD turns U+00B4 into space + combining mark; the SQL
    // drops it, so the mirror must strip apostrophes before normalising.
    ['michael-o´connor-1a2b3c4d', 'michael_oconnor_1a2b3c4d'], // acute accent as apostrophe
    ['o`neill', 'oneill'], // backtick
    ['Zoë Ångström', 'zoe_angstrom'],
    ['Straße-ab12cd34', 'strasse_ab12cd34'],
    ['Søren Łukasz Æsir', 'soren_lukasz_aesir'],
    ['  --Mary--Jane..Smith__  ', 'mary_jane_smith'],
    ['李明', ''],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(lyraSlugify(input)).toBe(expected);
  });

  test('null / undefined slugify to the empty string', () => {
    expect(lyraSlugify(null)).toBe('');
    expect(lyraSlugify(undefined)).toBe('');
  });
});

describe('KAN-490 — lyraIdFromLegacy edge cases (same values as the SQL logic on dev, read-only)', () => {
  test.each([
    // accents + apostrophe
    ["José-O'Brien-1a2b3c4d", 'jose_obrien_1a2b3c4d'],
    // over 30 with the 8-hex suffix: name shortened to 21, suffix kept
    ['christopher-alexander-montgomery-0f1e2d3c', 'christopher_alexander_0f1e2d3c'],
    // the 21-character cut ends on an underscore: trimmed
    ['abcdefghijklmnopqrst-xyz-12345678', 'abcdefghijklmnopqrst_12345678'],
    // over 30 without a suffix: cut to 30
    ['a-very-long-name-without-any-suffix-here', 'a_very_long_name_without_any_s'],
    // under 3: profile-id fallback
    ['Jo', 'jo_9f8e7d6c'],
    // nothing left: "user_" + fallback
    ['李明', 'user_9f8e7d6c'],
    ['---', 'user_9f8e7d6c'],
    // reserved
    ['Admin', 'admin_9f8e7d6c'],
    ['SEARCH', 'search_9f8e7d6c'],
    // reserved word + more is not reserved
    ['search-ab', 'search_ab'],
    // upper-case only
    ['Luisa_1', 'luisa_1'],
    ['x-12345678', 'x_12345678'],
  ])('%j -> %j', (slug, expected) => {
    expect(lyraIdFromLegacy(slug, PID)).toBe(expected);
  });
});

describe('KAN-490 — convertLegacySlugs (de-duplication)', () => {
  test('a clash between two legacy slugs: the older keeps the ID, the newer gets _2', () => {
    const out = convertLegacySlugs([
      { id: 'a', slug: 'maya-patel' },
      { id: 'b', slug: 'Maya Patel' },
    ]);
    expect([...out.entries()]).toEqual([
      ['maya-patel', 'maya_patel'],
      ['Maya Patel', 'maya_patel_2'],
    ]);
  });

  test('a profile whose old slug only differs by case keeps that ID, even if it is newer', () => {
    // MAYA_PATEL already IS maya_patel without regard to case (the unique
    // index is on lower(slug)), so the older profiles step round it.
    const out = convertLegacySlugs([
      { id: 'a', slug: 'maya-patel' },
      { id: 'b', slug: 'Maya Patel' },
      { id: 'c', slug: 'MAYA_PATEL' },
    ]);
    expect([...out.entries()]).toEqual([
      ['maya-patel', 'maya_patel_2'],
      ['Maya Patel', 'maya_patel_3'],
      ['MAYA_PATEL', 'maya_patel'],
    ]);
  });

  test('an existing valid ID is never taken and is not itself converted', () => {
    const out = convertLegacySlugs([
      { id: 'a', slug: 'sam_lee' },
      { id: 'b', slug: 'sam-lee' },
    ]);
    expect([...out.entries()]).toEqual([['sam-lee', 'sam_lee_2']]);
  });

  test('a 30-character candidate is shortened so the de-dup suffix still fits', () => {
    const out = convertLegacySlugs([
      { id: 'a', slug: 'e2e_published_activat_68db5eb1' },
      { id: 'b', slug: 'e2e-published-activate-user-68db5eb1' },
    ]);
    expect([...out.entries()]).toEqual([
      ['e2e-published-activate-user-68db5eb1', 'e2e_published_activat_68db5e_2'],
    ]);
  });

  test("another profile's old slug in the history is never handed out", () => {
    const out = convertLegacySlugs([{ id: 'b', slug: 'bob-smith' }], new Map([['bob_smith', 'a']]));
    expect([...out.entries()]).toEqual([['bob-smith', 'bob_smith_2']]);
  });

  test("a profile may take its own old slug's lower-case form", () => {
    const out = convertLegacySlugs([{ id: 'a', slug: 'Luisa_1' }], new Map([['luisa_1', 'a']]));
    expect([...out.entries()]).toEqual([['Luisa_1', 'luisa_1']]);
  });

  test('reserved and under-3 slugs use the profile id fallback', () => {
    const out = convertLegacySlugs([
      { id: '12345678-aaaa-4bbb-8ccc-000000000000', slug: 'Help' },
      { id: 'abcdef01-aaaa-4bbb-8ccc-000000000000', slug: 'X' },
    ]);
    expect([...out.entries()]).toEqual([
      ['Help', 'help_12345678'],
      ['X', 'x_abcdef01'],
    ]);
  });
});
