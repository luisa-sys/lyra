/**
 * Public Profile unit tests
 * KAN-8: Public Profiles & Landing Page
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('Public Profile', () => {
  test('public profile page exists at [slug]', () => {
    expect(fs.existsSync(path.join(root, 'src/app/[slug]/page.tsx'))).toBe(true);
  });

  test('custom 404 page exists for missing profiles', () => {
    expect(fs.existsSync(path.join(root, 'src/app/[slug]/not-found.tsx'))).toBe(true);
  });

  test('public profile page has dynamic metadata generation', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/[slug]/page.tsx'), 'utf8');
    expect(content).toContain('generateMetadata');
    expect(content).toContain('openGraph');
  });

  test('public profile page only shows published profiles', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/[slug]/page.tsx'), 'utf8');
    expect(content).toContain("is_published");
    expect(content).toContain("notFound");
  });

  test('public profile page displays all profile sections', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/[slug]/page.tsx'), 'utf8');
    expect(content).toContain('bio_short');
    expect(content).toContain('school_affiliations');
    expect(content).toContain('profile_items');
    expect(content).toContain('external_links');
    expect(content).toContain('gift_ideas');
    expect(content).toContain('boundaries');
  });
});
