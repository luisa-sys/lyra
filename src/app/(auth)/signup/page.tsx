import Link from 'next/link';
import { signUp } from '../actions';
import { SocialLoginButtons } from '../social-login-buttons';

export const metadata = {
  title: 'Create your Lyra profile',
  description: 'Sign up to share your preferences, gift ideas, and boundaries.',
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="font-[family-name:var(--font-serif)] text-2xl text-[var(--color-ink)]">
            Lyra
          </Link>
          <h1 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
            Create your profile
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            So people in your life never have to guess
          </p>
        </div>

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

        <SocialLoginButtons />

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-stone-200" />
          <span className="text-xs text-[var(--color-muted)]">or sign up with email</span>
          <div className="flex-1 h-px bg-stone-200" />
        </div>

        <form className="space-y-4">
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
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
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="At least 6 characters"
            />
          </div>

          <div className="flex items-start gap-2">
            <input
              id="consent"
              name="consent"
              type="checkbox"
              required
              className="mt-1 h-4 w-4 rounded border-stone-300 text-[var(--color-sage)] focus:ring-[var(--color-sage)]"
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
            Create account →
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
