import type { MetadataRoute } from 'next';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import { env } from '@/modules/platform/env';

/**
 * SEC-130 — render on every request, never at build time.
 *
 * This route reads no dynamic API (no `cookies()`, no `headers()`, no
 * `searchParams`), so Next PRERENDERS it during the build and then serves that
 * one snapshot until the next deploy. The profile list is therefore frozen at
 * build time, and suspending a member does not remove their slug from
 * `/sitemap.xml` — it stays advertised to crawlers for however long it is until
 * someone happens to deploy. Measured on dev: the member's profile page 404s
 * immediately and they leave `/search` immediately, yet `/sitemap.xml` still
 * listed them (`x-vercel-cache: HIT`, and a cache-buster did not dislodge it).
 *
 * That defeats the stated purpose of SEC-100. Suspension is how moderation and
 * takedown are enforced on a service holding minors' personal data, and a
 * takedown whose propagation is bounded only by the release cadence is not a
 * takedown. SEC-104 fixed WHAT the query filters; this fixes WHEN it runs, and
 * the two are independent — the view is correct and was already being read, but
 * a correct query executed once at build time is still a stale answer.
 *
 * `force-dynamic` + `revalidate = 0` is the idiom already used for the
 * freshness-critical routes in this repo (`src/app/status/page.tsx`,
 * `src/app/api/health/route.ts`). A bounded `revalidate` was considered and
 * rejected: it would trade an unbounded staleness window for a merely smaller
 * one, and there is no load argument for the trade — production has 27
 * published profiles, so this is one small indexed read on a route search
 * engines fetch a handful of times a day. If crawl volume ever makes that
 * untrue, a bounded `revalidate` is the knob to reach for, not a return to
 * build-time caching.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.siteUrl();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/privacy`, lastModified: new Date('2026-03-27'), changeFrequency: 'monthly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date('2026-03-27'), changeFrequency: 'monthly', priority: 0.3 },
  ];

  // Dynamic profile pages
  let profilePages: MetadataRoute.Sitemap = [];
  try {
    const supabase = createServiceRoleClient();

    const { data: profiles } = await supabase
      // SEC-104: reads the `public_profiles` VIEW, not the table. The sitemap
      // is built with the SERVICE-ROLE client, which bypasses RLS — so the
      // policy on `profiles` never applied here, and a suspended member's slug
      // was published to search engines for crawling (SEC-100, same mechanism
      // as SEC-44). The view carries `is_published = true AND is_suspended =
      // false` in its body, and a view's WHERE binds service_role.
      .from('public_profiles')
      .select('slug, updated_at');

    profilePages = (profiles || []).map((profile) => ({
      url: `${baseUrl}/${profile.slug}`,
      lastModified: new Date(profile.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  } catch {
    // If Supabase is unavailable, return static pages only
  }

  return [...staticPages, ...profilePages];
}
