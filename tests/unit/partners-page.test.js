/**
 * KAN-184: tests for the affiliate partners page + footer linkage.
 *
 * The Sovrn Commerce verification link must remain on a public page reachable
 * from the homepage — Sovrn's crawler follows the footer "Partners" link to
 * verify Lyra owns checklyra.com. If these tests fail, publisher verification
 * may break and our affiliate account could be put back into review.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('KAN-184: Partners page', () => {
  const filePath = path.join(root, 'src/app/(legal)/partners/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('exports metadata with title', () => {
    expect(content).toContain('Affiliate partners');
    expect(content).toContain('metadata');
  });

  test('contains the Sovrn Commerce verification link', () => {
    // Sovrn publisher verification — moving / removing this URL without
    // approval from Sovrn risks invalidating Lyra's publisher account.
    expect(content).toContain('https://sovrn.co/sw3qr9t');
  });

  test('verification link is crawlable (rendered as an <a href>)', () => {
    // The verification link must be a real anchor — Sovrn's bot follows
    // hrefs, not text mentions.
    expect(content).toMatch(/href="https:\/\/sovrn\.co\/sw3qr9t"/);
  });

  test('verification link uses rel attributes that do not block crawling', () => {
    // We use rel="noopener nofollow" — `nofollow` is fine for Sovrn's
    // verification crawler (verification is a one-time HEAD; not a PageRank
    // operation). We must NOT use `rel="nofollow noindex"` which would
    // signal exclusion.
    expect(content).not.toContain('noindex');
  });

  test('discloses affiliate relationship in plain English', () => {
    // FTC + UK ASA require disclosure. Even before the recommender is
    // monetised this page sets the precedent.
    expect(content).toContain('commission');
    expect(content).toContain('Sovrn Commerce');
  });

  test('states recommendations are not chosen for commission', () => {
    // Key trust signal — commission is secondary to recipient match.
    expect(content.toLowerCase()).toContain('not the reason');
  });
});

describe('KAN-184: Partners link in homepage footer', () => {
  const filePath = path.join(root, 'src/app/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('homepage footer links to /partners', () => {
    expect(content).toContain('href="/partners"');
  });

  test('"Partners" link is in the footer alongside Privacy / Terms / Cookies', () => {
    // Sanity check that the link is in the same block as the existing legal
    // links. If the homepage layout changes, this test may need updating.
    expect(content).toMatch(/href="\/privacy"[\s\S]{0,400}href="\/partners"/);
  });
});
