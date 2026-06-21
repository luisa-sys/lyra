/**
 * KAN-276 + KAN-278 (epic KAN-273): beta-access recording + routing, run from
 * the auth callback after a magic-link sign-in.
 *
 *  - resolveBetaAccess: records a brand-new signup as 'requested' (none ->
 *    requested) and notifies the admin ONCE (KAN-276); reports approval status.
 *    All writes go through the SERVICE ROLE so they pass the admin-only trigger
 *    from 20260620120100_beta_access_lockdown.sql.
 *  - betaRedirectUrl: pure — decides where to send the user (KAN-278). On prod
 *    (the public doorway) everyone is pushed to the beta app, carrying their
 *    session via the .checklyra.com cookie (KAN-274): approved -> beta dashboard,
 *    not-yet-approved -> beta waitlist. On beta the in-app middleware gate does
 *    the waitlist routing, and dev/stage stay on their own origin.
 */
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { sendBetaQueueNotice } from './email';

const BETA_HOST = 'https://beta.checklyra.com';

/** Pure: where to redirect after sign-in. `isProd` = the real production app. */
export function betaRedirectUrl(opts: {
  origin: string;
  isProd: boolean;
  approved: boolean;
  next: string;
}): string {
  // Guard against open redirects (SEC-07): accept only a same-origin relative
  // path — it must start with a single "/", never a protocol-relative "//evil.com"
  // or a backslash variant "/\evil.com" (which some browsers normalise to "//"),
  // and never an absolute URL.
  const path =
    opts.next &&
    opts.next.startsWith('/') &&
    !opts.next.startsWith('//') &&
    !opts.next.startsWith('/\\')
      ? opts.next
      : '/dashboard';
  if (opts.isProd) {
    // Prod is a doorway into the gated beta app.
    return opts.approved ? `${BETA_HOST}${path}` : `${BETA_HOST}/waitlist`;
  }
  // Beta: the IS_BETA_DEPLOY middleware routes ineligible users to /waitlist.
  // Dev/stage: open — land on the requested page.
  return `${opts.origin}${path}`;
}

/** True only on the real production deployment (not beta/dev/stage/local). */
export function isProdDeploy(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.NEXT_PUBLIC_SITE_URL === 'https://checklyra.com' && e.VERCEL_ENV === 'production';
}

/**
 * Record the user's beta-access state and report approval. Writes via the
 * service role (admin-only trigger). Defensive: any failure must NOT break
 * sign-in — we log and treat the user as not-approved (→ waitlist).
 */
export async function resolveBetaAccess(user: {
  id: string;
  email?: string | null;
}): Promise<{ approved: boolean }> {
  try {
    const svc = createServiceRoleClient(env.supabaseUrl(), env.supabaseServiceRoleKey());

    const { data: profile } = await svc
      .from('profiles')
      .select('beta_access_status, is_beta_eligible, display_name')
      .eq('user_id', user.id)
      .maybeSingle();

    const status = profile?.beta_access_status as string | undefined;
    if (profile?.is_beta_eligible === true || status === 'approved') {
      return { approved: true };
    }

    // Brand-new signup: record the request once + notify the admin.
    if (status === undefined || status === 'none') {
      const { data: updated } = await svc
        .from('profiles')
        .update({
          beta_access_status: 'requested',
          beta_requested_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('beta_access_status', 'none') // idempotent: only the none->requested transition
        .select('user_id');

      if (updated && updated.length > 0) {
        await sendBetaQueueNotice({
          userEmail: user.email ?? '(unknown)',
          displayName: (profile?.display_name as string | undefined) ?? null,
        });
      }
    }
    return { approved: false };
  } catch (e) {
    console.error('[beta-access] resolveBetaAccess failed', e);
    return { approved: false };
  }
}
