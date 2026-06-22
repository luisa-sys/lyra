/**
 * KAN-319 / KAN-282: age-verification landing (framework stub).
 *
 * When AGE_VERIFICATION_REQUIRED is on, an unverified user is sent here to
 * verify before they can publish their profile. The real Didit hosted
 * facial-age-estimation flow (selfie → estimate → webhook → age_status='passed')
 * ships as the immediate follow-up (KAN-282); for now this explains the gate and
 * how to proceed. We never collect a DOB or store a selfie/biometric here.
 */
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { isAgeVerificationRequired } from '@/lib/age/gate';

export const metadata = {
  title: 'Verify your age — Lyra',
  robots: { index: false, follow: false },
};

export default async function VerifyAgePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/verify-age');

  // If the gate is off, or the user is already verified, send them on.
  const { data: profile } = await supabase
    .from('profiles')
    .select('age_status')
    .eq('user_id', user.id)
    .maybeSingle();
  const status = (profile as { age_status?: string } | null)?.age_status;
  if (!isAgeVerificationRequired() || status === 'passed') {
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
              : 'Age checks are being switched on shortly. We never store your photo or date of birth — only a yes/no age result.'}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            A plain-English &ldquo;How we check your age&rdquo; summary will be published here
            when checks go live.
          </p>
        </div>
      </div>
    </main>
  );
}
