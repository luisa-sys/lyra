/**
 * SEC-18 (F-04 part 2) — contact-discovery hashes are HMAC-keyed.
 *
 * The old construction was SHA-256(key || ':' || kind || ':' || value), which
 * an authenticated attacker could rainbow-table to enumerate members. We now
 * HMAC-key the message. These tests pin that, and that getContactSearchHmacKey
 * prefers the dedicated key but falls back to the pepper (non-breaking rollout).
 */

process.env.LYRA_SEARCH_PEPPER = 'unit-test-pepper-long-enough-here';

import { createHash, createHmac } from 'crypto';
import {
  hashContact,
  getContactSearchHmacKey,
  hashPhoneInput,
} from '@/app/dashboard/settings/discoverability-helpers';

const KEY = 'a-test-key-at-least-16-chars';

describe('SEC-18 HMAC contact hashing', () => {
  test('hashContact is HMAC-SHA256, not the old SHA256(key||…) construction', () => {
    const got = hashContact('phone', '+447700900000', KEY);
    const hmac = createHmac('sha256', KEY).update('phone').update(':').update('+447700900000').digest('hex');
    const oldSha = createHash('sha256')
      .update(KEY)
      .update(':')
      .update('phone')
      .update(':')
      .update('+447700900000')
      .digest('hex');
    expect(got).toBe(hmac);
    expect(got).not.toBe(oldSha); // algorithm genuinely changed
    expect(got).toMatch(/^[a-f0-9]{64}$/);
  });

  test('stable per key; different key → different hash', () => {
    const a = hashContact('phone', '+447700900000', KEY);
    const b = hashContact('phone', '+447700900000', KEY);
    const c = hashContact('phone', '+447700900000', 'another-key-16-chars-ok');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test('kind namespacing holds under HMAC', () => {
    expect(hashContact('phone', 'SAMEVALUE', KEY)).not.toBe(hashContact('postcode', 'SAMEVALUE', KEY));
  });

  test('getContactSearchHmacKey prefers CONTACT_SEARCH_HMAC_KEY, falls back to the pepper', () => {
    const orig = process.env.CONTACT_SEARCH_HMAC_KEY;
    process.env.CONTACT_SEARCH_HMAC_KEY = 'dedicated-hmac-key-16chars+';
    expect(getContactSearchHmacKey()).toBe('dedicated-hmac-key-16chars+');
    delete process.env.CONTACT_SEARCH_HMAC_KEY;
    expect(getContactSearchHmacKey()).toBe(process.env.LYRA_SEARCH_PEPPER);
    if (orig === undefined) delete process.env.CONTACT_SEARCH_HMAC_KEY;
    else process.env.CONTACT_SEARCH_HMAC_KEY = orig;
  });

  test('hashPhoneInput end-to-end no longer matches a plain-SHA256 guess', () => {
    const h = hashPhoneInput('07700 900000'); // falls back to pepper as key
    const pepper = process.env.LYRA_SEARCH_PEPPER as string;
    const oldSha = createHash('sha256')
      .update(pepper)
      .update(':')
      .update('phone')
      .update(':')
      .update('+447700900000')
      .digest('hex');
    expect(h).not.toBe(oldSha);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
