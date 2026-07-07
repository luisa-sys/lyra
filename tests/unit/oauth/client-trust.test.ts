/**
 * SEC-76 (web-oauth-7) — DCR anti-phishing helper tests.
 *
 * Pure logic behind the /oauth/authorize consent-screen trust surface:
 * a verified/unverified verdict (fail-closed) and the redirect host shown
 * to the user before they grant access.
 */

import { clientTrust, redirectHost } from '@/lib/oauth/client-trust';

describe('clientTrust (SEC-76 web-oauth-7)', () => {
  test('a strict boolean true is the ONLY verified state', () => {
    const t = clientTrust(true);
    expect(t.verified).toBe(true);
    expect(t.label).toBe('Verified app');
  });

  test('false is unverified', () => {
    const t = clientTrust(false);
    expect(t.verified).toBe(false);
    expect(t.label).toBe('Unverified app');
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['string "true"', 'true'],
    ['number 1', 1],
    ['object', {}],
  ])('fails closed for %s → unverified', (_label, value) => {
    const t = clientTrust(value);
    expect(t.verified).toBe(false);
    expect(t.label).toBe('Unverified app');
  });
});

describe('redirectHost (SEC-76 web-oauth-7)', () => {
  test('returns the host of a valid https redirect URI', () => {
    expect(redirectHost('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
  });

  test('includes a non-default port', () => {
    expect(redirectHost('http://localhost:3000/cb')).toBe('localhost:3000');
  });

  test('surfaces a look-alike host verbatim (no normalisation that hides it)', () => {
    expect(redirectHost('https://lyra-official.evil.example/cb')).toBe('lyra-official.evil.example');
  });

  test('never throws on an unparseable value — falls back to the raw string', () => {
    expect(redirectHost('not a url')).toBe('not a url');
  });
});
