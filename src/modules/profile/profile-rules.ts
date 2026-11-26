/**
 * KAN-485 — spec v0.8 profile rules: field limits, per-section caps and the
 * CheckLyra ID rules, for the browser and the server actions.
 *
 * The database enforces the same rules on write (migration
 * 20261123090000_kan485_profile_model_v08.sql — profile_item_rule(),
 * is_reserved_lyra_id(), enforce_profile_identity_rules()), so this module is
 * the friendly first check, not the boundary. tests/unit/kan485-*.test.ts pins
 * BOTH copies to the spec's literal values, so they cannot drift apart.
 */

export type ItemOrigin = 'user' | 'ai';

export interface ItemRule {
  /** Items in the same cap group count toward one cap. */
  capGroup: string;
  cap: number;
  titleMax: number;
  descriptionMax: number;
}

/** v0.8 rule per profile_items.category, for member-written entries. */
export const ITEM_RULES: Readonly<Record<string, ItemRule>> = {
  causes: { capGroup: 'causes', cap: 6, titleMax: 250, descriptionMax: 250 },
  proud_of: { capGroup: 'proud_of', cap: 6, titleMax: 250, descriptionMax: 250 },
  gift_ideas: { capGroup: 'gifts_user', cap: 25, titleMax: 100, descriptionMax: 250 },
  gifts_to_avoid: { capGroup: 'not_for_me', cap: 15, titleMax: 100, descriptionMax: 200 },
  quotes: { capGroup: 'fav_quotes', cap: 15, titleMax: 500, descriptionMax: 120 },
  favourite_media: { capGroup: 'fav_screen', cap: 15, titleMax: 120, descriptionMax: 300 },
  plays: { capGroup: 'fav_screen', cap: 15, titleMax: 120, descriptionMax: 300 },
  favourite_tv: { capGroup: 'fav_screen', cap: 15, titleMax: 120, descriptionMax: 300 },
  favourite_books: { capGroup: 'fav_books', cap: 15, titleMax: 120, descriptionMax: 300 },
  favourite_places: { capGroup: 'fav_places', cap: 15, titleMax: 120, descriptionMax: 300 },
  favourite_venues: { capGroup: 'fav_places', cap: 15, titleMax: 120, descriptionMax: 300 },
  favourite_music: { capGroup: 'fav_others', cap: 15, titleMax: 120, descriptionMax: 300 },
  favourite_custom: { capGroup: 'fav_others', cap: 15, titleMax: 120, descriptionMax: 300 },
  life_hacks: { capGroup: 'tips', cap: 15, titleMax: 120, descriptionMax: 500 },
  current_problems: { capGroup: 'problems', cap: 10, titleMax: 120, descriptionMax: 500 },
};

/** AI gift suggestions: separate from the 25 member gifts (v0.8 §03). */
export const AI_GIFT_RULE: ItemRule = { capGroup: 'gifts_ai', cap: 10, titleMax: 100, descriptionMax: 250 };

export const URL_MAX = 2048;

/** The rule for a category/origin, or null for a legacy (pre-v0.8) category. */
export function itemRuleFor(category: string, origin: ItemOrigin = 'user'): ItemRule | null {
  if (origin === 'ai') return category === 'gift_ideas' ? AI_GIFT_RULE : null;
  return Object.prototype.hasOwnProperty.call(ITEM_RULES, category) ? ITEM_RULES[category] : null;
}

/** Fixed-length profile fields (v0.8 §01, §03, §10). */
export const PROFILE_FIELD_MAX = {
  display_name: 60,
  headline: 100,
  city: 80,
  country: 80,
  bio_short: 500,
  gift_voucher_hint: 350, // "Do you prefer surprise gifts…" general preference
  billboard: 200,
} as const;

/** Affiliations (v0.8 §02). */
export const AFFILIATION_RULES = {
  capPerType: 7,
  nameMax: 120,
  locationMax: 120,
  schoolPostcodeMax: 12,
  descriptionMax: 250,
} as const;

// ── CheckLyra ID ────────────────────────────────────────────────────────

export const LYRA_ID_RE = /^[a-z0-9_]{3,30}$/;

/**
 * Words no member may take as an ID: every single-word top-level route, and
 * words that would read as official. Hyphenated routes cannot collide (an ID
 * has no hyphen) but are listed to match the database copy exactly.
 */
export const RESERVED_LYRA_IDS: ReadonlySet<string> = new Set([
  'admin', 'api', 'auth', 'confirm-age', 'dashboard', 'examples', 'how-we-check-your-age',
  'join', 'oauth', 'r', 'search', 'status', 'suspended', 'verify-age', 'waitlist',
  'login', 'logout', 'signin', 'signout', 'signup', 'register', 'reset', 'password',
  'privacy', 'terms', 'cookies', 'legal', 'about', 'contact', 'help', 'support', 'faq',
  'accessibility', 'complaints', 'guidelines', 'partners', 'safe',
  'settings', 'profile', 'profiles', 'account', 'accounts', 'me', 'home', 'index',
  'lyra', 'checklyra', 'official', 'staff', 'team', 'moderator', 'mod', 'root',
  'system', 'null', 'undefined', 'www', 'mail', 'email', 'beta', 'dev', 'staging',
  'static', 'assets', 'public', 'robots', 'sitemap', 'favicon', 'manifest',
  'report', 'reports', 'security', 'invite', 'invites', 'new', 'edit', 'preview',
]);

export type LyraIdCheck = { ok: true; id: string } | { ok: false; error: string };

/** Normalise (trim + lower-case) and validate a member's chosen ID. */
export function checkLyraId(raw: unknown): LyraIdCheck {
  const id = String(raw ?? '').trim().toLowerCase();
  if (id.length < 3) return { ok: false, error: 'Your CheckLyra ID needs at least 3 characters.' };
  if (id.length > 30) return { ok: false, error: 'Your CheckLyra ID can be at most 30 characters.' };
  if (!LYRA_ID_RE.test(id)) {
    return { ok: false, error: 'Use only letters, numbers and underscores.' };
  }
  if (RESERVED_LYRA_IDS.has(id)) return { ok: false, error: 'That ID is reserved. Please choose another.' };
  return { ok: true, id };
}
