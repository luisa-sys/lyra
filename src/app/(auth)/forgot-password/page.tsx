import Link from 'next/link';
import Image from 'next/image';
import { requestPasswordReset } from '../actions';

export const metadata = {
  title: 'Reset your password — Lyra',
  description:
    "Enter your email and we'll send you a link to reset your password.",
  // Don't index recovery surfaces (low SEO value, exposes auth UI patterns
  // unnecessarily). Login/signup are intentionally indexed; this one isn't.
  robots: { index: false, follow: false },
};

/**
 * KAN-225 — request a password-reset email.
 *
 * Server Component with a single form posting to the
 * `requestPasswordReset` server action. The action ALWAYS returns the
 * same "if that email is registered…" message via `?message=…` to
 * prevent account enumeration. Errors come back via `?error=…`.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
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
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            We&apos;ll email you a link to set a new one.
          </p>
        </div>

        {params.error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {params.error}
          </div>
        )}

        {params.message && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-paper)] border border-[var(--color-border)] text-sm text-[var(--color-ink)]">
            {params.message}
          </div>
        )}

        <form className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[var(--color-ink)] mb-1"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            formAction={requestPasswordReset}
            className="w-full py-3 rounded-lg bg-[var(--color-sage)] text-white text-base font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Send reset link
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
          Remembered it?{' '}
          <Link href="/login" className="text-[var(--color-sage)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
