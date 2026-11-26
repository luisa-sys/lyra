/**
 * KAN-490 — the one-time conversion of pre-v0.8 profile slugs into CheckLyra
 * IDs (spec v0.8 §2 01, ADR-011). Pure; no I/O.
 *
 * This is the TypeScript MIRROR of two database functions in
 * supabase/migrations/20261123130000_kan490_v08_data_migration.sql:
 *   - `lyraSlugify`        ↔ public.lyra_slugify(text)
 *   - `lyraIdFromLegacy`   ↔ public.lyra_id_from_legacy(text, uuid)
 *   - `convertLegacySlugs` ↔ the de-duplication loop in that migration's DO block
 * The database copy is the one that runs; this copy exists so the rule can be
 * unit-tested and so the dev mapping (33 profiles, verified read-only against
 * dev with the SQL logic) is pinned as a literal table in
 * tests/unit/kan490-lyra-id-convert.test.ts.
 *
 * Accents: the database uses the `unaccent` extension. Here, Unicode NFKD
 * decomposition with the combining marks removed covers every accented Latin
 * letter that decomposes (é, í, ñ, ü, å, …); the few that do not decompose are
 * mapped explicitly (ß, æ, œ, ø, ł, đ). Characters outside Latin script are
 * removed by both copies. STATED GAP: for a script `unaccent` transliterates
 * and NFKD does not, the two copies may differ; the database result is the
 * one that applies.
 */

import { LYRA_ID_RE, RESERVED_LYRA_IDS } from './profile-rules';

/** Letters that do not decompose under NFKD but that `unaccent` folds. */
const NON_DECOMPOSING: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, 'ss'],
  [/[æÆ]/g, 'ae'],
  [/[œŒ]/g, 'oe'],
  [/[øØ]/g, 'o'],
  [/[łŁ]/g, 'l'],
  [/[đĐ]/g, 'd'],
];

/**
 * Lower-case, accents removed, apostrophes dropped, every other run of
 * characters outside [a-z0-9] becomes one underscore, underscores trimmed.
 */
export function lyraSlugify(input: string | null | undefined): string {
  let s = String(input ?? '');
  // Apostrophes go BEFORE normalising: NFKD turns ´ (U+00B4) into a space +
  // combining mark, which would become "_" here while the SQL drops it.
  s = s.replace(/['‘’`´]/g, '');
  for (const [re, to] of NON_DECOMPOSING) s = s.replace(re, to);
  s = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '_');
  return s.replace(/^_+|_+$/g, '');
}

/** First 8 hex digits of a uuid (the fallback suffix). */
function idFallback(profileId: string): string {
  return profileId.replace(/-/g, '').slice(0, 8);
}

function trimTrailingUnderscores(s: string): string {
  return s.replace(/_+$/, '');
}

/**
 * The v0.8 ID for one legacy slug, before de-duplication:
 *   - over 30 characters: shorten the name part to 21 so that
 *     name + "_" + 8-hex suffix = 30 (no suffix: cut to 30);
 *   - under 3: append "_" + the first 8 hex of the profile id
 *     ("user_" + 8 hex if nothing is left);
 *   - reserved: append "_" + the first 8 hex of the profile id.
 */
export function lyraIdFromLegacy(slug: string, profileId: string): string {
  let base = lyraSlugify(slug);
  if (base.length > 30) {
    const m = /^(.*)_([0-9a-f]{8})$/.exec(base);
    if (m) {
      const name = trimTrailingUnderscores(m[1].slice(0, 21));
      base = name === '' ? m[2] : `${name}_${m[2]}`;
    } else {
      base = trimTrailingUnderscores(base.slice(0, 30));
    }
  }
  if (base.length < 3) {
    base = `${base === '' ? 'user' : base}_${idFallback(profileId)}`;
  } else if (RESERVED_LYRA_IDS.has(base)) {
    base = `${base}_${idFallback(profileId)}`;
  }
  return base;
}

/** True when a slug already meets the v0.8 ID format (and needs no conversion). */
export function isConvertedFormat(slug: string): boolean {
  return LYRA_ID_RE.test(slug);
}

export interface LegacyProfileSlug {
  id: string;
  slug: string;
}

/**
 * Converts every profile whose slug fails the format, oldest first (the input
 * order), de-duplicating against every OTHER profile's current ID
 * (case-insensitive) and every other profile's old slug in `history`
 * (lower-cased keys → profile id). A clash gets "_2", "_3", … with the name
 * shortened so the result stays within 30. Returns old slug → new ID for the
 * converted profiles only.
 */
export function convertLegacySlugs(
  profiles: ReadonlyArray<LegacyProfileSlug>,
  history: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const current = new Map(profiles.map((p) => [p.id, p.slug]));
  // The migration writes each old slug to the history as it converts, so a
  // later profile can never be given an earlier profile's old slug.
  const retired = new Map(history);
  const out = new Map<string, string>();
  for (const p of profiles) {
    if (isConvertedFormat(p.slug)) continue;
    const candidate = lyraIdFromLegacy(p.slug, p.id);
    const taken = (id: string): boolean => {
      for (const [otherId, otherSlug] of current) {
        if (otherId !== p.id && otherSlug.toLowerCase() === id) return true;
      }
      const owner = retired.get(id);
      return owner !== undefined && owner !== p.id;
    };
    let next = candidate;
    for (let n = 2; taken(next); n++) {
      if (n > 999) throw new Error(`No free ID for profile ${p.id}`);
      const suffix = `_${n}`;
      next = trimTrailingUnderscores(candidate.slice(0, 30 - suffix.length)) + suffix;
    }
    if (!retired.has(p.slug.toLowerCase())) retired.set(p.slug.toLowerCase(), p.id);
    current.set(p.id, next);
    out.set(p.slug, next);
  }
  return out;
}
