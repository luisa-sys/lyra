import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Lyra",
  description: "How Lyra collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <nav className="border-b border-stone-200/60 bg-stone-50/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center">
          <Link href="/" className="font-[family-name:var(--font-serif)] text-2xl text-stone-800 tracking-tight">
            lyra
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-12 prose prose-stone prose-sm">
        <h1 className="font-[family-name:var(--font-serif)] text-3xl text-stone-800 mb-2">Privacy Policy</h1>
        <p className="text-stone-500 text-sm mb-8">Last updated: 30 March 2026</p>

        <div className="space-y-8 text-stone-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Who we are</h2>
            <p>
              Lyra is a personal profile platform operated from the United Kingdom. It allows you to
              create a structured public profile sharing your preferences, interests, gift ideas, and
              personal details — so the people (and AI assistants) in your life don&apos;t have to guess.
            </p>
            <p>
              For data protection purposes, the data controller is Lyra (checklyra.com). If you have
              questions about how your data is handled, contact us at <a href="mailto:privacy@checklyra.com" className="text-[var(--color-lyra-sage)] underline">privacy@checklyra.com</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">What data we collect</h2>
            <p>When you create a Lyra account and profile, we collect:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Account data:</strong> your email address and authentication credentials (managed via Google Sign-In or email/password).</li>
              <li><strong>Profile data:</strong> display name, headline, city, country, bio, and any items you add to your profile (likes, dislikes, gift ideas, boundaries, school affiliations, external links, and other preference categories).</li>
              <li><strong>Profile photo:</strong> if you upload one, your profile image is stored in our hosting infrastructure.</li>
              <li><strong>Usage data:</strong> basic analytics about how you interact with the site (page views, session duration), collected by our hosting provider Vercel.</li>
            </ul>
            <p>We do not collect sensitive personal data (as defined by UK GDPR Article 9) unless you voluntarily include it in your profile content.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">How we use your data</h2>
            <p>We use your data to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Provide and maintain your Lyra profile.</li>
              <li>Display your published profile to visitors on the web and via our API.</li>
              <li>Allow AI assistants to read your published profile data through our MCP (Model Context Protocol) server — this is a core feature of Lyra.</li>
              <li>Send you essential service communications (account verification, security alerts).</li>
              <li>Improve the platform based on aggregated, anonymised usage patterns.</li>
            </ul>
            <p>We do not sell your personal data. We do not use your data for advertising. We do not share your data with third parties for marketing purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Profile visibility and AI access</h2>
            <p>
              Lyra is designed to make your preferences accessible to people and AI assistants. When you
              publish your profile:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Your profile is visible to anyone on the web at your public URL (checklyra.com/your-slug).</li>
              <li>Your published profile data is accessible to AI assistants (such as Claude, ChatGPT, and others) via our MCP server. This means an AI companion can read your preferences to help someone choose a gift for you, for example.</li>
              <li>Your profile appears in search results on Lyra&apos;s search/browse page.</li>
            </ul>
            <p>
              Unpublished profiles are not visible to the public or to AI assistants. You control when to
              publish and can unpublish at any time from your dashboard.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Legal basis for processing</h2>
            <p>Under UK GDPR, we process your data on the following legal bases:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Consent:</strong> you choose to create an account and publish your profile. You can withdraw consent by deleting your account.</li>
              <li><strong>Legitimate interests:</strong> maintaining service security, preventing abuse, and improving the platform.</li>
              <li><strong>Contract:</strong> providing the service you signed up for.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Where your data is stored</h2>
            <p>
              Your data is stored using Supabase (a PostgreSQL database service) with servers in the EU
              (AWS eu-west-2, London region). Profile photos are stored in Supabase Storage, also in
              the EU region. The website is served globally via Vercel&apos;s edge network and protected by
              Cloudflare. Backups are stored in Cloudflare R2 with EU jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Data retention</h2>
            <p>
              We retain your account and profile data for as long as your account is active. If you
              delete your account, your data is removed from our active databases. Backups containing
              your data may persist for up to 90 days after deletion before being automatically purged.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Your rights</h2>
            <p>Under UK GDPR, you have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Access:</strong> request a copy of the personal data we hold about you.</li>
              <li><strong>Rectification:</strong> correct inaccurate data via your dashboard or by contacting us.</li>
              <li><strong>Erasure:</strong> delete your account and all associated data.</li>
              <li><strong>Portability:</strong> receive your data in a structured, machine-readable format.</li>
              <li><strong>Object:</strong> object to processing based on legitimate interests.</li>
              <li><strong>Restrict processing:</strong> request that we limit how we use your data.</li>
            </ul>
            <p>
              To exercise any of these rights, contact us at <a href="mailto:privacy@checklyra.com" className="text-[var(--color-lyra-sage)] underline">privacy@checklyra.com</a>.
              We will respond within one month as required by UK GDPR.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Cookies</h2>
            <p>
              Lyra uses essential cookies only. These are required for authentication (keeping you
              signed in) and security (CSRF protection). We do not use tracking cookies, advertising
              cookies, or third-party analytics cookies. Vercel may collect anonymised performance
              data through its edge network — see <a href="https://vercel.com/legal/privacy-policy" className="text-[var(--color-lyra-sage)] underline" target="_blank" rel="noopener noreferrer">Vercel&apos;s privacy policy</a> for details.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Children</h2>
            <p>
              Lyra is not directed at children under 13. We do not knowingly collect personal data from
              children under 13. If you believe a child under 13 has created an account, please contact
              us at <a href="mailto:privacy@checklyra.com" className="text-[var(--color-lyra-sage)] underline">privacy@checklyra.com</a> and we will delete the account promptly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Changes to this policy</h2>
            <p>
              We may update this privacy policy from time to time. We will notify you of significant
              changes by email or by posting a notice on the site. The &quot;last updated&quot; date at the
              top of this page indicates when the policy was last revised.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Contact and complaints</h2>
            <p>
              If you have questions or concerns about this privacy policy or how we handle your data,
              contact us at <a href="mailto:privacy@checklyra.com" className="text-[var(--color-lyra-sage)] underline">privacy@checklyra.com</a>.
            </p>
            <p>
              You also have the right to lodge a complaint with the Information Commissioner&apos;s Office
              (ICO), the UK&apos;s data protection authority: <a href="https://ico.org.uk/make-a-complaint/" className="text-[var(--color-lyra-sage)] underline" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>.
            </p>
          </section>

          <div className="border-t border-stone-200 pt-6 mt-8">
            <p className="text-xs text-stone-400">
              This is a working draft. It will be reviewed by a qualified solicitor before public beta launch.
            </p>
          </div>

        </div>
      </article>
    </main>
  );
}
