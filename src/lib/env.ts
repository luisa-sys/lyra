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
};
// Force rebuild 20260329011858
