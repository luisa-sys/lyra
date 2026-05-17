import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { createClient as createSupabaseServerClient } from '@/lib/supabase-server';
// KAN-234: replaced `filterItemsByVisibility` (KAN-143) with the
// hybrid-visibility filter from `section-visibility.ts`. The new helper
// resolves item.visibility against the section default before applying
// the anonymous/authenticated test. The KAN-143 helper is still exported
// (other modules and the unit suite use it directly) but isn't needed
// here any more.
import {
  coerceSectionVisibility,
  isItemVisibleUnderHybridModel,
} from '@/app/dashboard/profile/section-visibility';
import {
  isManualOfMeEmpty,
  type ManualOfMe,
} from '@/app/dashboard/profile/manual-of-me-fields';
import { getRecommendations } from '@/lib/recommend';
import RecommendationsSection from './recommendations-section';
import V2RecommendationsSection from './v2-recommendations-section';
import ReportButton from './report-button';
import { headers } from 'next/headers';
import { isIsoAlpha2, normaliseDeliveryCountry } from '@/lib/affiliate/country-codes';
import { buildV2Recommendations } from '@/lib/recommender/v2/pipeline';
import type { ConceptInput } from '@/lib/recommender/v2/types';

/**
 * BUGS-14: profile pages render dynamically per-request.
 *
 * Two reasons:
 *
 *  1. The page reads the viewer's session cookie via
 *     `createSupabaseServerClient()` (for the KAN-143 members-only
 *     visibility decision). Cookie reads are inherently per-request,
 *     so this page can never be statically pre-rendered — `force-dynamic`
 *     just makes the contract explicit and stops Next.js trying to
 *     optimise it.
 *
 *  2. With `force-dynamic`, the `notFound()` throw resolves to an
 *     HTTP 404 response status instead of the streaming-SSR-default
 *     200 + in-band marker. SEO crawlers and link-checkers will now
 *     see typo'd slugs as the real 404s they are.
 *
 * No measurable cost: every profile request already pays for a Supabase
 * round-trip (profile lookup + items + manual-of-me + links + schools)
 * plus a cookie read for the viewer's auth state. There was no ISR to
 * lose. Verified by checking that `vercel-cdn-cache-control: PRIVATE`
 * is already set on prod profile responses.
 */
export const dynamic = 'force-dynamic';

// Create client per-request, not at module scope
function getSupabase() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

interface ProfileData {
  id: string;
  user_id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  city: string | null;
  country: string | null;
  is_published: boolean;
  avatar_url: string | null;
  // KAN-234 / KAN-221: hybrid visibility — per-section defaults that items
  // inherit when their own `visibility` is NULL. Already selected by the
  // `*` query above; coerced via `coerceSectionVisibility` before use.
  section_visibility: Record<string, string> | null;
}

interface ProfileItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  // KAN-219 — optional URL on items (Python `lyra-app` parity). Already
  // selected by the `*` query; surfaced in the chip + Q&A rendering as a
  // clickable link when present.
  url: string | null;
  // KAN-234: nullable to allow "inherit from section default". When NULL,
  // effective visibility comes from `profile.section_visibility[sectionKey]`
  // — see `isItemVisibleUnderHybridModel`.
  visibility: string | null;
}

interface SchoolAffiliation {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
  // KAN-220: one of school|organisation|community (column added by
  // migration 20260517010000_affiliation_type.sql). Older rows from
  // before the migration default to 'school' at the DB level.
  affiliation_type: string;
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

  // KAN-234: with hybrid visibility, items with NULL `visibility` must
  // ALSO be considered (they inherit from the section default — which
  // could be 'public', 'members_only', or 'draft'). The previous
  // `.in('visibility', ['public', 'members_only'])` query filter would
  // wrongly exclude every NULL row, hiding inherited items. Fetch all,
  // filter in application code via the hybrid helper. Per-profile item
  // counts are bounded (low hundreds at most), so the extra rows are
  // negligible.
  //
  // The non-item resources (profile_files, conversation_starters, etc.)
  // still use the KAN-143 explicit-visibility query filter because they
  // don't participate in the hybrid model.
  const allowedVisibility = isAuthenticated
    ? ['public', 'members_only']
    : ['public'];

