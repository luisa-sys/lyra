/**
 * Search/browse page tests
 * KAN-136: Public search/browse page with profile cards and filters
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('KAN-136: Search page exists and has correct structure', () => {
  const searchPagePath = path.join(root, 'src/app/search/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(searchPagePath, 'utf8');
  });

  test('search page file exists', () => {
    expect(fs.existsSync(searchPagePath)).toBe(true);
  });

  test('page has metadata with title', () => {
    expect(content).toContain("title: 'Find someone");
  });

  test('page accepts search query param', () => {
    expect(content).toContain('searchParams');
    expect(content).toContain("q?:");
  });

  test('page queries Supabase for published profiles', () => {
    expect(content).toContain("is_published");
    expect(content).toContain("true");
    expect(content).toContain(".from('profiles')");
  });

  test('search filters by name, headline, city, slug', () => {
    expect(content).toContain('display_name.ilike');
    expect(content).toContain('headline.ilike');
    expect(content).toContain('city.ilike');
    expect(content).toContain('slug.ilike');
  });

  test('page contains search input form', () => {
    expect(content).toContain('type="text"');
    expect(content).toContain('name="q"');
    expect(content).toContain('action="/search"');
  });

  test('page shows result count', () => {
    expect(content).toContain('profiles.length');
    expect(content).toContain("found");
  });

  test('page has empty state for no results', () => {
    expect(content).toContain('No profiles found');
  });

  test('page has initial empty state before search', () => {
    expect(content).toContain('Search for someone');
  });

  test('page limits results to 30', () => {
    expect(content).toContain('.limit(30)');
  });
});

describe('KAN-136: ProfileCard component', () => {
  const searchPagePath = path.join(root, 'src/app/search/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(searchPagePath, 'utf8');
  });

  test('ProfileCard component exists', () => {
    expect(content).toContain('function ProfileCard');
  });

  test('ProfileCard links to profile slug', () => {
    expect(content).toContain('href={`/${profile.slug}`}');
  });

  test('ProfileCard shows display name', () => {
    expect(content).toContain('profile.display_name');
  });

  test('ProfileCard shows headline when present', () => {
    expect(content).toContain('profile.headline');
  });

  test('ProfileCard shows city when present', () => {
    expect(content).toContain('profile.city');
  });

  test('ProfileCard shows avatar initial', () => {
    expect(content).toContain('profile.display_name.charAt(0)');
  });
});

describe('KAN-136: Homepage links to search', () => {
  const homepagePath = path.join(root, 'src/app/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(homepagePath, 'utf8');
  });

  test('homepage nav has Find someone link', () => {
    expect(content).toContain('href="/search"');
    expect(content).toContain('Find someone');
  });
});
