import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { createServiceRoleClient } from '@/lib/supabase-service';
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
import { groupFavourites } from '@/app/dashboard/profile/favourites';
import { getRecommendations } from '@/lib/recommend';
import { withoutDismissedRecommendations, withoutDismissedV2 } from '@/lib/recommend/dismissals';
import RecommendationsSection from './recommendations-section';
import V2RecommendationsSection from './v2-recommendations-section';
import ReportButton from './report-button';
import { decodeSlug } from './slug-utils';
import { headers } from 'next/headers';
import { isIsoAlpha2, normaliseDeliveryCountry } from '@/lib/affiliate/country-codes';
import { buildV2Recommendations } from '@/lib/recommender/v2/pipeline';
import type { ConceptInput } from '@/lib/recommender/v2/types';
import * as Sentry from '@sentry/nextjs';

// BUGS-14: profile pages render dynamically per-request (cookie read for the
// members-only visibility decision; force-dynamic also makes notFound() emit a
// real 404 status rather than a streamed 200).
export const dynamic = 'force-dynamic';

function getSupabase() {
  return createServiceRoleClient();
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
  // KAN-443: optional one-liner for people who would rather choose their own
  // gift. Optional on the type as well as nullable in the DB, because the row
  // is read with select('*') and an environment that has not yet run
  // 20260803170000_kan443_gift_redesign.sql simply returns no such key.
  gift_voucher_hint?: string | null;
}

interface ProfileItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  url: string | null;
  visibility: string | null;
  // KAN-444: only set on custom favourites — the heading the member chose.
  group_label?: string | null;
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
  const { slug: rawSlug } = await params;
  // Decode + NFC-normalise to match the stored slug (see PublicProfilePage).
  const slug = decodeSlug(rawSlug);

  const { data: profile } = await getSupabase()
    .from('profiles')
    .select('display_name, headline, bio_short')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('is_suspended', false) // SEC-44: service-role render must exclude suspended profiles
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

/**
 * KAN-443 — the gift list reads as a LIST.
 *
 * Every other list section on this page (favourites, affiliations) puts the
 * name and its note on one line — name semibold, note in muted text — inside a
 * single card. Gifts were the exception: one full-width card per item, the
 * description on a second line, and the link as a pill, so a five-item list
 * read as five separate announcements. Same font-weight relationship as those
 * sections now, with any link on its own line underneath so it stays tappable.
 */
