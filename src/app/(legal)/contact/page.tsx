import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { turnstileSiteKey } from "@/lib/turnstile";
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
      </article>
    </main>
  );
}
