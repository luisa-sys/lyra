/**
 * SEO optimisation unit tests
 * KAN-28: SEO optimisation across all checklyra.com pages
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('SEO Optimisation', () => {
  test('robots.txt exists with correct directives', () => {
    const robots = fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /dashboard/');
    expect(robots).toContain('Disallow: /login');
    expect(robots).toContain('Sitemap: https://checklyra.com/sitemap.xml');
  });

  test('dynamic sitemap.ts exists and queries published profiles', () => {
    const sitemap = fs.readFileSync(path.join(root, 'src/app/sitemap.ts'), 'utf8');
    expect(sitemap).toContain('is_published');
    expect(sitemap).toContain('env.siteUrl()');
    expect(sitemap).toContain('changeFrequency');
    expect(sitemap).toContain('priority');
  });

  test('root layout has metadataBase and canonical URL', () => {
    const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toContain('metadataBase');
    expect(layout).toContain('checklyra.com');
    expect(layout).toContain('canonical');
  });

  test('root layout has Twitter card metadata', () => {
    const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toContain('twitter');
    expect(layout).toContain('card');
    expect(layout).toContain('summary');
  });

  test('root layout has Open Graph metadata with locale', () => {
    const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toContain('openGraph');
    expect(layout).toContain('en_GB');
    expect(layout).toContain('siteName');
  });

  test('public profile page has Twitter cards and canonical URL', () => {
    const profile = fs.readFileSync(path.join(root, 'src/app/[slug]/page.tsx'), 'utf8');
    expect(profile).toContain('twitter');
    expect(profile).toContain('canonical');
    expect(profile).toContain('generateMetadata');
  });

  test('public profile page has JSON-LD structured data', () => {
    const profile = fs.readFileSync(path.join(root, 'src/app/[slug]/page.tsx'), 'utf8');
    expect(profile).toContain('application/ld+json');
    expect(profile).toContain('schema.org');
    expect(profile).toContain('Person');
  });

  test('landing page has JSON-LD structured data', () => {
    const home = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
    expect(home).toContain('application/ld+json');
    expect(home).toContain('WebSite');
  });

  test('robots.txt blocks auth and dashboard pages from indexing', () => {
    const robots = fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8');
    expect(robots).toContain('Disallow: /login');
    expect(robots).toContain('Disallow: /signup');
    expect(robots).toContain('Disallow: /auth/');
    expect(robots).toContain('Disallow: /dashboard/');
  });
});
