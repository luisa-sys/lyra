/**
 * KAN-200: GET /api/recommendations/v2/[slug]
 *
 * V2 of the recommendation endpoint — returns monetisable product
 * recommendations (when Sovrn is live) or working-but-un-monetised raw
 * URLs (current state, pending KAN-184). V1 endpoint at
 * /api/recommendations/[slug] keeps working untouched and remains the
 * stable contract for the public profile render until V2 is promoted.
 *
 * Response shape:
 *
 *   {
 *     "slug": "luisa",
 *     "displayName": "Luisa",
 *     "version": "v2",
 *     "buyerCountry": "GB",
 *     "recipientCountry": "GB",
 *     "recommendations": [
 *       {
 *         "concept": { categoryKey, conceptTitle, ... },
 *         "product": { title, description, url, image, merchantId, price... },
 *         "affiliate": { url, clickId, provider, monetised },
 *         "rationale": "Because Anna mentioned books...",
 *         "score": 0.78
 *       },
 *       ...
 *     ]
 *   }
 *
 * Read-only, no auth. The underlying profile data is already public.
 *
 * Buyer country detection (per docs/GEO_SIGNAL_DESIGN.md, KAN-185):
 *   1. ?buyer_country=XX query param (highest priority — explicit caller override)
 *   2. Cloudflare CF-IPCountry request header
 *   3. GB fallback
 *
 * Recipient country: from profiles.delivery_country_code (KAN-186); falls
 * back to buyer country if NULL.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { getRecommendations } from '@/lib/recommend';
import { buildV2Recommendations } from '@/lib/recommender/v2/pipeline';
import type { ConceptInput } from '@/lib/recommender/v2/types';
import {
  normaliseDeliveryCountry,
  isIsoAlpha2,
} from '@/lib/affiliate/country-codes';

interface ProfileRow {
  id: string;
  display_name: string;
  bio_short: string | null;
  headline: string | null;
  is_published: boolean;
  delivery_country_code: string | null;
}

interface ItemRow {
  category: string;
  title: string;
  description: string | null;
}

function getServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

/**
 * Pull buyer country from query / Cloudflare / fallback. Per KAN-185.
 */
function resolveBuyerCountry(request: Request): string {
  const url = new URL(request.url);
  const override = url.searchParams.get('buyer_country');
  if (override) {
    const up = override.toUpperCase();
    if (isIsoAlpha2(up)) return up;
  }
  const cf = request.headers.get('cf-ipcountry');
  if (cf && isIsoAlpha2(cf.toUpperCase())) return cf.toUpperCase();
  return 'GB';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '5') || 5, 1), 20);

  const supabase = getServiceClient();

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name, bio_short, headline, is_published, delivery_country_code')
    .eq('slug', slug)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!profile || !profile.is_published) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: items, error: itemsError } = await supabase
    .from('profile_items')
    .select('category, title, description')
    .eq('profile_id', profile.id)
    .eq('visibility', 'public');

  if (itemsError) {
    return NextResponse.json({ error: 'items_lookup_failed' }, { status: 500 });
  }

  // 1. V1 concepts — re-use the existing concept layer.
  const v1Input = {
    bio: profile.bio_short,
    headline: profile.headline,
    items: (items ?? []) as ItemRow[],
  };
  const v1Concepts = getRecommendations(v1Input, { limit: 15 });

  // Map V1 concepts to V2 concept inputs.
  const concepts: ConceptInput[] = v1Concepts.map((r) => ({
    categoryKey: r.categoryKey,
    conceptTitle: r.title,
    conceptScore: r.score,
    reasons: r.reasons,
    tags: r.tags,
  }));

  // 2. Geo.
  const buyerCountry = resolveBuyerCountry(request);
  const recipientCountry = normaliseDeliveryCountry(profile.delivery_country_code) ?? buyerCountry;

  // 3. Optional buyer-context (occasion / budget) via query params.
  const budgetMinMinor = parseIntegerParam(url.searchParams.get('budget_min'));
  const budgetMaxMinor = parseIntegerParam(url.searchParams.get('budget_max'));

  // 4. Build V2 recommendations.
  const result = await buildV2Recommendations({
    concepts,
    buyerCountry,
    recipientCountry,
    budgetMinMinor,
    budgetMaxMinor,
    source: 'web',
    sessionId: request.headers.get('x-session-id') ?? null,
    userId: null,
    recipientId: profile.id,
    recommendationId: `rec-v2-${profile.id}-${Date.now()}`,
    limit,
  });

  return NextResponse.json(
    {
      slug,
      displayName: profile.display_name,
      version: 'v2',
      buyerCountry,
      recipientCountry,
      recommendations: result.recommendations,
      // The recommender's evergreen fallback (KAN-recommender) substitutes
      // safe-default concepts when the buyer's own concepts produce zero
      // candidates. Surfaced here so clients (web cards, MCP) can soften
      // the heading or label the cards appropriately.
      meta: {
        conceptsConsidered: concepts.length,
        sovrnLive: !!process.env.SOVRN_API_KEY,
        fellBackToEvergreen: result.fellBackToEvergreen,
      },
    },
    {
      // Shorter cache than V1 — V2 results depend on more inputs (buyer
      // country, budget) so per-URL cache value is lower.
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    },
  );
}

function parseIntegerParam(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}
