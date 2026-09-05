/**
 * KAN-349 — derived profile-completion score (0–100), computed at read-time.
 *
 * The stored `profiles.completion_score` column is vestigial: nothing in the
 * app has computed it since the profile redesign, so it sits at 0 for real
 * users (only seeded demo profiles carry a value). Both the dashboard journey
 * (the empty→drafted boundary in resolve-widgets) and the "Completion: N%"
 * display read a completion signal, so we derive it from the user's ACTUAL
 * profile content on each render — always fresh, no migration or save-time
 * recompute needed, and the dead column can be dropped later.
 *
 * Weights are a sensible default (they sum to 100) — tune freely; the founder
 * may want to reweight which fields matter most. Keep them summing to 100 so
 * the value reads as a percentage and the EMPTY_TO_DRAFTED_THRESHOLD (40) in
 * resolve-widgets stays meaningful.
 */
export interface ProfileCompletionInput {
  displayName?: string | null;
  /** A short intro — either the dedicated bio or the headline counts. */
  bioShort?: string | null;
  headline?: string | null;
  city?: string | null;
  avatarUrl?: string | null;
  /** At least one gift idea (profile_items category=gift_ideas). */
  hasGifts: boolean;
  /** At least one affiliation (school_affiliations row). */
  hasAffiliations: boolean;
}

const filled = (v?: string | null): boolean => typeof v === 'string' && v.trim().length > 0;

/** The components that make up a complete profile. Points sum to 100. */
export const COMPLETION_COMPONENTS: ReadonlyArray<{
  key: string;
  points: number;
  done: (i: ProfileCompletionInput) => boolean;
}> = [
  { key: 'display_name', points: 20, done: (i) => filled(i.displayName) },
  { key: 'intro', points: 20, done: (i) => filled(i.bioShort) || filled(i.headline) },
  { key: 'city', points: 15, done: (i) => filled(i.city) },
  { key: 'avatar', points: 15, done: (i) => filled(i.avatarUrl) },
  { key: 'gifts', points: 15, done: (i) => i.hasGifts },
  { key: 'affiliations', points: 15, done: (i) => i.hasAffiliations },
];

/**
 * Pure: 0–100 completion score from live profile content. Clamped to [0,100].
 */
export function computeProfileCompletion(input: ProfileCompletionInput): number {
  const score = COMPLETION_COMPONENTS.reduce((sum, c) => sum + (c.done(input) ? c.points : 0), 0);
  return Math.min(100, Math.max(0, score));
}