  const { data: items } = await getSupabase()
    .from('profile_items')
    .select('*')
    .eq('profile_id', typedProfile.id)
    .order('created_at', { ascending: true });

  // KAN-234: defence in depth — application-side filter using the hybrid
  // visibility model. `coerceSectionVisibility` drops unknown keys/values
  // before we use the map, so a malformed JSONB cell can't leak items.
  const sectionVisibility = coerceSectionVisibility(typedProfile.section_visibility);
  const visibleItems = ((items || []) as ProfileItem[]).filter((item) =>
    isItemVisibleUnderHybridModel(item, sectionVisibility, isAuthenticated),
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

  // KAN-142: profile files (images + PDFs). Filter to public-only for
  // anonymous viewers, public+members_only for authenticated. Same
  // visibility model as profile_items (KAN-143).
  const { data: filesRaw } = await getSupabase()
    .from('profile_files')
    .select('id, storage_path, file_name, mime_type, size_bytes, visibility')
    .eq('profile_id', typedProfile.id)
    .in('visibility', allowedVisibility)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const typedFiles = (filesRaw ?? []).filter((f) =>
    isAuthenticated
      ? f.visibility === 'public' || f.visibility === 'members_only'
      : f.visibility === 'public',
  );

  // KAN-181: conversation-starter answers (joined with the prompt text
  // so the public profile can render the prompt as a heading). No
  // visibility filter — all answers on a published profile are public.
  const { data: starterRowsRaw } = await getSupabase()
    .from('profile_conversation_starters')
    .select('id, answer, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(prompt, sort_order)')
    .eq('profile_id', typedProfile.id)
    .order('created_at', { ascending: true });
  const typedStarters = (starterRowsRaw ?? []).map((r) => {
    // Supabase typegen sometimes flattens the joined row to object,
    // sometimes array — see same pattern in dashboard/profile/page.tsx.
    const promptCandidate = r.prompt as unknown;
    const joined = Array.isArray(promptCandidate)
      ? (promptCandidate[0] as { prompt: string; sort_order: number } | undefined)
      : (promptCandidate as { prompt: string; sort_order: number } | null);
    return {
      id: r.id as string,
      answer: r.answer as string,
      prompt: joined?.prompt ?? '',
      sort_order: joined?.sort_order ?? 0,
    };
  })
  // Curated prompts are sorted by sort_order in the seed data; preserve
  // that on the public render so the most "warm-up" prompts come first.
  .sort((a, b) => a.sort_order - b.sort_order);

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

  // KAN-191 / KAN-200: V2 pipeline — turn V1's concepts into real
  // monetisable product recommendations. Buyer country is detected from
  // Cloudflare's CF-IPCountry header (KAN-185 geo design); recipient
  // delivery country comes off the profile (KAN-186). The Affiliate Link
  // Service (KAN-188) caches per-URL so repeat profile views don't hammer
  // Sovrn. When Sovrn isn't configured (current state), buildV2
  // recommendations returns curated-catalogue entries with un-monetised
  // raw URLs and the Affiliate badge reflects that honestly.
  //
  // We compute V2 unconditionally and let the rendering decide which
  // section to show — if V2 returns 0 items (sparse profile + nothing in
  // the curated catalogue) the page falls back to the V1 section so
  // sparse profiles aren't left empty.
  const requestHeaders = await headers();
  const buyerCountryHeader = requestHeaders.get('cf-ipcountry') ?? '';
  const buyerCountry = isIsoAlpha2(buyerCountryHeader.toUpperCase())
    ? buyerCountryHeader.toUpperCase()
    : 'GB';
  // delivery_country_code is added by KAN-186 (PR #203); the column is
  // accessed defensively because that PR may not be in develop yet when
  // this lands.
  const recipientCountryRaw =
    (typedProfile as { delivery_country_code?: string | null }).delivery_country_code ?? null;
  const recipientCountry = normaliseDeliveryCountry(recipientCountryRaw) ?? buyerCountry;

  const v2Concepts: ConceptInput[] = recommendations.map((r) => ({
    categoryKey: r.categoryKey,
    conceptTitle: r.title,
    conceptScore: r.score,
    reasons: r.reasons,
    tags: r.tags,
  }));

  const v2Recommendations = await buildV2Recommendations({
    concepts: v2Concepts,
    buyerCountry,
    recipientCountry,
    source: 'web',
    sessionId: null,
    userId: viewer?.id ?? null,
    recipientId: typedProfile.id,
    // recommendationId is intentionally stable per profile, not
    // per-request: react-compiler rejects Date.now() during render
    // ("impure function"). The link service's click_id gives us
    // per-click uniqueness; recommendationId just groups clicks under
    // the same render context.
    recommendationId: `web-${typedProfile.id}`,
    limit: 5,
  });

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
    // KAN-182: current projects / challenges the user is working on.
    // Networking + collaboration hook — "I'm trying to find a local
    // children's-book illustrator" is more useful than "I like books".
    current_problems: 'What I\'m working on right now',
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
    current_problems: '🧩',
  };

