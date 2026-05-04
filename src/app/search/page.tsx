import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { env } from '@/lib/env';

function getSupabase() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

export const metadata: Metadata = {
  title: 'Find someone — Lyra',
  description: 'Search for people on Lyra. Find their preferences, gift ideas, and boundaries.',
};

interface SearchProfile {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  city: string | null;
  country: string | null;
  avatar_url: string | null;
}

function ProfileCard({ profile }: { profile: SearchProfile }) {
  return (
    <Link
      href={`/${profile.slug}`}
      className="block bg-white rounded-xl border border-stone-200 p-5 hover:shadow-sm hover:border-stone-300 transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-[var(--color-sage)] flex items-center justify-center text-lg text-white font-[family-name:var(--font-serif)] shrink-0 overflow-hidden">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.display_name} className="w-full h-full object-cover" />
          ) : (
            profile.display_name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-medium text-[var(--color-ink)] group-hover:text-[var(--color-sage)] transition-colors truncate">
            {profile.display_name}
          </h3>
          {profile.headline && (
            <p className="text-sm text-[var(--color-muted)] mt-0.5 line-clamp-2">{profile.headline}</p>
          )}
          {profile.city && (
            <p className="text-xs text-[var(--color-muted)] mt-1">
              {profile.city}{profile.country ? `, ${profile.country}` : ''}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q || '').trim();

  let profiles: SearchProfile[] = [];

  if (query) {
    const supabase = getSupabase();
    const pattern = `%${query}%`;
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, slug, headline, city, country, avatar_url')
      .eq('is_published', true)
      .or(`display_name.ilike.${pattern},headline.ilike.${pattern},city.ilike.${pattern},slug.ilike.${pattern}`)
      .order('display_name')
      .limit(30);

    profiles = (data || []) as SearchProfile[];
  }

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Nav */}
      <nav aria-label="Search navigation" className="border-b border-stone-200/60 bg-stone-50/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" priority />
          </Link>
          <Link
            href="/signup"
            className="text-xs font-medium px-4 py-1.5 rounded-full bg-[var(--color-sage)] text-white hover:opacity-90 transition-opacity"
          >
            Create yours
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-10 pb-16">
        <h1 className="text-3xl font-[family-name:var(--font-serif)] text-[var(--color-ink)] mb-2">
          Find someone
        </h1>
        <p className="text-[var(--color-muted)] mb-8">
          Search by name, location, or headline.
        </p>

        {/* Search form */}
        <form method="GET" action="/search" className="mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Search by name..."
              autoComplete="off"
              className="flex-1 px-4 py-3 rounded-xl border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
            />
            <button
              type="submit"
              className="px-6 py-3 rounded-xl bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Search
            </button>
          </div>
        </form>

        {/* Results */}
        {query && (
          <p className="text-sm text-[var(--color-muted)] mb-4">
            {profiles.length} profile{profiles.length !== 1 ? 's' : ''} found
            {query ? ` for "${query}"` : ''}
          </p>
        )}

        {profiles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {profiles.map((p) => (
              <ProfileCard key={p.id} profile={p} />
            ))}
          </div>
        ) : query ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">🔍</p>
            <h3 className="text-lg font-medium text-[var(--color-ink)] mb-2">No profiles found</h3>
            <p className="text-sm text-[var(--color-muted)]">
              Try a different name or broader search term.
            </p>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">👤</p>
            <h3 className="text-lg font-medium text-[var(--color-ink)] mb-2">Search for someone</h3>
            <p className="text-sm text-[var(--color-muted)]">
              Enter a name to find profiles on Lyra.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
