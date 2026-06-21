import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { resolvePostLoginRedirect } from '@/lib/auth/post-login-redirect';

/**
 * BUGS-50 — email confirmation via the token-hash (verifyOtp) flow.
 *
 * The default `{{ .ConfirmationURL }}` magic link routes through Supabase's
 * `/auth/v1/verify` endpoint, which (under the @supabase/ssr default PKCE
 * flow) redirects back with an auth `code` that `/auth/callback` must hand to
 * `exchangeCodeForSession`. That exchange REQUIRES the PKCE code-verifier
 * cookie written into the browser at sign-up time — so the link only works if
 * it is opened in the exact same browser that started sign-up. Opened anywhere
 * else (a different browser, a mobile mail app's in-app webview, or after an
 * email security scanner pre-fetched it) the verifier is absent and the user
 * sees "Could not verify your email".
 *
 * `verifyOtp({ type, token_hash })` validates a server-side one-time token and
 * needs NO browser-bound verifier, so it works in any browser/device. The auth
 * email templates point here instead:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup     (Confirm signup)
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink  (Magic link / OTP)
 *
 * `/auth/callback` is retained for Google OAuth, where the code exchange is
 * genuinely same-browser and correct.
 */

// Only the OTP types reachable from our email templates are honoured. `recovery`
// is handled defensively so a future switch of the password-reset template to
// this route works without code changes (the reset flow is currently unlinked).
const ALLOWED_TYPES: readonly EmailOtpType[] = ['signup', 'magiclink', 'email', 'recovery'];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/dashboard';

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // A recovery link grants a short-lived session whose sole purpose is
      // setting a new password — send the user straight to the form, never
      // into the beta app / waitlist routing.
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`);
      }
      return NextResponse.redirect(await resolvePostLoginRedirect(supabase, origin, next));
    }
  }

  // Bad/expired/already-consumed token, or missing params — surface the same
  // message the callback uses so the login page handles it consistently.
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Could not verify your email. Please try again.')}`,
  );
}
