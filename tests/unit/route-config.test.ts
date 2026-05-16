/**
 * BUGS-14: regression guards for the route configuration that fixes the
 * RSC streaming notFound() bug.
 *
 * These are deliberately static-text assertions over the page source —
 * they're cheap and catch the regressing case where someone refactors
 * `[slug]/page.tsx` and silently drops the `dynamic` export, or where a
 * future change accidentally deletes the root `not-found.tsx`.
 *
 * If either of these regresses without intent, the consequence is the
 * BUGS-14 bug returning: unknown slugs would show a perpetual loading
 * spinner instead of the 404 page, and Google would index typo'd URLs
 * as 200s. Tighter unit-level guards prevent that.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('BUGS-14 — route configuration regression guards', () => {
  test('src/app/[slug]/page.tsx exports dynamic = "force-dynamic"', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/[slug]/page.tsx'),
      'utf-8',
    );
    // Look for the export. We accept any of the canonical forms so the
    // assertion doesn't break on innocent reformatting.
    expect(src).toMatch(
      /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/,
    );
  });

  test('NO root-level src/app/loading.tsx exists (BUGS-14 root cause)', () => {
    // BUGS-14: a root-level loading.tsx implicitly wraps the entire app
    // tree in a `<Suspense fallback={<Loading />}>`. When a server
    // component calls notFound(), the not-found template gets emitted
    // into the RSC stream, but the outer Suspense boundary keeps the
    // visible DOM on the loading fallback. Removing root loading.tsx
    // is THE fix.
    //
    // Per-segment loading.tsx (e.g. src/app/dashboard/loading.tsx) is
    // fine — they wrap their own subtree and don't trap [slug] 404s.
    expect(existsSync(resolve(ROOT, 'src/app/loading.tsx'))).toBe(false);
  });

  test('src/app/not-found.tsx exists (on-brand default for non-segment 404s)', () => {
    // Any URL with no closer not-found.tsx (e.g. `/foo/bar/baz`) falls
    // back to this root one. The segment-level `[slug]/not-found.tsx`
    // is preferred for slug URLs by Next.js routing.
    expect(existsSync(resolve(ROOT, 'src/app/not-found.tsx'))).toBe(true);
  });

  test('src/app/[slug]/not-found.tsx still exists for slug-specific UX', () => {
    // Provides "This profile doesn't exist" copy. Next.js's
    // closest-ancestor matching prefers this over the root one for
    // /[slug] routes.
    expect(existsSync(resolve(ROOT, 'src/app/[slug]/not-found.tsx'))).toBe(true);
  });

  test('root not-found.tsx contains the canonical 404 + Go to Lyra UI', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/not-found.tsx'), 'utf-8');
    // The visible "404" heading is what the E2E test (and humans) check.
    // If a refactor moves the heading to something else we want the
    // test to fail rather than silently regress.
    expect(src).toMatch(/>\s*404\s*</);
    // The "Go to Lyra" CTA link is also asserted by the E2E test.
    expect(src).toMatch(/Go to Lyra/);
    expect(src).toMatch(/href=["']\/["']/);
  });
});
