/**
 * SEC-120 — the single source of truth for "which IP do we rate-limit on".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The precedence rule used to live in two places — `getClientIp` in
 * `src/middleware.ts` and `clientIpFromHeaders` in `src/lib/rate-limit-shared.ts`
 * — and both preferred `cf-connecting-ip`, a header any client can set:
 *
 *     cf-connecting-ip ?? x-forwarded-for ?? x-real-ip ?? 'unknown'
 *
 * CONFIRMED LIVE 2026-08-04, not theoretical. The Vercel origin answers
 * directly, bypassing Cloudflare:
 *
 *     $ curl -sSI https://lyra-kohl.vercel.app/
 *     HTTP/2 200 · server: Vercel · (no cf-ray)
 *
 * and Vercel Deployment Protection is entirely off — no password, no Vercel
 * Authentication, no trusted IPs. So an actor reaching the origin rotates
 * `cf-connecting-ip` per request and mints a fresh rate-limit bucket each time.
 * Mutation-proven: 0 of 200 blocked with a rotating header, against 20 of 30
 * with a stable one.
 *
 * The endpoint that matters is `/oauth/register` — its own header calls it
 * INTENTIONALLY UNAUTHENTICATED and names "Capped per-IP rate limit" as a
 * mitigation, and `sharedRateLimit` is genuinely cross-instance there, so the
 * IP key is the ONLY thing making the 5-clients/hour cap bite.
 *
 * WHY NOT SIMPLY PREFER x-forwarded-for
 * -------------------------------------
 * Through Cloudflare, Vercel's `x-forwarded-for` is a Cloudflare EDGE ip. So
 * preferring it would collapse all genuine traffic into a handful of buckets
 * and rate-limit everybody — an outage, not a fix. This is a trusted-proxy
 * configuration problem, not a careless `??` ordering.
 *
 * THE RULE
 * --------
 * Trust `cf-connecting-ip` only when the request PROVABLY transited Cloudflare,
 * evidenced by a shared secret that a CF Transform Rule stamps on every request
 * and that a direct-to-origin client cannot know.
 *
 * Note that `cf-ray` is NOT sufficient evidence: an attacker forging
 * `cf-connecting-ip` can forge `cf-ray` in the same breath. Only a secret the
 * attacker does not hold distinguishes the two paths.
 */
import { env } from '@/lib/env';

/** Header a Cloudflare Transform Rule stamps with the shared secret. */
export const CF_PROXY_HEADER = 'x-lyra-edge';

function firstForwarded(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/**
 * Did this request provably come through our Cloudflare edge?
 *
 * Returns false when the secret is not configured — callers then keep the
 * legacy precedence (see `clientIp`). That is deliberate and temporary: see
 * the rollout note there.
 */
export function transitedCloudflare(headers: Headers): boolean {
  const expected = env.cfProxySecret();
  if (!expected) return false;
  const got = headers.get(CF_PROXY_HEADER);
  return Boolean(got) && got === expected;
}

/**
 * The IP to key rate-limit buckets on.
 *
 * ROLLOUT NOTE — read before changing the unconfigured branch.
 *
 * When `CF_PROXY_SECRET` is unset we fall back to the LEGACY precedence rather
 * than to `x-forwarded-for`. Switching an unconfigured deployment to XFF would
 * bucket every Cloudflare-fronted request by edge IP and rate-limit the whole
 * user base — trading an abuse vector for an outage. So the secure behaviour
 * activates when the founder configures the edge, and until then this is
 * explicitly no worse than before, never worse.
 *
 * `isTrustedProxyConfigured()` is exported so the gap CAN be surfaced, but is
 * not yet wired anywhere. It was going to go on `/api/health`, and that turned
 * out to be the wrong place: `tests/unit/health-endpoint.test.ts` asserts the
 * response shape with `toEqual` deep equality precisely so a field cannot be
 * added to a PUBLIC endpoint silently. That test is correct and was left
 * alone. Surfacing this belongs on an admin-only surface, as its own change.
 */
export function clientIp(headers: Headers): string {
  // MONITOR MODE (SEC-120). Enforcement is gated behind a SECOND variable on
  // purpose. There is no way to observe, from outside, whether the Cloudflare
  // Transform Rule is actually stamping the header — so flipping straight to
  // enforcement means the first symptom of a mis-built rule is the entire user
  // base rate-limited into a handful of Cloudflare edge-IP buckets.
  //
  // With the secret set but CF_PROXY_ENFORCE unset, behaviour is unchanged and
  // any request arriving WITHOUT a valid secret is logged. Once the logs show
  // that only direct-to-origin traffic is missing it, set CF_PROXY_ENFORCE=1.
  //
  // Rollout order matters and is the reverse of the obvious one:
  //   1. add the CF Transform Rule
  //   2. set CF_PROXY_SECRET        (monitor — safe, observable)
  //   3. confirm the logs are quiet
  //   4. set CF_PROXY_ENFORCE=1     (enforce)
  const trusted = transitedCloudflare(headers);

  if (env.cfProxySecret() && !trusted) {
    // Deliberately not rate-limited or sampled: after step 1 this should be
    // near-silent, and a flood IS the signal that the rule is not working.
    console.warn(
      '[SEC-120] request without a valid edge secret — ' +
        (env.cfProxyEnforce()
          ? 'cf-connecting-ip IGNORED'
          : 'monitor mode, cf-connecting-ip still trusted'),
    );
  }

  if (trusted) {
    // Provably ours: CF overwrites cf-connecting-ip at its own edge, so this
    // is the real client.
    return headers.get('cf-connecting-ip') ?? firstForwarded(headers) ?? 'unknown';
  }

  if (env.cfProxySecret() && env.cfProxyEnforce()) {
    // Enforcing, and this request did not present the secret, so it did not
    // come through our edge. cf-connecting-ip is untrustworthy here — use the
    // platform-set forwarded chain, which a client cannot overwrite.
    return firstForwarded(headers) ?? headers.get('x-real-ip') ?? 'unknown';
  }

  // Unconfigured, or configured-but-monitoring — legacy precedence, unchanged.
  return (
    headers.get('cf-connecting-ip') ??
    firstForwarded(headers) ??
    headers.get('x-real-ip') ??
    'unknown'
  );
}

/** Whether the trusted-proxy secret is configured. Not yet surfaced — see above. */
export function isTrustedProxyConfigured(): boolean {
  return Boolean(env.cfProxySecret());
}

/** 'off' | 'monitor' | 'enforce' — the current trusted-proxy posture. */
export function trustedProxyMode(): 'off' | 'monitor' | 'enforce' {
  if (!env.cfProxySecret()) return 'off';
  return env.cfProxyEnforce() ? 'enforce' : 'monitor';
}
