/**
 * KAN-88 P3 — /oauth/authorize request validator tests.
 *
 * Mocks the client lookup so we exercise the validation logic in
 * isolation. The DB-touching path (issueAuthCode + getConsent) is
 * covered by the live smoke test after deploy.
 */

import {
  buildErrorRedirect,
  buildSuccessRedirect,
  validateAuthorizeRequest,
} from '@/lib/oauth/authorize';

jest.mock('@/lib/oauth/clients', () => {
  return {
    getOauthClient: jest.fn(async (clientId: string) => {
      if (clientId === 'lyra_oauth_known') {
        return {
          client_id: 'lyra_oauth_known',
          client_secret_hash: null,
          client_name: 'Test Client',
          redirect_uris: ['https://example.com/cb', 'https://example.com/cb2'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          application_type: 'web',
          token_endpoint_auth_method: 'none',
          scopes: 'lyra:full',
          revoked_at: null,
        };
      }
      if (clientId === 'lyra_oauth_revoked') {
        return {
          client_id: 'lyra_oauth_revoked',
          client_secret_hash: null,
          client_name: 'Revoked',
          redirect_uris: ['https://example.com/cb'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          application_type: 'web',
          token_endpoint_auth_method: 'none',
          scopes: 'lyra:full',
          revoked_at: '2026-05-01T00:00:00Z',
        };
      }
      return null;
    }),
  };
});

describe('validateAuthorizeRequest (KAN-88 P3)', () => {
  const validParams = {
    response_type: 'code' as const,
    client_id: 'lyra_oauth_known',
    redirect_uri: 'https://example.com/cb',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'random123',
    scope: 'lyra:full',
  };

  test('accepts a minimal valid request', async () => {
    const v = await validateAuthorizeRequest(validParams);
    if (!v.ok) throw new Error(`expected ok, got ${JSON.stringify(v.error)}`);
    expect(v.req.client.client_id).toBe('lyra_oauth_known');
    expect(v.req.scope).toBe('lyra:full');
    expect(v.req.state).toBe('random123');
  });

  test('FATAL: unknown client_id returns invalid_client, no redirect', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, client_id: 'lyra_oauth_nope' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.kind).toBe('fatal');
    expect(v.error.code).toBe('invalid_client');
  });

  test('FATAL: missing client_id is invalid_client', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, client_id: undefined });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.kind).toBe('fatal');
    expect(v.error.code).toBe('invalid_client');
  });

  test('FATAL: revoked client is invalid_client', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, client_id: 'lyra_oauth_revoked' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.kind).toBe('fatal');
    expect(v.error.description).toMatch(/revoked/);
  });

  test('FATAL: unregistered redirect_uri', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, redirect_uri: 'https://evil.com/cb' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.kind).toBe('fatal');
    expect(v.error.code).toBe('invalid_redirect_uri');
  });

  test('FATAL: redirect_uri must be exact match (one of the registered ones)', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, redirect_uri: 'https://example.com/cb/' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.kind).toBe('fatal');
  });

  test('REDIRECT: unsupported response_type', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, response_type: 'token' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.kind).toBe('redirect');
    if (v.error.kind !== 'redirect') return;
    expect(v.error.code).toBe('unsupported_response_type');
    expect(v.error.redirectUri).toBe('https://example.com/cb');
    expect(v.error.state).toBe('random123');
  });

  test('REDIRECT: missing code_challenge', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, code_challenge: undefined });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    if (v.error.kind !== 'redirect') throw new Error('expected redirect');
    expect(v.error.code).toBe('invalid_request');
    expect(v.error.description).toMatch(/code_challenge/);
  });

  test('REDIRECT: code_challenge_method must be S256 (not plain)', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, code_challenge_method: 'plain' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    if (v.error.kind !== 'redirect') throw new Error('expected redirect');
    expect(v.error.code).toBe('invalid_request');
    expect(v.error.description).toMatch(/S256/);
  });

  test('REDIRECT: unknown scope is invalid_scope', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, scope: 'admin' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    if (v.error.kind !== 'redirect') throw new Error('expected redirect');
    expect(v.error.code).toBe('invalid_scope');
  });

  test('defaults scope to client.scopes when not provided', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, scope: undefined });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.req.scope).toBe('lyra:full');
  });

  test('state is optional', async () => {
    const v = await validateAuthorizeRequest({ ...validParams, state: undefined });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.req.state).toBeUndefined();
  });
});

describe('buildErrorRedirect / buildSuccessRedirect (KAN-88 P3)', () => {
  test('error redirect includes error, error_description, state', () => {
    const url = buildErrorRedirect('https://example.com/cb', 'access_denied', 'user said no', 'abc');
    expect(url).toContain('error=access_denied');
    expect(url).toContain('error_description=user+said+no');
    expect(url).toContain('state=abc');
  });

  test('error redirect without state omits the state param', () => {
    const url = buildErrorRedirect('https://example.com/cb', 'invalid_request', 'missing', undefined);
    expect(url).not.toMatch(/[?&]state=/);
  });

  test('preserves existing query params on redirect_uri', () => {
    const url = buildErrorRedirect('https://example.com/cb?extant=1', 'access_denied', 'no', 's');
    expect(url).toContain('extant=1');
    expect(url).toContain('error=access_denied');
  });

  test('success redirect includes code + state, no error', () => {
    const url = buildSuccessRedirect('https://example.com/cb', 'authcode_xyz', 'abc');
    expect(url).toContain('code=authcode_xyz');
    expect(url).toContain('state=abc');
    expect(url).not.toContain('error=');
  });
});
