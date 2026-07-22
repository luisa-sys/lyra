/**
 * BUGS-67: "See example profiles" must open a gallery of ALL curated example
 * profiles, not jump to a single one.
 *
 * The bug: the homepage ghost CTA linked to `/${people[0].slug}` — the first
 * example only — so "see example profiles" showed exactly one person. These
 * tests lock in (a) the homepage CTA now targets the /examples gallery, and
 * (b) the gallery lists the whole curated example set, each card linking to the
 * individual profile so visitors can pick who to explore.
 *
 * Source-level assertions (like homepage-content.test.js): these are
 * server components that query Supabase, so we assert on the wiring rather than
 * render them against a live DB.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const homepagePath = path.join(root, 'src/app/page.tsx');
const examplesPath = path.join(root, 'src/app/examples/page.tsx');

describe('BUGS-67: homepage "See example profiles" CTA', () => {
  let home;
  beforeAll(() => {
    home = fs.readFileSync(homepagePath, 'utf8');
  });

  test('the CTA label is unchanged', () => {
    expect(home).toContain('See example profiles');
  });

  test('the ghost CTA now targets the /examples gallery, not a single profile', () => {
    expect(home).toContain('const exampleHref = "/examples"');
    // Regression guard: it must NOT derive the target from a single profile
    // slug the way the bug did.
    expect(home).not.toContain('`/${people[0].slug}`');
  });
});

describe('BUGS-67: /examples gallery page', () => {
  let page;
  beforeAll(() => {
    page = fs.readFileSync(examplesPath, 'utf8');
  });

  test('the examples page exists', () => {
    expect(fs.existsSync(examplesPath)).toBe(true);
  });

  test('renders fresh (force-dynamic) so newly-curated examples appear', () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  test('queries ONLY curated example profiles (KAN-334 allowlist)', () => {
    expect(page).toContain("is_published");
    expect(page).toContain("is_homepage_example");
  });

  test('shows the whole set — NOT capped at the homepage band\'s 6', () => {
    // The homepage band uses .limit(6); the gallery must show more than that.
    expect(page).not.toContain('.limit(6)');
    // It maps the fetched profiles into a grid of cards.
    expect(page).toMatch(/people\.map\(/);
  });

  test('each example card links to the individual profile so people can pick', () => {
    expect(page).toContain('href={`/${profile.slug}`}');
  });

  test('mirrors the homepage prod guard — no browseable directory on prod', () => {
    // checklyra.com is the gated waitlist doorway; the gallery redirects home
    // there, exactly like the homepage showcase is hidden on prod.
    expect(page).toContain('isProdDeploy');
    expect(page).toContain("redirect(\"/\")");
  });

  test('degrades to an empty state instead of 500ing if the DB read throws', () => {
    expect(page).toMatch(/catch\s*\{[\s\S]*return \[\]/);
  });
});
