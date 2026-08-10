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
};
// Force rebuild 20260329011858
