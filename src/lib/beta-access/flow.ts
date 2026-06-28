/**
 * KAN-276 + KAN-278 (epic KAN-273): beta-access recording + routing, run from
 * the auth callback after a magic-link sign-in.
 *
 *  - resolveBetaAccess: records a brand-new signup as 'requested' (none ->
 *    requested) and notifies the admin ONCE (KAN-276); reports approval status.
 *    All writes go through the SERVICE ROLE so they pass the admin-only trigger
 *    from 20260620120100_beta_access_lockdown.sql.
 *  - betaRedirectUrl: pure — decides where to send the user (KAN-278 / KAN-326).
 *    On the prod family (prod + beta share the .checklyra.com cookie, KAN-274)
 *    it routes by access_tier: live+prod -> checklyra.com, live+beta ->
 *    beta.checklyra.com, not-live -> the beta waitlist. Dev/stage stay on their
 *    own origin and let the in-app middleware gate handle waitlisting.
 */
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { sendBetaQueueNotice } from './email';
import { computeAccessTransition } from '@/app/admin/users/users-actions-shared';

const BETA_HOST = 'https://beta.checklyra.com';
const PROD_HOST = 'https://checklyra.com';

export type UserStatus = 'not_applied' | 'waitlist' | 'live';
export type AccessTier = 'beta' | 'prod';

/**
 * Pure: where to redirect after sign-in (KAN-326 — route by access tier).
 *
 * On the prod family (prod OR beta deploy — they share the prod-lyra Supabase
 * and the .checklyra.com cookie, so a session carries across):
 *   - not live  -> the beta waitlist page
 *   - live+prod -> checklyra.com (the production product)
 *   - live+beta -> beta.checklyra.com (the gated beta app)
 * On dev/stage (single full env, host-scoped cookie) stay on the origin and let
 * the in-app middleware gate handle waitlisting.
 */
export function betaRedirectUrl(opts: {
  origin: string;
  isProdFamily: boolean;
  userStatus: UserStatus;
  accessTier: AccessTier;
  next: string;
}): string {
  // Guard against open redirects (SEC-07 + SEC-19/F-12): accept only a same-origin
  // relative path — must start with a single "/", never a protocol-relative
  // "//evil.com" or a backslash variant "/\evil.com" (which some browsers normalise
  // to "//"), and never an absolute / userinfo URL ("@evil.com", "https://evil.com"
  // — neither starts with "/").
  const path =
    opts.next &&
    opts.next.startsWith('/') &&
    !opts.next.startsWith('//') &&
    !opts.next.startsWith('/\\')
      ? opts.next
      : '/dashboard';
  if (opts.isProdFamily) {
    if (opts.userStatus !== 'live') {
      return `${BETA_HOST}/waitlist`;
    }
    return opts.accessTier === 'prod' ? `${PROD_HOST}${path}` : `${BETA_HOST}${path}`;
  }
  // Dev/stage: open — land on the requested page (middleware gates if needed).
  return `${opts.origin}${path}`;
}

/** True only on the real production deployment (not beta/dev/stage/local). */
export function isProdDeploy(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.NEXT_PUBLIC_SITE_URL === 'https://checklyra.com' && e.VERCEL_ENV === 'production';
}

/**
 * The "prod family" = the real production deploy OR the beta deploy. Both share
 * the prod-lyra Supabase project and the .checklyra.com parent cookie, so they
 * form a two-site pair that routes by access_tier. Dev and stage are separate
 * single-env deployments and are NOT part of this family.
 */
export function isProdFamily(e: NodeJS.ProcessEnv = process.env): boolean {
  return isProdDeploy(e) || e.IS_BETA_DEPLOY === 'true';
}

/**
 * Record the user's beta-access state and report approval. Writes via the
 * service role (admin-only trigger). Defensive: any failure must NOT break
 * sign-in — we log and treat the user as not-approved (→ waitlist).
 */
export async function resolveBetaAccess(
  user: {
    id: string;
    email?: string | null;
  },
  opts?: { carriedCode?: string },
): Promise<{ userStatus: UserStatus; accessTier: AccessTier }> {
  try {
    const svc = createServiceRoleClient(env.supabaseUrl(), env.supabaseServiceRoleKey());

    const { data: profile } = await svc
      .from('profiles')
      .select('user_status, access_tier, display_name, beta_requested_at')
      .eq('user_id', user.id)
      .maybeSingle();

    const userStatus = (profile?.user_status as UserStatus | undefined) ?? 'waitlist';
    const accessTier = (profile?.access_tier as AccessTier | undefined) ?? 'beta';

    // Already an active user — nothing to record.
    if (userStatus === 'live') {
      return { userStatus, accessTier };
    }

    // KAN-336 / KAN-337 — fast-track: if this signup carried a valid invite code,
    // grant beta directly (skip the waitlist). The code reaches us two ways, both
    // re-validated SERVER-SIDE here against env.inviteCode() (possessing the
    // correct code IS the authorisation):
    //   • carriedCode — the /join deep-link cookie, read by resolvePostLoginRedirect
    //     (this is the ONLY carrier that survives the Google-OAuth round-trip), and
    //   • user_metadata.invite_code — set by the email sign-up form (user-settable,
    //     hence the re-validation).
    // Only runs when a code is configured, so it adds no work on envs without it.
    const configuredCode = env.inviteCode();
    if (configuredCode) {
      const carriedCookie = (opts?.carriedCode ?? '').trim();
      let granted = !!carriedCookie && carriedCookie === configuredCode;
      if (!granted) {
        const { data: authData } = await svc.auth.admin.getUserById(user.id);
        const carried =
          (authData?.user?.user_metadata?.invite_code as string | undefined) ?? '';
        granted = !!carried && carried === configuredCode;
      }
      if (granted) {
        const { update } = computeAccessTransition('enable_beta', {
          now: new Date().toISOString(),
        });
        await svc.from('profiles').update(update).eq('user_id', user.id);
        return { userStatus: 'live', accessTier: 'beta' };
      }
    }

    // Brand-new signup: record the request once + notify the admin. KAN-326
    // Phase C — the legacy beta_access_status column is gone; we key the one-shot
    // notice off the beta_requested_at audit timestamp being null, so the
    // first-request transition stays atomic + idempotent (the .is(null) guard
    // means a concurrent/retried call updates 0 rows and won't re-notify).
    if (!profile?.beta_requested_at) {
      const { data: updated } = await svc
        .from('profiles')
        .update({
          user_status: 'waitlist',
          beta_requested_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .is('beta_requested_at', null) // idempotent: only the first request notifies
        .select('user_id');

      if (updated && updated.length > 0) {
        await sendBetaQueueNotice({
          userEmail: user.email ?? '(unknown)',
          displayName: (profile?.display_name as string | undefined) ?? null,
        });
      }
      return { userStatus: 'waitlist', accessTier };
    }

    return { userStatus, accessTier };
  } catch (e) {
    console.error('[beta-access] resolveBetaAccess failed', e);
    return { userStatus: 'waitlist', accessTier: 'beta' };
  }
}
