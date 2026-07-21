/**
 * /verify-age — provider (Didit) age check landing.
 *
 * KAN-407 retired this to a redirect stub when the provider check was replaced
 * by an 18+ self-declaration. KAN-408 brings it back as an OPT-IN: it is live
 * only where the `age_verification` global switch is ON for the environment
 * (isProviderAgeCheckActive). When the switch is OFF (the default), or the user
 * has already passed, we redirect straight to the dashboard — the
 * self-declaration at sign-up is all that's required.
 *
 * Lyra never collects a DOB or stores a selfie/biometric here — the Didit hosted
 * flow returns only a yes/no age result (see src/lib/age/didit.ts).
 */
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { isProviderAgeCheckActive } from '@/lib/age/provider-gate';
import { isDiditConfigured } from '@/lib/age/didit';
import { startAgeVerification } from './actions';

export const metadata = {
  title: 'Verify your age — Lyra',
  robots: { index: false, follow: false },
};

export default async function VerifyAgePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/verify-age');

  // Provider check off for this environment, or already verified → send them on.
  const { data: profile } = await supabase
    .from('profiles')
    .select('age_status')
    .eq('user_id', user.id)
    .maybeSingle();
  const status = (profile as { age_status?: string } | null)?.age_status;
  if (!(await isProviderAgeCheckActive()) || status === 'passed') {
    redirect('/dashboard/profile');
  }

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex flex-col">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center">
          <Link href="/dashboard" className="flex items-center" aria-label="Lyra">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
            Verify your age to publish
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Lyra is an adults-only (18+) service. Before your profile can go live,
            we need to confirm you&rsquo;re over 18 using a quick, privacy-preserving
            age check. You can keep editing your profile in the meantime — it just
            stays private until you&rsquo;re verified.
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            {status === 'failed'
              ? 'Our last check could not confirm you are over 18. Please contact us if you think this is a mistake.'
              : status === 'manual_review'
              ? 'Your check needs a closer look — we may ask for a quick document check. We never store your photo or date of birth, only a yes/no age result.'
              : 'We never store your photo or date of birth — only a yes/no age result.'}
          </p>

          {isDiditConfigured() ? (
            <form action={startAgeVerification}>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-full bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {status === 'pending' ? 'Continue age check' : 'Start age check'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              Age checks are being switched on shortly.
            </p>
          )}

          <p className="text-xs text-[var(--color-muted)]">
            <Link href="/how-we-check-your-age" className="underline hover:text-[var(--color-sage)]">
              How we check your age
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
