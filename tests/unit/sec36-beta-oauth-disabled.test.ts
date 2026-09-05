/**
 * SEC-36: beta has no OAuth authorization server, so it must not answer as one.
 *
 * WHY OFF RATHER THAN KEYED
 * -------------------------
 * Beta advertised ITSELF as the issuer and answered on /oauth/token, /register
 * and /revoke, while /.well-known/jwks.json returned 500 — beta has no RS256
 * keypair and never has. The obvious remedy is to give it one. That is the
 * wrong remedy.
 *
 * Beta runs on the PRODUCTION Supabase project (CLAUDE.md gotcha #19). A
 * working beta AS would mint tokens whose `sub` is a real production user and
 * write jti rows into production's `oauth_access_tokens` — a token factory for
 * production identities in the deliberately less-hardened environment,
 * separated from production by a single `iss` string comparison in the
 * verifier. Turning it off costs nothing and removes the whole class.
 *
 * Verified 2026-08-09 that nothing points at beta: both resource servers derive
 * the AS from LYRA_SITE_URL — prod MCP leaves it unset (defaults to
 * checklyra.com), dev MCP sets dev.checklyra.com. That is the "confirm unused"
 * question SEC-36 asked in June, answered.
 *
 * The load-bearing case below is /oauth/register while SIGNED OUT. The existing
 * beta gate further down middleware.ts only runs `if (deployTier && user)`, so
 * an unauthenticated Dynamic Client Registration call sailed past it and wrote
 * into PRODUCTION's oauth_clients.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

// Signed OUT on purpose — the DCR path is reachable without a session, which is
// exactly why the existing authenticated-only gate could not cover it.
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const AS_PATHS = [
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/register',
  '/oauth/revoke',
  '/.well-known/oauth-authorization-server',
  '/.well-known/jwks.json',
  // The internal rewrite targets are directly addressable, so gating only the
  // public half would leave a back door.
  '/api/well-known/jwks',
  '/api/well-known/oauth-authorization-server',
];

function req(path: string, host: string): NextRequest {
  return new NextRequest(new URL(`https://${host}${path}`), { headers: { host } });
}

describe('SEC-36: beta does not answer as an OAuth authorization server', () => {
  const original = process.env.IS_BETA_DEPLOY;
  afterEach(() => {
    if (original === undefined) delete process.env.IS_BETA_DEPLOY;
    else process.env.IS_BETA_DEPLOY = original;
  });

  it.each(AS_PATHS)('404s %s on beta', async (path) => {
    process.env.IS_BETA_DEPLOY = 'true';
    const res = await middleware(req(path, 'beta.checklyra.com'));
    expect(res.status).toBe(404);
  });

  it('404s /oauth/register on beta while SIGNED OUT — the DCR write into prod', async () => {
    // The case the pre-existing beta gate could not reach: it runs only
    // `if (deployTier && user)`. An unauthenticated registration call therefore
    // reached the route and inserted into PRODUCTION's oauth_clients, because
    // beta shares the production database.
    process.env.IS_BETA_DEPLOY = 'true';
    const res = await middleware(req('/oauth/register', 'beta.checklyra.com'));
    expect(res.status).toBe(404);
  });

  it('does NOT gate these paths when the deploy is not beta', async () => {
    // The inverse. A gate that fired everywhere would take production's real
    // authorization server offline — far worse than the problem it fixes.
    delete process.env.IS_BETA_DEPLOY;
    for (const path of AS_PATHS) {
      const res = await middleware(req(path, 'checklyra.com'));
      expect(res.status).not.toBe(404);
    }
  });

  it('does not gate unrelated paths on beta', async () => {
    process.env.IS_BETA_DEPLOY = 'true';
    for (const path of ['/', '/search', '/login', '/api/health']) {
      const res = await middleware(req(path, 'beta.checklyra.com'));
      expect(res.status).not.toBe(404);
    }
  });
});
