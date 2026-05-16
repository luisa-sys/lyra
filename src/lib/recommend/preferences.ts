/**
 * KAN-139: build a preference profile from a user's profile data.
 *
 * Ported from `_build_preference_profile` in
 * /Users/admin/Documents/2026 Lyra/lyra-app/recommend.py.
 *
 * Schema adaptation from the original Python/SQLite shape:
 *
 *   Python section_key  →  Next.js `item_category` enum
 *   ──────────────────     ────────────────────────────
 *   gift_ideas            gift_ideas         (identical)
 *   things_i_like         likes              (renamed)
 *   things_i_avoid        dislikes           (renamed)
 *   boundaries            boundaries         (identical)
 *   favourite_books       favourite_books    (identical, added in KAN-137)
 *   favourite_media       favourite_media    (identical, added in KAN-137)
 *   causes                causes             (identical, added in KAN-137)
 *
 * The "about" section body in the Python schema maps onto `profiles.bio`
 * in Next.js (single string column rather than a `profile_sections` row).
 *
 * Pure function — no DB / network access. The caller fetches the rows
 * and passes them in. This lets the same logic run from a Server
 * Component, an API route, or the MCP server (eventually) without
 * dragging Supabase into every consumer.
 */

import { extractKeywords, Counter } from './keywords';
import { GIFT_CATEGORIES, type GiftCategoryKey, ALL_CATEGORY_KEYS } from './categories';

/**
 * Subset of `profile_items` columns the preference builder needs.
 * Callers pass `select('category, title, description')` — anything
 * else is irrelevant to scoring.
 */
export interface ProfileItemInput {
  category: string;
  title: string | null;
  description: string | null;
}

export interface ProfileInput {
  /**
   * Short bio shown on the public profile. In the current schema this
   * column is `profiles.bio_short`; the field is named `bio` here so the
   * recommend module is decoupled from the column name and can be
   * reused if that ever changes.
   */
  bio: string | null;
  headline: string | null;
  /** All non-draft items the viewer is allowed to see. */
  items: ProfileItemInput[];
}

export interface PreferenceProfile {
  likes: Counter;
  avoids: Counter;
  boundaries: Counter;
  gifts: Counter;
  all: Counter;
  /** Lowercased + trimmed titles of items in the gift_ideas category. */
  existingGiftTitles: Set<string>;
  /** Detected dietary constraints from boundary items. */
  dietary: Set<'vegan' | 'vegetarian' | 'gluten-free' | 'dairy-free' | 'no-pork'>;
  /** How many gift items match each gift category — drives "preferred categories" boost. */
  preferredCategories: Counter;
  /** How many avoid items match each gift category — drives anti-category penalty. */
  antiCategories: Counter;
  valuesExperiences: boolean;
  valuesCharitable: boolean;
  valuesHandmade: boolean;
  valuesMinimal: boolean;
}

/** Categories whose item text the scorer treats as "things I like". */
const LIKE_CATEGORIES = new Set([
  'likes',
  'favourite_books',
  'favourite_media',
  'causes',
  'helpful_to_know',
  'proud_of',
  'life_hacks',
]);

/** Returns true if the lowercased text contains any of the substrings. */
function containsAny(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/**
 * Returns the gift-category keys that match `text` based on each
 * category's keyword list. The same text can match multiple categories
 * (e.g. "spa retreat voucher" matches both `experiences` and arguably
 * `charitable` if it says donation). Mirrors the Python loop.
 */
function categoriesMatchingText(text: string): GiftCategoryKey[] {
  const out: GiftCategoryKey[] = [];
  for (const key of ALL_CATEGORY_KEYS) {
    if (containsAny(text, GIFT_CATEGORIES[key].keywords)) {
      out.push(key);
    }
  }
  return out;
}

export function buildPreferenceProfile(profile: ProfileInput): PreferenceProfile {
  const pref: PreferenceProfile = {
    likes: new Counter(),
    avoids: new Counter(),
    boundaries: new Counter(),
    gifts: new Counter(),
    all: new Counter(),
    existingGiftTitles: new Set(),
    dietary: new Set(),
    preferredCategories: new Counter(),
    antiCategories: new Counter(),
    valuesExperiences: false,
    valuesCharitable: false,
    valuesHandmade: false,
    valuesMinimal: false,
  };

  for (const item of profile.items) {
    const title = item.title ?? '';
    const desc = item.description ?? '';
    const text = `${title} ${desc}`.toLowerCase();
    const words = extractKeywords(text);

    if (item.category === 'gift_ideas') {
      pref.gifts.add(words);
      pref.existingGiftTitles.add(title.toLowerCase().trim());

      // Preference signals from the kinds of gift ideas they list.
      if (containsAny(text, ['experience', 'ticket', 'entry', 'class', 'workshop'])) {
        pref.valuesExperiences = true;
      }
      if (containsAny(text, ['donation', 'charity', 'cause'])) {
        pref.valuesCharitable = true;
      }
      if (containsAny(text, ['handmade', 'independent', 'artisan', 'small'])) {
        pref.valuesHandmade = true;
      }

      for (const cat of categoriesMatchingText(text)) {
        pref.preferredCategories.add([cat]);
      }
    } else if (item.category === 'dislikes' || item.category === 'gifts_to_avoid') {
      pref.avoids.add(words);
      for (const cat of categoriesMatchingText(text)) {
        pref.antiCategories.add([cat]);
      }
    } else if (item.category === 'boundaries') {
      pref.boundaries.add(words);
      if (containsAny(text, ['vegan'])) pref.dietary.add('vegan');
      if (containsAny(text, ['vegetarian'])) pref.dietary.add('vegetarian');
      if (containsAny(text, ['gluten-free', 'coeliac', 'celiac'])) pref.dietary.add('gluten-free');
      if (containsAny(text, ['dairy', 'lactose'])) pref.dietary.add('dairy-free');
      if (containsAny(text, ['pork', 'halal'])) pref.dietary.add('no-pork');
    } else if (LIKE_CATEGORIES.has(item.category)) {
      pref.likes.add(words);
    }

    pref.all.add(words);

    // Minimalism signal: applies regardless of which category the
    // signal appears in (the Python original scanned all items).
    if (containsAny(text, ['minimal', 'clutter', 'fewer', 'less stuff', 'simple'])) {
      pref.valuesMinimal = true;
    }
  }

  // Treat the profile bio as additional "likes" / "all" signal —
  // matches the Python behaviour of reading the about section body.
  for (const field of [profile.bio, profile.headline]) {
    if (field) {
      const w = extractKeywords(field);
      pref.likes.add(w);
      pref.all.add(w);
    }
  }

  return pref;
}
