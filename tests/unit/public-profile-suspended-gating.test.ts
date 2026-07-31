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
const pagePath = SRC.slugPage;

describe('SEC-44: public profile page filters suspended profiles', () => {
  const content = fs.readFileSync(path.join(root, pagePath), 'utf8');

  test(`${pagePath} exists`, () => {
    expect(fs.existsSync(path.join(root, pagePath))).toBe(true);
  });

  test('excludes suspended profiles via .eq(\'is_suspended\', false)', () => {
    expect(content).toMatch(/\.eq\(\s*['"]is_suspended['"]\s*,\s*false\s*\)/);
  });

  test('applies the suspension filter on BOTH the metadata and page fetches', () => {
    // The two service-role reads are distinguished by their select() shape:
    // generateMetadata selects specific columns; the page fetch selects '*'.
    const metaFetch = content.slice(
      content.indexOf("select('display_name, headline, bio_short')"),
    );
    const pageFetch = content.slice(content.indexOf(".select('*')"));

    const suspensionFilter = /\.eq\(\s*['"]is_suspended['"]\s*,\s*false\s*\)/;

    // Each fetch block ends at its `.single()`; assert the filter appears
    // before that terminator in both.
    const metaBlock = metaFetch.slice(0, metaFetch.indexOf('.single()'));
    const pageBlock = pageFetch.slice(0, pageFetch.indexOf('.single()'));

    expect(metaBlock).toMatch(suspensionFilter);
    expect(pageBlock).toMatch(suspensionFilter);
  });

  test('still requires is_published = true (does not weaken the existing guard)', () => {
    expect(content).toMatch(/\.eq\(\s*['"]is_published['"]\s*,\s*true\s*\)/);
  });
});
