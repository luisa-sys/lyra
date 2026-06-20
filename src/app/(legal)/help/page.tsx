import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help — Lyra",
  description: "Common questions about Lyra — who can see your profile, how people find you, and more.",
};

export default function HelpPage() {
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
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Help</h1>

        <h2>Who can see my profile?</h2>
        <p>
          Anything you fill in is public — <em>except</em> the things we deliberately hide, like your
          schools, organisations and communities (hidden by default). Only fill in what you&apos;re
          happy for people to see. Everything except your name is optional.
        </p>

        <h2>How do people find me?</h2>
        <p>
          By name, school, organisation, or the first part of your postcode. Your affiliations help
          people find you <em>even when they&apos;re hidden</em> from your public page.
        </p>

        <h2>How do people contact me?</h2>
        <p>
          They don&apos;t — not through Lyra. There are no messages, friend requests, comments or
          likes. If someone wants to reach you, they do it offline. That&apos;s the whole idea.
        </p>

        <h2>Why can&apos;t I add my phone number or email?</h2>
        <p>To keep you safe and spam-free. Lyra is for being understood, not for being contacted here.</p>

        <h2>Can I write about my friend, or a celebrity?</h2>
        <p>No — Lyra is only about <em>you</em>. Content about other people is removed.</p>

        <h2>Why is it taking so long to hear back from you?</h2>
        <p>
          Lyra is a small team. We read everything and we <em>will</em> reply — just not always
          quickly. Thank you for bearing with us. 💛
        </p>

        <h2>How do I edit or delete my profile?</h2>
        <p>
          You can edit any time. To delete your profile or data,{" "}
          <Link href="/contact" className="text-[var(--color-sage)]">contact us</Link> — see the{" "}
          <Link href="/privacy" className="text-[var(--color-sage)]">Privacy Policy</Link> for your
          full rights.
        </p>
      </article>
    </main>
  );
}
