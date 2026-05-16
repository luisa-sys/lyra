/**
 * KAN-200: V2 candidate sourcing — turns each concept from V1 into N real
 * product candidates that the ranker can score.
 *
 * Three-tier waterfall (per docs/RECOMMENDATION_ENGINE_DESIGN.md):
 *   1. Curated catalogue (admin-managed; works without Sovrn) ← LIVE NOW
 *   2. Sovrn Product API ← stubbed until KAN-184 lands SOVRN_API_KEY
 *   3. LLM fallback (Claude) ← stubbed until ANTHROPIC_API_KEY is wired
 *
 * Tiers are tried in order per concept. Tier 1 wins on match; Tier 2 fills
 * the gap; Tier 3 is the last-resort safety net. We try Tier 2 + Tier 3 in
 * parallel for the same concept (when both are available) because the
 * latency budget is tight — but at MVP only Tier 1 returns data.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { ConceptInput, ProductCandidate } from './types';

/** Service-role client — bypasses RLS for fast reads. */
function getServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

type CatalogueRow = {
  catalogue_id: string;
  concept_category: string;
  concept_keywords: string[] | null;
  title: string;
  description: string | null;
  image_url: string | null;
  raw_url: string;
  merchant_id: string;
  price_min_minor: number | null;
  price_max_minor: number | null;
  price_currency: string | null;
  buyer_countries: string[] | null;
  is_active: boolean;
  rationale_fragment: string | null;
  weight: number;
};

export type SourcingOptions = {
  /** Cap on candidates per concept. Default 5. */
  perConceptLimit?: number;
  /** Buyer country (ISO-2). Filters catalogue entries by buyer_countries. */
  buyerCountry: string;
  /** Optional budget guard rails — drop catalogue entries outside the range. */
  budgetMinMinor?: number | null;
  budgetMaxMinor?: number | null;
};

/**
 * Source candidates for a single concept. MVP implementation hits only Tier 1.
 * The shape is async + Promise-returning so we can drop in Tier 2/3 later
 * without changing the caller's signature.
 */
export async function sourceCandidatesForConcept(
  concept: ConceptInput,
  opts: SourcingOptions,
): Promise<ProductCandidate[]> {
  const tier1 = await sourceFromCatalogue(concept, opts);
  if (tier1.length >= (opts.perConceptLimit ?? 5)) {
    return tier1;
  }
  const tier2 = await sourceFromSovrn(concept, opts);
  const tier3 = tier1.length + tier2.length === 0
    ? await sourceFromLlm(concept, opts)
    : [];
  return [...tier1, ...tier2, ...tier3].slice(0, opts.perConceptLimit ?? 5);
}

/**
 * Top-level entry — source candidates for many concepts in parallel.
 * Each concept's sourcing is independent so we parallelise.
 */
export async function sourceCandidatesForConcepts(
  concepts: ConceptInput[],
  opts: SourcingOptions,
): Promise<ProductCandidate[]> {
  const perConcept = await Promise.all(
    concepts.map((c) => sourceCandidatesForConcept(c, opts)),
  );
  return perConcept.flat();
}

// ---------------------------------------------------------------------------
// Tier 1 — curated catalogue
// ---------------------------------------------------------------------------

async function sourceFromCatalogue(
  concept: ConceptInput,
  opts: SourcingOptions,
): Promise<ProductCandidate[]> {
  const supabase = getServiceClient();
  // Pre-filter by category + active flag. Country and budget are applied
  // client-side because Postgres array containment + null-or-membership
  // makes the SQL noisy and the catalogue is small.
  const { data, error } = await supabase
    .from('recommender_catalogue')
    .select('*')
    .eq('concept_category', concept.categoryKey)
    .eq('is_active', true)
    .order('weight', { ascending: false })
    .limit(20);

  if (error || !data) return [];

  const rows = data as CatalogueRow[];
  return rows
    .filter((row) => matchesBuyerCountry(row, opts.buyerCountry))
    .filter((row) => matchesBudget(row, opts.budgetMinMinor, opts.budgetMaxMinor))
    .slice(0, opts.perConceptLimit ?? 5)
    .map<ProductCandidate>((row) => ({
      concept,
      title: row.title,
      description: row.description,
      imageUrl: row.image_url,
      rawUrl: row.raw_url,
      merchantId: row.merchant_id,
      priceMinMinor: row.price_min_minor,
      priceMaxMinor: row.price_max_minor,
      priceCurrency: row.price_currency,
      sourceTier: 'curated',
      rationaleFragment: row.rationale_fragment,
      sourceWeight: row.weight,
    }));
}

function matchesBuyerCountry(row: CatalogueRow, buyer: string): boolean {
  // null means "available globally"
  if (!row.buyer_countries || row.buyer_countries.length === 0) return true;
  return row.buyer_countries.includes(buyer);
}

function matchesBudget(
  row: CatalogueRow,
  budgetMin: number | null | undefined,
  budgetMax: number | null | undefined,
): boolean {
  // Reject the row only if the buyer set a budget and the catalogue range
  // explicitly excludes it. Missing budget on either side means "no filter".
  if (budgetMax != null && row.price_min_minor != null && row.price_min_minor > budgetMax) {
    return false;
  }
  if (budgetMin != null && row.price_max_minor != null && row.price_max_minor < budgetMin) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Tier 2 — Sovrn Product API (stubbed)
// ---------------------------------------------------------------------------

async function sourceFromSovrn(
  // Unused parameters until SOVRN_API_KEY lands — keep the signature so the
  // future implementation slots in cleanly.
  _concept: ConceptInput,
  _opts: SourcingOptions,
): Promise<ProductCandidate[]> {
  if (!process.env.SOVRN_API_KEY) return [];
  // TODO(KAN-184): real Sovrn Product API call. See the design doc for the
  // expected request/response shape. Hard timeout of 500ms per concept.
  return [];
}

// ---------------------------------------------------------------------------
// Tier 3 — LLM fallback (stubbed)
// ---------------------------------------------------------------------------

async function sourceFromLlm(
  _concept: ConceptInput,
  _opts: SourcingOptions,
): Promise<ProductCandidate[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  // TODO(future ticket): Claude structured-output call with the prompt-
  // injection defences from docs/RECOMMENDATION_ENGINE_DESIGN.md.
  return [];
}
