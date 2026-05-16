/**
 * KAN-193: tests for the affiliate disclosure additions on the privacy
 * and cookie policy pages, plus the existence of the cookie audit doc.
 *
 * Locks the compliance-relevant strings so they can't disappear in a
 * later refactor without intent. If these tests break, raise with Luisa
 * before changing the assertions — UK GDPR / PECR / FTC require the
 * specific disclosures.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('KAN-193: privacy policy — Affiliate partners section', () => {
  const filePath = path.join(root, 'src/app/(legal)/privacy/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('has an "Affiliate partners" heading', () => {
    expect(content).toContain('Affiliate partners');
  });

  test('names Sovrn Commerce as an affiliate partner', () => {
    expect(content).toContain('Sovrn Commerce');
  });

  test('discloses that Lyra may earn a commission', () => {
    expect(content).toContain('commission');
  });

  test('discloses that the commission is at no extra cost to the user', () => {
    expect(content).toMatch(/no extra cost/i);
  });

  test('lists what data is shared with affiliate partners', () => {
    // Must enumerate: URL, opaque tracking id, browser metadata
    expect(content.toLowerCase()).toContain('opaque');
    expect(content.toLowerCase()).toMatch(/url|referring/);
  });

  test('explicitly states what is NOT shared', () => {
    // Email / name / profile content / recipient identity must NOT be shared.
    // The JSX may have inline tags (<strong>never</strong>) so we tolerate
    // small gaps between "never" and "share".
    expect(content).toMatch(/never<\/?\w+>?\s*share/i);
    expect(content).toMatch(/email|name|profile content/i);
  });

  test('states the lawful basis as legitimate interest under UK GDPR', () => {
    expect(content).toMatch(/legitimate interest/i);
    expect(content).toContain('Art. 6(1)(f)');
  });

  test('links to the /partners page for the long-form disclosure', () => {
    expect(content).toMatch(/href=["']\/partners["']/);
  });

  test('links to Sovrn\'s own privacy policy', () => {
    expect(content).toContain('sovrn.com/legal/privacy-policy');
  });

  test('Last updated date reflects this PR', () => {
    expect(content).toContain('16 May 2026');
  });
});

describe('KAN-193: cookie policy — Affiliate links section', () => {
  const filePath = path.join(root, 'src/app/(legal)/cookies/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('has an "Affiliate links" heading', () => {
    expect(content).toContain('Affiliate links');
  });

  test('states explicitly that Lyra sets no cookies for affiliate flow', () => {
    // The strong claim — required so a user reading just this paragraph
    // can be confident they aren't being tracked on the Lyra domain.
    expect(content).toMatch(/does not set any cookies/i);
  });

  test('names Sovrn Commerce', () => {
    expect(content).toContain('Sovrn Commerce');
  });

  test('links to Sovrn\'s privacy policy', () => {
    expect(content).toContain('sovrn.com/legal/privacy-policy');
  });

  test('links to the /partners disclosure page', () => {
    expect(content).toMatch(/href=["']\/partners["']/);
  });

  test('clarifies that retailer cookies are governed by retailer policy', () => {
    expect(content.toLowerCase()).toMatch(/retailer/);
  });

  test('Last updated date reflects this PR', () => {
    expect(content).toContain('16 May 2026');
  });
});

describe('KAN-193: cookie audit doc', () => {
  const filePath = path.join(root, 'docs/COOKIE_AUDIT.md');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('doc file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('enumerates the essential Lyra cookies', () => {
    expect(content).toContain('sb-*-auth-token');
    expect(content).toContain('__cf_bm');
  });

  test('states no analytics / marketing / targeting cookies are set', () => {
    expect(content.toLowerCase()).toContain('no analytics cookies');
    expect(content.toLowerCase()).toContain('no marketing');
  });

  test('explains the affiliate-link cookie boundary (off-domain)', () => {
    expect(content).toMatch(/nothing on the .{0,20}checklyra/i);
  });

  test('documents the click-log schema reference (KAN-189)', () => {
    expect(content).toContain('affiliate_clicks');
    expect(content).toContain('KAN-189');
  });

  test('records that no cookie consent banner change is required', () => {
    expect(content.toLowerCase()).toMatch(/no cookie consent banner change/);
  });

  test('points at the public-facing pages for the human-readable disclosure', () => {
    expect(content).toContain('src/app/(legal)/cookies/page.tsx');
    expect(content).toContain('src/app/(legal)/privacy/page.tsx');
    expect(content).toContain('src/app/(legal)/partners/page.tsx');
  });
});
