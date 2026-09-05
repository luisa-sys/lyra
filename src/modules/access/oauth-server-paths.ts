/**
 * The OAuth authorization-server surface — KAN-415 D4.
 *
 * ⚠️ THIS IS AN INCLUSION SET, NOT AN EXEMPTION SET. Deliberately a separate
 * module from ./exemptions.ts, with its own name and its own export, even
 * though it shares the PathMatch vocabulary and the matchesAny primitive.
 *
 * Every path here is one SEC-36 TURNS OFF on the beta deploy. Folding it into a
 * table whose column header reads "exempt from" would put it one careless edit
 * — one polarity inversion — away from disabling the 404 entirely.
 *
 * What that 404 is holding shut, from src/middleware.ts:
 *   Beta advertised ITSELF as the issuer and answered on /oauth/token,
 *   /register and /revoke while /.well-known/jwks.json returned 500. Beta runs
 *   on the PRODUCTION Supabase project (gotcha #19), so a working beta AS would
 *   mint tokens whose `sub` is a real production user and write jti rows into
 *   production's oauth_access_tokens. The 404 also closes an unauthenticated
 *   DCR write into production's oauth_clients via /oauth/register — which the
 *   beta gate further down CANNOT reach, because that one only runs for
 *   authenticated requests.
 *
 * Both halves are listed: middleware sees the public /.well-known/* paths, but
 * the internal /api/well-known/* rewrite targets are directly addressable too,
 * so gating only one half leaves a back door.
 */
import { compile, matchesAny, type PathMatch } from './matchers';

const OAUTH_SERVER_PATHS: readonly PathMatch[] = [
  { kind: 'prefix', path: '/oauth/' },
  { kind: 'exact', path: '/.well-known/oauth-authorization-server' },
  { kind: 'exact', path: '/.well-known/jwks.json' },
  { kind: 'prefix', path: '/api/well-known/' },
];

const COMPILED = compile(OAUTH_SERVER_PATHS);

export function isOauthServerPath(pathname: string): boolean {
  return matchesAny(COMPILED, pathname);
}

/** Test-only introspection, mirroring exemptMatchersFor. */
export function oauthServerMatchers(): readonly PathMatch[] {
  return OAUTH_SERVER_PATHS;
}
