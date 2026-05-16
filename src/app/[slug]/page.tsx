import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { createClient as createSupabaseServerClient } from '@/lib/supabase-server';
import { filterItemsByVisibility } from '@/app/dashboard/profile/visibility';
import {
  isManualOfMeEmpty,
  type ManualOfMe,
} from '@/app/dashboard/profile/manual-of-me-fields';
import { getRecommendations } from '@/lib/recommend';
import RecommendationsSection from './recommendations-section';

// Create client per-request, not at module scope
function getSupabase() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

interface ProfileData {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  city: string | null;
  country: string | null;
  is_published: boolean;
  avatar_url: string | null;
}

interface ProfileItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  visibility: string;
}

interface SchoolAffiliation {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
}

interface ExternalLink {
  id: string;
  title: string;
  url: string;
  link_type: string;
}

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  const { data: profile } = await getSupabase()
    .from('profiles')
    .select('display_name, headline, bio_short')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (!profile) {
    return { title: 'Profile not found — Lyra' };
  }

  const description = profile.bio_short || profile.headline || `${profile.display_name}'s Lyra profile`;

  const siteUrl = env.siteUrl();

  return {
    title: `${profile.display_name} — Lyra`,
    description,
    alternates: {
      canonical: `${siteUrl}/${slug}`,
    },
    openGraph: {
      title: `${profile.display_name} — Lyra`,
      description,
      url: `${siteUrl}/${slug}`,
      siteName: 'Lyra',
      type: 'profile',
      locale: 'en_GB',
    },
    twitter: {
      card: 'summary',
      title: `${profile.display_name} — Lyra`,
      description,
    },
  };
}

/** KAN-154: Display helper for a single Manual of Me field on the public
 * profile. `value` is rendered as JSX text — React escapes it — and is also
 * pre-sanitised on write via sanitiseText (which strips HTML tags and
 * collapses whitespace). No dangerouslySetInnerHTML here. */
function ManualOfMeFieldDisplay({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className="text-sm text-[var(--color-ink)] leading-relaxed">
        {value}
      </p>
    </div>
  );
}

