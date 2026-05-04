import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';

/**
 * KAN-175: beta waitlist landing page.
 *
 * Reached via the middleware redirect when an authenticated user visits any
 * page on `beta.checklyra.com` (i.e. IS_BETA_DEPLOY=true) but does not have
 * `is_beta_eligible = true` on their profile.
 *
 * If the user is already beta-eligible (e.g. they navigated here directly),
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

export default async function WaitlistPage() {
  // Side door: if a beta-eligible user lands here for some reason, send
  // them home rather than showing the "you're on the waitlist" message.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_beta_eligible')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.is_beta_eligible) {
      redirect('/dashboard');
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center px-6 py-12">
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
