'use server';

import { redirect } from 'next/navigation';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-server';
import { env } from '@/lib/env';
import { computeAccessTransition } from '@/app/admin/users/users-actions-shared';

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

  const svc = createServiceRoleClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
  const { update } = computeAccessTransition('enable_beta', {
    now: new Date().toISOString(),
  });
  await svc.from('profiles').update(update).eq('user_id', user.id);

  redirect('/dashboard');
}
