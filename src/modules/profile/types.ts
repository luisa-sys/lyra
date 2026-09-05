/**
 * The profile domain model — KAN-415 D8.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These seven interfaces ARE the de-facto data model for a Lyra profile, with a
 * fan-in of 14. Until D8 they lived in `steps/types.tsx`, a leaf of the profile
 * EDITOR's wizard, welded to two presentational components in the same file.
 *
 * That is the D-4 privacy finding, and it is a boundary problem rather than
 * untidiness: the *public* profile's privacy policy — which fields exist, which
 * are nullable, what `section_visibility` inherits — was owned by the *editor's*
 * UI. `src/app/[slug]/page.tsx` had to reach into `app/dashboard/profile/` to
 * find out what a profile is, one of the two wrong-direction app→app edges the
 * plan tracks. A change made for the editor's convenience could silently move
 * what the public page shows.
 *
 * The split is deliberate and asymmetric:
 *
 *   * the DOMAIN (these interfaces) moves here, where `public-profile` (D9) and
 *     the editor can both depend on it legitimately;
 *   * the UI (`Field`, `SaveButton`) STAYS in the app tree. They are founder-
 *     owned surface carrying design tokens (`--color-sage`, `--color-ink`) and
 *     are gated by KAN-411. A domain module is the wrong home for a button, and
 *     moving one here would drag `uiApprovalGated: always` into a module whose
 *     whole purpose is to be safely depended upon.
 *
 * `steps/types.tsx` re-exports these so the 14 existing editor imports keep
 * working unchanged — this commit moves the boundary, it does not rewrite the
 * wizard. New code should import from here directly.
 */
export interface WizardProfile {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  city: string | null;
  region: string | null;
  // KAN-339: postcode_prefix removed (postcode no longer collected/stored).
  country: string | null;
  // KAN-186: ISO-3166 alpha-2 country where gifts for this profile should
  // ship. Separate from `country` (which is freeform display text). NULL
  // means "unknown — fall back to buyer country at recommendation time".
  delivery_country_code: string | null;
  is_published: boolean;
  avatar_url: string | null;
  // KAN-443: optional one-liner for people who would rather choose their own
  // gift. OPTIONAL on the type as well as nullable in the DB — the row is read
  // with select('*'), so an environment that has not yet run
  // 20260803170000_kan443_gift_redesign.sql simply returns no such key.
  gift_voucher_hint?: string | null;
  // KAN-234 / KAN-221: hybrid visibility. Per-section default ({} when
  // unset) that items inherit when their own `visibility` is NULL.
  // Keys live in `section-visibility.ts → CONTROLLABLE_SECTION_KEYS`.
  section_visibility: Record<string, string> | null;
}

export interface WizardItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  url: string | null;
  // KAN-234 / KAN-221: nullable to allow "inherit from section default".
  // Older rows from before KAN-221 always had an explicit value; new items
  // default to NULL when the form chooses "Use section default".
  visibility: string | null;
  // KAN-444: the member's own heading for a custom favourites group. Only
  // meaningful for category 'favourite_custom'; optional because every other
  // caller (and every row written before the column existed) simply omits it.
  group_label?: string | null;
}

export interface WizardSchool {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
  // KAN-220: one of school|organisation|community. Backward-compatible
  // default — older rows from before migration 20260517010000 have this
  // column with the default value 'school'.
  affiliation_type: string;
  // KAN-263 / KAN-267: affiliations are hidden on the public profile unless
  // the owner opts the row in. `description` is an optional short note
  // ("Class of 2008"). Older rows default to false / null.
  show_on_profile: boolean;
  description: string | null;
}

export interface WizardLink {
  id: string;
  title: string;
  url: string;
  link_type: string;
  description: string | null;
}

// KAN-142: profile_files row, shaped for the wizard FilesStep.
export interface WizardFile {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: string;
}

// KAN-181: conversation starters — both the curated prompt library
// and the user's answers (joined to the prompt for display).
export interface ConversationPrompt {
  id: string;
  prompt: string;
  sort_order: number;
}

export interface ConversationAnswer {
  id: string;
  // KAN-445: null when the member wrote the question themselves.
  prompt_id: string | null;
  answer: string;
  prompt: string; // the seeded prompt joined for display, or the member's own
  /** The member's own question text; null for a seeded prompt. */
  custom_prompt: string | null;
}

