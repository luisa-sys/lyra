'use client';

/**
 * Sign-up form — 18+ self-declaration + the two account-creation paths.
 *
 * Lyra is an adults-only (18+) service. This is a client component for ONE
 * reason: the 18+ confirmation has to gate BOTH paths from a single tick.
 * "Continue with Google" isn't part of the email form, so an HTML `required`
 * checkbox alone would leave the OAuth path wide open — the box would be
 * skippable by simply choosing Google. Holding the tick in React state lets us
 * disable the Google button until it's ticked, while the email form keeps
 * `required` as its own native guard. Both server actions re-check it, so the
 * client state is a UX affordance and never the enforcement.
 */
import { useState } from 'react';
import Link from 'next/link';
import { signUp, signInWithGoogle } from '../actions';
import { AGE_DECLARATION_FIELD } from '@/lib/age/self-declaration';

export function SignupForm({
  hasInviteCode,
  invited,
  inviteCookie,
  showWaitlistFraming,
}: {
  hasInviteCode: boolean;
  invited: boolean;
  inviteCookie: string;
  showWaitlistFraming: boolean;
}) {
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  return (
    <>
      {/* The 18+ declaration sits ABOVE both paths — it governs each of them. */}
      <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-white px-4 py-3">
        <div className="flex items-start gap-2">
          <input
            id="age_confirm_gate"
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-sage)] focus:ring-[var(--color-sage)]"
          />
          <label htmlFor="age_confirm_gate" className="text-sm text-[var(--color-ink)]">
            I confirm I am <strong>18 or over</strong>.
          </label>
        </div>
        <p className="mt-1.5 ml-6 text-xs text-[var(--color-muted)]">
          Lyra is for adults only. You need to confirm this before creating a profile.
        </p>
      </div>

      {/* Not aria-hidden when unconfirmed — hiding focusable controls from
          assistive tech is worse than exposing them as disabled. */}
      <div>
        <form>
          <input type="hidden" name={AGE_DECLARATION_FIELD} value={ageConfirmed ? 'on' : ''} />
          <button
            type="submit"
            formAction={signInWithGoogle}
            disabled={!ageConfirmed}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-lg border border-[var(--color-border)] bg-white text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-paper)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[#ece7df]" />
          <span className="text-xs text-[var(--color-muted)]">or sign up with email</span>
          <div className="flex-1 h-px bg-[#ece7df]" />
        </div>

        <form className="space-y-4">
          {/* Mirrors the gate above so the email path carries the same declaration. */}
          <input type="hidden" name={AGE_DECLARATION_FIELD} value={ageConfirmed ? 'on' : ''} />

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
            disabled={!ageConfirmed}
            className="w-full py-3 rounded-lg bg-[var(--color-sage)] text-white text-base font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showWaitlistFraming ? 'Join the waitlist →' : 'Create account →'}
          </button>
        </form>
      </div>
    </>
  );
}
