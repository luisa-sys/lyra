import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { env } from '@/modules/platform/env';
import { jsonLdSafe } from '@/modules/guards/json-ld';
import { createClient as createSupabaseServerClient } from '@/modules/platform/supabase-server';
import { initialEditorState } from '@/modules/profile/editor/editor-state';
import { buildPublicProfileView } from '@/modules/profile/editor/public-view-model';
import ReportButton from '@/modules/public-profile/report-button';
import { decodeSlug } from '@/modules/public-profile/slug-utils';
import {
  loadPublicProfile,
  loadPublicProfileRow,
  resolveLegacySlug,
} from '@/modules/public-profile/load-public-profile';
import { buildPublicProfileMeta } from '@/modules/public-profile/public-profile-meta';
import { PublicProfileSections } from '@/modules/public-profile/public-profile-sections';

// BUGS-14: profile pages render dynamically per-request (cookie read for the
// members-only visibility decision; force-dynamic also makes notFound() emit a
// real 404 status rather than a streamed 200).
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
};

// KAN-488: this route makes no database call itself (CTL-056). The data access
// lives in the public-profile module; the sections come from the profile
// module's pure view model, so the page shows exactly what the editor's
// Preview shows (spec v0.8 §2, ADR-010).

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  // Decode + NFC-normalise to match the stored slug (see PublicProfilePage).
  const slug = decodeSlug(rawSlug);
  const row = await loadPublicProfileRow(slug);
  if (!row) {
    return { title: 'Profile not found — Lyra' };
  }

  const meta = buildPublicProfileMeta(row, env.siteUrl());
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.url },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: meta.url,
      siteName: 'Lyra',
      type: 'profile',
      locale: 'en_GB',
      ...(meta.image && { images: [{ url: meta.image, alt: meta.name }] }),
    },
    twitter: {
      card: 'summary',
      title: meta.title,
      description: meta.description,
      ...(meta.image && { images: [meta.image] }),
    },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const { slug: rawSlug } = await params;
  // The dynamic route param arrives PERCENT-ENCODED for any non-ASCII slug
  // (e.g. "rosa-martínez" → "rosa-mart%C3%ADnez"), so it must be decoded before
  // the lookup — an undecoded "%C3%AD" never matches the stored "í" and the
  // profile 404s. Slugs are stored in Unicode NFC, so normalise to NFC too so a
  // decomposed (NFD) form still matches. ASCII slugs are unaffected (no-op).
  const slug = decodeSlug(rawSlug);

  const row = await loadPublicProfileRow(slug);
  if (!row) {
    // KAN-490 / ADR-011: an old (pre-v0.8) slug, or a mixed-case form of a
    // live ID, redirects permanently (308) to the current ID — only ever to a
    // published, not-suspended profile. Anything else is a 404.
    const target = await resolveLegacySlug(slug);
    if (target) {
      permanentRedirect(`/${encodeURIComponent(target)}`);
    }
    notFound();
  }

  // KAN-143 — viewer auth state drives members-only visibility.
  const cookieClient = await createSupabaseServerClient();
  const { data: { user: viewer } } = await cookieClient.auth.getUser();
  const isAuthenticated = viewer !== null;

  const loaded = await loadPublicProfile(row, { isAuthenticated });
  const view = buildPublicProfileView(initialEditorState(loaded), { audience: 'public' });

  const meta = buildPublicProfileMeta(row, env.siteUrl());
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: meta.name,
    url: meta.url,
    ...(meta.image && { image: meta.image }),
    ...(meta.headline && { description: meta.headline }),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe(jsonLd) }} />
      {/* KAN-488 review: the brand bar is site navigation, so it sits beside
          <main>, not inside it. The wrapper carries the old <main> classes so
          the page renders exactly as before; <main> keeps the paper bg the
          profile-redesign e2e asserts on. */}
      <div className="min-h-screen bg-[#fdfcf8]">
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

        <main className="bg-[#fdfcf8]">
          {/* Calm layout: a pale sage cover band, full width. The profile
              header in PublicProfileSections pulls itself up over it. */}
          <div
            aria-hidden="true"
            className="h-[168px] bg-gradient-to-b from-[#e3eadf] to-[var(--color-lyra-sage-50)] border-b border-[#ece7df]"
          />
          <div className="max-w-[760px] mx-auto px-5 pb-24">
            <PublicProfileSections view={view} />

            {/* Footer */}
            <div className="pt-14 text-center space-y-3">
              <p className="text-sm text-[var(--color-muted)]">
                This is a <Link href="/" className="text-[var(--color-sage)] hover:underline">Lyra</Link> profile
              </p>
              {viewer?.id !== row.user_id && (
                <ReportButton profileSlug={row.slug} isAuthenticated={isAuthenticated} />
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
