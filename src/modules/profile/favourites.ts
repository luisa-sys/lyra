/**
 * KAN-444 / KAN-487 (spec v0.8 §06) — "A few of my favourite things": five
 * fixed groups in a fixed order.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The favourites grouping is rendered on more than one surface — the editor
 * and the public profile (`src/app/[slug]/page.tsx`). Before KAN-444 each
 * surface carried its own literal list of categories, so the two could drift
 * silently and a member would see one set of groups while editing and a
 * different set once published. Both surfaces derive their groups from the
 * single `FAVOURITE_GROUPS` table below, which makes that drift impossible
 * rather than merely detectable.
 *
 * Import-only: no Supabase calls, no server actions, safe from both client
 * and server components (same rule as `section-visibility.ts`, and the
 * reason it is not declared in the `'use server'` action file — BUGS-12).
 *
 * MAPPING ONTO THE EXISTING ENUM (spec v0.8 §06)
 * ----------------------------------------------
 * The five fixed groups are a pure regrouping of `item_category` values that
 * already exist, so they need no migration. The FIRST category of each group
 * is the one new entries are written under:
 *
 *   Quotes                  quotes
 *   Movies / Theatre / TV   favourite_media + plays + favourite_tv
 *   Books                   favourite_books
 *   Places                  favourite_places + favourite_venues
 *   Others                  favourite_custom + favourite_music
 *
 * This matches the favourites cap groups in `profile-rules.ts` (`fav_quotes`,
 * `fav_screen`, `fav_books`, `fav_places`, `fav_others`): a category's
 * display group and its cap group are the same thing.
 *
 * The merges are read-compatible: existing `plays`, `favourite_tv`,
 * `favourite_venues` and `favourite_music` rows keep rendering (under their
 * v0.8 heading), while new entries are written under the group's primary
 * category. No backfill, no data migration.
 *
 * LEGACY MEMBER-NAMED GROUPS
 * --------------------------
 * Before v0.8 a member could name their own group ("Board games"), stored as
 * `favourite_custom` + `group_label`. v0.8 has no named groups: every
 * `favourite_custom` row renders under Others whatever its `group_label`.
 * The label is kept in the DB and may be shown as a muted tag in the editor
 * (`legacyGroupLabel`), but it never creates a heading of its own.
 *
 * `causes` is deliberately ABSENT. It is its own field in About Me —
 * "Causes close to my heart" (KAN-458, spec §01) — and must never reappear
 * as a favourites group, or a member's causes would be listed twice.
 */

export interface FavouriteGroupDef {
  /** Stable key — used as a React key and in tests; never shown to members. */
  key: string;
  /** The heading a member sees, in the editor and on the public profile. */
  label: string;
  /**
   * Every `profile_items.category` that renders under this group. The FIRST
   * entry is the group's primary category — the one new items are written
   * under. The rest are historical categories that still render here.
   */
  categories: string[];
}

/** Spec v0.8 §06: "Categories in fixed order". */
export const FAVOURITE_GROUPS: readonly FavouriteGroupDef[] = [
  { key: 'quotes', label: 'Quotes', categories: ['quotes'] },
  { key: 'screen', label: 'Movies / Theatre / TV', categories: ['favourite_media', 'plays', 'favourite_tv'] },
  { key: 'books', label: 'Books', categories: ['favourite_books'] },
  { key: 'places', label: 'Places', categories: ['favourite_places', 'favourite_venues'] },
  { key: 'others', label: 'Others', categories: ['favourite_custom', 'favourite_music'] },
];

/**
 * The Others group's primary category. Kept as a named export because the
 * legacy editor and the KAN-444 persistence path still refer to it; it is
 * now simply where new "Others" entries are written.
 */
export const CUSTOM_FAVOURITE_CATEGORY = 'favourite_custom';

/** The primary category new items in a group are written under. */
export function primaryCategory(group: FavouriteGroupDef): string {
  return group.categories[0];
}

/**
 * Every category the favourites section owns — what the editor filters the
 * member's items by, so a group that renders is also a group that edits.
 */
export const FAVOURITE_CATEGORIES: string[] = FAVOURITE_GROUPS.flatMap((g) => g.categories);

export function isFavouriteCategory(category: string): boolean {
  return FAVOURITE_CATEGORIES.includes(category);
}

/**
 * One choice per GROUP (not per category), in the fixed order: offering
 * films, plays and TV separately while rendering them under one heading
 * would be the drift this module exists to prevent. The last option is
 * Others (`favourite_custom`).
 */
export const FAVOURITE_CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  FAVOURITE_GROUPS.map((g) => ({ value: primaryCategory(g), label: g.label }));

/** The minimum an item needs for grouping. Both surfaces pass a wider row. */
export interface GroupableFavourite {
  category: string;
  group_label?: string | null;
}

export interface FavouriteCard<T> {
  key: string;
  label: string;
  items: T[];
}

/**
 * Group a member's items into the cards the favourites grid renders.
 *
 * Order: the five fixed groups in their declared order. Within a group,
 * items keep their input order. Empty groups are dropped (spec §06: "display
 * category heading only if populated"). Items outside the favourites
 * categories are ignored.
 */
export function groupFavourites<T extends GroupableFavourite>(items: T[]): FavouriteCard<T>[] {
  const cards: FavouriteCard<T>[] = [];
  for (const group of FAVOURITE_GROUPS) {
    const groupItems = items.filter((item) => group.categories.includes(item.category));
    if (groupItems.length > 0) {
      cards.push({ key: group.key, label: group.label, items: groupItems });
    }
  }
  return cards;
}

/**
 * The heading of the group an item renders under, so the editor labels an
 * item with the same words the public profile will. `null` for a category
 * that is not a favourite.
 */
export function favouriteLabelForItem(item: GroupableFavourite): string | null {
  const group = FAVOURITE_GROUPS.find((g) => g.categories.includes(item.category));
  return group ? group.label : null;
}

/**
 * A legacy member-chosen group name on a `favourite_custom` row, trimmed, or
 * `null` when there is none. For display as a muted, non-editable tag only;
 * it never affects grouping.
 */
export function legacyGroupLabel(item: GroupableFavourite): string | null {
  if (item.category !== CUSTOM_FAVOURITE_CATEGORY) return null;
  const name = (item.group_label ?? '').trim();
  return name === '' ? null : name;
}
