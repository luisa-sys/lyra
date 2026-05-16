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
import { getAffiliateLink } from '@/lib/affiliate/link-service';
import type { PipelineRequest, V2Recommendation } from './types';

/**
 * Top-level entry. Async because both candidate sourcing and the
 * affiliate-link service hit IO.
 */
export async function buildV2Recommendations(
  req: PipelineRequest,
): Promise<V2Recommendation[]> {
  const limit = req.limit ?? 5;
  const recipientCountry = req.recipientCountry ?? req.buyerCountry;

  // 1. Source candidates per concept (parallelised across concepts in the
  //    candidate-sourcing module).
  const sourcingOpts: SourcingOptions = {
    perConceptLimit: 3,
    buyerCountry: req.buyerCountry,
    budgetMinMinor: req.budgetMinMinor,
    budgetMaxMinor: req.budgetMaxMinor,
  };
  const candidates = await sourceCandidatesForConcepts(
    req.concepts,
    sourcingOpts,
  );
  if (candidates.length === 0) return [];

  // 2. Rank — pure function, no IO.
  // EPC + shipping confidence ContextMaps are empty for MVP; populated
  // from KAN-195 reporting + KAN-187 matrix once those land.
  const rankerCtx: RankerContext = {
    budgetMinMinor: req.budgetMinMinor,
    budgetMaxMinor: req.budgetMaxMinor,
    merchantEpc: new Map(),
    shippingConfidence: new Map(),
  };
  const ranked = rankCandidates(candidates, rankerCtx);

  // 3. Take the top N, then monetise each via the Affiliate Link Service.
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

  // 4. Compose final results — pair each ranked candidate with its
  //    monetisation outcome and a composed rationale.
  return topN.map<V2Recommendation>((cand, i) => ({
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
}