  const groupedItems = typedItems.reduce((acc: Record<string, ProfileItem[]>, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  // Display order for categories.
  // KAN-182: `current_problems` placed early — it's a strong networking
  // hook ("looking for an illustrator") that should land before the
  // softer signals like favourite books or life hacks.
  const categoryOrder = [
    'likes', 'dislikes', 'gift_ideas', 'gifts_to_avoid', 'helpful_to_know', 'boundaries',
    'current_problems', 'favourite_books', 'favourite_media', 'causes', 'proud_of', 'life_hacks', 'questions',
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

      {/* KAN-220: Schools / Organisations / Communities — three groups
          rendered from one table (`school_affiliations`). Older rows
          default to 'school' at the DB level, so a profile that pre-dates
          the migration still renders correctly under the Schools heading. */}
      {typedSchools.length > 0 && (() => {
        const groups: Array<{ key: string; label: string; icon: string }> = [
          { key: 'school', label: 'Schools', icon: '🏫' },
          { key: 'organisation', label: 'Organisations', icon: '🏢' },
          { key: 'community', label: 'Communities', icon: '👥' },
        ];
        const byType = groups.map((g) => ({
          ...g,
          items: typedSchools.filter((s) => (s.affiliation_type || 'school') === g.key),
        })).filter((g) => g.items.length > 0);
        if (byType.length === 0) return null;
        return (
          <div className="max-w-2xl mx-auto px-6 pb-6">
            <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
              {byType.map((g) => (
                <div key={g.key}>
                  <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">
                    {g.icon} {g.label}
                  </h2>
                  <div className="space-y-2">
                    {g.items.map((s) => (
                      <div key={s.id} className="flex items-baseline justify-between">
                        <span className="text-[var(--color-ink)] font-medium">
                          {s.school_name}
                          {s.school_location && (
                            <span className="ml-2 text-xs text-[var(--color-muted)] font-normal">
                              · {s.school_location}
                            </span>
                          )}
                        </span>
                        {s.relationship && (
                          <span className="text-sm text-[var(--color-muted)]">{s.relationship}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
                      {/* KAN-219: when an item has a URL, the title becomes a
                          clickable link. Server-side sanitiseUrl restricts
                          to http(s); React escapes attribute values; we add
                          rel="noopener noreferrer" to prevent tab-nabbing. */}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-[var(--color-sage)] hover:underline"
                        >
                          {item.title}
                          <span aria-hidden className="ml-1 text-xs opacity-70">↗</span>
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-[var(--color-ink)]">{item.title}</p>
                      )}
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
                      {/* KAN-219: linked chip when URL present; plain
                          chip otherwise. Hover preserves the same styling. */}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-full text-sm text-[var(--color-ink)] hover:border-[var(--color-sage)] hover:text-[var(--color-sage)] transition-colors"
                        >
                          {item.title}
                          <span aria-hidden className="ml-1 text-xs opacity-70">↗</span>
                        </a>
                      ) : (
                        <span className="inline-block px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-full text-sm text-[var(--color-ink)]">
                          {item.title}
                        </span>
                      )}
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

      {/* KAN-181: conversation-starter prompts. Each prompt with a
          user-supplied answer renders as a small Q&A card. Encourages
          deeper conversations than the items lists alone. Section is
          hidden if no prompts answered. */}
      {typedStarters.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-4">💬 Things to ask me about</h2>
            <div className="space-y-4">
              {typedStarters.map((s) => (
                <div key={s.id}>
                  <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-1">
                    {s.prompt}
                  </p>
                  <p className="text-sm text-[var(--color-ink)] leading-relaxed whitespace-pre-wrap">
                    {s.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KAN-142: files & media. Public-only bucket with a permanent
          URL pattern: {bucket public URL}/{storage_path}. PDFs render
          as a download link (with `download` attribute and an explicit
          Content-Disposition hint via the storage layer); images render
          as a thumbnail next to the filename. */}
      {typedFiles.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">📎 Files & media</h2>
            <div className="space-y-2">
              {typedFiles.map((f) => {
                const url = `${env.supabaseUrl()}/storage/v1/object/public/profile-files/${f.storage_path}`;
                const isImage = f.mime_type.startsWith('image/');
                const isPdf = f.mime_type === 'application/pdf';
                return (
                  <a
                    key={f.id}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    {...(isPdf ? { download: f.file_name } : {})}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-stone-50 transition-colors group"
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element -- KAN-142: profile_files bucket is on Supabase Storage, not the Vercel asset pipeline, so Next/Image's optimizer doesn't apply. Direct <img> is the right tool here; thumbnails are small (max 10MB enforced at upload).
                      <img
                        src={url}
                        alt={f.file_name}
                        className="w-12 h-12 rounded object-cover shrink-0 bg-stone-100"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-2xl shrink-0" aria-hidden>📄</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-ink)] truncate group-hover:text-[var(--color-sage)]">
                        {f.file_name}
                      </p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {isPdf ? 'PDF' : isImage ? 'Image' : f.mime_type}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--color-muted)]">{isPdf ? '↓' : '↗'}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* KAN-191 / KAN-200: V2 gift recommendations — monetisable when
          Sovrn is live (KAN-184), un-monetised but click-logged today.
          Falls back to V1 concept-only section (KAN-139) when V2 has
          nothing in the curated catalogue for this profile. */}
      <div className="max-w-2xl mx-auto px-6">
        {v2Recommendations.length > 0 ? (
          <V2RecommendationsSection
            displayName={typedProfile.display_name}
            recommendations={v2Recommendations}
          />
        ) : (
          <RecommendationsSection
            displayName={typedProfile.display_name}
            recommendations={recommendations}
          />
        )}
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-6 py-8 text-center space-y-3">
        <p className="text-sm text-[var(--color-muted)]">
          This is a <Link href="/" className="text-[var(--color-sage)] hover:underline">Lyra</Link> profile
        </p>
        {/* KAN-141: inline report button — never shown for the profile's owner */}
        {viewer?.id !== typedProfile.user_id && (
          <ReportButton
            profileSlug={typedProfile.slug}
            isAuthenticated={isAuthenticated}
          />
        )}
      </div>
    </main>
    </>
  );
}
