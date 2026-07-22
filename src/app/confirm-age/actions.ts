'use server';

/**
 * Record (or decline) the 18+ self-declaration for an already-signed-in user.
 *
 * Reached only via /confirm-age, which resolvePostLoginRedirect diverts to when
 * a session exists but no declaration is on record.
 */
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase-server';
import { env } from '@/lib/env';
import { recordAgeDeclaration } from '@/lib/age/record-declaration';
import { resolvePostLoginRedirect } from '@/lib/auth/post-login-redirect';

export async function confirmAge(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  await recordAgeDeclaration(user.id);

  // Re-run the normal post-login routing now the declaration is on record — it
  // owns the waitlist/beta/prod decision, so we must not duplicate it here.
  const origin = (await headers()).get('origin') || env.siteUrl();
  const next = String(formData.get('next') || '/dashboard');
  redirect(await resolvePostLoginRedirect(supabase, origin, next));
}

export async function declineAge() {
  // Under 18 — end the session rather than leaving them signed in on a service
  // they've just told us they aren't eligible for.
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
