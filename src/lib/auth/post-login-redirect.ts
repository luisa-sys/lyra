/**
 * BUGS-50: shared post-sign-in routing for the auth routes.
 *
 * Once a session is established — whether via the email token-hash flow
 * (`/auth/confirm`, verifyOtp) or the OAuth code exchange (`/auth/callback`,
 * exchangeCodeForSession) — both routes need the same follow-up:
 *   1. record the beta-access lifecycle (none -> requested + notify admin on a
 *      brand-new signup), and
 *   2. route the user into the gated beta app (approved -> dashboard, everyone
 *      else -> waitlist).
 *
 * Extracted from /auth/callback so /auth/confirm reuses it verbatim (KAN-276/278).
 */
import { cookies } from 'next/headers';
import type { createClient } from '@/lib/supabase-server';
import { resolveBetaAccess, betaRedirectUrl, isProdFamily } from '@/lib/beta-access/flow';
import { INVITE_COOKIE } from '@/lib/beta-access/invite-cookie';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function resolvePostLoginRedirect(
  supabase: ServerClient,
  origin: string,
  next: string,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // No session (shouldn't happen post-login) — stay on the origin.
    return betaRedirectUrl({
      origin,
      isProdFamily: false,
      userStatus: 'live',
      accessTier: 'prod',
      next,
    });
  }
  // KAN-337 — a beta-invite deep-link (/join) leaves the code in an httpOnly
  // cookie; for Google OAuth this is the only carrier (no sign-up form), so read
  // it here and hand it to resolveBetaAccess for server-side re-validation.
  const carriedCode = (await cookies()).get(INVITE_COOKIE)?.value;
  const { userStatus, accessTier } = await resolveBetaAccess(
    { id: user.id, email: user.email },
    { carriedCode },
  );
  return betaRedirectUrl({ origin, isProdFamily: isProdFamily(), userStatus, accessTier, next });
}
