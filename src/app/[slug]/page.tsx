import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { env } from '@/lib/env';
import { jsonLdSafe } from '@/lib/json-ld';
import { createClient as createSupabaseServerClient } from '@/lib/supabase-server';
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

// BUGS-14: profile pages render dynamically per-request (cookie read for the
// members-only visibility decision; force-dynamic also makes notFound() emit a
// real 404 status rather than a streamed 200).
export const dynamic = 'force-dynamic';

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
  section_visibility: Record<string, string> | null;
}

interface ProfileItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  url: string | null;
  visibility: string | null;
}

interface SchoolAffiliation {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
  affiliation_type: string;
  // KAN-263: optional short note ("Class of 2008") + per-row visibility.
  // Affiliations are hidden on the public profile unless show_on_profile.
  description: string | null;
  show_on_profile: boolean;
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
    alternates: { canonical: `${siteUrl}/${slug}` },
    openGraph: {
      title: `${profile.display_name} — Lyra`,
      description,
      url: `${siteUrl}/${slug}`,
      siteName: 'Lyra',
      type: 'profile',
      locale: 'en_GB',
    },
    twitter: { card: 'summary', title: `${profile.display_name} — Lyra`, description },
  };
}

// ─────────────────────────── redesign building blocks ───────────────────────
// KAN-265: ported from the June-2026 profile mock-up. Warm question heading
// with a 3px sage left-rule; calm white cards; 2-col about/favourites grids.

function SectionQ({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[var(--color-ink)] border-l-[3px] border-[var(--color-sage)] pl-[13px] mb-1.5">
      {children}
    </h2>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] my-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {children}
    </div>
  );
}

