import type { MetadataRoute } from 'next';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import { env } from '@/modules/platform/env';

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
