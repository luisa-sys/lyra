import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Lyra",
  description: "Terms and conditions for using the Lyra platform.",
};

export default function TermsPage() {
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
        <h1 className="font-[family-name:var(--font-serif)] text-3xl text-stone-800 mb-2">Terms of Service</h1>
        <p className="text-stone-500 text-sm mb-8">Last updated: 30 March 2026</p>

        <div className="space-y-8 text-stone-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-stone-800">What Lyra is</h2>
            <p>
              Lyra is a personal profile platform. You create a profile that shares your preferences,
              interests, gift ideas, boundaries, and other personal details. Your published profile is
              visible on the web and accessible to AI assistants through our API, so the people in your
              life can understand you better — without having to ask.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Your account</h2>
            <p>
              To use Lyra, you need to create an account using a valid email address or Google Sign-In.
              You are responsible for keeping your account credentials secure. If you suspect
              unauthorised access to your account, contact us immediately at <a href="mailto:support@checklyra.com" className="text-[var(--color-lyra-sage)] underline">support@checklyra.com</a>.
            </p>
            <p>You must be at least 13 years old to create a Lyra account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Your content</h2>
            <p>
              You own the content you add to your Lyra profile. By publishing your profile, you grant
              Lyra a licence to display that content on the web and make it accessible through our
              MCP (Model Context Protocol) server to AI assistants. This licence exists only for as
              long as your profile is published — if you unpublish or delete your profile, we stop
              displaying and serving your content.
            </p>
            <p>You are responsible for the accuracy and legality of the content you add to your profile.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Profile visibility</h2>
            <p>When you publish your profile on Lyra, you understand and agree that:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Your profile is publicly accessible at your unique URL (checklyra.com/your-slug).</li>
              <li>Your published profile data can be read by AI assistants (such as Claude, ChatGPT, and others) through our MCP server. This is a core feature of Lyra — it&apos;s how AI companions learn about the people they help.</li>
              <li>Your profile may appear in Lyra&apos;s search results.</li>
              <li>Search engines may index your published profile.</li>
            </ul>
            <p>
              You can unpublish your profile at any time from your dashboard. Unpublished profiles are
              not visible to the public or to AI assistants.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Acceptable use</h2>
            <p>You agree not to use Lyra to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Impersonate another person or create a profile for someone without their consent.</li>
              <li>Post content that is illegal, defamatory, abusive, threatening, or harassing.</li>
              <li>Upload malware, spam, or content designed to exploit vulnerabilities.</li>
              <li>Attempt to access other users&apos; accounts or data.</li>
              <li>Use automated tools to scrape profiles or abuse the API beyond its intended purpose.</li>
              <li>Post content that infringes copyright or other intellectual property rights.</li>
            </ul>
            <p>
              We reserve the right to suspend or terminate accounts that violate these terms, with or
              without notice depending on the severity of the violation.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Deleting your account</h2>
            <p>
              You can delete your account at any time. When you delete your account, we remove your
              profile and all associated data from our active databases. Backups may retain your data
              for up to 90 days. See our <Link href="/privacy" className="text-[var(--color-lyra-sage)] underline">Privacy Policy</Link> for full details on data retention.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Service availability</h2>
            <p>
              Lyra is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We aim to keep the service
              running reliably, but we do not guarantee uninterrupted or error-free access. We may
              temporarily suspend the service for maintenance, updates, or security reasons.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Limitation of liability</h2>
            <p>
              To the fullest extent permitted by law, Lyra is not liable for any indirect, incidental,
              or consequential damages arising from your use of the service. Our total liability is
              limited to the amount you have paid us (if any) in the 12 months preceding the claim.
            </p>
            <p>
              Nothing in these terms limits our liability for death or personal injury caused by
              negligence, fraud, or any other liability that cannot be excluded by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Changes to these terms</h2>
            <p>
              We may update these terms from time to time. We will notify you of significant changes by
              email or by posting a notice on the site. Continued use of Lyra after changes take effect
              constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Governing law</h2>
            <p>
              These terms are governed by the laws of England and Wales. Any disputes will be subject to
              the exclusive jurisdiction of the courts of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-stone-800">Contact</h2>
            <p>
              If you have questions about these terms, contact us at <a href="mailto:support@checklyra.com" className="text-[var(--color-lyra-sage)] underline">support@checklyra.com</a>.
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
