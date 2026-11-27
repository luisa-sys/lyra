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
          how you like to be thanked, and the things people would never guess about you.
        </p>

        <h2 className="text-lg font-semibold mb-2">What Lyra isn&rsquo;t</h2>
        <p className="mb-8">
          It isn&rsquo;t social media. There are no messages, no feeds, no groups, no likes and no
          followers. Nothing to keep up with and nothing to perform. You fill in your page when you
          feel like it, and the people who care about you can read it when they need it. There are
          no posts &ndash; once you update something, people can only see the latest version.
        </p>

        <h2 className="text-lg font-semibold mb-2">Why it exists</h2>
        <p className="mb-4">
          Most of us know the people around us less well than we&rsquo;d like. A colleague, a
          teacher, a neighbour, sometimes even family. Not because we don&rsquo;t care, but because
          nobody ever told us. So we play it safe: another bouquet of flowers, another box of
          chocolates, or a bottle of wine for someone who doesn&rsquo;t drink.
        </p>
        <p className="mb-8">
          Lyra fixes the &ldquo;nobody told us&rdquo; part. Then it gets out of the way, so the real
          moment can happen offline: a gift that fits, a thank-you that lands, a kind word that
          shows you were paying attention.
        </p>

        <p className="text-lg font-medium mb-10">Understand each other better.</p>

        {/* KAN-493: Guidelines, Keeping people safe and Help moved here from their
            own pages; /guidelines, /safe and /help 308-redirect to these anchors. */}
        {/* KAN-493: Guidelines (KAN-495 copy, approved 2026-11-26) and "How Lyra
            keeps you safe" moved here from /guidelines; /guidelines and /safe
            308-redirect to these anchors. */}
        <section id="guidelines" className="mb-10 scroll-mt-6">
          <h2 className="text-lg font-semibold mb-2">Guidelines</h2>
          <p className="mb-6">
            Lyra works because every page is honest, kind and written by the person it&rsquo;s
            about. A few things to keep in mind:
          </p>

          <h3 className="font-semibold mb-1">Keep it about you</h3>
          <p className="mb-5">
            Your page is your story, in your own words: what you love, what you&rsquo;d rather skip,
            how you like to be thanked. Please don&rsquo;t write about other people, whether
            that&rsquo;s a partner, a child, a colleague or someone famous, and whether you name them
            or not. If they haven&rsquo;t chosen to have a page, that choice is theirs. Saying
            you&rsquo;re a mum of two or that you love walking your dog is fine. Describing someone
            else, their habits or their private life isn&rsquo;t.
          </p>
          <h3 className="font-semibold mb-1">Be kind</h3>
          <p className="mb-5">
            Write the way you&rsquo;d talk to someone you respect. No insults, threats, bullying or
            aggressive language towards anyone.
          </p>
          <h3 className="font-semibold mb-1">No hate</h3>
          <p className="mb-5">
            Nothing that attacks or demeans people for who they are. That covers race, ethnicity,
            nationality, religion, sex, gender identity, sexual orientation, disability, age and
            anything else.
          </p>
          <h3 className="font-semibold mb-1">Keep it suitable for everyone</h3>
          <p className="mb-5">
            Colleagues, teachers, neighbours and family all read Lyra pages. So no sexual content,
            nudity, or sexually suggestive words or photos.
          </p>
          <h3 className="font-semibold mb-1">Nothing harmful or illegal</h3>
          <p className="mb-5">
            No violence or graphic content, nothing that encourages self-harm, nothing illegal, and
            no spam or advertising.
          </p>
          <h3 className="font-semibold mb-1">Keep your private details private</h3>
          <p className="mb-5">
            Please don&rsquo;t add phone numbers, home addresses or email addresses for your own
            safety &ndash; remember all pages are public (like Wikipedia) so that information can be
            read by anyone. Lyra isn&rsquo;t a place for being contacted and leaving them off keeps
            you safe.
          </p>
          <h3 className="font-semibold mb-1">What happens if something breaks these guidelines</h3>
          <p className="mb-5">
            We use a mix of automated checks and human review. Anything that breaks these guidelines
            will be deleted. If it keeps happening, or if something is seriously harmful, we may
            suspend the account.
          </p>
          <p>
            See something that doesn&rsquo;t belong? Let us know via{" "}
            <Link href="/contact" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Contact</Link>.
          </p>
        </section>

        <section id="safety" className="mb-10 scroll-mt-6">
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
          <p className="mb-4">
            Seen something about you that shouldn&rsquo;t be there?{" "}
            <Link href="/contact" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Contact us</Link> and we&rsquo;ll act quickly.
          </p>
          <p className="font-medium">Thank you for helping keep Lyra a kind place.</p>
        </section>

        <section id="help" className="mb-10 scroll-mt-6">
          <h2 className="text-lg font-semibold mb-4">Help</h2>

          <h3 className="font-semibold mb-1">Who can see my profile?</h3>
          <p className="mb-5">
            Anything you fill in is public &mdash; <em>except</em> the things we deliberately hide, like your
            schools, organisations and communities (hidden by default). Only fill in what you&rsquo;re
            happy for people to see. To publish, you need a photo, your name and a CheckLyra ID;
            everything else is optional.
          </p>

          <h3 className="font-semibold mb-1">How do people find me?</h3>
          <p className="mb-5">
            By your name, or by a public school or organisation you&rsquo;ve added to your profile.
          </p>

          <h3 className="font-semibold mb-1">How do people contact me?</h3>
          <p className="mb-5">
            They don&rsquo;t &mdash; not through Lyra. There are no messages, friend requests, comments or
            likes. If someone wants to reach you, they do it offline. That&rsquo;s the whole idea.
          </p>

          <h3 className="font-semibold mb-1">Why can&rsquo;t I add my phone number or email?</h3>
          <p className="mb-5">To keep you safe and spam-free. Lyra is for being understood, not for being contacted here.</p>

          <h3 className="font-semibold mb-1">Can I write about my friend, or a celebrity?</h3>
          <p className="mb-5">No &mdash; Lyra is only about <em>you</em>. Content about other people is removed.</p>

          <h3 className="font-semibold mb-1">Why is it taking so long to hear back from you?</h3>
          <p className="mb-5">
            We read everything and we <em>will</em> reply &mdash; just not always
            quickly. Thank you for bearing with us. 💛
          </p>

          <h3 className="font-semibold mb-1">How do I edit or delete my profile?</h3>
          <p>
            You can edit your profile any time from your dashboard. You can delete your account
            yourself in <Link href="/dashboard/settings" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Settings</Link> &mdash; see the{" "}
            <Link href="/privacy" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Privacy Policy</Link> for your
            full rights.
          </p>
        </section>

        <p className="text-sm text-[var(--color-muted)] mb-6">
          Your email is only ever used to sign you in. <strong>We never share it.</strong>
        </p>

        <p>
          <Link href="/contact" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Get in touch</Link>
        </p>
      </article>
    </main>
  );
}
