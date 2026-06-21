/**
 * KAN-139: GET /api/recommendations/[slug]
 *
 * Returns ranked gift / experience recommendations for a published
 * profile. Read-only, no auth — the underlying profile data is already
 * public (`is_published = true`). Members-only items are NOT considered
 * here because the request is unauthenticated; if a future use-case
 * needs auth'd-viewer recommendations the route can accept a cookie
 * session and switch to the cookie-aware client.
 *
 * Response shape:
 *
 *   {
 *     "slug": "luisa",
 *     "displayName": "Luisa",
 *     "recommendations": [
 *       { "title": "...", "description": "...", "category": "Experiences",
 *         "categoryKey": "experiences", "score": 12.4,
 *         "reasons": ["..."], "tags": ["..."] },
 *       ...
 *     ],
 *     "insights": {
 *       "dietary": [...], "values": [...], "topInterests": [...],
 *       "avoidThemes": [...], "preferredCategories": [...]
 *     }
 *   }
 *
 * Returns 404 if the slug doesn't match a published profile.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { getRecommendations, getProfileInsights } from '@/lib/recommend';

interface ProfileRow {
  id: string;
  display_name: string;
  bio_short: string | null;
  headline: string | null;
  is_published: boolean;
  is_suspended?: boolean | null;
}

interface ItemRow {
  category: string;
  title: string;
  description: string | null;
}

function getServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '8') || 8, 1), 30);

  const supabase = getServiceClient();

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name, bio_short, headline, is_published')
    .eq('slug', slug)
    .eq('is_suspended', false) // SEC-19/F-13: suspended profiles must not return recommendations
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

  const recInput = {
    bio: profile.bio_short,
    headline: profile.headline,
    items: (items ?? []) as ItemRow[],
  };

  const recommendations = getRecommendations(recInput, { limit });
  const insights = getProfileInsights(recInput);

  return NextResponse.json(
    {
      slug,
      displayName: profile.display_name,
      recommendations,
      insights,
    },
    {
      // Caches well — the underlying data only changes when the user
      // updates their profile. 5-minute SWR balances freshness against
      // load. Anyone hitting this URL more often is almost certainly
      // automation; the cache will keep them off the DB.
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
      },
    },
  );
}
