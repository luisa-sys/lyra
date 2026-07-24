import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import {
  ensureBetaRequested,
  notifyBetaQueueJoined,
  betaRoutingTarget,
} from '@/lib/beta-access';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // KAN-276 — beta access queue. On a user's first authenticated landing,
      // move their profile into the queue (beta_access_status none→requested)
      // and notify Luisa. Idempotent + non-fatal: a repeat sign-in is a no-op,
      // and any failure here must never block the user from reaching the app.
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { transitioned } = await ensureBetaRequested(supabase, user.id);
          if (transitioned) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('display_name')
              .eq('user_id', user.id)
              .maybeSingle();
            const who =
              (profile?.display_name as string | null)?.trim() ||
              user.email ||
              user.id;
            await notifyBetaQueueJoined({ who });
          }

          // KAN-276 — routing. On PROD (not the beta deploy) and only when
          // BETA_ROUTING_ENABLED is flipped on, send the user over to the
          // beta deploy (where the existing middleware shows /waitlist).
          // Inert by default → falls through to the normal `next` redirect.
          const betaTarget = betaRoutingTarget(next);
          if (betaTarget) {
            return NextResponse.redirect(betaTarget);
          }
        }
      } catch (err) {
        // Beta-access bookkeeping is best-effort. Log and continue to the
        // normal post-auth redirect so a user can always finish signing in.
        console.warn('[auth/callback] beta-access step failed:', err);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth code exchange failed — redirect to error page
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Could not verify your email. Please try again.')}`);
}
