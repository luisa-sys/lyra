/**
 * KAN-200: V2 recommender top-level pipeline.
 *
 *   V1 concepts (already shipped in src/lib/recommend/)
 *     ↓
 *   candidate-sourcing (Tier 1 catalogue + Tier 2 Sovrn stub + Tier 3 LLM stub)
 *     ↓
 *   ranker (V2 scoring formula)
 *     ↓
 *   eligibility filter (KAN-190 — built into the candidate sourcing buyer-country filter)
 *     ↓
 *   affiliate link service (KAN-188 / KAN-191 — Sovrn stubbed until KAN-184)
 *     ↓
 *   compose rationale (KAN-199)
 *
 * Returns a list of V2Recommendation rows, monetised when SOVRN_API_KEY is
 * set, un-monetised but click-logged otherwise.
 */

import {
  sourceCandidatesForConcepts,
  type SourcingOptions,
} from './candidate-sourcing';
import { rankCandidates, type RankerContext } from './rank';
import { composeRationale } from './explain';
import { EVERGREEN_FALLBACK_CONCEPTS } from './evergreen';
import { getAffiliateLink } from '@/lib/affiliate/link-service';
import type { PipelineRequest, PipelineResult, V2Recommendation } from './types';

/**
 * Top-level entry. Async because both candidate sourcing and the
 * affiliate-link service hit IO.
 *
 * Always-show contract: callers should never see an empty result if the
 * recommender_catalogue has any active entries — the evergreen fallback
 * substitutes safe-default concepts when the buyer's own profile-derived
 * concepts produce nothing.
 */
export async function buildV2Recommendations(
  req: PipelineRequest,
): Promise<PipelineResult> {
  const limit = req.limit ?? 5;
  const recipientCountry = req.recipientCountry ?? req.buyerCountry;
  const sourcingOpts: SourcingOptions = {
    perConceptLimit: 3,
    buyerCountry: req.buyerCountry,
    budgetMinMinor: req.budgetMinMinor,
    budgetMaxMinor: req.budgetMaxMinor,
  };

  // 1. Try the user's own concepts first. Parallelised across concepts
  //    inside sourceCandidatesForConcepts.
  let candidates = await sourceCandidatesForConcepts(req.concepts, sourcingOpts);
  let fellBackToEvergreen = false;

  // 2. Evergreen fallback. Triggers when the user's profile produced
  //    zero candidates — either because V1 returned no concepts (sparse
  //    profile) or because none of V1's concepts matched the catalogue +
  //    Sovrn / LLM stubs. The evergreen pool is deliberately broad and
  //    maps onto the seeded catalogue categories so it almost always
  //    returns something. Better to surface a generic "thoughtful default"
  //    than nothing.
  if (candidates.length === 0) {
    candidates = await sourceCandidatesForConcepts(
      [...EVERGREEN_FALLBACK_CONCEPTS],
      sourcingOpts,
    );
    fellBackToEvergreen = candidates.length > 0;
  }

  // If even the evergreen pool produces nothing (catalogue empty for the
  // buyer's country, Sovrn stubbed, no LLM key), genuinely return empty.
  // The web fallback to V1's RecommendationsSection still catches this
  // case on the public profile page.
  if (candidates.length === 0) {
    return { recommendations: [], fellBackToEvergreen: false };
  }

  // 3. Rank — pure function, no IO.
  const rankerCtx: RankerContext = {
    budgetMinMinor: req.budgetMinMinor,
    budgetMaxMinor: req.budgetMaxMinor,
    merchantEpc: new Map(),
    shippingConfidence: new Map(),
  };
  const ranked = rankCandidates(candidates, rankerCtx);

  // 4. Take the top N, then monetise each via the Affiliate Link Service.
  const topN = ranked.slice(0, limit);
  const monetised = await Promise.all(
    topN.map((cand) =>
      getAffiliateLink({
        rawUrl: cand.rawUrl,
        buyerCountry: req.buyerCountry,
        recipientCountry,
        sessionId: req.sessionId ?? null,
        userId: req.userId ?? null,
        recipientId: req.recipientId ?? null,
        recommendationId: req.recommendationId ?? null,
        source: req.source,
      }),
    ),
  );

  // 5. Compose final results — pair each ranked candidate with its
  //    monetisation outcome and a composed rationale.
  const recommendations = topN.map<V2Recommendation>((cand, i) => ({
    concept: cand.concept,
    product: {
      title: cand.title,
      description: cand.description,
      imageUrl: cand.imageUrl,
      merchantId: cand.merchantId,
      priceMinMinor: cand.priceMinMinor,
      priceMaxMinor: cand.priceMaxMinor,
      priceCurrency: cand.priceCurrency,
    },
    affiliate: monetised[i],
    rationale: composeRationale(cand),
    score: cand.score,
  }));

  return { recommendations, fellBackToEvergreen };
}
