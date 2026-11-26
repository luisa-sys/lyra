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

        <p className="text-lg font-medium mb-10">Understand each other better.</p>

        {/* KAN-493: Guidelines, Keeping people safe and Help moved here from their
            own pages; /guidelines, /safe and /help 308-redirect to these anchors. */}
        <section id="guidelines" className="mb-10 scroll-mt-6">
          <h2 className="text-lg font-semibold mb-2">Guidelines</h2>
          <p className="mb-3">A few simple rules:</p>
          <ul className="list-disc pl-5 space-y-2 mb-4">
            <li><strong>It&rsquo;s your page, in your own words.</strong> Write about <em>you</em> &mdash; your loves, your story, your questions.</li>
            <li><strong>Keep it about you.</strong> Don&rsquo;t write about other people &mdash; named or not, famous or not. Anything about someone else is removed.</li>
            <li><strong>No contact details.</strong> Please don&rsquo;t put phone numbers or email addresses on your profile &mdash; Lyra isn&rsquo;t for being contacted here, and it keeps you safe.</li>
            <li><strong>No abuse, harassment or hate.</strong></li>
            <li><strong>Nothing harmful, illegal, sexual or violent</strong> &mdash; that includes photos.</li>
          </ul>
          <p>
            See something that breaks these? Tell us via{" "}
            <Link href="/contact" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Contact</Link>. We use a mix of
            automated checks and human review, and we remove anything that crosses the line.
          </p>
        </section>

        <section id="safety" className="mb-10 scroll-mt-6">
          <h2 className="text-lg font-semibold mb-2">Keeping people safe</h2>
          <p className="mb-3">Your safety comes first.</p>
          <ul className="list-disc pl-5 space-y-2 mb-4">
            <li>
              <strong>Sensitive details are private by default.</strong> The schools, organisations and
              communities you belong to help people <em>find</em> you in search, but they&rsquo;re hidden
              on your public profile unless you choose to show them &mdash; so things like where you (or your
              children) study aren&rsquo;t on display.
            </li>
            <li>
              <strong>No contact details on show.</strong> We don&rsquo;t allow phone numbers or emails on
              profiles, and there are no messages &mdash; so no one can contact you through Lyra.
            </li>
            <li>
              <strong>No exact locations.</strong> We don&rsquo;t show addresses. If you add a school, we
              keep its postcode so we can tell schools with the same name apart, but it is never shown
              on your profile.
            </li>
          </ul>
          <p>
            Worried about something, or seen content about you that shouldn&rsquo;t be there?{" "}
            <Link href="/contact" className="text-[var(--color-sage)] underline underline-offset-2 hover:no-underline">Contact us</Link> and we&rsquo;ll
            act quickly.
          </p>
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
