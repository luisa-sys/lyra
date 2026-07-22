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
      .eq('is_published', true);

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
