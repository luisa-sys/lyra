import type { MetadataRoute } from 'next';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { env } from '@/lib/env';

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
      .from('profiles')
      .select('slug, updated_at')
      .eq('is_published', true)
      // SEC-100: the sitemap is built with the SERVICE-ROLE client, which
      // bypasses RLS — the `is_published = true AND is_suspended = false`
      // policy on `profiles` does NOT apply here. Without this filter a
      // suspended (moderated / taken-down) member's slug was still published
      // to search engines for crawling. Identical mechanism to SEC-44.
      // Guarded by scripts/check-suspension-guard-coverage.py.
      .eq('is_suspended', false);

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
