import Link from 'next/link';

/**
 * BUGS-14: root not-found boundary.
 *
 * Lyra didn't have a root-level not-found.tsx before BUGS-14. Any URL
 * outside the matched routes (e.g. `/foo/bar/baz` — a path with no
 * segment that has its own not-found.tsx) would fall back to Next.js'
 * built-in 404 page. This file gives those URLs the same on-brand 404
 * UX as the slug-specific one in `[slug]/not-found.tsx`.
 *
 * Not the primary BUGS-14 fix on its own — that was removing the root
 * `loading.tsx` (which was creating a Suspense boundary that trapped
 * the not-found unwrap on `[slug]` routes). This file is the on-brand
 * default for non-`[slug]` 404s.
 *
 * Metadata (page title) is set here so any non-slug 404 reads as a
 * deliberate not-found state, not a generic page-load error.
 */

export const metadata = {
  title: 'Page not found — Lyra',
  description: "The page you're looking for doesn't exist.",
};

export default function RootNotFound() {
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-[family-name:var(--font-serif)] text-[var(--color-ink)] mb-4">
          404
        </h1>
        <p className="text-lg text-[var(--color-muted)] mb-2">
          Page not found.
        </p>
        <p className="text-sm text-[var(--color-muted)] mb-8">
          The link you followed may be broken, or the page may have moved.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-lg bg-[var(--color-sage)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Go to Lyra
        </Link>
      </div>
    </main>
  );
}
