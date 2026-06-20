import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accessibility — Lyra",
  description: "Our commitment to making Lyra usable by everyone, working towards WCAG 2.2 AA.",
};

export default function AccessibilityPage() {
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
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Accessibility</h1>

        <p>
          We want Lyra to be easy for everyone to use. We aim for clean, calm pages, good colour
          contrast, clear text and keyboard-friendly navigation, working towards{" "}
          <strong>WCAG 2.2 AA</strong>.
        </p>
        <p>
          We&apos;re a small team and we won&apos;t get everything right first time — if something is
          hard to use, please tell us via{" "}
          <Link href="/contact" className="text-[var(--color-sage)]">Contact</Link> and we&apos;ll fix
          it.
        </p>
      </article>
    </main>
  );
}
