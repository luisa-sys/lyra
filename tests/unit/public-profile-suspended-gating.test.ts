/**
 * SEC-44 / KAN-355 — the public profile page (`/[slug]`) renders via the
 * RLS-bypassing service-role client, so the suspension guard must be an
 * EXPLICIT `.eq('is_suspended', false)` filter on every profile lookup.
 * Without it, an admin-suspended profile stays fully publicly viewable — a
 * safeguarding + UK-GDPR exposure on an under-18-facing platform.
 *
 * Both the `generateMetadata` fetch and the page fetch must carry the filter
 * (alongside `is_published = true`) so a suspended published profile 404s.
 * These source assertions lock the filter in against regression, mirroring the
 * sibling SEC-19/F-13 guard in `recommendations-routes-security.test.ts`.
 */
import fs from 'fs';
import path from 'path';
import { SRC } from '../support/source-paths';

const root = path.join(__dirname, '../..');
// KAN-488: the profile-row read moved from src/app/[slug]/page.tsx into the
// public-profile module's loader (CTL-056). Was: const pagePath = SRC.slugPage;
const pagePath = SRC.loadPublicProfile;
const routePath = SRC.slugPage;

describe('SEC-44: public profile page filters suspended profiles', () => {
  const content = fs.readFileSync(path.join(root, pagePath), 'utf8');

  test(`${pagePath} exists`, () => {
    expect(fs.existsSync(path.join(root, pagePath))).toBe(true);
  });

  // ⚠️ SEC-104 CHANGED WHAT THESE THREE CAN ASSERT.
  //
  // They used to require `.eq('is_suspended', false)` and `.eq('is_published',
  // true)` in the source, because a service-role read bypasses RLS and that
  // hand-written pair was the whole guard. The pair now lives in the
  // `public_profiles` view body, so asserting its absence-from-source would be
  // asserting the OPPOSITE of the fix, and asserting its presence would fail
  // forever.
  //
  // What a source scan can still prove is the part that is still in the source:
  // BOTH reads go to the constrained view and NEITHER touches the raw table.
  // Whether the view carries the predicate on a given database is not knowable
  // from here — that is asserted live by scripts/check-db-invariants.py, and
  // behaviourally (against a fake that models the view) by
  // tests/unit/sitemap-suspension-behaviour.test.ts.

  test('reads the public_profiles view, never the raw profiles table', () => {
    expect(content).toMatch(/\.from\(\s*['"]public_profiles['"]\s*\)/);
    expect(content).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
  });

  test('BOTH the metadata and page fetches use the constrained source', () => {
    // KAN-488: generateMetadata and the page no longer make two reads — both
    // call the ONE cached `loadPublicProfileRow`, whose chain is checked here.
    // Was: two blocks located by select('display_name, headline, bio_short')
    // and select('*') in page.tsx, each required to read from('public_profiles').
    const rowFnStart = content.indexOf('export const loadPublicProfileRow');
    expect(rowFnStart).toBeGreaterThan(-1);
    const rowFn = content.slice(rowFnStart, content.indexOf('.maybeSingle()', rowFnStart));
    expect(rowFn).toContain("from('public_profiles')");
    expect(rowFn).toContain(".select('*')");
    expect(rowFn).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);

    // Both route consumers go through it, and the route reads nothing itself.
    const route = fs.readFileSync(path.join(root, routePath), 'utf8');
    expect(route.match(/await loadPublicProfileRow\(slug\)/g)).toHaveLength(2);
    expect(route).not.toMatch(/\.from\(\s*['"][a-z_]+['"]\s*\)/);
  });

  test('the page does not narrow the view back to the raw table by hand', () => {
    // A plausible "tidy-up" is to re-add the predicates alongside the view read
    // — harmless — or to revert one read to `profiles` while leaving the other
    // on the view, which is the half-migration that makes the SEC-100 checker
    // report ✓ over an unguarded site. Only the second is a defect, and this
    // pins it.
    const fromCalls = [...content.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(fromCalls.length).toBeGreaterThan(0);
    expect([...new Set(fromCalls)]).not.toContain('profiles');
  });
});
