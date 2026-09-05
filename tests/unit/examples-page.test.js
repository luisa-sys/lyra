/**
 * Example-profiles gallery page tests
 *
 * The homepage hero's ghost CTA ("See example profiles") now leads to a
 * dedicated /examples gallery that lists EVERY curated example profile, instead
 * of jumping to the single first profile. The homepage "A few people to meet"
 * band still previews only the first 6.
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');
const examplesPath = path.join(root, SRC.examplesPage);
const homepagePath = path.join(root, SRC.appPage);

describe('Example profiles gallery (/examples)', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(examplesPath, 'utf8');
  });

  test('examples page file exists', () => {
    expect(fs.existsSync(examplesPath)).toBe(true);
  });

  test('page has metadata with title', () => {
    expect(content).toContain('title: "Example profiles');
  });

  test('renders fresh so newly-published examples appear without a redeploy', () => {
    expect(content).toContain('export const dynamic = "force-dynamic"');
  });

  test('queries published curated example profiles, ordered', () => {
    // SEC-104: reads moved from the `profiles` table to the `public_profiles`
    // view, which carries `is_published = true AND is_suspended = false` in its
    // body and therefore binds the service-role client (RLS does not).
    expect(content).toContain('.from("public_profiles")');
    expect(content).not.toContain('.from("profiles")');
    expect(content).toContain('.eq("is_homepage_example", true)');
    expect(content).toContain('homepage_example_order');
  });

  test('lists ALL examples — not just the homepage band\'s 6', () => {
    // The homepage band caps at .limit(6); the gallery must NOT reuse that cap.
    expect(content).not.toContain('.limit(6)');
    expect(content).toContain('.limit(60)');
  });

  test('KAN-334: gated to curated examples only (never real users)', () => {
    expect(content).toContain('is_homepage_example');
  });

  test('KAN-273: prod front door surfaces no browseable directory — redirects home', () => {
    expect(content).toContain('isProdDeploy');
    expect(content).toContain('LYRA_FORCE_WAITLIST');
    expect(content).toContain('redirect("/")');
  });

  test('cards link to each profile by slug', () => {
    expect(content).toContain('href={`/${profile.slug}`}');
    expect(content).toContain('profile.display_name');
    expect(content).toContain('profile.headline');
  });

  test('has an empty state when no examples are present', () => {
    expect(content).toContain('No example profiles yet');
  });
});

describe('Homepage "See example profiles" CTA targets the gallery', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(homepagePath, 'utf8');
  });

  test('ghost CTA no longer jumps to the first profile slug', () => {
    expect(content).not.toContain('`/${people[0].slug}`');
  });

  test('ghost CTA points at the /examples gallery', () => {
    expect(content).toContain('const exampleHref = "/examples"');
    expect(content).toContain('See example profiles');
  });
});
