import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy — Lyra',
  description: 'How Lyra collects, uses, and protects your personal data.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <nav className="border-b border-stone-200/60">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink)]">lyra</Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-10 prose prose-stone prose-sm">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Privacy Policy</h1>
        <p className="text-sm text-[var(--color-muted)]">Last updated: 30 March 2026</p>

        <h2>Who we are</h2>
        <p>Lyra (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the website checklyra.com. We are committed to protecting your privacy and handling your personal data transparently.</p>

        <h2>What data we collect</h2>
        <p>When you create a Lyra profile, we collect:</p>
        <ul>
          <li><strong>Account data:</strong> Email address, password (encrypted), display name</li>
          <li><strong>Profile data:</strong> Headline, bio, city, country, preferences, gift ideas, likes, dislikes, boundaries, school affiliations, external links, and profile photo — all provided voluntarily by you</li>
          <li><strong>Usage data:</strong> Page views and basic analytics (via Vercel Analytics), collected anonymously unless you opt in</li>
        </ul>
        <p>We do <strong>not</strong> collect: payment information, precise location data, browsing history, data from third-party sources, or any data from children under 13.</p>

        <h2>Why we collect it (lawful basis)</h2>
        <ul>
          <li><strong>Consent:</strong> You choose to create a profile and share your preferences. You can withdraw consent at any time by deleting your account.</li>
          <li><strong>Legitimate interest:</strong> We use anonymised analytics to improve the service and security logs to protect against abuse.</li>
        </ul>

        <h2>How we use your data</h2>
        <ul>
          <li>To display your public profile at checklyra.com/your-slug</li>
          <li>To show your profile in Lyra&apos;s search/browse page when published</li>
          <li>To enable AI companions (via MCP) to help people find gift ideas and understand your preferences</li>
          <li>To improve the Lyra service through anonymised analytics</li>
          <li>To send essential account emails (confirmation, password reset)</li>
        </ul>
        <p>We will <strong>never</strong> sell your data, use it for targeted advertising, or share it with third parties for their marketing purposes.</p>

        <h2>Who we share data with</h2>
        <p>We use the following service providers who process data on our behalf:</p>
        <ul>
          <li><strong>Supabase</strong> (database hosting, EU region) — stores your profile data</li>
          <li><strong>Vercel</strong> (website hosting) — serves checklyra.com</li>
          <li><strong>Cloudflare</strong> (DNS and CDN) — routes web traffic</li>
        </ul>
        <p>Each provider has their own GDPR-compliant data processing agreements. We do not transfer data outside the UK/EU. Profile photos are stored in Supabase Storage (EU region). Database backups are stored in Cloudflare R2 with EU jurisdiction and 90-day retention.</p>

        <h2>Your rights (UK GDPR / Data Protection Act 2018)</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Download all your data in JSON format from your account settings</li>
          <li><strong>Rectification:</strong> Edit any of your profile data at any time via the dashboard</li>
          <li><strong>Erasure:</strong> Permanently delete your account and all associated data from your account settings</li>
          <li><strong>Restrict processing:</strong> Unpublish your profile to hide it from public view without deleting your data</li>
          <li><strong>Data portability:</strong> Export your data in machine-readable JSON format</li>
          <li><strong>Object:</strong> Opt out of analytics tracking via the cookie consent banner</li>
        </ul>
        <p>To exercise any of these rights, use the controls in your <Link href="/dashboard/settings" className="text-[var(--color-sage)]">account settings</Link> or email us at privacy@checklyra.com.</p>

        <h2>Cookies</h2>
        <p>Lyra uses only essential cookies for authentication (keeping you logged in). We use Vercel Analytics which collects anonymised page view data without cookies. You can opt out of analytics via the cookie consent banner.</p>

        <h2>Data retention</h2>
        <ul>
          <li><strong>Active accounts:</strong> Data retained while your account is active</li>
          <li><strong>Deleted accounts:</strong> All data permanently deleted within 30 days of account deletion</li>
          <li><strong>Security logs:</strong> Retained for 90 days, then automatically deleted</li>
        </ul>

        <h2>Data security</h2>
        <p>We protect your data with: HTTPS encryption in transit, encrypted database storage, Row Level Security ensuring users can only access their own data, and regular security audits.</p>

        <h2>Changes to this policy</h2>
        <p>We may update this policy from time to time. We will notify you of significant changes via email or a notice on the website.</p>

        <h2>Contact</h2>
        <p>For privacy enquiries: privacy@checklyra.com</p>
        <p>For complaints, you can contact the UK Information Commissioner&apos;s Office (ICO) at <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">ico.org.uk</a>.</p>
      </article>
    </main>
  );
}
