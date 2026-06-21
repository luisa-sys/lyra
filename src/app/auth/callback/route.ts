import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { resolvePostLoginRedirect } from '@/lib/auth/post-login-redirect';

/**
 * OAuth (e.g. Google) redirect callback — the PKCE code exchange here is
 * genuinely same-browser, so the code verifier is always present.
 *
 * Emailed magic links are NOT handled here any more: opened outside the
 * originating browser they would arrive without the verifier and fail. They
 * go through `/auth/confirm` (verifyOtp / token-hash flow) instead. See BUGS-50.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // KAN-276/278: record the beta-access lifecycle and route into the gated
      // beta app — shared with /auth/confirm via resolvePostLoginRedirect.
      return NextResponse.redirect(await resolvePostLoginRedirect(supabase, origin, next));
    }
  }

  // Auth code exchange failed — redirect to error page
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Could not verify your email. Please try again.')}`,
  );
}
