/**
 * Google OAuth helper unit tests (KAN-204).
 *
 * Exercises URL construction and HTTP error handling without hitting Google.
 *
 * BUGS-86 — THE SCOPE ORACLE MUST NOT BE THE CONSTANT UNDER TEST
 * --------------------------------------------------------------
 * This file used to assert the scopes like this:
 *
 *     for (const s of GOOGLE_SCOPES) expect(scope).toContain(s);
 *
 * The expected value was computed from the subject, so the two could never
 * disagree. Three mutations to `src/lib/convene/google/oauth.ts` left the
 * suite 6/6 green (measured 2026-08-14, BUGS-86 comment 15062, and
 * re-measured 2026-08-16 before this change):
 *
 *   * delete `contacts.readonly` from `GOOGLE_SCOPES` — the loop iterates
 *     whatever remains, and the URL is built from the same array;
 *   * `GOOGLE_SCOPES = []` — green with ZERO assertions executed;
 *   * ADD `https://mail.google.com/` (full Gmail read/write) — a
 *     presence-only assertion is structurally incapable of seeing an
 *     over-requested scope, on a service holding minors' personal data;
 *   * `GOOGLE_SCOPES.join(',')` — `toContain` matches each scope URL as a
 *     substring whatever the delimiter, but Google's OAuth 2.0 requires
 *     space-delimited scopes, so this breaks authorization in production
 *     while CI stays green.
 *
 * CTL-038 cannot see this: the reimplementation detector looks for a test
 * that never reaches its subject, and this one does import and call it. The
 * flaw is the oracle, not the reach.
 *
 * So `EXPECTED_SCOPES` below is written out BY HAND and compared as a SET.
 * Set equality is what catches over-requesting; the delimiter is asserted
 * separately. Same pattern as `microsoft-oauth-behaviour.test.ts`, which was
 * written this way precisely because of this file.
 *
 * ⚠️ `offline_access` is a MICROSOFT scope and must NOT appear below.
 * Google returns a refresh token from the `access_type=offline` query
 * parameter, not from a scope — that is asserted by the
 * `includes every required parameter` test, which already turns red when it
 * is removed.
 */

import { buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken, GOOGLE_SCOPES } from '@/lib/convene/google/oauth';

/**
 * Hardcoded on purpose — deriving these from `GOOGLE_SCOPES` is BUGS-86.
 * Changing this list is a deliberate change to what Lyra asks Google for.
 */
const EXPECTED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts.readonly',
];

const ORIGINAL_FETCH = global.fetch;

describe('convene/google/oauth', () => {
  beforeAll(() => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://localhost:3000/api/convene/spike/callback';
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  describe('buildAuthorizeUrl', () => {
    it('includes every required parameter', () => {
      const url = buildAuthorizeUrl('xyz-state');
      const u = new URL(url);
      expect(u.origin).toBe('https://accounts.google.com');
      expect(u.pathname).toBe('/o/oauth2/v2/auth');
      expect(u.searchParams.get('client_id')).toBe('test-client-id');
      expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/convene/spike/callback');
      expect(u.searchParams.get('response_type')).toBe('code');
      expect(u.searchParams.get('access_type')).toBe('offline');
      expect(u.searchParams.get('prompt')).toBe('consent');
      expect(u.searchParams.get('include_granted_scopes')).toBe('true');
      expect(u.searchParams.get('state')).toBe('xyz-state');
    });

    it('requests EXACTLY the three documented Convene scopes', () => {
      const scope = new URL(buildAuthorizeUrl('s')).searchParams.get('scope') ?? '';

      // Set equality, not toContain: this fails on a MISSING scope AND on an
      // EXTRA one. `URLSearchParams` encodes the joined string with '+', and
      // `searchParams.get` decodes it back to spaces.
      expect(new Set(scope.split(' '))).toEqual(new Set(EXPECTED_SCOPES));
    });

    it('space-delimits the scopes, as Google OAuth 2.0 requires', () => {
      const scope = new URL(buildAuthorizeUrl('s')).searchParams.get('scope') ?? '';

      // A ',' join leaves every scope URL present as a substring, so a
      // presence-only assertion is blind to it while Google rejects or
      // silently narrows the request.
      expect(scope).not.toContain(',');
      expect(scope.split(' ')).toHaveLength(EXPECTED_SCOPES.length);
    });

    it('asks for no scope beyond calendar and contacts read', () => {
      const scope = new URL(buildAuthorizeUrl('s')).searchParams.get('scope') ?? '';

      // Called out separately from the set assertion because the failure mode
      // is distinctive and silent: an added Gmail or Drive scope escalates what
      // Lyra may read from a member's Google account with no visible symptom.
      expect(scope).not.toContain('https://mail.google.com');
      expect(scope).not.toContain('auth/gmail');
      expect(scope).not.toContain('auth/drive');
    });

    it('keeps the source constant in step with the expected set', () => {
      // The one assertion that MAY read GOOGLE_SCOPES: it pins the constant to
      // the hand-written list rather than deriving the list from it, so a
      // drifting constant is a red build and not a silently-adjusted oracle.
      expect([...GOOGLE_SCOPES]).toEqual(EXPECTED_SCOPES);
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('throws with a useful message on non-2xx', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"error":"invalid_grant"}'),
      }) as unknown as typeof fetch;

      await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow(/400/);
      await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow(/invalid_grant/);
    });

    it('returns parsed token payload on 200', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: GOOGLE_SCOPES.join(' '),
            token_type: 'Bearer',
          }),
      }) as unknown as typeof fetch;

      const out = await exchangeCodeForTokens('good-code');
      expect(out.access_token).toBe('at');
      expect(out.refresh_token).toBe('rt');
    });
  });

  describe('refreshAccessToken', () => {
    it('throws with a useful message on non-2xx', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('expired'),
      }) as unknown as typeof fetch;

      await expect(refreshAccessToken('rt')).rejects.toThrow(/401/);
    });

    it('returns refreshed access token on 200', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-at',
            expires_in: 3600,
            scope: GOOGLE_SCOPES.join(' '),
            token_type: 'Bearer',
          }),
      }) as unknown as typeof fetch;

      const out = await refreshAccessToken('rt');
      expect(out.access_token).toBe('new-at');
    });
  });
});
