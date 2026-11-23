/**
 * Centralised environment variable validation.
 * Fails fast with descriptive errors instead of crashing mid-request.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Check your .env.local file or Vercel environment settings.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  supabaseUrl: () => requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  siteUrl: () => optionalEnv('NEXT_PUBLIC_SITE_URL', 'https://checklyra.com'),
  // KAN-336 (was KAN-258) — shared OPTIONAL sign-up code. When set, entering it
  // on /signup skips the waitlist and grants beta directly (re-validated
  // server-side in resolveBetaAccess). No code = normal waitlist signup; empty
  // string = feature off (no code field shown). Trimmed (KAN-337 review) so a
  // configured code with stray whitespace still matches the trimmed input every
  // comparison site uses (/join, signup, actions, resolveBetaAccess); a
  // whitespace-only value collapses to '' = feature off.
  inviteCode: () => optionalEnv('LYRA_INVITE_CODE', '').trim(),
  // KAN-451 — the same Google Places key the KAN-341 town/city lookup already
  // uses. Optional on purpose: with no key the school type-ahead simply returns
  // nothing and members type their school in themselves, so an unset value
  // degrades the feature rather than breaking it.
  placesApiKey: () => optionalEnv('GOOGLE_PLACES_API_KEY', '').trim(),
  // SEC-120: shared secret a Cloudflare Transform Rule stamps on every request
  // it proxies, proving the request came through our edge. Empty until the
  // founder configures the rule — see src/modules/guards/client-ip.ts for why the
  // unconfigured branch keeps legacy behaviour rather than failing to XFF.
  cfProxySecret: () => optionalEnv('CF_PROXY_SECRET', '').trim(),
  // SEC-120: enforcement is a SECOND switch so the secret can be rolled out in
  // monitor mode first. See the rollout order in src/modules/guards/client-ip.ts.
  cfProxyEnforce: () => optionalEnv('CF_PROXY_ENFORCE', '').trim() === '1',

  /**
   * SEC-46 / RFC 8707 — comma-separated canonical resource URIs this
   * authorization server will mint `aud`-bound tokens for, user MCP first (the
   * first entry is the default when a client sends no `resource`).
   *
   * Lives here rather than being read inline in the oauth-as config because
   * CTL-037 holds the direct-`process.env` set to shrink-only, and reading env
   * is this module's job. Returns the raw string; the oauth-as config owns the
   * splitting and canonicalisation, since that is policy rather than plumbing.
   */
  oauthAllowedResources: () => optionalEnv('OAUTH_ALLOWED_RESOURCES', '').trim(),

  /**
   * KAN-488 — gate for the unauthenticated recommendation APIs
   * (/api/recommendations/[slug] and /api/recommendations/v2/[slug]).
   *
   * Spec v0.8 §3/§03: "never publish an unapproved suggestion" and the public
   * profile "must not expose … unapproved AI content in APIs". Those routes
   * return gift/product suggestions the member never approved, so they are OFF
   * unless this is exactly '1'. Off = 404, before any database read. Turning it
   * back on is a founder decision against the spec, not a config tweak.
   */
  publicRecommendationsApiEnabled: () =>
    optionalEnv('LYRA_PUBLIC_RECOMMENDATIONS_API', '').trim() === '1',
  // KAN-489 — the Anthropic key behind AI gift suggestions (spec v0.8 §03).
  // Server-only and optional on purpose: with no key the editor shows "AI
  // gift suggestions aren't available yet." and never calls the model, so an
  // unset value degrades the feature rather than breaking the editor. Never
  // log or render the value; report only booleans.
  anthropicApiKey: () => optionalEnv('ANTHROPIC_API_KEY', '').trim(),
  anthropicKeyPresent: () => optionalEnv('ANTHROPIC_API_KEY', '').trim() !== '',
  // KAN-489 review — a SECOND switch, like CF_PROXY_ENFORCE: setting the key
  // alone must not start sending member text to a new sub-processor. Only
  // exactly '1' turns the feature on, and it needs founder sign-off first
  // (consent copy, members-only inclusion, privacy-page sub-processor
  // listing — docs/compliance/FOUNDER_CHECKLIST.md).
  aiGiftsEnabled: () => optionalEnv('LYRA_AI_GIFTS_ENABLED', '').trim() === '1',
  // Members can use AI gift suggestions only when BOTH are true.
  aiGiftsConfigured: () =>
    optionalEnv('ANTHROPIC_API_KEY', '').trim() !== '' &&
    optionalEnv('LYRA_AI_GIFTS_ENABLED', '').trim() === '1',
};
// Force rebuild 20260329011858
