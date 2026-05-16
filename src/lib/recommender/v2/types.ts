/**
 * KAN-200 / KAN-199: shared types for the V2 recommender pipeline.
 *
 * The V2 contract extends V1 (`src/lib/recommend/`): V1's RecommendationResult
 * is a concept; V2 wraps it with one or more concrete products (with URLs)
 * and the monetised affiliate output.
 */

import type { GiftCategoryKey } from '@/lib/recommend/categories';
import type { AffiliateProvider } from '@/lib/affiliate/types';

/** A concept from V1 — what the recommender thinks the recipient would like. */
export type ConceptInput = {
  /** V1's category key (e.g. "books_reading"). */
  categoryKey: GiftCategoryKey;
  /** V1's surfaced title for the concept (e.g. "A great novel"). */
  conceptTitle: string;
  /** V1's score for the concept; used as a weighted input to the V2 ranker. */
  conceptScore: number;
  /** V1's "reasons" list — short strings the rationale composer can use. */
  reasons: string[];
  /** Tags from V1's pool entry — useful for diversity + LLM context. */
  tags: readonly string[];
};

/** A specific product candidate, before ranking. */
export type ProductCandidate = {
  /** Concept this candidate resolves. */
  concept: ConceptInput;
  /** What the buyer sees. */
  title: string;
  description: string | null;
  imageUrl: string | null;
  /** The raw merchant URL — pre-monetisation. */
  rawUrl: string;
  merchantId: string;
  /** Price range in lowest currency unit (e.g. pence for GBP). Null if unknown. */
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  priceCurrency: string | null;
  /** Where this candidate came from. */
  sourceTier: 'curated' | 'sovrn' | 'llm';
  /** A rationale fragment specific to this product, composed with the concept. */
  rationaleFragment: string | null;
  /** Source-specific weight, used as a tiebreak in scoring. */
  sourceWeight: number;
};

/** A scored candidate, after the V2 ranker. */
export type ScoredCandidate = ProductCandidate & {
  /** V2 composite score. */
  score: number;
  /** Trace of each factor's contribution — useful for debugging + admin UI. */
  scoreBreakdown: {
    v1: number;
    budget: number;
    merchantEpc: number;
    shipping: number;
    diversity: number;
    sourceTier: number;
    sourceWeight: number;
  };
};

/** Final, user-facing V2 recommendation. */
export type V2Recommendation = {
  /** Inherited concept context. */
  concept: ConceptInput;
  /** Resolved product. */
  product: {
    title: string;
    description: string | null;
    imageUrl: string | null;
    merchantId: string;
    priceMinMinor: number | null;
    priceMaxMinor: number | null;
    priceCurrency: string | null;
  };
  /** Affiliate-link service output. */
  affiliate: {
    /** The URL the user clicks. ALWAYS works (raw if not monetised). */
    url: string;
    /** Internal click id; matches affiliate_clicks.click_id. */
    clickId: string;
    /** Which provider monetised the click; 'raw' = not monetised yet. */
    provider: AffiliateProvider;
    monetised: boolean;
  };
  /** Plain-English rationale string surfaced in UI + MCP. ≤ 280 chars. */
  rationale: string;
  /** V2 composite score for sort/debug. */
  score: number;
};

/** Inputs to the top-level pipeline call. */
export type PipelineRequest = {
  /** The concepts V1 produced for this profile, in descending V1 score order. */
  concepts: ConceptInput[];
  /** Buyer's country (ISO-2). Drives commission attribution + eligibility. */
  buyerCountry: string;
  /** Recipient's delivery country (ISO-2). Falls back to buyerCountry when null. */
  recipientCountry: string | null;
  /** Optional buyer-context (KAN-198). */
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
  budgetCurrency?: string | null;
  /** Where the call originated. */
  source: 'web' | 'mcp' | 'email';
  /** Anchors clicks. */
  sessionId?: string | null;
  userId?: string | null;
  recipientId?: string | null;
  /** Free-form id from upstream — joins affiliate_clicks + recommendation_events. */
  recommendationId?: string | null;
  /** Final result count cap. Default 5. */
  limit?: number;
};
