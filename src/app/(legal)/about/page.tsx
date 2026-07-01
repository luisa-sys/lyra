import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { AboutTrio } from "@/app/_marketing/sections";

export const metadata: Metadata = {
  title: "About Lyra — Lyra",
  description:
    "Lyra is a place to be understood — a calm tool for your offline life.",
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

      <article className="max-w-3xl mx-auto px-6 py-10 prose prose-stone prose-sm">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">About Lyra</h1>

        <p className="lead text-[var(--color-ink)]">
          <strong>Lyra is a place to be understood — a tool for your <em>offline</em> life.</strong>
        </p>

        {/* 📖 / 🤝 / 🕊️ trio (moved here from the old homepage). */}
        <AboutTrio />

        <p>
          Most of the internet is built to keep you online longer. Lyra is the opposite. It&apos;s
          somewhere you read about <strong>someone you already know</strong> — before you meet,
          after you&apos;ve met, when you&apos;re looking for a gift, or simply to understand them a
          little better. The point isn&apos;t more screen time; it&apos;s to help your real-world
          relationships.
        </p>

        <p>So Lyra leaves out the things that make the internet anxious:</p>
        <ul>
          <li><strong>No direct messages, no friend requests.</strong> Lyra never puts you in anyone&apos;s inbox.</li>
          <li><strong>No comments</strong> — nothing hateful to read, nothing to dread.</li>
          <li><strong>No likes.</strong> Whatever you write, you never wonder if it got enough likes — because no one gets any. 🙂</li>
        </ul>

        <p>
          Your email is only ever used to sign you in. <strong>We never share it.</strong> If
          someone wants to reach you, they do it the old-fashioned way — offline.
        </p>

        <p>
          Just honest pages, in people&apos;s own words — a little &ldquo;Wikipedia for real
          people&rdquo;. We hope it makes knowing each other a little kinder.
        </p>

        <p>
          <Link href="/guidelines" className="text-[var(--color-sage)]">Read the guidelines</Link>
          {" · "}
          <Link href="/contact" className="text-[var(--color-sage)]">Get in touch</Link>
        </p>
      </article>
    </main>
  );
}
