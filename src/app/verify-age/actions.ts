'use server';

/**
 * KAN-282: start a Didit age-verification session and hand off to the hosted
 * selfie flow. Marks the profile 'pending', then redirects to Didit's URL. The
 * outcome arrives via the signed webhook (authoritative) and/or the callback
 * route (immediate UX). No biometric is handled here.
 */
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { env } from '@/lib/env';
import { createAgeSession } from '@/lib/age/didit';
import { profileIdForUser, setProfileAgeStatus } from '@/lib/age/age-service';

export async function startAgeVerification(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/verify-age');

  const profileId = await profileIdForUser(user.id);
  if (!profileId) redirect('/verify-age?e=no_profile');

  const session = await createAgeSession({
    vendorData: profileId,
    callbackUrl: `${env.siteUrl()}/verify-age/callback`,
  });
  if (!session.ok) {
    redirect(`/verify-age?e=${session.reason}`);
  }

  // Mark in-flight; the webhook/callback will resolve to passed/failed/manual_review.
  await setProfileAgeStatus(profileId, 'pending', session.sessionId);
  redirect(session.url);
}
