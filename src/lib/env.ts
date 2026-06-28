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
};
// Force rebuild 20260329011858
