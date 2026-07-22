/**
 * /confirm-age — the one-question 18+ check.
 *
 * Most people never see this: the sign-up form already collects the declaration,
 * and resolvePostLoginRedirect stamps it on the way through. This catches the
 * two cases the sign-up form can't:
 *   1. a brand-new Google account created from /login (OAuth always creates the
 *      user, so there's no sign-up form in that path), and
 *   2. accounts that predate the declaration.
 *
 * It asks once, records the answer, and then hands routing straight back to
 * resolvePostLoginRedirect.
 */
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { hasDeclaredAge } from '@/lib/age/record-declaration';
import { confirmAge, declineAge } from './actions';

export const metadata = {
  title: 'Confirm your age — Lyra',
  robots: { index: false, follow: false },
};

export default async function ConfirmAgePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/confirm-age');

  // Already answered — never ask twice.
  if (await hasDeclaredAge(supabase, user.id)) redirect(next || '/dashboard');

  return (
    <main className="min-h-screen bg-[var(--color-paper)] flex flex-col">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center">
          <Link href="/" className="flex items-center" aria-label="Lyra">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center space-y-5">
          <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
            Are you 18 or over?
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Lyra is for adults only, so we need you to confirm this before you carry
            on. We just record your answer — we don&rsquo;t ask for your date of birth
            or any ID.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
            <form action={confirmAge}>
              <input type="hidden" name="next" value={next || '/dashboard'} />
              <button
                type="submit"
                className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
              >
                Yes, I&rsquo;m 18 or over
              </button>
            </form>
            <form action={declineAge}>
              <button
                type="submit"
                className="w-full sm:w-auto px-6 py-2.5 rounded-full border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm font-medium hover:bg-[var(--color-paper)] transition-colors cursor-pointer"
              >
                No, I&rsquo;m under 18
              </button>
            </form>
          </div>

          <p className="text-xs text-[var(--color-muted)] pt-1">
            See our <Link href="/privacy" className="underline hover:text-[var(--color-sage)]">Privacy Policy</Link>{' '}
            and <Link href="/terms" className="underline hover:text-[var(--color-sage)]">Terms of Service</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
