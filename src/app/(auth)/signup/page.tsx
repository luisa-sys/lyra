import Link from 'next/link';
import Image from 'next/image';
import { cookies } from 'next/headers';
import { signUp } from '../actions';
import { SocialLoginButtons } from '../social-login-buttons';
import { env } from '@/lib/env';
import { isProdFamily } from '@/lib/beta-access/flow';
import { INVITE_COOKIE } from '@/lib/beta-access/invite-cookie';

export const metadata = {
  title: 'Create your Lyra profile',
  description: 'Sign up to share your preferences, gift ideas, and boundaries.',
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; preview?: string; invited?: string }>;
}) {
  const params = await searchParams;
  // KAN-336 — when a sign-up code is configured, offer it as an OPTIONAL field:
  // entering the correct code skips the waitlist and grants beta directly. No
  // code = a normal waitlist signup. Social sign-in stays available either way.
  const hasInviteCode = !!env.inviteCode();
  // KAN-273/KAN-287/KAN-326 — sign-up is gated by the waitlist across the whole
  // PROD FAMILY (prod AND beta): both enforce the gate (betaRedirectUrl +
  // middleware redirect a non-'live' user to /waitlist), so the sign-up copy must
  // say "join the waitlist" on BOTH, not just prod. We therefore key the framing
  // off isProdFamily() (prod OR beta) rather than isProdDeploy() (prod only), so
  // the sign-up framing can never drift from the gate that actually runs. (The
  // homepage deliberately stays a product showcase on beta — it keys off
  // isProdDeploy() — so the curated "people to meet" examples stay visible there
  // while signing up is still waitlisted.) `?preview=waitlist` + LYRA_FORCE_WAITLIST
  // still force the framing on any single-env deploy (e.g. dev). Framing only.
  const waitlist = isProdFamily() || process.env.LYRA_FORCE_WAITLIST === 'true' || params.preview === 'waitlist';

  // KAN-337 — a beta-invite deep-link (/join) sets the invite cookie; when it's
  // present + valid the visitor is pre-approved for beta, so show the celebratory
  // banner, carry the code via a hidden field, and drop the waitlist framing.
  const inviteCookie = (await cookies()).get(INVITE_COOKIE)?.value ?? '';
  const invited = hasInviteCode && inviteCookie === env.inviteCode();
  const showWaitlistFraming = waitlist && !invited;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="flex items-center justify-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={48} height={48} className="h-12 w-auto" priority />
          </Link>
          <h1 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
            {showWaitlistFraming ? 'Join the Lyra waitlist' : 'Create your profile'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {showWaitlistFraming
              ? "Lyra is opening in stages — sign up and we'll email you when your spot is ready."
              : 'So people in your life never have to guess'}
          </p>
        </div>

        {showWaitlistFraming && (
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

        {invited && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
            🎉 You&rsquo;ve been invited to the Lyra beta — finish signing up below and you&rsquo;ll
            skip the waitlist and go straight in.
          </div>
        )}

        <SocialLoginButtons />

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[#ece7df]" />
          <span className="text-xs text-[var(--color-muted)]">or sign up with email</span>
          <div className="flex-1 h-px bg-[#ece7df]" />
        </div>

        <form className="space-y-4">
          {invited ? (
            // KAN-337 — invited via /join: the code is auto-applied (carried in a
            // hidden field; the banner above explains it), no manual entry needed.
            <input type="hidden" name="invite_code" value={inviteCookie} />
          ) : hasInviteCode ? (
            <div>
              <label htmlFor="invite_code" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
                Invite code <span className="font-normal text-[var(--color-muted)]">(optional)</span>
              </label>
              <input
                id="invite_code"
                name="invite_code"
                type="text"
                autoComplete="off"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
                placeholder="Skip the waitlist"
              />
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                Have a code? Enter it to skip the waitlist and go straight in.
              </p>
            </div>
          ) : null}

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
            {showWaitlistFraming ? 'Join the waitlist →' : 'Create account →'}
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
