/**
 * Convene-specific environment variables.
 *
 * Kept separate from the platform-wide src/lib/env.ts so that missing Convene
 * env vars never break the rest of the app — Convene is feature-flagged, so a
 * fresh checkout without Convene env vars must still boot.
 *
 * Tracked under KAN-203.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required Convene env var: ${name}. ` +
        `If you don't intend to run Convene locally, set CONVENE_ENABLED=false (or unset).`
    );
  }
  return value;
}

export const conveneEnv = {
  // Google OAuth client used for Calendar + Contacts scopes.
  // Same client as Supabase Google Sign-In (see CLAUDE.md / KAN-125), but with
  // additional scopes requested in incremental-consent mode.
  googleClientId: () => requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
  googleClientSecret: () => requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
  googleRedirectUri: () =>
    requireEnv('GOOGLE_CALENDAR_REDIRECT_URI'),
};