function GiftLines({ items }: { items: ProfileItem[] }) {
  return (
    <div className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] mt-3">
      {items.map((it) => (
        <div key={it.id} className="py-2 border-b border-dashed border-[#ece7df] last:border-0">
          <div className="text-[14.5px] leading-snug">
            <b className="font-semibold text-[var(--color-ink)]">{it.title}</b>
            {it.description && <span className="text-[var(--color-muted)]"> — {it.description}</span>}
          </div>
          {it.url && (
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1.5 text-[12.5px] text-[var(--color-sage)] bg-[#e9efea] rounded-full px-[11px] py-[3px] no-underline hover:underline"
            >
              🔗 view link
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function PublicProfilePage({ params }: Props) {
  const { slug: rawSlug } = await params;
  // The dynamic route param arrives PERCENT-ENCODED for any non-ASCII slug
  // (e.g. "rosa-martínez" → "rosa-mart%C3%ADnez"), so it must be decoded before
  // the lookup — an undecoded "%C3%AD" never matches the stored "í" and the
  // profile 404s. Slugs are stored in Unicode NFC, so normalise to NFC too so a
  // decomposed (NFD) form still matches. ASCII slugs are unaffected (no-op).
  const slug = decodeSlug(rawSlug);

  const { data: profile } = await getSupabase()
    .from('profiles')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .eq('is_suspended', false) // SEC-44: suspended profiles must 404 on the public page, not render
    .single();

  if (!profile) {
    notFound();
  }

  const typedProfile = profile as ProfileData;

  // KAN-143 — viewer auth state drives members-only visibility.
  const cookieClient = await createSupabaseServerClient();
  const { data: { user: viewer } } = await cookieClient.auth.getUser();
  const isAuthenticated = viewer !== null;

  // KAN-351 (web-arch-3): the five per-profile section reads each depend only
  // on typedProfile.id, so run them in parallel instead of the previous
  // sequential await-waterfall. Errors are no longer silently dropped — every
  // read result is inspected below and any failure is surfaced.
  const [itemsRes, schoolsRes, linksRes, manualOfMeRes, starterRowsRes] = await Promise.all([
    getSupabase()
      .from('profile_items')
      .select('*')
      .eq('profile_id', typedProfile.id)
      .order('created_at', { ascending: true }),
    getSupabase()
      .from('school_affiliations')
      .select('*')
      .eq('profile_id', typedProfile.id),
    getSupabase()
      .from('external_links')
      .select('*')
      .eq('profile_id', typedProfile.id),
    getSupabase()
      .from('profile_manual_of_me')
      .select('communication_style, working_preferences, energises_me, drains_me, good_to_know, boundaries')
      .eq('profile_id', typedProfile.id)
      .maybeSingle(),
    getSupabase()
      .from('profile_conversation_starters')
      .select('id, answer, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(prompt, sort_order)')
      .eq('profile_id', typedProfile.id)
      .order('created_at', { ascending: true }),
  ]);

  // KAN-351 (web-arch-3): previously each `const { data } = await …` dropped
  // its `error`, so a partial DB outage rendered an incomplete profile as a
  // clean 200. Capture every failure to Sentry for observability, then fail
  // loudly rather than silently serve an empty/partial profile. These are
  // plain/`maybeSingle` reads (no `.single()`), so an error means a genuine
  // read failure — never the "row legitimately absent" case.
  const sectionReadErrors = (
    [
      ['profile_items', itemsRes.error],
      ['school_affiliations', schoolsRes.error],
      ['external_links', linksRes.error],
      ['profile_manual_of_me', manualOfMeRes.error],
      ['profile_conversation_starters', starterRowsRes.error],
    ] as const
  ).filter((entry) => entry[1] != null);

  if (sectionReadErrors.length > 0) {
    for (const [table, error] of sectionReadErrors) {
      Sentry.captureException(error, {
        tags: { area: 'public-profile', table },
        extra: { slug, profileId: typedProfile.id },
      });
    }
    throw new Error(
      `Public profile section reads failed for ${sectionReadErrors
        .map(([table]) => table)
        .join(', ')}`,
    );
  }

  const items = itemsRes.data;
  const schools = schoolsRes.data;
  const links = linksRes.data;
  const manualOfMe = (manualOfMeRes.data as ManualOfMe | null) ?? null;
  const starterRowsRaw = starterRowsRes.data;

  const sectionVisibility = coerceSectionVisibility(typedProfile.section_visibility);
  const visibleItems = ((items || []) as ProfileItem[]).filter((item) =>
    isItemVisibleUnderHybridModel(item, sectionVisibility, isAuthenticated),
  );
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

  // KAN-443 — suggestions this member has said "not for me" to.
  //
  // Read SEPARATELY from the Promise.all above, and deliberately NOT added to
  // the fail-loud `sectionReadErrors` set. This table is created by
  // 20260803170000_kan443_gift_redesign.sql, and code reaches an environment
  // before its migration does — so on a not-yet-migrated environment this read
  // errors. Failing loud there would 500 EVERY published profile over a filter
  // whose absence merely shows a few more suggestions. That is the wrong trade,
  // so the error is captured to Sentry (never swallowed) and the page degrades
  // to "nothing dismissed" rather than not rendering at all.
  const dismissalsRes = await getSupabase()
    .from('gift_suggestion_dismissals')
    .select('suggestion_key')
    .eq('profile_id', typedProfile.id);

  if (dismissalsRes.error) {
    Sentry.captureException(dismissalsRes.error, {
      tags: { area: 'public-profile', table: 'gift_suggestion_dismissals' },
      extra: { slug, profileId: typedProfile.id },
    });
  }

  const dismissedKeys = new Set(
    ((dismissalsRes.data ?? []) as { suggestion_key: string }[]).map((r) => r.suggestion_key),
  );

  // Recommendations (V1 concepts → V2 monetisable).
  //
  // KAN-443: dismissed concepts are dropped BEFORE the V2 pipeline runs, so a
  // dismissal frees its slot for the next-best concept rather than leaving a
  // gap — the member loses the idea they rejected, not one of their five
  // suggestions.
  const recommendations = withoutDismissedRecommendations(
    getRecommendations(
      {
        bio: typedProfile.bio_short,
        headline: typedProfile.headline,
        items: typedItems.map((i) => ({ category: i.category, title: i.title, description: i.description })),
      },
      { limit: 8 },
    ),
    dismissedKeys,
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
  // KAN-443: filter the pipeline OUTPUT too, not only its input. When a profile
  // is sparse the pipeline substitutes its own evergreen concepts, which never
  // passed through the V1 list above — without this second pass a dismissed
  // evergreen suggestion would come straight back.
  const v2Recommendations = withoutDismissedV2(v2Result.recommendations, dismissedKeys);
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

  // KAN-444: favourites grid — one card per non-empty group, built by the
  // SAME function the editor groups by (see dashboard/profile/favourites).
  // Sharing it is the point: the groups a member arranges while editing are
  // by construction the groups their visitors see, so the two cannot drift.
  const favCards = groupFavourites(typedItems);

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
          {/* KAN-443: the section also carries the optional voucher hint, so it
              shows even when the list itself is empty — "I'd rather choose my
              own" is a complete answer to the question this heading asks. */}
          {((groupedItems['gift_ideas']?.length ?? 0) > 0 || Boolean(typedProfile.gift_voucher_hint)) && (
            <section className="mt-11">
              <SectionQ>💛 Things I love, can&apos;t get enough of, or have been dreaming about</SectionQ>
              {(groupedItems['gift_ideas']?.length ?? 0) > 0 && (
                <GiftLines items={groupedItems['gift_ideas'] ?? []} />
              )}
              {typedProfile.gift_voucher_hint && (
                <div className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] mt-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                  <div className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-1">
                    If you&apos;d rather I chose
                  </div>
                  <div className="text-[14.5px] text-[#544f49] leading-relaxed">
                    {typedProfile.gift_voucher_hint}
                  </div>
                </div>
              )}
            </section>
          )}
          {notForMe.length > 0 && (
            <section className="mt-11">
              <SectionQ>🙅 Things that aren&apos;t really for me</SectionQ>
              <ItemCards items={notForMe} />
            </section>
          )}
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
