/**
 * SEC-36 — beta has no OAuth authorization server. Turn it OFF, don't key it.
 *
 * Lifted verbatim from src/middleware.ts. The reasoning is preserved in full
 * because it is the reason this gate runs FIRST, before authentication and
 * before any database read:
 *
 *   Beta advertised ITSELF as the issuer and answered on /oauth/token,
 *   /register and /revoke, while /.well-known/jwks.json returned 500 — it has
 *   no RS256 keypair on the beta scope and never has. Verified 2026-08-09:
 *   NOTHING points at it. Both resource servers derive the AS from
 *   LYRA_SITE_URL — prod MCP leaves it unset (defaults to checklyra.com) and
 *   dev MCP sets dev.checklyra.com.
 *
 *   Giving beta a keypair would have been the WRONG fix. Beta runs on the
 *   PRODUCTION Supabase project (gotcha #19), so a working beta AS would mint
 *   tokens whose `sub` is a real production user and write jti rows into
 *   production's oauth_access_tokens — a token factory for production
 *   identities in the deliberately less-hardened environment, separated from
 *   prod only by an `iss` string comparison in the verifier.
 *
 *   404, not 403: beta genuinely has no authorization server, and that is what
 *   a client should discover. It also closes the unauthenticated DCR write into
 *   production's oauth_clients via /oauth/register, which the beta gate further
 *   down CANNOT reach, because that one only runs for authenticated requests.
 *
 * That last sentence is why this is typed `Gate<EdgeContext>`: it must answer
 * identically whether or not anyone is signed in, and an EdgeContext has no
 * `user` to consult even by mistake.
 */
import { NextResponse } from 'next/server';
import type { EdgeContext } from '../context';
import type { Gate } from '../gate';
import { isOauthServerPath } from '../oauth-server-paths';

export const betaOauth404: Gate<EdgeContext> = {
  id: 'beta-oauth-404',
  ticket: 'SEC-36',
  why: 'Beta has no authorization server; answering as one mints production identities.',
  run: (ctx) =>
    ctx.env.isBetaDeploy && isOauthServerPath(ctx.pathname)
      ? new NextResponse(null, { status: 404 })
      : null,
};
