import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import * as Sentry from '@sentry/nextjs';
import { createServiceRoleClient } from '@/lib/supabase-service';
import { sanitiseSearchTerm } from '@/lib/sanitise';

function getSupabase() {
  return createServiceRoleClient();
}

export const metadata: Metadata = {
  title: 'Find someone — Lyra',
  description: 'Search for people on Lyra. Find their preferences, gift ideas, and boundaries.',
};

/** KAN-450: ceiling on the profile ids a school/organisation match may contribute. */
const AFFILIATION_MATCH_LIMIT = 100;

/**
 * KAN-450, following the KAN-351 handling at `src/app/[slug]/page.tsx`: a
 * dropped `error` renders a failed read as a clean "0 profiles found", which is
 * indistinguishable from a genuine empty result and alerts nobody. Capture
 * every failure to Sentry for observability, then fail loudly rather than serve
 * a partial read as if it were complete. These are plain reads (no `.single()`),
 * so an error means a genuine read failure — never "no rows matched".
 *
 * The search term is deliberately NOT sent to Sentry: it is unauthenticated
 * user input and routinely names a third party.
 */
function assertSearchReadsSucceeded(
  results: readonly (readonly [label: string, error: unknown])[],
): void {
  const failed = results.filter((entry) => entry[1] != null);
  if (failed.length === 0) return;

  for (const [label, error] of failed) {
    Sentry.captureException(error, { tags: { area: 'public-search', read: label } });
  }
  throw new Error(`Search reads failed for ${failed.map(([label]) => label).join(', ')}`);
}

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
      className="block bg-white rounded-xl border border-[var(--color-border)] p-5 hover:shadow-sm hover:border-[var(--color-border)] transition-all group"
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
  // SEC-09 (TDD 2026-06-21): strip PostgREST filter metacharacters before
  // interpolating the term into .or(). `query` is kept raw only for display.
  const safeQuery = sanitiseSearchTerm(query);

  let profiles: SearchProfile[] = [];

  if (safeQuery) {
    const supabase = getSupabase();
    const pattern = `%${safeQuery}%`;

    // KAN-450 step 1: which profiles carry a matching school or organisation.
    // An affiliation is HIDDEN unless its owner has explicitly opted it in —
    // `show_on_profile` is NOT NULL DEFAULT false (migration
    // 20260617120100_affiliation_show_on_profile.sql), so the majority of rows
    // in this table are private. The flag is filtered HERE, in the query, so no
    // code below this point can ever hold a hidden affiliation's profile id.
    const affiliationsRes = await supabase
      .from('school_affiliations')
      .select('profile_id')
      .eq('show_on_profile', true)
      .in('affiliation_type', ['school', 'organisation'])
      .ilike('school_name', pattern)
      // A LIMIT without an ORDER BY lets Postgres return an arbitrary subset,
      // so once the cap below binds, two identical searches can surface two
      // different sets of people. Order by (profile_id, id) — total, because
      // `id` is the primary key — so the truncation is stable and reproducible.
      .order('profile_id')
      .order('id')
      // A common school name can match thousands of rows; cap the id list so it
      // stays well inside PostgREST's request-line limit on the read below.
      .limit(AFFILIATION_MATCH_LIMIT);

    assertSearchReadsSucceeded([['school_affiliations', affiliationsRes.error]]);

    const affiliationIds = Array.from(
      new Set(
        ((affiliationsRes.data || []) as { profile_id: string }[]).map((row) => row.profile_id),
      ),
    );

    // KAN-450 step 2: the name/headline/city/slug match and the affiliation
    // match are two reads over `profiles`, unioned below. Both start from
    // publicProfiles() so neither can drift and lose a guard on its own.
    const publicProfiles = () =>
      supabase
        .from('profiles')
        .select('id, display_name, slug, headline, city, country, avatar_url')
        .eq('is_published', true)
        // SEC-100: this page reads through the SERVICE-ROLE client, which bypasses
        // RLS — so the `is_published = true AND is_suspended = false` policy on
        // `profiles` does NOT apply here. Without this filter a suspended (i.e.
        // moderated / taken-down) member stayed fully discoverable in public
        // search. Identical mechanism to SEC-44, which fixed only /[slug].
        // Guarded by scripts/check-suspension-guard-coverage.py.
        .eq('is_suspended', false)
        .eq('is_homepage_example', false); // KAN-334: curated demo profiles never appear in real member discovery

    const [byField, byAffiliation] = await Promise.all([
      publicProfiles()
        .or(`display_name.ilike.${pattern},headline.ilike.${pattern},city.ilike.${pattern},slug.ilike.${pattern}`)
        .order('display_name')
        .limit(30),
      affiliationIds.length > 0
        ? publicProfiles().in('id', affiliationIds).order('display_name').limit(30)
        : null,
    ]);

    assertSearchReadsSucceeded([
      ['profiles:by-field', byField.error],
      ['profiles:by-affiliation', byAffiliation?.error ?? null],
    ]);

    // What the union does and does not guarantee. The name/headline/city/slug
    // read is ordered by display_name, so the alphabetically-first 30 of THAT
    // branch are always here. The affiliation branch carries no equivalent
    // guarantee: when AFFILIATION_MATCH_LIMIT binds, its ids are the first 100
    // by (profile_id, id) — stable and reproducible, but unrelated to
    // display_name — so an affiliation match whose name sorts early can still
    // fall outside the cap. The result is deterministic, not exhaustive.
    const merged = new Map<string, SearchProfile>();
    for (const row of [...(byField.data || []), ...(byAffiliation?.data || [])] as SearchProfile[]) {
      merged.set(row.id, row);
    }

    profiles = Array.from(merged.values())
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .slice(0, 30);
  }

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      {/* Nav */}
      <nav aria-label="Search navigation" className="border-b border-[var(--color-border)]/60 bg-[var(--color-paper)]/80 backdrop-blur-md">
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
          Search by name, school or organisation.
        </p>

        {/* Search form */}
        <form method="GET" action="/search" className="mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Name, school or organisation..."
              autoComplete="off"
              className="flex-1 px-4 py-3 rounded-xl border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
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
              Try a different name, school or organisation.
            </p>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">👤</p>
            <h3 className="text-lg font-medium text-[var(--color-ink)] mb-2">Search for someone</h3>
            <p className="text-sm text-[var(--color-muted)]">
              Enter a name, school or organisation to find someone on Lyra.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
