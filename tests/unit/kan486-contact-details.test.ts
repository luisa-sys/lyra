/**
 * KAN-486 — contact-detail filter for public profile text (spec v0.8 §05).
 *
 * Expected values are literals written from the spec, never derived from the
 * module (CLAUDE.md failure mode 10). Both directions are pinned: what must be
 * caught, and ordinary text that must NOT be caught — a filter that blocks
 * "Born in 1999" would be worse than none.
 */
import { findContactDetails, type ContactKind } from '@/modules/profile/contact-details';

const MUST_FLAG: ReadonlyArray<readonly [string, ContactKind]> = [
  // phones
  ['Call me on 07700 900123', 'phone'],
  ['07700900123', 'phone'],
  ['(020) 7946 0958', 'phone'],
  ['+44 7700 900123', 'phone'],
  ['+44 (0)20 7946 0958', 'phone'],
  ['555.123.4567', 'phone'],
  ['+33 6 12 34 56 78', 'phone'],
  ['07 7 0 0 9 0 0 1 2 3', 'phone'],
  // emails, literal and obfuscated
  ['a.b@example.co.uk', 'email'],
  ['name @ gmail . com', 'email'],
  ['name[at]gmail[dot]com', 'email'],
  ['name (at) gmail (dot) com', 'email'],
  ['write to name at gmail dot com', 'email'],
  ['name@gmail', 'email'],
  ['n a m e @ g m a i l . c o m', 'email'],
  // UK postcodes
  ['SW1A 1AA', 'postcode'],
  ['sw1a1aa', 'postcode'],
  ['near M1 1AE', 'postcode'],
  // street addresses
  ['12 High Street', 'address'],
  ['Flat 3, 22 Acacia Road', 'address'],
  ['10 Downing Street, London', 'address'],
  ['PO Box 123', 'address'],
];

const MUST_PASS: readonly string[] = [
  'Born in 1999',
  'The years 1999 2000 2001 were good',
  'I have 4 kids',
  'Sold for £1,250,000',
  'ISBN 9780143128540',
  'Open 24/7',
  'look at the dot com boom',
  'Coronation Street fan',
  'I live off Abbey Road',
  'Score 120 340 560',
  'See https://example.com/page/12345678901',
  'I love long walks, good coffee and kind people.',
  '',
];

describe('KAN-486 findContactDetails — must flag', () => {
  test('corpus is the size written here (guards against an empty test.each)', () => {
    expect(MUST_FLAG.length).toBe(22);
  });

  test.each(MUST_FLAG)('%s → %s', (text, kind) => {
    expect(findContactDetails(text)).toContain(kind);
  });
});

describe('KAN-486 findContactDetails — must pass', () => {
  test('corpus is the size written here', () => {
    expect(MUST_PASS.length).toBe(13);
  });

  test.each(MUST_PASS)('%j is not flagged', (text) => {
    expect(findContactDetails(text)).toEqual([]);
  });
});

describe('KAN-486 findContactDetails — places mode', () => {
  test('allowPlaces lets a postcode and a street address through', () => {
    expect(findContactDetails('SW1A 1AA', { allowPlaces: true })).toEqual([]);
    expect(findContactDetails('12 High Street', { allowPlaces: true })).toEqual([]);
  });

  test('allowPlaces still catches phones and emails', () => {
    expect(findContactDetails('07700 900123', { allowPlaces: true })).toEqual(['phone']);
    expect(findContactDetails('a@b.com', { allowPlaces: true })).toEqual(['email']);
  });
});
