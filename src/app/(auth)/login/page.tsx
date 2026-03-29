import Link from 'next/link';
import { signIn } from '../actions';
import { SocialLoginButtons } from '../social-login-buttons';

export const metadata = {
  title: 'Sign in to Lyra',
  description: 'Sign in to manage your Lyra profile.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
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
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Sign in to manage your profile
          </p>
        </div>

        {params.error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {params.error}
          </div>
        )}

        <SocialLoginButtons />

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-stone-200" />
          <span className="text-xs text-[var(--color-muted)]">or</span>
          <div className="flex-1 h-px bg-stone-200" />
        </div>

        <form className="space-y-4">
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
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
              placeholder="Your password"
            />
          </div>

          <button
            type="submit"
            formAction={signIn}
            className="w-full py-3 rounded-lg bg-[var(--color-sage)] text-white text-base font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Sign in →
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-[var(--color-sage)] hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
