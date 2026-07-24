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
  // KAN-258 — shared invite code for the private (invite-only) phase.
  // When set, creating an account requires this code and third-party
  // sign-in is hidden. Empty string = gate off (open signup).
  inviteCode: () => optionalEnv('LYRA_INVITE_CODE', ''),

  // KAN-274 — cross-domain auth cookie domain for the beta access
  // programme. When set (to '.checklyra.com' on prod + beta ONLY), Supabase
  // auth cookies are scoped to the parent domain so a session established on
  // checklyra.com is also valid on beta.checklyra.com (shared-cookie SSO).
  // Unset everywhere else → cookies stay host-scoped, so dev/stage are fully
  // isolated and unchanged. Returns undefined (not '') when unset so callers
  // can spread it conditionally without writing an empty domain.
  cookieDomain: (): string | undefined => process.env.COOKIE_DOMAIN || undefined,

  // KAN-276 — base URL of the beta deploy. New users signing up on prod are
  // routed here (where the IS_BETA_DEPLOY middleware shows /waitlist). Only
  // takes effect when BETA_ROUTING_ENABLED is 'true' (inert until cutover).
  betaAppUrl: () => optionalEnv('BETA_APP_URL', 'https://beta.checklyra.com'),

  // KAN-276 — address Luisa is notified at when someone joins the beta queue.
  betaQueueNotifyEmail: () =>
    optionalEnv('BETA_QUEUE_NOTIFY_EMAIL', 'luisa@santos-stephens.com'),

  // KAN-276 / KAN-278 — master switch for the prod→beta routing behaviour.
  // INERT BY DEFAULT: only when this is exactly 'true' does prod redirect
  // new signups / approved users over to the beta deploy. Flip at cutover.
  betaRoutingEnabled: (): boolean => process.env.BETA_ROUTING_ENABLED === 'true',
};
// Force rebuild 20260329011858
