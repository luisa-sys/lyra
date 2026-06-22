/**
 * KAN-282: public "How we check your age" summary.
 *
 * Ofcom's Highly Effective Age Assurance guidance requires a service that
 * restricts access to adults to publish an easy-to-find, plain-English summary
 * of its age-assurance process. This is that page. (Copy is provisional and
 * should be reviewed/signed off by Luisa before age checks are switched on.)
 */
import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'How we check your age — Lyra',
  description: 'How Lyra confirms that members are over 18, and what data we keep.',
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
        <h1 className="text-2xl font-medium font-[family-name:var(--font-serif)]">How we check your age</h1>

        <p className="text-sm text-[var(--color-muted)] leading-relaxed">
          Lyra is an adults-only (18+) service. Before a profile can be published, we confirm the
          member is over 18 using a privacy-preserving age check. This page explains how it works
          and what we keep.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-medium">The method</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            We use <strong>facial age estimation</strong> provided by our age-assurance partner,
            Didit. You take a short selfie in their secure flow; their system estimates your age.
            A simple date-of-birth box or tick-box is not enough on its own, so we don&rsquo;t rely
            on one.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium">What we store</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            We store only a <strong>yes/no age result</strong>, the date of the check, and a
            reference number from the provider. We do <strong>not</strong> store your selfie, your
            image, or your date of birth — the photo is processed by the provider and deleted after
            the estimate.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium">If the estimate is borderline</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            To be confident at the 18 boundary, anyone whose estimate is close to 18 is asked to
            complete a stronger check (for example a document check) rather than being passed or
            refused on a near-18 guess. If a check can&rsquo;t confirm you&rsquo;re over 18, your
            profile stays private and you can contact us to review it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-medium">Accessibility & alternatives</h2>
          <p className="text-sm text-[var(--color-muted)] leading-relaxed">
            If you can&rsquo;t or would prefer not to take a selfie, an alternative check is
            available. If you have any difficulty, email{' '}
            <a href="mailto:hello@checklyra.com" className="underline hover:text-[var(--color-sage)]">
              hello@checklyra.com
            </a>.
          </p>
        </section>

        <p className="text-xs text-[var(--color-muted)]">
          See also our{' '}
          <Link href="/privacy" className="underline hover:text-[var(--color-sage)]">privacy policy</Link>
          {' '}for the legal basis and retention details.
        </p>
      </article>
    </main>
  );
}
