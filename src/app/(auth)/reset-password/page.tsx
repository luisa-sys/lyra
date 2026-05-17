import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { updateRecoveryPassword } from '../actions';

export const metadata = {
  title: 'Set a new password — Lyra',
  description: 'Set a new password for your Lyra account.',
  robots: { index: false, follow: false },
};

/**
 * KAN-225 — landing page from the password-recovery email link.
 *
 * Flow:
 *   1. User clicks the email link → /auth/callback?code=…&next=/reset-password
 *   2. callback exchanges the code for a (short-lived) recovery session
 *      via `exchangeCodeForSession` and redirects here
 *   3. THIS page checks the user is authenticated (= has a valid recovery
 *      session). If not, send them back to /forgot-password.
 *   4. User submits new password → `updateRecoveryPassword` action calls
 *      `supabase.auth.updateUser({ password })`, then signs them out so
 *      they re-authenticate with the new password.
 *
 * Security: the page only renders the form if there's an active session.
 * Direct visits without a recovery code redirect to /forgot-password.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      '/forgot-password?error=' +
        encodeURIComponent('Your reset link has expired or is invalid. Please request a new one.'),
    );
  }

  const params = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="flex items-center justify-center">
            <Image
              src="/lyra-logo.png"
              alt="Lyra"
              width={48}
              height={48}
              className="h-12 w-auto"
              priority
            />
          </Link>
          <h1 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
            Set a new password
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            For {user.email}
          </p>
        </div>

        {params.error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {params.error}
          </div>
        )}

        <form className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[var(--color-ink)] mb-1"
            >
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label
              htmlFor="confirm_password"
              className="block text-sm font-medium text-[var(--color-ink)] mb-1"
            >
              Confirm password
            </label>
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="Repeat the same password"
            />
          </div>

          <button
            type="submit"
            formAction={updateRecoveryPassword}
            className="w-full py-3 rounded-lg bg-[var(--color-sage)] text-white text-base font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Update password
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
          Wrong account?{' '}
          <Link href="/login" className="text-[var(--color-sage)] hover:underline">
            Sign in as someone else
          </Link>
        </p>
      </div>
    </main>
  );
}
