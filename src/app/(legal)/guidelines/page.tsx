import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guidelines — Lyra",
  description: "How to use Lyra kindly, and what gets removed.",
};

export default function GuidelinesPage() {
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
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Guidelines</h1>

        <p>A few simple rules:</p>
        <ul>
          <li><strong>It&apos;s your page, in your own words.</strong> Write about <em>you</em> — your loves, your story, your questions.</li>
          <li><strong>Keep it about you.</strong> Don&apos;t write about other people — named or not, famous or not. Anything about someone else is removed.</li>
          <li><strong>No contact details.</strong> Please don&apos;t put phone numbers or email addresses on your profile — Lyra isn&apos;t for being contacted here, and it keeps you safe.</li>
          <li><strong>No abuse, harassment or hate.</strong></li>
          <li><strong>Nothing harmful, illegal, sexual or violent</strong> — that includes photos.</li>
        </ul>

        <p>
          See something that breaks these? Tell us via{" "}
          <Link href="/contact" className="text-[var(--color-sage)]">Contact</Link>. We use a mix of
          automated checks and human review, and we remove anything that crosses the line.
        </p>

        <p className="text-sm text-[var(--color-muted)]">
          See also: <Link href="/safe" className="text-[var(--color-sage)]">Keeping people safe</Link>.
        </p>
      </article>
    </main>
  );
}
