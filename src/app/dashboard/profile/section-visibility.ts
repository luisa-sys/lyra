/**
 * KAN-221 Phase 3 — Hybrid section + item visibility (helper module).
 *
 * Sibling to `visibility.ts` (KAN-143). Lives outside the action file
 * because Next.js 16+ rejects non-async-function exports from
 * `'use server'` files at action-invocation time — see BUGS-12.
 *
 * Semantics (full hybrid model):
 *
 *   effective(item) = item.visibility (if set)              -- explicit per-item override wins
 *                  ?? sectionVisibility[sectionOf(category)] -- section default
 *                  ?? 'public'                               -- safe fallback
 *
 * Sections that hold items map their item-categories back to a section
 * key (see ITEM_CATEGORY_TO_SECTION). Section keys are limited to the
 * set the editor UI knows how to toggle (CONTROLLABLE_SECTION_KEYS) —
 * the server action rejects writes to other keys, and the read-side
 * coercer drops unknown keys.
 *
 * This module is import-only — no Supabase calls, no server actions.
 * Safe to import from both client and server components.
 */

import { coerceVisibility, type VisibilityLevel } from './visibility';

// ────────────── Section keys + allowlists ──────────────

/**
 * Sections whose default visibility the user can toggle from the
 * editor. Matches the SECTIONS array in `edit-profile-form.tsx`,
 * restricted to the sections that contain items.
 *
 * Non-item sections (basic-info, affiliations, bio, manual-of-me,
 * links, files, starters) are NOT in this list — their default is
 * always "show when populated". A follow-up ticket can extend the
 * model if section-level hide for free-text sections is wanted.
 */
export const CONTROLLABLE_SECTION_KEYS = [
  'likes',
  'gifts',
  'boundaries',
  'books-media',
  'causes-quotes',
  'more',
] as const;

export type ControllableSectionKey = (typeof CONTROLLABLE_SECTION_KEYS)[number];

export function isControllableSectionKey(v: string): v is ControllableSectionKey {
  return (CONTROLLABLE_SECTION_KEYS as readonly string[]).includes(v);
}

/**
 * Item-category → section-key. Several item categories may live under
 * the same section (e.g. `gift_ideas` + `gifts_to_avoid` both live under
 * `gifts`). Categories not in this map don't have a section default —
 * their items fall through to the 'public' fallback.
 *
 * Must be kept in sync with the SECTIONS array in `edit-profile-form.tsx`.
 */
export const ITEM_CATEGORY_TO_SECTION: Record<string, ControllableSectionKey> = {
  likes: 'likes',
  dislikes: 'likes',
  gift_ideas: 'gifts',
  gifts_to_avoid: 'gifts',
  boundaries: 'boundaries',
  helpful_to_know: 'boundaries',
  favourite_books: 'books-media',
  favourite_media: 'books-media',
  causes: 'causes-quotes',
  quotes: 'causes-quotes',
  proud_of: 'more',
  life_hacks: 'more',
  questions: 'more',
  billboard: 'more',
  current_problems: 'more',
};

export type SectionVisibility = Partial<Record<ControllableSectionKey, VisibilityLevel>>;

// ────────────── Coercion + parsing ──────────────

/**
 * Parse an unknown value (e.g. a JSONB column read) into a clean
 * SectionVisibility map. Drops keys not in CONTROLLABLE_SECTION_KEYS
 * and values not in the visibility-level allowlist. Defence in depth
 * against (a) historical data with old keys, (b) any DB-side writes
 * that bypassed our server action, (c) garbage in the column.
 */
export function coerceSectionVisibility(input: unknown): SectionVisibility {
  if (!input || typeof input !== 'object') return {};
  const out: SectionVisibility = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isControllableSectionKey(k)) continue;
    if (typeof v !== 'string') continue;
    // Only accept the three real values — don't auto-coerce unknown
    // strings to 'public' here because that would silently change
    // user intent. Skip them instead.
    if (v === 'public' || v === 'members_only' || v === 'draft') {
      out[k] = v;
    }
  }
  return out;
}

// ────────────── Effective visibility lookup ──────────────

/**
 * Compute the effective visibility for a single item, applying the
 * hybrid model: explicit per-item value wins; otherwise inherit from
 * the section default; otherwise 'public'.
 *
 * Unknown per-item values (anything outside the visibility-level
 * allowlist OR the legacy 'private' value) fail closed to 'draft'
 * via `coerceVisibility`. That matches the conservative behaviour of
 * KAN-143's `isItemVisibleToViewer` ('private' / unknown → hidden).
 *
 * @param itemVisibility  raw value from the `profile_items.visibility`
 *                        column. `null` / `''` / `undefined` mean
 *                        "inherit from section".
 * @param itemCategory    `profile_items.category` — used to look up the
 *                        section that owns this item.
 * @param sectionVisibility  the parsed JSONB from
 *                        `profiles.section_visibility`.
 */
export function getEffectiveItemVisibility(
  itemVisibility: string | null | undefined,
  itemCategory: string,
  sectionVisibility: SectionVisibility,
): VisibilityLevel {
  if (itemVisibility != null && itemVisibility !== '') {
    return coerceVisibility(itemVisibility);
  }
  const sectionKey = ITEM_CATEGORY_TO_SECTION[itemCategory];
  if (sectionKey && sectionVisibility[sectionKey]) {
    return sectionVisibility[sectionKey] as VisibilityLevel;
  }
  return 'public';
}

/**
 * Convenience: should this item be visible to the given viewer under
 * the hybrid model? Combines `getEffectiveItemVisibility` with
 * KAN-143's authenticated/anonymous distinction.
 */
export function isItemVisibleUnderHybridModel(
  item: { visibility?: string | null; category: string },
  sectionVisibility: SectionVisibility,
  isAuthenticated: boolean,
): boolean {
  const effective = getEffectiveItemVisibility(item.visibility, item.category, sectionVisibility);
  if (effective === 'public') return true;
  if (effective === 'members_only') return isAuthenticated;
  return false;
}
