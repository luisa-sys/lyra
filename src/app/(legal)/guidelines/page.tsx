import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guidelines — Lyra",
  description:
    "Keep your Lyra page about you, kind and suitable for everyone. Anything that breaks these guidelines is deleted.",
};

const LINK = "text-[var(--color-sage)] underline underline-offset-2 hover:no-underline";

// Styled with explicit classes (like /about) rather than `prose`:
// @tailwindcss/typography is not installed, so `prose` renders unstyled.
function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <p>{children}</p>
    </section>
  );
}

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

      <article className="max-w-3xl mx-auto px-6 py-10 text-[var(--color-ink)] leading-relaxed">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] mb-4">Guidelines</h1>

        <p className="mb-8">
          Lyra works because every page is honest, kind and written by the person it&rsquo;s
          about. A few things to keep in mind:
        </p>

        <Rule title="Keep it about you">
          Your page is your story, in your own words: what you love, what you&rsquo;d rather skip,
          how you like to be thanked. Please don&rsquo;t write about other people, whether
          that&rsquo;s a partner, a child, a colleague or someone famous, and whether you name them
          or not. If they haven&rsquo;t chosen to have a page, that choice is theirs. Saying
          you&rsquo;re a mum of two or that you love walking your dog is fine. Describing someone
          else, their habits or their private life isn&rsquo;t.
        </Rule>

        <Rule title="Be kind">
          Write the way you&rsquo;d talk to someone you respect. No insults, threats, bullying or
          aggressive language towards anyone.
        </Rule>

        <Rule title="No hate">
          Nothing that attacks or demeans people for who they are. That covers race, ethnicity,
          nationality, religion, sex, gender identity, sexual orientation, disability, age and
          anything else.
        </Rule>

        <Rule title="Keep it suitable for everyone">
          Colleagues, teachers, neighbours and family all read Lyra pages. So no sexual content,
          nudity, or sexually suggestive words or photos.
        </Rule>

        <Rule title="Nothing harmful or illegal">
          No violence or graphic content, nothing that encourages self-harm, nothing illegal, and
          no spam or advertising.
        </Rule>

        <Rule title="Keep your private details private">
          Please don&rsquo;t add phone numbers, home addresses or email addresses. Lyra isn&rsquo;t
          a place for being contacted, and leaving them off keeps you safe.
        </Rule>

        <Rule title="What happens if something breaks these guidelines">
          We use a mix of automated checks and human review. Anything that breaks these guidelines
          will be deleted. If it keeps happening, or if something is seriously harmful, we may
          suspend the account.
        </Rule>

        <p className="mb-10">
          See something that doesn&rsquo;t belong? Let us know via{" "}
          <Link href="/contact" className={LINK}>Contact</Link>.
        </p>

        <h2 className="text-lg font-semibold mb-2">How Lyra keeps you safe</h2>
        <ul className="list-disc pl-6 mb-4 space-y-1">
          <li>
            We never show your email address. It&rsquo;s only used to sign you in.
          </li>
          <li>There are no messages, so no one can contact you through Lyra.</li>
          <li>
            The schools and groups you add can be found through search. They&rsquo;re hidden on your
            page unless you choose to show them, but someone searching for a school can still see
            that you&rsquo;re connected to it. If you&rsquo;d rather keep that private, the safest
            choice is to leave it off. Many people, like teachers, are happy to share where they
            work, just as they would on LinkedIn.
          </li>
          <li>
            For your own safety and privacy, we recommend not posting personal information.
          </li>
        </ul>
        <p className="mb-10">
          Seen something about you that shouldn&rsquo;t be there?{" "}
          <Link href="/contact" className={LINK}>Contact us</Link> and we&rsquo;ll act quickly.
        </p>

        <p className="text-lg font-medium">Thank you for helping keep Lyra a kind place.</p>
      </article>
    </main>
  );
}
