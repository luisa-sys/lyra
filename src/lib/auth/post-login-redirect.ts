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
import type { createClient } from '@/modules/platform/supabase-server';
import { resolveBetaAccess, betaRedirectUrl, isProdFamily } from '@/lib/beta-access/flow';
import { INVITE_COOKIE } from '@/lib/beta-access/invite-cookie';
import { AGE_DECLARATION_COOKIE } from '@/lib/age/self-declaration';
import { hasDeclaredAge, recordAgeDeclaration } from '@/lib/age/record-declaration';

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
  const jar = await cookies();
  const carriedCode = jar.get(INVITE_COOKIE)?.value;

  // 18+ self-declaration. Both auth paths land here, so this is the one place
  // that has to know about it. The declaration reaches us either in the sign-up
  // cookie or in user_metadata (the email path sets both); stamp the profile
  // once, then stop asking.
  //
  // Anyone who gets this far WITHOUT a declaration on record — a brand-new
  // Google account created via /login, or an account that predates the
  // declaration — is diverted to /confirm-age first. That page is the reason
  // the 18+ question is a real gate rather than a decorative checkbox on one
  // of the two sign-up routes.
  //
  // DEGRADES OPEN, deliberately. This is an attestation, not a security
  // control, and it sits on the hot sign-in path — if the lookup fails (DB
  // blip, missing service-role env) we let the user through rather than
  // locking every account out of Lyra over a checkbox we can't re-read.
  try {
    if (!(await hasDeclaredAge(supabase, user.id))) {
      const declaredNow =
        jar.get(AGE_DECLARATION_COOKIE)?.value === '1' ||
        user.user_metadata?.age_declared_18 === true;
      if (declaredNow) {
        await recordAgeDeclaration(user.id);
      } else {
        return `${origin}/confirm-age?next=${encodeURIComponent(next)}`;
      }
    }
  } catch (e) {
    console.error('[post-login] 18+ declaration check failed, continuing:', e);
  }

  const { userStatus, accessTier } = await resolveBetaAccess(
    { id: user.id, email: user.email },
    { carriedCode },
  );
  return betaRedirectUrl({ origin, isProdFamily: isProdFamily(), userStatus, accessTier, next });
}
