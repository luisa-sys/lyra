import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Lyra — Lyra",
  description:
    "Lyra is a simple page about you, written by you, for the people in your life. For gifts more personal than flowers and chocolates.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <nav className="border-b border-[var(--color-border)]/60">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="flex items-center" aria-label="Lyra home">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" priority />
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-10 text-[var(--color-ink)] leading-relaxed">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] mb-2">About Lyra</h1>

        <p className="text-xl font-medium leading-snug text-[var(--color-sage)] mb-6">
          For gifts more personal than flowers and chocolates.
        </p>

        <p className="mb-4">
          Lyra is a simple page about you, written by you, for the people in your life.
        </p>

        <p className="mb-8">
          Think of it as a small encyclopedia entry for an ordinary person. It covers what you love
          and what you&rsquo;d rather skip, your sizes and favourite colours, the books on your list,
          how you like to be thanked, and the things you&rsquo;d never guess about yourself.
        </p>

        <h2 className="text-lg font-semibold mb-2">What Lyra isn&rsquo;t</h2>
        <p className="mb-8">
          It isn&rsquo;t social media. There are no messages, no feeds, no groups, no likes and no
          followers. Nothing to keep up with and nothing to perform. You fill in your page when you
          feel like it, and the people who care about you can read it when they need it.
        </p>

        <h2 className="text-lg font-semibold mb-2">Why it exists</h2>
        <p className="mb-4">
          Most of us know the people around us less well than we&rsquo;d like. A colleague, a
          teacher, a neighbour, sometimes even family. Not because we don&rsquo;t care, but because
          nobody ever told us. So we play it safe: another bottle of wine, another box of
          chocolates, a bunch of flowers for someone who never liked flowers.
        </p>
        <p className="mb-8">
          Lyra fixes the &ldquo;nobody told us&rdquo; part. Then it gets out of the way, so the real
          moment can happen offline: a gift that fits, a thank-you that lands, a kind word that
          shows you were paying attention.
        </p>

        <p className="text-lg font-medium mb-8">Understand each other better.</p>

        <p className="text-sm text-[var(--color-muted)] mb-6">
          Your email is only ever used to sign you in. <strong>We never share it.</strong>
        </p>

        <p>
          <Link href="/guidelines" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Read the guidelines</Link>
          {" · "}
          <Link href="/contact" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Get in touch</Link>
        </p>
      </article>
    </main>
  );
}
