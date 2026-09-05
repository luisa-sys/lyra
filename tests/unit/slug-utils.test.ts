/**
 * decodeSlug — resolving the public profile [slug] route param.
 *
 * Regression: a percent-encoded non-ASCII slug (e.g. an accented "í") reached
 * the profile lookup undecoded, so `.eq('slug', …)` never matched the stored
 * value and the profile 404'd (surfaced by the /examples gallery via
 * "rosa-martínez"). decodeSlug URL-decodes + NFC-normalises the param.
 */

import { decodeSlug } from '@/modules/public-profile/slug-utils';

describe('decodeSlug', () => {
  test('leaves a pure-ASCII slug unchanged', () => {
    expect(decodeSlug('olu-adebayo-a0000000')).toBe('olu-adebayo-a0000000');
  });

  test('URL-decodes a percent-encoded accented slug to the stored NFC form', () => {
    // "rosa-mart%C3%ADnez-a0000000" → "rosa-martínez-a0000000" (NFC "í").
    const decoded = decodeSlug('rosa-mart%C3%ADnez-a0000000');
    expect(decoded).toBe('rosa-martínez-a0000000');
    expect(Buffer.from(decoded, 'utf8').toString('hex')).toContain('c3ad'); // NFC í
  });

  test('decodes the raw (already-decoded) accented form to the same NFC value', () => {
    expect(decodeSlug('rosa-martínez-a0000000')).toBe('rosa-martínez-a0000000');
  });

  test('normalises a decomposed (NFD) accented slug to NFC', () => {
    // NFD "í" = "i" + combining acute (U+0301). Percent-encoded combining mark.
    const nfd = 'rosa-marti%CC%81nez-a0000000';
    const decoded = decodeSlug(nfd);
    expect(decoded).toBe('rosa-martínez-a0000000');
    expect(Buffer.from(decoded, 'utf8').toString('hex')).toContain('c3ad'); // collapsed to NFC í
  });

  test('leaves an apostrophe slug intact (apostrophes are not percent-encoded in paths)', () => {
    expect(decodeSlug("michael-o'connor-a0000000")).toBe("michael-o'connor-a0000000");
  });

  test('falls back to the raw value on malformed percent-encoding (no throw)', () => {
    // A lone "%" is invalid percent-encoding; decodeURIComponent throws — we
    // must not crash the route, just return a value that won't match → 404.
    expect(() => decodeSlug('bad-%-slug')).not.toThrow();
    expect(decodeSlug('bad-%-slug')).toBe('bad-%-slug');
  });
});
