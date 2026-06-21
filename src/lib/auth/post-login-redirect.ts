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
import type { createClient } from '@/lib/supabase-server';
import { resolveBetaAccess, betaRedirectUrl, isProdDeploy } from '@/lib/beta-access/flow';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function resolvePostLoginRedirect(
  supabase: ServerClient,
  origin: string,
  next: string,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const approved = user
    ? (await resolveBetaAccess({ id: user.id, email: user.email })).approved
    : true;
  return betaRedirectUrl({ origin, isProd: isProdDeploy(), approved, next });
}
