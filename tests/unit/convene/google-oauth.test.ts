/**
 * Google OAuth helper unit tests (KAN-204).
 *
 * Exercises URL construction and HTTP error handling without hitting Google.
 */

import { buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken, GOOGLE_SCOPES } from '@/lib/convene/google/oauth';

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

    it('includes all three Convene scopes', () => {
      const url = buildAuthorizeUrl('s');
      const scope = new URL(url).searchParams.get('scope') ?? '';
      for (const s of GOOGLE_SCOPES) {
        expect(scope).toContain(s);
      }
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
