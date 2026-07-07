/**
 * KAN-344 (epic KAN-349) — onboarding-progress dashboard state resolver.
 *
 * Pure function: given the user's profile signals + entitlements + dismissals,
 * return the onboarding STATE and the ordered list of eligible, non-dismissed
 * dashboard widgets. No UI or DB coupling → fully unit-testable.
 *
 * State axes (deliberately NOT `user_status` from KAN-327, which is the access
 * lifecycle): the journey is driven by `is_published` + profile completeness +
 * derived content signals; feature entitlements decide which widgets exist at all.
 *
 * ── PROPOSED DEFAULTS — flagged for founder review (KAN-340 §7) ──────────────
 *  • empty→drafted boundary: completion_score >= EMPTY_TO_DRAFTED_THRESHOLD (40).
 *  • layout: a single primary CTA in empty/drafted; a stack in published states.
 *  • dismissal: only secondary/grow widgets are dismissible (W1 "complete" and
 *    W2 "publish" are the journey's single next step and are never dismissible);
 *    a dismissal is keyed per-widget and re-surfaces when the state changes
 *    (handled by the persistence layer, KAN-345).
 * These are easy to change in one place — see the questions doc.
 */

export type OnboardingState = 'empty' | 'drafted' | 'published_activate' | 'published_grow';

export const WIDGET_IDS = [
  'complete_profile', // W1
  'publish', // W2
  'add_gifts', // W3
  'add_affiliations', // W4
  'share', // W5
  'convene', // W6
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

/**
 * Completion % at/above which an unpublished profile is treated as "drafted"
 * (ready to publish) rather than "empty" (needs more content). Tunable default —
 * founder to confirm the threshold.
 */
export const EMPTY_TO_DRAFTED_THRESHOLD = 40;

/** W1/W2 are the single next step of the journey and cannot be dismissed. */
const NON_DISMISSIBLE: readonly WidgetId[] = ['complete_profile', 'publish'];
export function isDismissible(id: WidgetId): boolean {
  return !NON_DISMISSIBLE.includes(id);
}

export interface WidgetResolverInput {
  /** profiles.is_published */
  isPublished: boolean;
  /** profiles.completion_score (0–100) */
  completionScore: number;
  /** has at least one gift_ideas profile_item */
  hasGifts: boolean;
  /** has at least one school_affiliations row */
  hasAffiliations: boolean;
  /** feature_entitlements: convene (resolved, env-AND-entitlement) */
  conveneEntitled: boolean;
  /** persisted dismissal map for the CURRENT state (widget_id -> dismissed) */
  dismissed?: Partial<Record<WidgetId, boolean>>;
}

export interface ResolvedWidget {
  id: WidgetId;
  order: number;
}
export interface WidgetResolution {
  state: OnboardingState;
  widgets: ResolvedWidget[];
}

/** Pure: derive the onboarding state from publish + completeness + content. */
export function resolveOnboardingState(
  input: Pick<WidgetResolverInput, 'isPublished' | 'completionScore' | 'hasGifts' | 'hasAffiliations'>,
): OnboardingState {
  if (!input.isPublished) {
    return input.completionScore >= EMPTY_TO_DRAFTED_THRESHOLD ? 'drafted' : 'empty';
  }
  return input.hasGifts && input.hasAffiliations ? 'published_grow' : 'published_activate';
}

/**
 * Pure: the ordered, eligible, non-dismissed widget set for the user's state.
 * Order is contiguous (0..n) after dismissal filtering so the renderer is dumb.
 */
export function resolveWidgets(input: WidgetResolverInput): WidgetResolution {
  const state = resolveOnboardingState(input);
  const dismissed = input.dismissed ?? {};
  const candidates: WidgetId[] = [];

  switch (state) {
    case 'empty':
      candidates.push('complete_profile');
      break;
    case 'drafted':
      candidates.push('publish');
      break;
    case 'published_activate':
      // Lead with the growth actions the user hasn't done yet, then share.
      if (!input.hasGifts) candidates.push('add_gifts');
      if (!input.hasAffiliations) candidates.push('add_affiliations');
      candidates.push('share');
      break;
    case 'published_grow':
      candidates.push('share');
      if (input.conveneEntitled) candidates.push('convene');
      break;
  }

  const widgets = candidates
    .filter((id) => !(isDismissible(id) && dismissed[id]))
    .map((id, i) => ({ id, order: i }));

  return { state, widgets };
}
