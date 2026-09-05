/**
 * KAN-199 / KAN-200: V2 ranker — pure scoring functions for product
 * candidates surfaced by candidate-sourcing.
 *
 * Implements the formula from docs/RECOMMENDATION_ENGINE_DESIGN.md:
 *
 *   score = 0.40 * v1
 *         + 0.20 * budgetFit
 *         + 0.20 * merchantEpc_normalised
 *         + 0.10 * shippingConfidence
 *         - 0.10 * diversityPenalty
 *         + 0.10 * sourceTier            ← Tier 1 wins ties (admin curation)
 *         + (small) sourceWeight contribution
 *
 * Pure functions — no DB, no fetch. Inputs in, scores out. Easy to unit
 * test and to tune via env-var weights without redeploying logic.
 */

import type { ProductCandidate, ScoredCandidate } from './types';

export type RankerWeights = {
  v1: number;
  budget: number;
  merchantEpc: number;
  shipping: number;
  diversity: number;
  sourceTier: number;
};

export const DEFAULT_WEIGHTS: RankerWeights = {
  v1: 0.40,
  budget: 0.20,
  merchantEpc: 0.20,
  shipping: 0.10,
  diversity: 0.10,
  sourceTier: 0.10,
};

export type RankerContext = {
  /** Buyer's budget range; missing = no filter. */
  budgetMinMinor: number | null | undefined;
  budgetMaxMinor: number | null | undefined;
  /**
   * Per-(merchant_id) EPC in [0, 1]. Defaults to 0.5 when not in the map
   * — fair coin until we have reporting data (KAN-195).
   */
  merchantEpc: ReadonlyMap<string, number>;
  /**
   * Per-(merchant_id × country_code) shipping confidence in [0, 1].
   * Defaults to 0.5 when not in the map.
   */
  shippingConfidence: ReadonlyMap<string, number>;
  /** Optional weight overrides. */
  weights?: Partial<RankerWeights>;
};

/**
 * Score and rank a list of candidates. Returns a new array sorted by score
 * descending. Tie-break is stable (original order preserved on ties).
 *
 * The diversity penalty is applied across the result list — the n-th
 * candidate from a merchant we've already seen pays an increasing penalty.
 */
export function rankCandidates(
  candidates: ProductCandidate[],
  ctx: RankerContext,
): ScoredCandidate[] {
  const weights: RankerWeights = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };

  // Initial scoring without diversity (diversity needs a result-list pass).
  // We carry the original index as a side-channel for stable tie-breaking;
  // strip it before returning.
  type ScoredWithIdx = ScoredCandidate & { _idx: number };
  const initial: ScoredWithIdx[] = candidates.map((c, idx) => {
    const v1 = normaliseV1Score(c.concept.conceptScore);
    const budget = budgetFitScore(c, ctx);
    const epc = ctx.merchantEpc.get(c.merchantId) ?? 0.5;
    const shipping = ctx.shippingConfidence.get(c.merchantId) ?? 0.5;
    const tier = sourceTierScore(c.sourceTier);
    const breakdown = {
      v1: weights.v1 * v1,
      budget: weights.budget * budget,
      merchantEpc: weights.merchantEpc * epc,
      shipping: weights.shipping * shipping,
      diversity: 0, // computed in second pass
      sourceTier: weights.sourceTier * tier,
      sourceWeight: c.sourceWeight * 0.01, // small contribution
    };
    const score =
      breakdown.v1 +
      breakdown.budget +
      breakdown.merchantEpc +
      breakdown.shipping +
      breakdown.diversity +
      breakdown.sourceTier +
      breakdown.sourceWeight;
    return { ...c, score, scoreBreakdown: breakdown, _idx: idx };
  });

  // Sort by initial score, then apply diversity penalty during the second
  // pass so it depends on rank order.
  const stableSort = (a: ScoredWithIdx, b: ScoredWithIdx) => {
    if (b.score !== a.score) return b.score - a.score;
    return a._idx - b._idx;
  };
  initial.sort(stableSort);

  const merchantSeen = new Map<string, number>();
  for (const cand of initial) {
    const count = merchantSeen.get(cand.merchantId) ?? 0;
    if (count > 0) {
      // Penalty grows quadratically: 2nd seen = 0.5, 3rd = 1.0, 4th = 1.5…
      const penalty = (count * (count + 1)) / 4;
      cand.scoreBreakdown.diversity = -weights.diversity * penalty;
      cand.score += cand.scoreBreakdown.diversity;
    }
    merchantSeen.set(cand.merchantId, count + 1);
  }

  initial.sort(stableSort);

  // Strip the temporary _idx field before returning.
  return initial.map<ScoredCandidate>(({ _idx: _unused, ...rest }) => rest);
}

/** Normalise V1's raw score to roughly [0, 1] for compositing. V1 scores
 *  typically sit in the 0–25 range; we clamp + scale. */
function normaliseV1Score(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw <= 0) return 0;
  return Math.min(1, raw / 25);
}

/**
 * Budget fit:
 *   - 1.0 if the candidate's price range overlaps the buyer's range
 *   - 0.5 if the candidate has no price information (no penalty, no boost)
 *   - 0.0 if the candidate is strictly above the buyer's max
 *   - linear decay between (max, max + 50%) so over-budget candidates aren't hard-zero
 */
function budgetFitScore(c: ProductCandidate, ctx: RankerContext): number {
  if (c.priceMinMinor == null && c.priceMaxMinor == null) return 0.5;
  const min = c.priceMinMinor ?? 0;
  const max = c.priceMaxMinor ?? min;
  if (ctx.budgetMaxMinor == null && ctx.budgetMinMinor == null) return 1.0;
  if (ctx.budgetMaxMinor != null && min > ctx.budgetMaxMinor) {
    // Soft decay above budget: at 1.5× over, score is 0.
    const headroom = ctx.budgetMaxMinor * 0.5;
    if (headroom <= 0) return 0;
    const over = min - ctx.budgetMaxMinor;
    return Math.max(0, 1 - over / headroom);
  }
  if (ctx.budgetMinMinor != null && max < ctx.budgetMinMinor) {
    // Below the buyer's preferred minimum — not a hard reject; mild penalty.
    return 0.5;
  }
  return 1.0;
}

/** Tier scoring favours admin-curated entries because they're vetted. */
function sourceTierScore(tier: ProductCandidate['sourceTier']): number {
  switch (tier) {
    case 'curated':
      return 1.0;
    case 'sovrn':
      return 0.7;
    case 'llm':
      return 0.4;
    default:
      return 0;
  }
}
