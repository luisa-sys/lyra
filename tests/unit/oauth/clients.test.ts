/**
 * KAN-88 P2 — Dynamic Client Registration validator tests.
 *
 * Pure validation logic, no DB. The DB-touching createOauthClient path
 * is exercised by the integration smoke test once the endpoint is live.
 */

import {
  validateRegisterInput,
  generateClientId,
  generateClientSecret,
  hashClientSecret,
} from '@/lib/oauth/clients';

describe('validateRegisterInput (KAN-88 P2)', () => {
  const minimal = {
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  };

  test('accepts minimal valid input + defaults grant/response/auth method', () => {
    const v = validateRegisterInput(minimal);
    if (!v.ok) throw new Error(`expected ok, got ${v.error.code}`);
    expect(v.input.client_name).toBe('Claude');
    expect(v.input.grant_types).toEqual(['authorization_code']);
    expect(v.input.response_types).toEqual(['code']);
    expect(v.input.application_type).toBe('web');
    expect(v.input.token_endpoint_auth_method).toBe('none');
  });

  test('rejects non-object body', () => {
    const v = validateRegisterInput('string-body');
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.code).toBe('invalid_client_metadata');
  });

  test('rejects missing client_name', () => {
    const v = validateRegisterInput({ redirect_uris: ['https://x.com/cb'] });
    expect(v.ok).toBe(false);
  });

  test('rejects empty client_name', () => {
    const v = validateRegisterInput({ ...minimal, client_name: '' });
    expect(v.ok).toBe(false);
  });

  test('rejects >200 char client_name', () => {
    const v = validateRegisterInput({ ...minimal, client_name: 'x'.repeat(201) });
    expect(v.ok).toBe(false);
  });

  test('rejects missing/empty redirect_uris', () => {
    expect(validateRegisterInput({ client_name: 'Claude' }).ok).toBe(false);
    expect(validateRegisterInput({ client_name: 'Claude', redirect_uris: [] }).ok).toBe(false);
  });

  test('rejects >10 redirect_uris', () => {
    const v = validateRegisterInput({
      ...minimal,
      redirect_uris: new Array(11).fill('https://x.com/cb'),
    });
    expect(v.ok).toBe(false);
  });

  test('rejects non-https redirect_uri (except localhost)', () => {
    const v = validateRegisterInput({ ...minimal, redirect_uris: ['http://malicious.com/cb'] });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.code).toBe('invalid_redirect_uri');
  });

  test('allows http://localhost for native dev (RFC 8252)', () => {
    const v = validateRegisterInput({ ...minimal, redirect_uris: ['http://localhost:8080/cb'] });
    expect(v.ok).toBe(true);
    const v2 = validateRegisterInput({ ...minimal, redirect_uris: ['http://127.0.0.1:3000/cb'] });
    expect(v2.ok).toBe(true);
  });

  test('rejects redirect_uri with fragment', () => {
    const v = validateRegisterInput({ ...minimal, redirect_uris: ['https://x.com/cb#frag'] });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.code).toBe('invalid_redirect_uri');
  });

  test('rejects unsupported grant_type', () => {
    const v = validateRegisterInput({ ...minimal, grant_types: ['password'] });
    expect(v.ok).toBe(false);
  });

  test('accepts subset of supported grant_types', () => {
    expect(validateRegisterInput({ ...minimal, grant_types: ['authorization_code'] }).ok).toBe(true);
    expect(
      validateRegisterInput({ ...minimal, grant_types: ['authorization_code', 'refresh_token'] }).ok
    ).toBe(true);
  });

  test('rejects non-code response_type', () => {
    const v = validateRegisterInput({ ...minimal, response_types: ['token'] });
    expect(v.ok).toBe(false);
  });

  test('rejects unknown application_type', () => {
    const v = validateRegisterInput({ ...minimal, application_type: 'tv' });
    expect(v.ok).toBe(false);
  });

  test('accepts native application_type', () => {
    const v = validateRegisterInput({ ...minimal, application_type: 'native' });
    expect(v.ok).toBe(true);
  });

  test('rejects unknown token_endpoint_auth_method', () => {
    const v = validateRegisterInput({ ...minimal, token_endpoint_auth_method: 'private_key_jwt' });
    expect(v.ok).toBe(false);
  });
});

describe('client id / secret generators (KAN-88 P2)', () => {
  test('client_id has lyra_oauth_ prefix and is URL-safe', () => {
    const id = generateClientId();
    expect(id).toMatch(/^lyra_oauth_[A-Za-z0-9_-]+$/);
    expect(id.length).toBeGreaterThan(20);
  });

  test('100 client_ids are all unique (entropy check)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(generateClientId());
    expect(ids.size).toBe(100);
  });

  test('client_secret is high-entropy URL-safe', () => {
    const s = generateClientSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThan(40);
  });

  test('hashClientSecret returns 64-char hex (sha256)', () => {
    const h = hashClientSecret('test-secret');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashClientSecret is deterministic for same input', () => {
    expect(hashClientSecret('abc')).toBe(hashClientSecret('abc'));
  });
});
