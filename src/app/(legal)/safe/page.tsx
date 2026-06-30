import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Keeping people safe — Lyra",
  description: "Safety and safeguarding on Lyra — sensitive details are private by default.",
};

export default function SafePage() {
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
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Keeping people safe</h1>

        <p>Your safety comes first.</p>
        <ul>
          <li>
            <strong>Sensitive details are private by default.</strong> The schools, organisations and
            communities you belong to help people <em>find</em> you in search, but they&apos;re hidden
            on your public profile unless you choose to show them — so things like where you (or your
            children) study aren&apos;t on display.
          </li>
          <li>
            <strong>No contact details on show.</strong> We don&apos;t allow phone numbers or emails on
            profiles, and there are no messages — so no one can contact you through Lyra. Connecting
            happens offline, with people you choose.
          </li>
          <li>
            <strong>No exact locations.</strong> We don&apos;t show addresses, and we don&apos;t
            collect or store your postcode.
          </li>
          <li>
            <strong>Extra care for children.</strong> Children&apos;s profiles are parent-managed with
            stronger protections. <em>(In progress.)</em>
          </li>
        </ul>

        <p>
          Worried about something, or seen content about you that shouldn&apos;t be there?{" "}
          <Link href="/contact" className="text-[var(--color-sage)]">Contact us</Link> and we&apos;ll
          act quickly.
        </p>

        <p className="text-sm text-[var(--color-muted)]">
          A proper safeguarding / child-safety review is part of our UK GDPR Art. 8 /
          Age-Appropriate Design work, and is ongoing.
        </p>
      </article>
    </main>
  );
}
