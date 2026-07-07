import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data protection complaints — Lyra",
  description: "How to raise a data-protection complaint with Lyra and escalate to the ICO.",
};

export default function ComplaintsPage() {
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
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Data protection complaints</h1>

        <p>This page is for concerns about how Lyra handles your personal data. If you have a general question or another kind of problem, please use our <Link href="/contact" className="text-[var(--color-sage)]">contact page</Link> instead.</p>

        <h2>How to make a complaint</h2>
        <p>Email <a href="mailto:privacy@checklyra.com" className="text-[var(--color-sage)]">privacy@checklyra.com</a> with the word &quot;complaint&quot; in your message and a description of your concern. Tell us what happened, which of your personal data is involved, and what you would like us to do.</p>

        <h2>What we will do</h2>
        <p>We will <strong>acknowledge your complaint within 30 days</strong> of receiving it, investigate it without undue delay, keep you informed of progress, and write to you with the outcome. This reflects our statutory duty under the <strong>Data (Use and Access) Act 2025</strong>.</p>

        <h2>Escalating to the ICO</h2>
        <p>If you remain dissatisfied, you have the right to complain to the UK Information Commissioner&apos;s Office (ICO), our supervisory authority:</p>
        <ul>
          <li>Online: <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">ico.org.uk/make-a-complaint</a></li>
          <li>Helpline: 0303 123 1113</li>
          <li>Post: Information Commissioner&apos;s Office, Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF</li>
        </ul>
        <p>You can complain to the ICO at any time, but we would like the chance to resolve your concern first.</p>

        <p>For the full detail of how we collect, use, and protect your personal data, see our <Link href="/privacy" className="text-[var(--color-sage)]">privacy policy</Link>.</p>
      </article>
    </main>
  );
}
