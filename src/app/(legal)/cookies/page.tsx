import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Cookie Policy — Lyra',
  description: 'How Lyra uses cookies and similar technologies.',
};

export default function CookiePolicyPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <nav className="border-b border-stone-200/60">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" priority />
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-10 prose prose-stone prose-sm">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Cookie Policy</h1>
        <p className="text-sm text-[var(--color-muted)]">Last updated: 31 March 2026</p>

        <h2>What are cookies?</h2>
        <p>Cookies are small text files stored on your device when you visit a website. They help websites remember your preferences and keep you signed in.</p>

        <h2>Cookies we use</h2>
        <p>Lyra uses only <strong>essential cookies</strong> that are strictly necessary for the site to function. We do not use any advertising, tracking, or analytics cookies.</p>

        <table>
          <thead>
            <tr>
              <th>Cookie</th>
              <th>Purpose</th>
              <th>Duration</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>sb-*-auth-token</code></td>
              <td>Keeps you signed in to your Lyra account. Set by Supabase Auth after you log in.</td>
              <td>Session / up to 7 days</td>
              <td>Essential</td>
            </tr>
            <tr>
              <td><code>sb-*-auth-token-code-verifier</code></td>
              <td>Used during the OAuth sign-in flow (e.g. Google Sign-In) to prevent cross-site request forgery.</td>
              <td>Session</td>
              <td>Essential</td>
            </tr>
          </tbody>
        </table>

        <h2>Third-party cookies</h2>
        <p>When you sign in with Google, Google may set its own cookies as part of the authentication process. These are governed by <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">Google&apos;s Privacy Policy</a>. Lyra does not control these cookies.</p>
        <p>Vercel, our hosting provider, may collect anonymised performance data. See <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">Vercel&apos;s Privacy Policy</a> for details. Cloudflare, which protects and routes our traffic, may set a <code>__cf_bm</code> cookie for bot detection. See <a href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">Cloudflare&apos;s cookie documentation</a>.</p>

        <h2>Managing cookies</h2>
        <p>Since Lyra only uses essential cookies, disabling them will prevent the site from working correctly (you won&apos;t be able to stay signed in). You can clear cookies at any time through your browser settings:</p>
        <ul>
          <li><strong>Chrome:</strong> Settings → Privacy and security → Clear browsing data</li>
          <li><strong>Firefox:</strong> Settings → Privacy &amp; Security → Cookies and Site Data → Clear Data</li>
          <li><strong>Safari:</strong> Settings → Safari → Clear History and Website Data</li>
          <li><strong>Edge:</strong> Settings → Privacy, search, and services → Clear browsing data</li>
        </ul>

        <h2>Changes to this policy</h2>
        <p>If we add new types of cookies (for example, analytics), we will update this page and notify you. We will never add advertising or tracking cookies.</p>

        <h2>Contact</h2>
        <p>Questions about cookies: <a href="mailto:privacy@checklyra.com" className="text-[var(--color-sage)]">privacy@checklyra.com</a></p>
        <p>See also our <Link href="/privacy" className="text-[var(--color-sage)]">Privacy Policy</Link> and <Link href="/terms" className="text-[var(--color-sage)]">Terms of Service</Link>.</p>
      </article>
    </main>
  );
}
