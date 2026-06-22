/**
 * KAN-319: account-suspended page.
 *
 * A suspended user (profiles.is_suspended = true) is redirected here by the
 * middleware on any authenticated navigation. The page is intentionally public
 * (no auth gate) so the redirect target always renders, and tells the user how
 * to appeal. Their public profile is already hidden by RLS; this blocks their
 * own use of the app and explains why.
 */
import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Account suspended — Lyra',
  robots: { index: false, follow: false },
};

const SUPPORT_EMAIL = 'hello@checklyra.com';

export default function SuspendedPage() {
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
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
            Your account is suspended
          </h1>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Access to your Lyra account has been suspended and your profile is not
            visible to others. If you think this is a mistake, please contact our
            team and we&rsquo;ll look into it.
          </p>
          <p className="text-sm text-[var(--color-ink)]">
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=Account%20suspension%20appeal`}
              className="font-medium underline hover:text-[var(--color-sage)]"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
