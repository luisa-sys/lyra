/**
 * Evergreen "always-show" fallback concepts for the V2 recommender.
 *
 * Use case: a profile is too sparse for V1 to produce any concepts (e.g.
 * brand-new profile with no items yet), OR V1 produced concepts but
 * candidate-sourcing found no catalogue / Sovrn matches in the buyer's
 * country. Rather than returning an empty list — which means the recipient's
 * profile-viewer sees nothing useful — we substitute this small set of
 * generic "thoughtful default" concepts.
 *
 * These concepts map cleanly onto the seeded `recommender_catalogue`
 * categories (KAN-200) so they always find Tier-1 matches:
 *
 *   books_reading → Bookshop.org / Amazon Kindle gift cards
 *   experiences   → John Lewis experience-day voucher
 *   food_drink    → Selfridges Food Hall gift card
 *   home_garden   → Notonthehighstreet home gift card
 *   arts_crafts   → Etsy gift card
 *
 * Scores are deliberately low (5) so when the recommender is invoked with
 * a profile that DID produce real concepts (typical scores 8–20), the real
 * concepts always rank above the evergreen ones. Evergreen entries only
 * fill the result list when there's nothing better to surface.
 *
 * The concepts are still un-monetised when Sovrn isn't live — they just
 * go through the same Affiliate Link Service that returns `monetised:false`
 * and the AffiliateBadge renders "Tracked" rather than "Affiliate" so the
 * disclosure stays honest. Once Sovrn is live, the same evergreen items
 * become monetisable opportunistically without any code change.
 */

import type { ConceptInput } from './types';

export const EVERGREEN_FALLBACK_CONCEPTS: readonly ConceptInput[] = [
  {
    categoryKey: 'experiences',
    conceptTitle: 'A memorable experience',
    conceptScore: 5,
    reasons: [
      "When you're not sure what they'll want, let them choose the experience.",
    ],
    tags: ['evergreen', 'safe-default', 'gift-card'],
  },
  {
    categoryKey: 'books_reading',
    conceptTitle: 'Something to read',
    conceptScore: 5,
    reasons: [
      'A book or reading credit is a thoughtful, low-risk gift for most adults.',
    ],
    tags: ['evergreen', 'safe-default', 'books'],
  },
  {
    categoryKey: 'home_garden',
    conceptTitle: 'Something for the home',
    conceptScore: 5,
    reasons: [
      'A small useful or decorative thing for the home tends to land well.',
    ],
    tags: ['evergreen', 'safe-default'],
  },
  {
    categoryKey: 'arts_crafts',
    conceptTitle: 'Something handmade',
    conceptScore: 5,
    reasons: [
      "Handmade signals care without assuming the recipient's specific taste.",
    ],
    tags: ['evergreen', 'safe-default', 'handmade'],
  },
  {
    categoryKey: 'food_drink',
    conceptTitle: 'Food or drink',
    conceptScore: 5,
    reasons: [
      'Consumable gifts leave space rather than clutter — usually a safe bet.',
    ],
    tags: ['evergreen', 'safe-default', 'food'],
  },
];

/**
 * Did the caller fall back to evergreen because there was nothing else?
 * Returns true if the candidate list looks like it came entirely from the
 * evergreen pool — used for telemetry and the response's `meta` block.
 */
export function isEvergreenFallback(
  candidates: { concept: ConceptInput }[],
): boolean {
  if (candidates.length === 0) return false;
  return candidates.every((c) => c.concept.tags.includes('evergreen'));
}
