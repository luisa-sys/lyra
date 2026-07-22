/**
 * Public, plain-English summary of how Lyra handles the 18+ rule: a
 * self-declaration at sign-up (no age-verification provider, no biometric).
 *
 * Keep this page honest about what it is — a declaration, not a verification.
 * Overstating it would be worse than having no page at all. Keep it minimal:
 * users don't need implementation or vendor detail, only what we do and don't
 * collect.
 */
import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'How we handle age on Lyra — Lyra',
  description: 'Lyra is for over-18s. How we ask, what we record, and what we do not collect.',
};

export default function HowWeCheckYourAgePage() {
  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center">
          <Link href="/" className="flex items-center" aria-label="Lyra">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <article className="max-w-2xl mx-auto px-4 py-12 space-y-6 text-[var(--color-ink)]">
        <h1 className="text-2xl font-medium font-[family-name:var(--font-serif)]">
          How we handle age on Lyra
        </h1>

        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          Lyra is an adults-only (18+) service. Before you create a profile we ask you one
          question — whether you are 18 or over — and you have to confirm that you are in
          order to carry on.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-medium">What we record</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            Only that you confirmed it, and when. That is the whole record.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium">What we don&rsquo;t ask for</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            We don&rsquo;t ask for your date of birth. We don&rsquo;t ask for ID or any
            document. We don&rsquo;t take a selfie, scan your face, or run age-estimation
            software. Lyra holds no biometric data about you at all.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium">Being straight with you about this</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            This is a self-declaration, not a verified age check — we are recording what you
            have told us. It works alongside our{' '}
            <Link href="/terms" className="underline hover:text-[var(--color-sage)]">
              Terms of Service
            </Link>
            , which require you to be 18 or over to use Lyra. If we find out an account
            belongs to someone under 18, we suspend it and delete their data.
          </p>
        </section>
      </article>
    </main>
  );
}
