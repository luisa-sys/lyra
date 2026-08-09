/**
 * SEC-57: behavioural tests that a suspended (or unverifiable) account cannot
 * OBTAIN new MCP credentials at either issuance point:
 *
 *   - generateApiKey (dashboard settings) returns an error and never inserts an
 *     api_keys row.
 *   - submitConsent (OAuth authorize, Allow path) redirects to /suspended and
 *     never records consent or issues an authorization code.
 *
 * Both paths fail CLOSED: an 'unknown' standing (profiles lookup error) refuses
 * issuance too. A good-standing account still mints normally.
 *
 * A static assertion also pins the defence-in-depth guard on the consent-screen
 * render (page.tsx) so it can't silently regress.
 */

import fs from 'fs';
import path from 'path';

// ── next/navigation: redirect throws so we can assert the target + halt. ──
const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error('REDIRECT');
  },
}));

// ── Shared cookie-auth supabase client (getUser + profiles + api_keys). ──
const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockInsert = jest.fn();
jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }) }),
        };
      }
      // api_keys
      return { insert: (...a: unknown[]) => mockInsert(...a) };
    },
  })),
}));

// generateApiKey's module imports getAdminServiceClient (unused here).
jest.mock('@/lib/admin', () => ({
  getAdminServiceClient: () => ({}),
}));

// ── OAuth libs used by submitConsent. ──
const mockGetOauthClient = jest.fn();
jest.mock('@/modules/oauth-as/lib/clients', () => ({
  getOauthClient: (...a: unknown[]) => mockGetOauthClient(...a),
}));
const mockRecordConsent = jest.fn();
jest.mock('@/modules/oauth-as/lib/consents', () => ({
  recordConsent: (...a: unknown[]) => mockRecordConsent(...a),
}));
const mockIssueAuthCode = jest.fn();
jest.mock('@/modules/oauth-as/lib/codes', () => ({
  issueAuthCode: (...a: unknown[]) => mockIssueAuthCode(...a),
}));
jest.mock('@/modules/oauth-as/lib/authorize', () => ({
  buildErrorRedirect: (uri: string, code: string) => `${uri}?error=${code}`,
  buildSuccessRedirect: (uri: string, code: string) => `${uri}?code=${code}`,
}));

import { generateApiKey } from '@/app/dashboard/settings/actions';
import { submitConsent } from '@/app/oauth/authorize/actions';

const VALID_CONSENT_INPUT = {
  client_id: 'client-1',
  redirect_uri: 'https://claude.ai/callback',
  scope: 'lyra:full',
  state: 'xyz',
  code_challenge: 'abc123',
  code_challenge_method: 'S256' as const,
  decision: 'allow' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
  mockMaybeSingle.mockResolvedValue({ data: { is_suspended: false }, error: null });
  mockInsert.mockResolvedValue({ error: null });
  mockGetOauthClient.mockResolvedValue({
    client_id: 'client-1',
    revoked_at: null,
    redirect_uris: ['https://claude.ai/callback'],
  });
  mockIssueAuthCode.mockResolvedValue({ code: 'authcode-xyz' });
});

// ── generateApiKey ──────────────────────────────────────────
describe('SEC-57 generateApiKey suspension gate', () => {
  test('a good-standing user mints a key', async () => {
    const res = await generateApiKey('My key');
    expect(res.key).toMatch(/^lyra_/);
    expect(res.error).toBeUndefined();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('a suspended user is refused and NO api_keys row is inserted', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { is_suspended: true }, error: null });
    const res = await generateApiKey('My key');
    expect(res.key).toBeUndefined();
    expect(res.error).toMatch(/suspended/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('fails closed: a profiles lookup error refuses issuance', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await generateApiKey('My key');
    expect(res.key).toBeUndefined();
    expect(res.error).toMatch(/suspended/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('still rejects unauthenticated callers before any suspension read', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await generateApiKey('My key');
    expect(res.error).toMatch(/not authenticated/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

// ── submitConsent (OAuth authorize, Allow path) ─────────────
describe('SEC-57 submitConsent suspension gate', () => {
  test('a good-standing user gets an authorization code', async () => {
    await expect(submitConsent({ ...VALID_CONSENT_INPUT })).rejects.toThrow('REDIRECT');
    expect(mockIssueAuthCode).toHaveBeenCalledTimes(1);
    expect(mockRecordConsent).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('https://claude.ai/callback?code=authcode-xyz');
  });

  test('a suspended user is redirected to /suspended and NO code is issued', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { is_suspended: true }, error: null });
    await expect(submitConsent({ ...VALID_CONSENT_INPUT })).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/suspended');
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
    expect(mockRecordConsent).not.toHaveBeenCalled();
  });

  test('fails closed: a profiles lookup error blocks code issuance', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(submitConsent({ ...VALID_CONSENT_INPUT })).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('/suspended');
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  test('the Deny path is unaffected (still an access_denied redirect)', async () => {
    await expect(
      submitConsent({ ...VALID_CONSENT_INPUT, decision: 'deny' }),
    ).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('https://claude.ai/callback?error=access_denied');
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });
});

// The "SEC-57 authorize page render guard" block that sat here was a source-text
// scan: it read page.tsx and asserted three substrings were present. All three
// survive a widening of the condition to `standing !== 'ok'`, which would lock a
// good-standing user out of OAuth on a transient lookup blip — so the scan could
// not have caught the regression that matters most. Replaced by
// tests/unit/oauth-authorize-suspension-guard.test.ts, which executes the page
// and pins all three standing values ('suspended' redirects; 'ok' and 'unknown'
// do not), each mutation-proven. (KAN-414 F4, KAN-417 §8 group 2.)
