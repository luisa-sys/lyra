'use server';

import { redirect } from 'next/navigation';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import { createClient } from '@/modules/platform/supabase-server';
import { env } from '@/modules/platform/env';
import { computeAccessTransition } from '@/modules/access/access-model';
import { getAccountStanding, shouldRefuseIssuance } from '@/modules/access/account-status';

/**
 * KAN-336 — redeem a skip-the-waitlist code from the /waitlist page.
 *
 * Google/OAuth signups can't carry an invite code: there's no signup form in
 * the OAuth flow, so the code from KAN-336's signup field never reaches
 * resolveBetaAccess and the user always lands on the waitlist. This action lets
 * an already-authenticated waitlisted user paste the same code to skip the queue.
 *
 * The user is already signed in (they reached /waitlist past the auth gate), so
 * possessing the correct code IS the authorisation. We re-validate the secret
 * VALUE server-side against env.inviteCode() and grant beta via the service role
 * (which passes the admin-only prevent_beta_self_elevation trigger) using the
 * same canonical enable_beta transition as the signup fast-track — so the access
 * model never drifts between the two entry points.
 */
export async function redeemWaitlistCode(formData: FormData): Promise<void> {
  const code = String(formData.get('invite_code') ?? '').trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const configured = env.inviteCode();
  if (!configured || code !== configured) {
    // Wrong/blank code (or the feature isn't configured) — back to the waitlist
    // with a flag so the page can show a gentle "not recognised" message.
    redirect('/waitlist?error=invalid');
  }

  // SEC-82: defence-in-depth — a suspended account must not be able to
  // self-elevate to beta by pasting the code. Mirror the SEC-57 issuance guard
  // and fail closed on anything other than confirmed good standing. (Middleware
  // already routes a suspended user to /suspended, but that gate fails open on a
  // lookup error; this narrow check does not.)
  const standing = await getAccountStanding(supabase, user.id);
  if (shouldRefuseIssuance(standing)) {
    redirect('/waitlist?error=suspended');
  }

  const svc = createServiceRoleClient();
  const { update } = computeAccessTransition('enable_beta', {
    now: new Date().toISOString(),
  });
  // SEC-82: don't swallow the grant failure. Previously the update error was
  // ignored and the user was sent to /dashboard as if it had succeeded, so a
  // failed grant produced a silently-still-waitlisted account with no signal.
  const { error: grantError } = await svc
    .from('profiles')
    .update(update)
    .eq('user_id', user.id);
  if (grantError) {
    console.error('[waitlist] beta grant failed:', grantError.message);
    redirect('/waitlist?error=grant_failed');
  }

  redirect('/dashboard');
}
