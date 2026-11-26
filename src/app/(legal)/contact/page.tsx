import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { turnstileSiteKey } from "@/modules/guards/turnstile";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact — Lyra",
  description: "Questions, problems, ideas, or just hello — send the Lyra team a note.",
};

export default function ContactPage() {
  // Read the public site key server-side; it's the only Turnstile value that
  // crosses to the client. null → the human-check is not provisioned and the
  // form degrades gracefully.
  const siteKey = turnstileSiteKey();

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <nav className="border-b border-[var(--color-border)]/60">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="flex items-center" aria-label="Lyra home">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" priority />
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-10 prose prose-stone prose-sm">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Contact</h1>

        <p>Questions, problems, ideas, or just hello — send us a note below.</p>
        <p className="text-[var(--color-muted)]">
          Replies can take a little while. We read everything, and
          we&apos;ll always come back to you. 💛
        </p>
        <p className="text-sm text-[var(--color-muted)]">
          For something <strong>urgent</strong> — a safety concern, or content about you that
          shouldn&apos;t be there — say so in your message and we&apos;ll prioritise it.
        </p>

        <ContactForm turnstileSiteKey={siteKey} />

        {/* KAN-493: the complaints page now lives here; /complaints 308-redirects
            to #complaints. A complaints route is expected under the Online
            Safety Act; data-protection complaints follow the DUAA 2025 duty. */}
        <section id="complaints" className="not-prose mt-12 scroll-mt-6 text-[var(--color-ink)] leading-relaxed">
          <h2 className="text-lg font-semibold mb-2">Complaints</h2>
          <p className="mb-4">
            To report content on Lyra, or to complain about how we&rsquo;ve handled something, use the
            form above and start your message with &ldquo;Complaint&rdquo;. For concerns about how Lyra
            handles your personal data, you can also email 
            <a href="mailto:privacy@checklyra.com" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">privacy@checklyra.com</a> with the word
            &ldquo;complaint&rdquo; in your message and a description of your concern. Tell us what
            happened, which of your personal data is involved, and what you would like us to do.
          </p>

          <h3 className="font-semibold mb-1">What we will do</h3>
          <p className="mb-4">
            We will <strong>acknowledge your complaint within 30 days</strong> of receiving it, investigate
            it without undue delay, keep you informed of progress, and write to you with the outcome. For
            data-protection complaints this reflects our statutory duty under the 
            <strong>Data (Use and Access) Act 2025</strong>.
          </p>

          <h3 className="font-semibold mb-1">Escalating to the ICO</h3>
          <p className="mb-2">
            If you remain dissatisfied with how we handled your personal data, you have the right to
            complain to the UK Information Commissioner&rsquo;s Office (ICO), our supervisory authority:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-4">
            <li>Online: <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">ico.org.uk/make-a-complaint</a></li>
            <li>Helpline: 0303 123 1113</li>
            <li>Post: Information Commissioner&rsquo;s Office, Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF</li>
          </ul>
          <p className="mb-4">You can complain to the ICO at any time, but we would like the chance to resolve your concern first.</p>
          <p>
            For the full detail of how we collect, use, and protect your personal data, see our 
            <Link href="/privacy" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">privacy policy</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}
