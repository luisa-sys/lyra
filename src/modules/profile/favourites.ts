/**
 * KAN-444 — "A few of my favourite things": five fixed groups + add-your-own.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The favourites grouping is rendered TWICE — once in the editor
 * (`edit-profile-form.tsx` → `ItemsStep`) and once on the public profile
 * (`src/app/[slug]/page.tsx`). Before KAN-444 each surface carried its own
 * literal list of categories, so the two could drift silently and a member
 * would see one set of groups while editing and a different set once
 * published. Both surfaces now derive their groups from the single
 * `FAVOURITE_GROUPS` table below, which makes that drift impossible rather
 * than merely detectable.
 *
 * Import-only: no Supabase calls, no server actions, safe from both client
 * and server components (same rule as `section-visibility.ts`, and the
 * reason it is not declared in the `'use server'` action file — BUGS-12).
 *
 * MAPPING ONTO THE EXISTING ENUM
 * ------------------------------
 * The five fixed groups are a pure regrouping of `item_category` values that
 * already exist, so they need no migration:
 *
 *   Books                 favourite_books
 *   Movies, plays & TV    favourite_media + plays + favourite_tv   (merged)
 *   Quotes                quotes
 *   Music                 favourite_music
 *   Places                favourite_places
 *
 * The merge is read-compatible in both directions: existing `plays` and
 * `favourite_tv` rows keep rendering (under the merged heading), while new
 * items in that group are written under the group's primary category. No
 * backfill, no data migration.
 *
 * `causes` is deliberately ABSENT. It is its own section — "Causes close to
 * my heart" (KAN-458) — and must never reappear as a favourites group, or a
 * member's causes would be listed twice under two different headings.
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

export const FAVOURITE_GROUPS: readonly FavouriteGroupDef[] = [
  { key: 'books', label: 'Books', categories: ['favourite_books'] },
  { key: 'screen', label: 'Movies, plays & TV', categories: ['favourite_media', 'plays', 'favourite_tv'] },
  { key: 'quotes', label: 'Quotes', categories: ['quotes'] },
  { key: 'music', label: 'Music', categories: ['favourite_music'] },
  { key: 'places', label: 'Places', categories: ['favourite_places'] },
];

/**
 * The member-named group. Items land in their own `favourite_custom`
 * category so that every other reader of `profile_items` — the MCP tools,
 * the gift recommender, search — sees an unfamiliar category and leaves it
 * alone, rather than mis-filing a "Board games" entry as a book.
 */
export const CUSTOM_FAVOURITE_CATEGORY = 'favourite_custom';

/** What the member picks in the editor to start a group of their own. */
export const CUSTOM_FAVOURITE_LABEL = 'Add your own';

/**
 * Heading used when a custom item somehow has no group name (a row written
 * before the column existed, or whitespace). Never blank: a card with no
 * heading reads as a rendering bug.
 */
export const CUSTOM_FAVOURITE_FALLBACK_LABEL = 'A few more favourites';

/** The primary category new items in a group are written under. */
export function primaryCategory(group: FavouriteGroupDef): string {
  return group.categories[0];
}

/**
 * Every category the favourites section owns — what the editor filters the
 * member's items by, so a group that renders is also a group that edits.
 */
export const FAVOURITE_CATEGORIES: string[] = [
  ...FAVOURITE_GROUPS.flatMap((g) => g.categories),
  CUSTOM_FAVOURITE_CATEGORY,
];

export function isFavouriteCategory(category: string): boolean {
  return FAVOURITE_CATEGORIES.includes(category);
}

/**
 * The editor's "which group?" choices: the five fixed groups, then
 * add-your-own. One option per GROUP, not per category — merging films,
 * plays and TV into one heading while still offering three separate
 * choices would be the drift this module exists to prevent.
 */
export const FAVOURITE_CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  ...FAVOURITE_GROUPS.map((g) => ({ value: primaryCategory(g), label: g.label })),
  { value: CUSTOM_FAVOURITE_CATEGORY, label: CUSTOM_FAVOURITE_LABEL },
];

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
 * Order: the five fixed groups in their declared order, then any custom
 * groups in the order the member first used them. Empty groups are dropped
 * — a favourites grid should show what someone shared, not a row of blanks.
 *
 * Custom groups are keyed by their name, case- and whitespace-insensitively,
 * so "Board games" and "board games " are one group rather than two.
 */
export function groupFavourites<T extends GroupableFavourite>(items: T[]): FavouriteCard<T>[] {
  const cards: FavouriteCard<T>[] = [];

  for (const group of FAVOURITE_GROUPS) {
    const groupItems = items.filter((item) => group.categories.includes(item.category));
    if (groupItems.length > 0) {
      cards.push({ key: group.key, label: group.label, items: groupItems });
    }
  }

  const byName = new Map<string, FavouriteCard<T>>();
  for (const item of items) {
    if (item.category !== CUSTOM_FAVOURITE_CATEGORY) continue;
    const name = (item.group_label ?? '').trim() || CUSTOM_FAVOURITE_FALLBACK_LABEL;
    const key = `custom:${name.toLowerCase()}`;
    let card = byName.get(key);
    if (!card) {
      card = { key, label: name, items: [] };
      byName.set(key, card);
      cards.push(card);
    }
    card.items.push(item);
  }

  return cards;
}

/**
 * The heading to show above a single item in the editor's list, so the
 * editor labels an item with the same words the public profile will.
 */
export function favouriteLabelForItem(item: GroupableFavourite): string | null {
  if (item.category === CUSTOM_FAVOURITE_CATEGORY) {
    return (item.group_label ?? '').trim() || CUSTOM_FAVOURITE_FALLBACK_LABEL;
  }
  const group = FAVOURITE_GROUPS.find((g) => g.categories.includes(item.category));
  return group ? group.label : null;
}