function ItemCards({ items }: { items: ProfileItem[] }) {
  return (
    <>
      {items.map((it) => (
        <Card key={it.id}>
          <div className="font-semibold text-[16px] text-[var(--color-ink)]">{it.title}</div>
          {it.description && (
            <div className="text-[14.5px] text-[#544f49] mt-[3px] leading-relaxed">{it.description}</div>
          )}
          {it.url && (
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-[12.5px] text-[var(--color-sage)] bg-[#e9efea] rounded-full px-[11px] py-[3px] no-underline hover:underline"
            >
              🔗 view link
            </a>
          )}
        </Card>
      ))}
    </>
  );
}

function CardSection({ heading, items }: { heading: string; items: ProfileItem[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-11">
      <SectionQ>{heading}</SectionQ>
      <ItemCards items={items} />
    </section>
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

  // KAN-143 — viewer auth state drives members-only visibility.
  const cookieClient = await createSupabaseServerClient();
  const { data: { user: viewer } } = await cookieClient.auth.getUser();
  const isAuthenticated = viewer !== null;

  const allowedVisibility = isAuthenticated ? ['public', 'members_only'] : ['public'];

  const { data: items } = await getSupabase()
    .from('profile_items')
    .select('*')
    .eq('profile_id', typedProfile.id)
    .order('created_at', { ascending: true });

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

  const { data: manualOfMeRow } = await getSupabase()
    .from('profile_manual_of_me')
    .select('communication_style, working_preferences, energises_me, drains_me, good_to_know, boundaries')
    .eq('profile_id', typedProfile.id)
    .maybeSingle();
  const manualOfMe = (manualOfMeRow as ManualOfMe | null) ?? null;

  const { data: filesRaw } = await getSupabase()
    .from('profile_files')
    .select('id, storage_path, file_name, mime_type, size_bytes, visibility')
    .eq('profile_id', typedProfile.id)
    .in('visibility', allowedVisibility)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  const visibleFiles = (filesRaw ?? []).filter((f) =>
    isAuthenticated
      ? f.visibility === 'public' || f.visibility === 'members_only'
      : f.visibility === 'public',
  );
  // BUGS-33 (SEC-03b): profile-files is now a PRIVATE bucket. Mint a short-lived
  // signed URL (service-role) for each file the viewer is allowed to see, instead
  // of a public direct URL. Files filtered out above never get a signed URL, so
  // private/connections files are never world-readable by direct link.
  const fileSb = getSupabase();
  const typedFiles = (
    await Promise.all(
      visibleFiles.map(async (f) => {
        const { data: signed } = await fileSb.storage
          .from('profile-files')
          .createSignedUrl(f.storage_path as string, 60 * 60);
        return { ...f, url: signed?.signedUrl ?? null };
      }),
    )
  ).filter((f) => f.url);

  const { data: starterRowsRaw } = await getSupabase()
    .from('profile_conversation_starters')
    .select('id, answer, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(prompt, sort_order)')
    .eq('profile_id', typedProfile.id)
    .order('created_at', { ascending: true });
  const typedStarters = (starterRowsRaw ?? []).map((r) => {
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
  }).sort((a, b) => a.sort_order - b.sort_order);

  const typedItems = visibleItems;
  const typedSchools = (schools || []) as SchoolAffiliation[];
  const typedLinks = (links || []) as ExternalLink[];

  // Recommendations (V1 concepts → V2 monetisable). Unchanged from before.
  const recommendations = getRecommendations(
    {
      bio: typedProfile.bio_short,
      headline: typedProfile.headline,
      items: typedItems.map((i) => ({ category: i.category, title: i.title, description: i.description })),
    },
    { limit: 8 },
  );

  const requestHeaders = await headers();
  const buyerCountryHeader = requestHeaders.get('cf-ipcountry') ?? '';
  const buyerCountry = isIsoAlpha2(buyerCountryHeader.toUpperCase()) ? buyerCountryHeader.toUpperCase() : 'GB';
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

  const v2Result = await buildV2Recommendations({
    concepts: v2Concepts,
    buyerCountry,
    recipientCountry,
    source: 'web',
    sessionId: null,
    userId: viewer?.id ?? null,
    recipientId: typedProfile.id,
    recommendationId: `web-${typedProfile.id}`,
    limit: 5,
  });
  const v2Recommendations = v2Result.recommendations;
  const v2FellBackToEvergreen = v2Result.fellBackToEvergreen;

  // Group items by category for the redesign sections.
  const groupedItems = typedItems.reduce((acc: Record<string, ProfileItem[]>, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});
  const has = (cat: string) => (groupedItems[cat]?.length ?? 0) > 0;

  // The six "To understand me a little better" prompts, in mock-up order.
  const ABOUT_BOXES: Array<[keyof ManualOfMe, string]> = [
    ['good_to_know', 'Good to know about me'],
    ['boundaries', 'My boundaries'],
    ['communication_style', 'How I find communication easier'],
    ['working_preferences', 'If you ever come to my house'],
    ['energises_me', 'What gives me energy'],
    ['drains_me', 'What drains me'],
  ];

  // Favourites grid — one card per non-empty list.
  const FAV_DEFS: Array<[string, string]> = [
    ['favourite_media', 'Favourite films'],
    ['favourite_books', 'Favourite books'],
    ['favourite_tv', 'Favourite TV shows'],
    ['quotes', 'Favourite quotes'],
    ['favourite_places', 'Favourite places'],
    ['favourite_music', 'Favourite music & bands'],
  ];
  const favCards = FAV_DEFS.filter(([cat]) => has(cat)).map(([cat, label]) => ({
    key: cat,
    label,
    items: groupedItems[cat] ?? [],
  }));

  // Affiliations — hidden by default, shown only where the owner opted in.
  const affGroups: Array<{ key: string; label: string }> = [
    { key: 'school', label: 'Schools' },
    { key: 'organisation', label: 'Organisations' },
    { key: 'community', label: 'Communities' },
  ];
  const visibleAffiliations = typedSchools.filter((s) => s.show_on_profile);
  const affByType = affGroups
    .map((g) => ({ ...g, items: visibleAffiliations.filter((s) => (s.affiliation_type || 'school') === g.key) }))
    .filter((g) => g.items.length > 0);

  const notForMe = [...(groupedItems['gifts_to_avoid'] || []), ...(groupedItems['dislikes'] || [])];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: typedProfile.display_name,
    url: `${env.siteUrl()}/${typedProfile.slug}`,
    ...(typedProfile.headline && { jobTitle: typedProfile.headline }),
    ...(typedProfile.bio_short && { description: typedProfile.bio_short }),
    ...(typedProfile.city && {
      address: { '@type': 'PostalAddress', addressLocality: typedProfile.city, addressCountry: typedProfile.country || 'GB' },
    }),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }} />
      <main className="min-h-screen bg-[#fdfcf8]">
        {/* Brand bar */}
        <nav aria-label="Profile navigation" className="border-b border-[#ece7df] bg-[#fdfcf8]/85 backdrop-blur-md">
          <div className="max-w-[760px] mx-auto px-5 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center">
              <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
            </Link>
            <Link
              href="/signup"
              className="text-[13px] font-medium px-4 py-1.5 rounded-[10px] bg-[var(--color-sage)] text-white hover:opacity-90 transition-opacity"
            >
              Create yours
            </Link>
          </div>
        </nav>

        <div className="max-w-[760px] mx-auto px-5 pt-9 pb-24">
          {/* Hero */}
          <header className="text-center mb-3.5">
            <div className="relative w-32 h-32 rounded-full mx-auto mb-4 overflow-hidden bg-gradient-to-br from-[#dcd2ca] to-[#b09a8e] text-white flex items-center justify-center font-[family-name:var(--font-serif)] text-[46px] shadow-[0_6px_18px_rgba(0,0,0,0.12)]">
              {typedProfile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- KAN-265: avatar lives in Supabase Storage, not the Vercel image pipeline
                <img src={typedProfile.avatar_url} alt={typedProfile.display_name} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                typedProfile.display_name.charAt(0).toUpperCase()
              )}
            </div>
            <h1 className="font-[family-name:var(--font-serif)] text-[32px] font-bold tracking-[-0.022em] text-[var(--color-ink)] m-0">
              {typedProfile.display_name}
            </h1>
            {typedProfile.headline && (
              <p className="text-[16.5px] text-[#4f4a44] max-w-[34em] mx-auto mt-[7px] mb-[9px]">{typedProfile.headline}</p>
            )}
            {typedProfile.city && (
              <p className="text-[14px] text-[var(--color-muted)]">📍 {typedProfile.city}{typedProfile.country ? `, ${typedProfile.country}` : ''}</p>
            )}
          </header>

          {/* Bio */}
          {typedProfile.bio_short && (
            <Card>
              <p className="text-[var(--color-ink)] leading-relaxed">{typedProfile.bio_short}</p>
            </Card>
          )}

          {/* Where you might know me from */}
          {affByType.length > 0 && (
            <section className="mt-11">
              <SectionQ>🤝 Where you might know me from</SectionQ>
              <div className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] mt-3">
                {affByType.map((g) => (
                  <div key={g.key} className="mb-1">
                    <h4 className="text-[13px] uppercase tracking-wide text-[var(--color-muted)] mt-3.5 mb-1 first:mt-0">{g.label}</h4>
                    {g.items.map((s) => (
                      <div key={s.id} className="py-2 border-b border-dashed border-[#ece7df] last:border-0">
                        <b className="font-semibold text-[var(--color-ink)]">{s.school_name}</b>
                        {s.school_location && <small className="text-[var(--color-muted)]"> · {s.school_location}</small>}
                        {s.description && <small className="text-[var(--color-muted)]"> · {s.description}</small>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* To understand me a little better */}
          {!isManualOfMeEmpty(manualOfMe) && manualOfMe && (
            <section className="mt-11">
              <SectionQ>💭 To understand me a little better</SectionQ>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                {ABOUT_BOXES.map(([key, label]) =>
                  manualOfMe[key] ? (
                    <div key={key} className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                      <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-1">{label}</div>
                      <div className="text-[14.5px] text-[#544f49] leading-relaxed">{manualOfMe[key]}</div>
                    </div>
                  ) : null,
                )}
              </div>
            </section>
          )}

          {/* Things I love + not for me */}
          <CardSection heading="💛 Things I love, can't get enough of, or have been dreaming about" items={groupedItems['gift_ideas']} />
          <CardSection heading="💚 Things I'm into" items={groupedItems['likes']} />
          {notForMe.length > 0 && (
            <section className="mt-11">
              <SectionQ>🙅 Things that aren&apos;t really for me</SectionQ>
              <ItemCards items={notForMe} />
            </section>
          )}
          <CardSection heading="🧭 Helpful to know" items={groupedItems['helpful_to_know']} />
          <CardSection heading="🚧 My boundaries" items={groupedItems['boundaries']} />
          <CardSection heading="🌍 Causes close to my heart" items={groupedItems['causes']} />
          <CardSection heading="🏆 Things I'm proud of" items={groupedItems['proud_of']} />

          {/* A few of my favourite things */}
          {favCards.length > 0 && (
            <section className="mt-11">
              <SectionQ>⭐ A few of my favourite things</SectionQ>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                {favCards.map((fc) => (
                  <div key={fc.key} className="bg-white border border-[#ece7df] rounded-[10px] pt-3.5 px-4 pb-3">
                    <h4 className="font-[family-name:var(--font-serif)] text-[15px] font-bold mb-2 text-[var(--color-ink)]">{fc.label}</h4>
                    {fc.items.map((it) => (
                      <div key={it.id} className="text-[14.5px] py-1 leading-snug">
                        <b className="font-semibold text-[var(--color-ink)]">{it.title}</b>
                        {it.description && <span className="text-[var(--color-muted)]"> — {it.description}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tips & life hacks / Problems */}
          <CardSection heading="🧰 Tips & life hacks I can share" items={groupedItems['life_hacks']} />
          <CardSection heading="🧩 Problems I'm trying to solve — ideas welcome" items={groupedItems['current_problems']} />

          {/* A few more things about me (Q&A) */}
          {(typedStarters.length > 0 || has('questions')) && (
            <section className="mt-11">
              <SectionQ>💬 A few more things about me</SectionQ>
              <div className="mt-3 space-y-5">
                {typedStarters.map((s) => (
                  <div key={s.id}>
                    <div className="font-semibold text-[15px] text-[var(--color-ink)] mb-[3px]">{s.prompt}</div>
                    <div className="text-[15.5px] text-[#544f49] whitespace-pre-wrap leading-relaxed">{s.answer}</div>
                  </div>
                ))}
                {(groupedItems['questions'] || []).map((it) => (
                  <div key={it.id}>
                    <div className="font-semibold text-[15px] text-[var(--color-ink)] mb-[3px]">{it.title}</div>
                    {it.description && (
                      <div className="text-[15.5px] text-[#544f49] whitespace-pre-wrap leading-relaxed">{it.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Billboard */}
          {(groupedItems['billboard']?.length ?? 0) > 0 && (
            <section className="mt-11">
              <div className="bg-[var(--color-sage)] rounded-[12px] p-8 text-center">
                <p className="text-xs uppercase tracking-wide text-white/70 mb-3">If I had a giant billboard, it would say&hellip;</p>
                <p className="text-xl sm:text-2xl font-[family-name:var(--font-serif)] text-white leading-relaxed">
                  &ldquo;{groupedItems['billboard']?.[0]?.title}&rdquo;
                </p>
              </div>
            </section>
          )}

          {/* Links */}
          {typedLinks.length > 0 && (
            <section className="mt-11">
              <SectionQ>🔗 Links</SectionQ>
              <div className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] mt-3">
                {typedLinks.map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-[#f5f1ea] transition-colors group"
                  >
                    <span className="text-[var(--color-ink)] group-hover:text-[var(--color-sage)]">{l.title}</span>
                    <span className="text-xs text-[var(--color-muted)]">↗</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Files & media */}
          {typedFiles.length > 0 && (
            <section className="mt-11">
              <SectionQ>📎 Files &amp; media</SectionQ>
              <div className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] mt-3 space-y-1">
                {typedFiles.map((f) => {
                  const url = f.url as string;
                  const isImage = f.mime_type.startsWith('image/');
                  const isPdf = f.mime_type === 'application/pdf';
                  return (
                    <a
                      key={f.id}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...(isPdf ? { download: f.file_name } : {})}
                      className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-[#f5f1ea] transition-colors group"
                    >
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element -- KAN-265: Supabase Storage, not the Vercel image pipeline
                        <img src={url} alt={f.file_name} className="w-12 h-12 rounded object-cover shrink-0 bg-[#f3efe8]" loading="lazy" />
                      ) : (
                        <span className="text-2xl shrink-0" aria-hidden>📄</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--color-ink)] truncate group-hover:text-[var(--color-sage)]">{f.file_name}</p>
                        <p className="text-xs text-[var(--color-muted)]">{isPdf ? 'PDF' : isImage ? 'Image' : f.mime_type}</p>
                      </div>
                      <span className="text-xs text-[var(--color-muted)]">{isPdf ? '↓' : '↗'}</span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}

          {/* Gift recommendations (separate feature) */}
          <div className="mt-11">
            {v2Recommendations.length > 0 ? (
              <V2RecommendationsSection
                displayName={typedProfile.display_name}
                recommendations={v2Recommendations}
                fellBackToEvergreen={v2FellBackToEvergreen}
              />
            ) : (
              <RecommendationsSection displayName={typedProfile.display_name} recommendations={recommendations} />
            )}
          </div>

          {/* Footer */}
          <div className="pt-10 text-center space-y-3">
            <p className="text-sm text-[var(--color-muted)]">
              This is a <Link href="/" className="text-[var(--color-sage)] hover:underline">Lyra</Link> profile
            </p>
            {viewer?.id !== typedProfile.user_id && (
              <ReportButton profileSlug={typedProfile.slug} isAuthenticated={isAuthenticated} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
