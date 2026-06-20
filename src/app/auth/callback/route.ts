import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { resolveBetaAccess, betaRedirectUrl, isProdDeploy } from '@/lib/beta-access/flow';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // KAN-276/278: record the beta-access lifecycle (none -> requested + notify
      // the admin on a brand-new signup) and route the user into the gated beta
      // app — approved users to the dashboard, everyone else to the waitlist.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const approved = user
        ? (await resolveBetaAccess({ id: user.id, email: user.email })).approved
        : true;
      return NextResponse.redirect(
        betaRedirectUrl({ origin, isProd: isProdDeploy(), approved, next }),
      );
    }
  }

  // Auth code exchange failed — redirect to error page
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Could not verify your email. Please try again.')}`,
  );
}