export default async function PublicProfilePage({ params }: Props) {
  const { slug } = await params;

  const { data: profile } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (!profile) {
    notFound();
  }

  const typedProfile = profile as ProfileData;

  // KAN-143 — check viewer's auth state. Authenticated viewers see
  // public + members_only items; anonymous viewers see public only.
  // We use the cookie-aware server client for the auth check, then continue
  // using the service-role client for reads so RLS-equivalent filtering is
  // done explicitly in code (existing pattern — see ProfileItem fetch).
  const cookieClient = await createSupabaseServerClient();
  const { data: { user: viewer } } = await cookieClient.auth.getUser();
  const isAuthenticated = viewer !== null;

  // Fetch ALL non-draft visibility levels we might show, then filter in
  // application code. This keeps the visibility decision in one place
  // (`filterItemsByVisibility`) shared with the unit tests.
  const allowedVisibility = isAuthenticated
    ? ['public', 'members_only']
    : ['public'];

  const { data: items } = await getSupabase()
    .from('profile_items')
    .select('*')
    .eq('profile_id', typedProfile.id)
    .in('visibility', allowedVisibility)
    .order('created_at', { ascending: true });

  // Defence in depth — apply the same filter in application code so a query
  // bug, a future schema change, or a manually-edited row can't leak a draft.
  const visibleItems = filterItemsByVisibility(
    (items || []) as ProfileItem[],
    isAuthenticated,
  );

  const { data: schools } = await getSupabase()
    .from('school_affiliations')
    .select('*')
    .eq('profile_id', typedProfile.id);

  const { data: links } = await getSupabase()
    .from('external_links')
    .select('*')
    .eq('profile_id', typedProfile.id);

  // KAN-154: Manual of Me (1-1 with profiles). Row may not exist for older
  // profiles — treat that as "all fields empty" so the section is skipped.
  const { data: manualOfMeRow } = await getSupabase()
    .from('profile_manual_of_me')
    .select('communication_style, working_preferences, energises_me, drains_me')
    .eq('profile_id', typedProfile.id)
    .maybeSingle();
  const manualOfMe = (manualOfMeRow as ManualOfMe | null) ?? null;

  // KAN-143: visibility-filtered items (see filterItemsByVisibility above).
  const typedItems = visibleItems;
  const typedSchools = (schools || []) as SchoolAffiliation[];
  const typedLinks = (links || []) as ExternalLink[];

  // KAN-139: build gift / experience recommendations from the items the
  // current viewer can see. Anonymous viewers therefore get recommendations
  // computed against the public subset only — members_only items influence
  // the engine only when a logged-in viewer is reading the profile, which
  // matches the visibility intent (private signals stay private).
  const recommendations = getRecommendations(
    {
      bio: typedProfile.bio_short,
      headline: typedProfile.headline,
      items: typedItems.map((i) => ({
        category: i.category,
        title: i.title,
        description: i.description,
      })),
    },
    { limit: 8 },
  );

  const categoryLabels: Record<string, string> = {
    likes: 'Likes',
    dislikes: 'Dislikes',
    gift_ideas: 'Gift ideas',
    gifts_to_avoid: 'Gifts to avoid',
    boundaries: 'Boundaries',
    helpful_to_know: 'Helpful to know',
    favourite_books: 'Favourite books',
    favourite_media: 'Favourite movies & series',
    causes: 'Causes I care about',
    quotes: 'Quotes I love',
    proud_of: 'What I\'m most proud of',
    life_hacks: 'Life hacks & recommendations',
    questions: 'Questions I wish people asked',
    billboard: 'My billboard',
  };

  const categoryIcons: Record<string, string> = {
    likes: '💚',
    dislikes: '💔',
    gift_ideas: '🎁',
    gifts_to_avoid: '🚫',
    boundaries: '🛑',
    helpful_to_know: '💡',
    favourite_books: '📖',
    favourite_media: '🎬',
    causes: '🌍',
    quotes: '💬',
    proud_of: '🏆',
    life_hacks: '✨',
    questions: '❓',
    billboard: '📢',
  };

  const groupedItems = typedItems.reduce((acc: Record<string, ProfileItem[]>, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  // Display order for categories
  const categoryOrder = [
    'likes', 'dislikes', 'gift_ideas', 'gifts_to_avoid', 'helpful_to_know', 'boundaries',
    'favourite_books', 'favourite_media', 'causes', 'proud_of', 'life_hacks', 'questions',
  ];
  // quotes and billboard render separately with special styling

  // JSON-LD structured data for AI consumption (Schema.org Person)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: typedProfile.display_name,
    url: `${env.siteUrl()}/${typedProfile.slug}`,
    ...(typedProfile.headline && { jobTitle: typedProfile.headline }),
    ...(typedProfile.bio_short && { description: typedProfile.bio_short }),
    ...(typedProfile.city && {
      address: {
        '@type': 'PostalAddress',
        addressLocality: typedProfile.city,
        addressCountry: typedProfile.country || 'GB',
      },
    }),
    ...(typedSchools.length > 0 && {
      alumniOf: typedSchools
        .filter((s) => s.relationship === 'alumni')
        .map((s) => ({
          '@type': 'EducationalOrganization',
          name: s.school_name,
          ...(s.school_location && { address: { '@type': 'PostalAddress', addressLocality: s.school_location } }),
        })),
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-stone-50">
      {/* Nav */}
      <nav aria-label="Profile navigation" className="border-b border-stone-200/60 bg-stone-50/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <Link
            href="/signup"
            className="text-xs font-medium px-4 py-1.5 rounded-full bg-[var(--color-sage)] text-white hover:opacity-90 transition-opacity"
          >
            Create yours
          </Link>
        </div>
      </nav>

      {/* Profile header */}
      <div className="max-w-2xl mx-auto px-6 pt-10 pb-6 text-center">
        <div className="w-20 h-20 rounded-full bg-[var(--color-sage)] mx-auto mb-4 flex items-center justify-center text-3xl text-white font-[family-name:var(--font-serif)] overflow-hidden">
          {typedProfile.avatar_url ? (
            <img src={typedProfile.avatar_url} alt={typedProfile.display_name} className="w-full h-full object-cover" />
          ) : (
            typedProfile.display_name.charAt(0).toUpperCase()
          )}
        </div>
        <h1 className="text-3xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">
          {typedProfile.display_name}
        </h1>
        {typedProfile.headline && (
          <p className="mt-2 text-[var(--color-muted)]">{typedProfile.headline}</p>
        )}
        {typedProfile.city && (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {typedProfile.city}{typedProfile.country ? `, ${typedProfile.country}` : ''}
          </p>
        )}
      </div>

      {/* Bio */}
      {typedProfile.bio_short && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <p className="text-[var(--color-ink)] leading-relaxed">{typedProfile.bio_short}</p>
          </div>
        </div>
      )}

      {/* KAN-154: Manual of Me — "How to work with me". Skip entirely if every
          field is empty. All values are pre-sanitised on write (sanitiseText
          strips HTML / normalises whitespace) AND rendered as JSX text content,
          which React auto-escapes — no dangerouslySetInnerHTML here. */}
      {!isManualOfMeEmpty(manualOfMe) && manualOfMe && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-4">
              📖 How to work with me
            </h2>
            <div className="space-y-4">
              {manualOfMe.communication_style && (
                <ManualOfMeFieldDisplay
                  label="Communication style"
                  value={manualOfMe.communication_style}
                />
              )}
              {manualOfMe.working_preferences && (
                <ManualOfMeFieldDisplay
                  label="Best ways to work with me"
                  value={manualOfMe.working_preferences}
                />
              )}
              {manualOfMe.energises_me && (
                <ManualOfMeFieldDisplay
                  label="What energises me"
                  value={manualOfMe.energises_me}
                />
              )}
              {manualOfMe.drains_me && (
                <ManualOfMeFieldDisplay
                  label="What drains me"
                  value={manualOfMe.drains_me}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Schools */}
      {typedSchools.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">🏫 Schools</h2>
            <div className="space-y-2">
              {typedSchools.map((s) => (
                <div key={s.id} className="flex items-baseline justify-between">
                  <span className="text-[var(--color-ink)] font-medium">{s.school_name}</span>
                  <span className="text-sm text-[var(--color-muted)]">{s.relationship}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Profile items by category */}
      {categoryOrder.map((cat) => {
        const catItems = groupedItems[cat];
        if (!catItems || catItems.length === 0) return null;
        return (
          <div key={cat} className="max-w-2xl mx-auto px-6 pb-6">
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">
                {categoryIcons[cat]} {categoryLabels[cat]}
              </h2>
              {cat === 'questions' ? (
                <div className="space-y-3">
                  {catItems.map((item) => (
                    <div key={item.id} className="border-l-3 border-[var(--color-sage)] bg-stone-50 rounded-r-lg pl-4 pr-4 py-3">
                      <p className="text-sm font-medium text-[var(--color-ink)]">{item.title}</p>
                      {item.description && (
                        <p className="text-sm text-[var(--color-muted)] mt-1 leading-relaxed">{item.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {catItems.map((item) => (
                    <div key={item.id} className="group relative">
                      <span className="inline-block px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-full text-sm text-[var(--color-ink)]">
                        {item.title}
                      </span>
                      {item.description && (
                        <div className="hidden group-hover:block absolute bottom-full left-0 mb-1 px-3 py-2 bg-[var(--color-ink)] text-white text-xs rounded-lg max-w-xs z-10">
                          {item.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Quotes — styled with left accent border */}
      {groupedItems['quotes'] && groupedItems['quotes'].length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">
              💬 Quotes I love
            </h2>
            <div className="space-y-3">
              {groupedItems['quotes'].map((item) => (
                <div key={item.id} className="border-l-3 border-[var(--color-sage)] pl-4 py-1">
                  <p className="text-[var(--color-ink)] italic leading-relaxed">&ldquo;{item.title}&rdquo;</p>
                  {item.description && (
                    <p className="text-sm text-[var(--color-muted)] mt-1">— {item.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Billboard — large statement at the bottom */}
      {groupedItems['billboard'] && groupedItems['billboard'].length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-[var(--color-sage)] rounded-xl p-8 text-center">
            <p className="text-xs font-medium text-white/70 uppercase tracking-wide mb-3">
              If I had a giant billboard, it would say&hellip;
            </p>
            <p className="text-xl sm:text-2xl font-[family-name:var(--font-serif)] text-white leading-relaxed">
              &ldquo;{groupedItems['billboard'][0].title}&rdquo;
            </p>
          </div>
        </div>
      )}

      {/* Links */}
      {typedLinks.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">🔗 Links</h2>
            <div className="space-y-2">
              {typedLinks.map((l) => (
                <a
                  key={l.id}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-stone-50 transition-colors group"
                >
                  <span className="text-[var(--color-ink)] group-hover:text-[var(--color-sage)]">{l.title}</span>
                  <span className="text-xs text-[var(--color-muted)]">↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KAN-139: gift recommendations based on profile data */}
      <div className="max-w-2xl mx-auto px-6">
        <RecommendationsSection
          displayName={typedProfile.display_name}
          recommendations={recommendations}
        />
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-6 py-8 text-center">
        <p className="text-sm text-[var(--color-muted)]">
          This is a <Link href="/" className="text-[var(--color-sage)] hover:underline">Lyra</Link> profile
        </p>
      </div>
    </main>
    </>
  );
}
