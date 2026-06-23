import Link from 'next/link';
import Image from 'next/image';
import { signUp } from '../actions';
import { SocialLoginButtons } from '../social-login-buttons';
import { env } from '@/lib/env';
import { isProdDeploy } from '@/lib/beta-access/flow';

export const metadata = {
  title: 'Create your Lyra profile',
  description: 'Sign up to share your preferences, gift ideas, and boundaries.',
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; preview?: string }>;
}) {
  const params = await searchParams;
  // KAN-258 — during the private phase, account creation needs an invite
  // code and third-party sign-in is hidden, so the only way in is the
  // gated email form.
  const inviteOnly = !!env.inviteCode();
  // KAN-273/KAN-287 — on the public production deploy, prod is the doorway into
  // the gated beta app: signing up records a request and lands the user on the
  // waitlist. Frame the page as "join the waitlist". `?preview=waitlist`
  // renders this on any deploy so it can be verified before reaching prod.
  // LYRA_FORCE_WAITLIST mirrors this framing on a non-prod env (e.g. dev) without
  // flipping isProdDeploy() (which also drives auth routing). Framing only.
  const waitlist = isProdDeploy() || process.env.LYRA_FORCE_WAITLIST === 'true' || params.preview === 'waitlist';

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="flex items-center justify-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={48} height={48} className="h-12 w-auto" priority />
          </Link>
          <h1 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
            {waitlist ? 'Join the Lyra waitlist' : 'Create your profile'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {waitlist
              ? "Lyra is opening in stages — sign up and we'll email you when your spot is ready."
              : 'So people in your life never have to guess'}
          </p>
        </div>

        {waitlist && (
          <ol className="mb-6 space-y-1.5 text-xs text-[var(--color-muted)] max-w-xs mx-auto">
            <li>1. Confirm your email with the secure link we send.</li>
            <li>2. You&rsquo;re added to the waitlist queue.</li>
            <li>3. We email you the moment a spot opens up.</li>
          </ol>
        )}

        {params.error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {params.error}
          </div>
        )}

        {params.message && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
            {params.message}
          </div>
        )}

        {!inviteOnly && (
          <>
            <SocialLoginButtons />

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-[#ece7df]" />
              <span className="text-xs text-[var(--color-muted)]">or sign up with email</span>
              <div className="flex-1 h-px bg-[#ece7df]" />
            </div>
          </>
        )}

        <form className="space-y-4">
          {inviteOnly && (
            <div>
              <label htmlFor="invite_code" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
                Invite code
              </label>
              <input
                id="invite_code"
                name="invite_code"
                type="text"
                required
                autoComplete="off"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
                placeholder="From your invitation"
              />
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Lyra is invite-only while we&apos;re in private testing.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="Sarah Ashworth"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <p className="text-xs text-[var(--color-muted)]">
            No password needed — we&apos;ll email you a secure link to finish signing up.
          </p>

          <div className="flex items-start gap-2">
            <input
              id="consent"
              name="consent"
              type="checkbox"
              required
              className="mt-1 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-sage)] focus:ring-[var(--color-sage)]"
            />
            <label htmlFor="consent" className="text-xs text-[var(--color-muted)]">
              I agree to the <Link href="/privacy" className="text-[var(--color-sage)] hover:underline">Privacy Policy</Link> and <Link href="/terms" className="text-[var(--color-sage)] hover:underline">Terms of Service</Link>
            </label>
          </div>

          <button
            type="submit"
            formAction={signUp}
            className="w-full py-3 rounded-lg bg-[var(--color-sage)] text-white text-base font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            {waitlist ? 'Join the waitlist →' : 'Create account →'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
          Already have an account?{' '}
          <Link href="/login" className="text-[var(--color-sage)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
