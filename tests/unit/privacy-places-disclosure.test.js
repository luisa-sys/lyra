/**
 * KAN-251 / KAN-341: the public privacy policy must disclose that the optional
 * town/city finder sends the postcode or place text the user types to Google's
 * Places API to resolve a town/city, and that only the resulting city is stored
 * (the postcode/place text is never persisted by Lyra). This is a UK GDPR
 * Art. 13-14 recipient/transfer disclosure and gates the KAN-349/404 promote.
 *
 * These are compliance-locking assertions. If one breaks, raise with Luisa
 * before changing it — do not weaken the assertion.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const filePath = path.join(root, 'src/app/(legal)/privacy/page.tsx');

describe('KAN-251/KAN-341: privacy policy — Google Places town/city disclosure', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('still names Google as a processor', () => {
    expect(content).toContain('Google');
  });

  test('discloses the optional town/city (place) lookup use of Google', () => {
    expect(content).toMatch(/town\/city|place name/i);
  });

  test('names the Google Places API as the recipient of the lookup text', () => {
    expect(content).toMatch(/Google Places API/i);
  });

  test('states only the resulting town/city is stored, not the postcode/place text', () => {
    expect(content).toMatch(/never stored by Lyra/i);
    expect(content).toMatch(/only the resulting town\/city is saved/i);
  });
});
