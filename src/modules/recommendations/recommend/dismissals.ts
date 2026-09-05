/**
 * KAN-443 — "not for me": the identity of a gift suggestion a member has
 * dismissed, and the filters that keep it gone.
 *
 * WHY THE KEY IS A CONCEPT, NOT A PRODUCT
 * ---------------------------------------
 * What a visitor sees is a PRODUCT ("Waterstones gift card, £20"), resolved at
 * request time from a CONCEPT ("Something to read") by the V2 pipeline. Product
 * resolution is not stable: the curated catalogue changes, Sovrn results move,
 * and the same concept happily yields a different product tomorrow. Keying a
 * dismissal on the product would therefore mean the member says "not for me",
 * the catalogue rotates, and the same idea reappears wearing a different label —
 * exactly the failure the feature exists to prevent.
 *
 * Concepts come from a fixed pool (`./pool`) plus the evergreen fallbacks, so
 * `<categoryKey>:<title>` is stable across requests, across the V1 and V2
 * sections, and across a catalogue refresh. If a pool title is ever reworded the
 * old key simply stops matching — the suggestion returns and can be dismissed
 * again. That is a mild, self-correcting failure; the alternative (an opaque
 * numeric id) would make a stored dismissal unreadable and undebuggable.
 *
 * Pure module, no IO: `src/lib/**` may not import `src/app/**`, and both the
 * public profile page and the editor need this, so it lives here.
 */

/** Longest key we will ever produce or accept. Mirrors the server-side cap in
 *  `dismissGiftSuggestion` so a stored key and a computed key cannot disagree
 *  about length. */
export const MAX_SUGGESTION_KEY_LENGTH = 200;

/**
 * The stable identity of one suggested gift.
 *
 * Lower-cased and whitespace-collapsed so trivial presentation changes (a
 * double space, a capitalised first word) do not resurrect a dismissed
 * suggestion.
 */
export function giftSuggestionKey(categoryKey: string, title: string): string {
  const normalisedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${categoryKey.trim().toLowerCase()}:${normalisedTitle}`.slice(
    0,
    MAX_SUGGESTION_KEY_LENGTH,
  );
}

/** Key for a V1 `RecommendationResult` (what the concept-only section renders). */
export function keyForRecommendation(rec: { categoryKey: string; title: string }): string {
  return giftSuggestionKey(rec.categoryKey, rec.title);
}

/** Key for a V2 concept (carried on every `V2Recommendation` as `.concept`). */
export function keyForConcept(concept: { categoryKey: string; conceptTitle: string }): string {
  return giftSuggestionKey(concept.categoryKey, concept.conceptTitle);
}

/**
 * Drop every V1 recommendation the member has dismissed.
 *
 * Applied BEFORE the V2 pipeline runs, so a dismissal frees a slot for the next
 * concept instead of leaving a gap — the member loses the idea they rejected,
 * not one of their five suggestions.
 */
export function withoutDismissedRecommendations<T extends { categoryKey: string; title: string }>(
  recommendations: readonly T[],
  dismissedKeys: ReadonlySet<string>,
): T[] {
  if (dismissedKeys.size === 0) return [...recommendations];
  return recommendations.filter((r) => !dismissedKeys.has(keyForRecommendation(r)));
}

/**
 * Drop every V2 recommendation whose concept the member has dismissed.
 *
 * This is NOT redundant with the V1 filter above. When a profile is too sparse
 * the pipeline substitutes its own evergreen concepts (`v2/evergreen.ts`), which
 * never passed through the V1 list and so were never filtered. Without this
 * second pass a dismissed evergreen suggestion would come straight back.
 */
export function withoutDismissedV2<T extends { concept: { categoryKey: string; conceptTitle: string } }>(
  recommendations: readonly T[],
  dismissedKeys: ReadonlySet<string>,
): T[] {
  if (dismissedKeys.size === 0) return [...recommendations];
  return recommendations.filter((r) => !dismissedKeys.has(keyForConcept(r.concept)));
}
