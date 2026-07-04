/**
 * KAN-348 — authenticated E2E harness: service-role admin client factory.
 *
 * Used ONLY by the Playwright globalSetup (tests/e2e/global-setup.ts) to seed
 * deterministic test users and mint sessions against DEV / STAGING Supabase.
 *
 * ── SECURITY / PROD GUARD ────────────────────────────────────────────────────
 *  • The harness reads its OWN, distinct env vars — `E2E_SUPABASE_URL` and
 *    `E2E_SUPABASE_SERVICE_ROLE_KEY` — NOT the app's NEXT_PUBLIC_SUPABASE_URL /
 *    SUPABASE_SERVICE_ROLE_KEY. This keeps the privileged harness creds out of
 *    the app-under-test runtime (never bundled, never injected into Next).
 *  • A HARD guard at construction refuses the prod ref/host and only allows the
 *    dev + staging project refs. There is no prod bypass anywhere in the design:
 *    every privileged write requires this service-role key, which is absent in
 *    the prod app runtime.
 *
 * The client is only constructed by adminClient(); importing this module has no
 * side effects, so the anon PR gate (which never calls adminClient) is unaffected.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Prod project ref — the harness MUST NEVER touch this. */
export const PROD_REF = 'llzkgprqewuwkiwclowi';
/** Dev project ref (dev-lyra). */
export const DEV_REF = 'ilprytcrnqyrsbsrfujj';
/** Staging project ref. */
export const STAGING_REF = 'uobmlkzrjkptwhttzmmi';

const ALLOWED_REFS: readonly string[] = [DEV_REF, STAGING_REF];

function readEnv(): { url: string; serviceKey: string } {
  const url = process.env.E2E_SUPABASE_URL;
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'E2E harness: E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY must both be set ' +
        '(dev/staging only). These are DISTINCT from the app\'s NEXT_PUBLIC_SUPABASE_URL / ' +
        'SUPABASE_SERVICE_ROLE_KEY so the harness creds never leak into the app runtime.',
    );
  }
  return { url, serviceKey };
}

/** Parse the project ref from a Supabase URL host (`https://<ref>.supabase.co`). */
export function projectRefFromUrl(url: string): string {
  try {
    const host = new URL(url).host; // <ref>.supabase.co  (or a custom host)
    return host.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * Assert the target Supabase URL is a permitted (dev/staging) project and NOT
 * prod. Throws before any client is constructed or any DB write is attempted.
 */
export function assertNotProd(url: string): string {
  if (url.includes(PROD_REF) || url.includes('checklyra.com')) {
    throw new Error('E2E harness refuses to run against prod Supabase');
  }
  const ref = projectRefFromUrl(url);
  if (!ALLOWED_REFS.includes(ref)) {
    throw new Error(
      `E2E harness: refusing to run against unrecognised Supabase project ref "${ref}". ` +
        `Only dev (${DEV_REF}) and staging (${STAGING_REF}) are allowed.`,
    );
  }
  return ref;
}

/** The dev/staging project ref derived from E2E_SUPABASE_URL (guarded). */
export function projectRef(): string {
  const { url } = readEnv();
  return assertNotProd(url);
}

/**
 * The SSR auth cookie name Supabase writes for this project
 * (`sb-<ref>-auth-token`). Exposed for the mint step / debugging.
 */
export function cookieName(): string {
  return `sb-${projectRef()}-auth-token`;
}

/**
 * Service-role admin client. Guarded: throws immediately if pointed at prod or
 * a non-allowlisted project. Sessions are never persisted (server-side use only).
 */
export function adminClient(): SupabaseClient {
  const { url, serviceKey } = readEnv();
  assertNotProd(url);
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
