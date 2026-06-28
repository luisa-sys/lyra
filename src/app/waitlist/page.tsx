import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { env } from '@/lib/env';
import { redeemWaitlistCode } from './actions';

/**
 * KAN-175: beta waitlist landing page.
 *
 * Reached via the middleware redirect when an authenticated user visits any
 * page on `beta.checklyra.com` (i.e. IS_BETA_DEPLOY=true) but is not yet a live
 * beta user (`user_status !== 'live'`).
 *
 * If the user is already a live beta user (e.g. they navigated here directly),
 * we send them back to the dashboard instead of showing the waitlist UI.
 *
 * If the user is not signed in, we just show the public-facing waitlist
 * message — they shouldn't normally land here unauthenticated, but it's a
 * harmless fallback.
 */
export const metadata = {
  title: 'You’re on the waitlist — Lyra Beta',
  description: 'Thanks for joining the Lyra beta waitlist. We’ll let you in soon.',
};

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Side door: if a beta-eligible user lands here for some reason, send
  // them home rather than showing the "you're on the waitlist" message.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.user_status === 'live') {
      redirect('/dashboard');
    }
  }

  // KAN-336 — Google/OAuth signups can't carry an invite code through the
  // magic-link flow, so they always land here. When the skip-the-waitlist code
  // is configured (LYRA_INVITE_CODE, set on beta + prod), let an authenticated
  // waitlisted user paste it to skip the queue. The action re-validates the
  // code server-side and grants beta via the canonical transition.
  const showCodeForm = Boolean(env.inviteCode()) && Boolean(user);

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <Image src="/lyra-logo.png" alt="Lyra" width={64} height={64} className="h-16 w-auto" priority />
        </div>

        <h1 className="text-3xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          You&rsquo;re on the list
        </h1>

        <p className="text-[var(--color-muted)] leading-relaxed">
          Thanks for trying the Lyra beta. Beta access is invite-only while we&rsquo;re polishing things.
          We&rsquo;ll send an email when your account is approved.
        </p>

        {showCodeForm && (
          <div className="space-y-3 rounded-2xl border border-[var(--color-sage)]/25 bg-white/60 p-5 text-left">
            <p className="text-sm font-medium text-[var(--color-ink)]">
              Have a code? Enter it to skip the waitlist.
            </p>
            {error === 'invalid' && (
              <p className="text-sm text-red-700" role="alert">
                That code wasn&rsquo;t recognised. Check it and try again.
              </p>
            )}
            <form action={redeemWaitlistCode} className="flex gap-2">
              <input
                type="text"
                name="invite_code"
                required
                autoComplete="off"
                placeholder="Enter your code"
                aria-label="Skip-the-waitlist code"
                className="flex-1 rounded-full border border-[var(--color-muted)] bg-white px-4 py-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
              />
              <button
                type="submit"
                className="rounded-full bg-[var(--color-sage)] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Enter
              </button>
            </form>
          </div>
        )}

        <p className="text-[var(--color-muted)] leading-relaxed">
          In the meantime, you can use the live site at{' '}
          <Link href="https://checklyra.com" className="text-[var(--color-sage)] hover:underline">
            checklyra.com
          </Link>{' '}
          with the same Google account.
        </p>

        <div className="pt-4">
          <Link
            href="https://checklyra.com"
            className="inline-block rounded-full bg-[var(--color-sage)] text-white px-6 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Go to Lyra
          </Link>
        </div>

        <p className="text-xs text-[var(--color-muted)] pt-8">
          Questions? Email{' '}
          <a href="mailto:hello@checklyra.com" className="hover:underline">
            hello@checklyra.com
          </a>
        </p>
      </div>
    </main>
  );
}
