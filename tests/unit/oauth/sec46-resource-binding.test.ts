/**
 * SEC-46 Phase C — RFC 8707 resource indicators, and `aud` = the resource.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * -----------------------------------
 * `aud` used to be the `client_id`. Both resource servers (mcp.checklyra.com and
 * admin-mcp.checklyra.com) verify against the SAME JWKS with issuer only, so one
 * token was accepted by both — a token minted through the ordinary consent
 * screen reached the admin tool surface, with `profiles.is_admin` and the
 * Cloudflare Access edge the only things in the way. That is SEC-48's leg 2 seen
 * from the authorization server, and Dynamic Client Registration being open is
 * what makes it reachable: anyone can register a client and receive a
 * legitimately-signed token every resource server honours.
 *
 * These tests pin the three things that make the binding real rather than
 * decorative:
 *   1. `aud` is the resource and `client_id` survives as a SEPARATE claim;
 *   2. an unknown `resource` is REJECTED, not silently ignored;
 *   3. an absent `resource` resolves to the environment default, so the binding
 *      exists even for clients that have never heard of RFC 8707.
 *
 * (3) is the one that makes enforcement deployable: without it, turning on
 * audience checking on the resource servers would 401 every existing connector.
 */

import { validateAuthorizeRequest } from '@/modules/oauth-as/lib/authorize';
import { buildAuthorizePath } from '@/modules/oauth-as/consent-flow';

const RESOURCE = 'https://mcp-dev.checklyra.com/mcp';
const ADMIN_RESOURCE = 'https://admin-mcp-dev.checklyra.com/mcp';

jest.mock('@/modules/oauth-as/lib/clients', () => ({
  getOauthClient: jest.fn().mockResolvedValue({
    client_id: 'lyra_oauth_test',
    redirect_uris: ['https://client.test/cb'],
    scopes: 'lyra:full',
    revoked_at: null,
  }),
}));

const BASE = {
  response_type: 'code',
  client_id: 'lyra_oauth_test',
  redirect_uri: 'https://client.test/cb',
  scope: 'lyra:full',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
};

describe('SEC-46 — resource indicator validation at /oauth/authorize', () => {
  const prev = process.env.OAUTH_ALLOWED_RESOURCES;
  beforeEach(() => {
    process.env.OAUTH_ALLOWED_RESOURCES = `${RESOURCE},${ADMIN_RESOURCE}`;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.OAUTH_ALLOWED_RESOURCES;
    else process.env.OAUTH_ALLOWED_RESOURCES = prev;
  });

  test('a registered resource is accepted and carried onto the validated request', async () => {
    const r = await validateAuthorizeRequest({ ...BASE, resource: RESOURCE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req.resource).toBe(RESOURCE);
  });

  test('the SECOND registered resource is accepted too — the list is a list', async () => {
    // Guards against an implementation that only ever honours the default.
    const r = await validateAuthorizeRequest({ ...BASE, resource: ADMIN_RESOURCE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req.resource).toBe(ADMIN_RESOURCE);
  });

  test('an UNKNOWN resource is rejected with invalid_target, not ignored', async () => {
    // Silently dropping it is what makes RFC 8707 decorative: the client would
    // believe it holds a narrowly-scoped token and would not.
    const r = await validateAuthorizeRequest({
      ...BASE,
      resource: 'https://evil.test/mcp',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('redirect');
    if (r.error.kind !== 'redirect') return;
    expect(r.error.code).toBe('invalid_target');
  });

  test('matching is EXACT — a prefix of a real resource is rejected', async () => {
    // `https://mcp-dev.checklyra.com/mcp.evil.test` starts with the real
    // resource. A prefix or substring test would hand back exactly the
    // cross-resource replay this binding exists to prevent.
    const r = await validateAuthorizeRequest({
      ...BASE,
      resource: `${RESOURCE}.evil.test`,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    if (r.error.kind !== 'redirect') return;
    expect(r.error.code).toBe('invalid_target');
  });

  test('a trailing slash is tolerated (same resource, RFC 8707 §2 canonicalisation)', async () => {
    const r = await validateAuthorizeRequest({ ...BASE, resource: `${RESOURCE}/` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req.resource).toBe(RESOURCE);
  });

  test('an ABSENT resource resolves to the environment default, never undefined', async () => {
    // This is what keeps non-RFC-8707 clients working AND bound. Without it,
    // enforcing `aud` on the resource servers would 401 every existing
    // connector, and the rollout could never start.
    const r = await validateAuthorizeRequest({ ...BASE });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req.resource).toBe(RESOURCE);
  });

  test('an EMPTY resource is treated as absent, not as an unknown target', async () => {
    const r = await validateAuthorizeRequest({ ...BASE, resource: '   ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req.resource).toBe(RESOURCE);
  });
});

describe('SEC-46 — the resource survives the /login round-trip', () => {
  test('buildAuthorizePath carries `resource` through the sign-in bounce', () => {
    // Losing it here is SILENT: the user signs in, returns, and is issued a
    // token bound to the DEFAULT resource instead of the requested one. No
    // error — just a quietly different audience.
    const path = buildAuthorizePath({
      clientId: 'lyra_oauth_test',
      redirectUri: 'https://client.test/cb',
      scope: 'lyra:full',
      state: 'st',
      codeChallenge: 'x'.repeat(43),
      codeChallengeMethod: 'S256',
      resource: ADMIN_RESOURCE,
    });
    expect(path).toContain(`resource=${encodeURIComponent(ADMIN_RESOURCE)}`);
  });

  test('the frozen parameter order is preserved — resource is appended LAST', () => {
    // That function's header records the authorize URL as a frozen contract
    // compared verbatim. A new parameter inserted mid-string would break
    // consumers that diff it.
    const path = buildAuthorizePath({
      clientId: 'c',
      redirectUri: 'https://client.test/cb',
      scope: 'lyra:full',
      state: 'st',
      codeChallenge: 'y',
      codeChallengeMethod: 'S256',
      resource: RESOURCE,
    });
    expect(path.indexOf('code_challenge_method=')).toBeLessThan(path.indexOf('resource='));
  });

  test('omitting resource emits no empty parameter', () => {
    const path = buildAuthorizePath({
      clientId: 'c',
      redirectUri: 'https://client.test/cb',
      scope: 'lyra:full',
      codeChallenge: 'y',
      codeChallengeMethod: 'S256',
    });
    expect(path).not.toContain('resource=');
  });
});
