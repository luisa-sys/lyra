/**
 * KAN-283: the public privacy notice must show the ICO registration reference
 * (ZC124222) and a DUAA-compliant data-protection complaints channel — a
 * 30-day acknowledgement commitment citing the Data (Use and Access) Act 2025
 * and ICO signposting (helpline + Wycliffe House postal address). A dedicated
 * /complaints page must exist and be reachable from the site-wide footer.
 *
 * These are compliance-locking assertions (UK GDPR + DUAA 2025). If one breaks,
 * raise with Luisa before changing it — do not weaken the assertion.
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');
const privacyPath = path.join(root, SRC.privacyPage);
const complaintsPath = path.join(root, SRC.complaintsPage);
const footerPath = path.join(root, SRC.footer);

describe('KAN-283: privacy notice — ICO registration reference', () => {
  let content;
  beforeAll(() => {
    content = fs.readFileSync(privacyPath, 'utf8');
  });

  test('shows the ICO registration reference ZC124222', () => {
    expect(content).toContain('ZC124222');
  });
});

describe('KAN-283: privacy notice — DUAA complaints section', () => {
  let content;
  beforeAll(() => {
    content = fs.readFileSync(privacyPath, 'utf8');
  });

  test('has a "Data protection complaints" heading', () => {
    expect(content).toContain('Data protection complaints');
  });

  test('commits to acknowledging a complaint within 30 days', () => {
    expect(content).toContain('within 30 days');
  });

  test('cites the Data (Use and Access) Act 2025', () => {
    expect(content).toContain('Data (Use and Access) Act 2025');
  });

  test('signposts the ICO with helpline and postal address', () => {
    expect(content).toContain('0303 123 1113');
    expect(content).toContain('Wycliffe House');
  });

  test('links to the dedicated complaints page', () => {
    expect(content).toContain('/complaints');
  });
});

describe('KAN-283: dedicated /complaints page', () => {
  let content;
  beforeAll(() => {
    content = fs.readFileSync(complaintsPath, 'utf8');
  });

  test('the complaints page file exists', () => {
    expect(fs.existsSync(complaintsPath)).toBe(true);
  });

  test('has a "Data protection complaints" heading', () => {
    expect(content).toContain('Data protection complaints');
  });

  test('carries the same DUAA 30-day commitment + statute cite', () => {
    expect(content).toContain('within 30 days');
    expect(content).toContain('Data (Use and Access) Act 2025');
  });

  test('signposts the ICO with helpline and Wycliffe House address', () => {
    expect(content).toContain('0303 123 1113');
    expect(content).toContain('Wycliffe House');
  });

  test('routes complaints to the monitored privacy inbox', () => {
    expect(content).toContain('privacy@checklyra.com');
  });
});

describe('KAN-283: footer links to the complaints page', () => {
  test('footer contains a /complaints link', () => {
    const content = fs.readFileSync(footerPath, 'utf8');
    expect(content).toContain('/complaints');
  });
});
