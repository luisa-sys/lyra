import Link from 'next/link';
import Image from 'next/image';

export const metadata = {
  title: 'Privacy Policy — Lyra',
  description: 'How Lyra collects, uses, and protects your personal data.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <nav className="border-b border-[var(--color-border)]/60">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" priority />
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-10 prose prose-stone prose-sm">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Privacy Policy</h1>
        <p className="text-sm text-[var(--color-muted)]">Last updated: 20 July 2026</p>

        <h2>Who we are</h2>
        <p>Lyra is operated by <strong>CheckLyra Ltd</strong> (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), a company registered in England &amp; Wales (company no. 16351012; registered office: 71–75 Shelton Street, Covent Garden, London, WC2H 9JQ). CheckLyra Ltd is the data controller for the personal data described here, and is registered with the UK Information Commissioner&apos;s Office (ICO) under registration reference <strong>ZC124222</strong>. We are committed to protecting your privacy and handling your personal data transparently.</p>

        <h2>What data we collect</h2>
        <p>When you create a Lyra profile, we collect:</p>
        <ul>
          <li><strong>Account data:</strong> Email address and display name. Sign-in is passwordless — we email you a secure one-time link, so there&apos;s no password to store.</li>
          <li><strong>Profile data:</strong> Headline, bio, city, country, preferences, gift ideas, likes, dislikes, boundaries, school affiliations, external links, and profile photo — all provided voluntarily by you</li>
          <li><strong>Usage data:</strong> Page views and basic analytics (via Vercel Analytics), collected anonymously unless you opt in</li>
          <li><strong>Age confirmation:</strong> The fact that you confirmed you are 18 or over, and the date and time you confirmed it — see <strong>Age (18+)</strong> below. We do <strong>not</strong> ask for your date of birth.</li>
        </ul>
        <p>Lyra is for adults — you must be <strong>18 or over</strong> to create a profile, and it is not intended for children. We do <strong>not</strong> collect payment information, precise location data, browsing history, date of birth, identity documents, or biometric data. We do not receive any data about you from third-party data brokers or profiling services.</p>

        <h2>Why we collect it (lawful basis)</h2>
        <ul>
          <li><strong>Consent:</strong> You choose to create a profile and share your preferences. You can withdraw consent at any time by deleting your account.</li>
          <li><strong>Legitimate interest:</strong> We use anonymised analytics to improve the service and security logs to protect against abuse.</li>
        </ul>

        <h2>Age (18+)</h2>
        <p>Lyra is an adults-only service. Before you can create a profile we ask you a single question — whether you are 18 or over — and you must confirm that you are in order to continue. We record your answer and the date and time you gave it.</p>
        <p><strong>What we do not collect.</strong> We do not ask for your date of birth, we do not ask you for identity documents, and we do not use facial scanning, age-estimation software, or any other biometric check. Lyra holds no special-category data under Article 9 of the UK GDPR for this or any other purpose.</p>
        <p><strong>What this means.</strong> This is a self-declaration: it records what you have told us, and it is not an independently verified check of your age. We rely on it together with our <Link href="/terms" className="text-[var(--color-sage)]">Terms of Service</Link>, which require you to be 18 or over to use Lyra. If we become aware that an account belongs to someone under 18, we will suspend it and delete the associated personal data.</p>
        <p><strong>Change from our previous policy.</strong> Until July 2026 this section described a one-time biometric facial age-estimation check performed by a third-party provider (Didit). We have <strong>removed that check</strong>. Lyra no longer uses Didit, no longer sends any image to an age-assurance provider, and no longer holds any age-assurance result or age band. Any such results previously held have been retired along with the feature.</p>

        <h2>How we use your data</h2>
        <ul>
          <li>To display your public profile at checklyra.com/your-slug</li>
          <li>To show your profile in Lyra&apos;s search/browse page when published</li>
          <li>To enable AI companions (via MCP) to help people find gift ideas and understand your preferences</li>
          <li>To improve the Lyra service through anonymised analytics</li>
          <li>To send essential account emails (your sign-in link and account notices)</li>
        </ul>
        <p>We will <strong>never</strong> sell your data, use it for targeted advertising, or share it with third parties for their marketing purposes.</p>

        <h2>Who we share data with</h2>
        <p>We use the following service providers, who each act as our processor under a data processing agreement:</p>
        <ul>
          <li><strong>Supabase</strong> (database, authentication, and file storage) — stores your profile data, media, and sign-in records</li>
          <li><strong>Vercel</strong> (website hosting) — serves checklyra.com</li>
          <li><strong>Cloudflare</strong> (DNS, CDN, and encrypted backup storage) — routes web traffic and holds our database backups in Cloudflare R2</li>
          <li><strong>Railway</strong> (application hosting) — runs the MCP integration servers that let AI companions access published profiles</li>
          <li><strong>Resend</strong> (transactional email) — delivers your sign-in link, event invites, and account notices</li>
          <li><strong>Google</strong> (sign-in, calendar, and town/city lookup) — provides optional Google sign-in; if you connect it, reads your calendar&apos;s free/busy availability to help plan events; and, when you use the optional town/city finder, resolves a postcode or place name you type into a town/city using the <strong>Google Places API</strong>. Only the resulting town/city is saved to your profile — the postcode or place text you type is sent to Google solely to perform that lookup and is <strong>never stored by Lyra</strong>.</li>
        </ul>
        <p>Each of these providers processes data under its own GDPR-compliant data processing agreement. Some of them are based in, or host data in, the United States. Where personal data is transferred outside the UK, that transfer is protected by the <strong>UK Addendum to the EU Standard Contractual Clauses</strong> (or the UK International Data Transfer Agreement) incorporated by the provider&apos;s DPA, together with encryption in transit and at rest. Database backups are stored, encrypted, in Cloudflare R2 with 90-day retention. Our full sub-processor register is available on request at privacy@checklyra.com.</p>

        <h2>Affiliate partners</h2>
        <p>Some of the gift suggestions Lyra surfaces are affiliate links. If you click one and make a purchase, Lyra may earn a small commission from the retailer at no extra cost to you. We work with the following affiliate networks:</p>
        <ul>
          <li><strong>Sovrn Commerce</strong> (US-based aggregator) — routes outbound clicks to retailers and reports back which clicks led to purchases so the correct commission is paid. <a href="https://www.sovrn.com/legal/privacy-policy/" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">Sovrn&apos;s privacy policy</a>.</li>
        </ul>
        <p>When you click an affiliate link, the affiliate network receives the URL you clicked, an opaque tracking identifier generated by Lyra, and standard browser metadata (your referring page, your user agent, your IP address). We <strong>never</strong> share your account email, your name, your profile content, or the name or contents of any recipient profile with affiliate partners.</p>
        <p>The opaque identifier lets us reconcile our internal click log against the partner&apos;s monthly report. It does not identify you to the partner. See the <Link href="/partners" className="text-[var(--color-sage)]">affiliate partners page</Link> for the full disclosure.</p>
        <p><strong>Lawful basis</strong>: legitimate interest under UK GDPR Art. 6(1)(f). Routing affiliate commission to the correct programme is necessary to operate the monetisation feature you are using. You can use Lyra entirely without clicking affiliate links.</p>
        <p>We may add more affiliate partners (for example direct programmes with specific large retailers) in the future. When we do, this section and <Link href="/partners" className="text-[var(--color-sage)]">/partners</Link> will be updated.</p>

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
        <p>Affiliate links route you to retailers via a redirect. The retailer (and, when relevant, the affiliate network operating the redirect) may set their own cookies on their own domain — those are governed by the retailer&apos;s and the network&apos;s privacy policies, not ours. Lyra does not set any tracking cookies on your browser as part of clicking an affiliate link. See the <Link href="/cookies" className="text-[var(--color-sage)]">Cookie Policy</Link> for the full breakdown.</p>

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

        <h2>Data protection complaints</h2>
        <p>If you are unhappy with how we have handled your personal data, you can make a data-protection complaint to us. Email <a href="mailto:privacy@checklyra.com" className="text-[var(--color-sage)]">privacy@checklyra.com</a> with the word &quot;complaint&quot; and a description of your concern, or use our <Link href="/complaints" className="text-[var(--color-sage)]">complaints page</Link>.</p>
        <p>We will <strong>acknowledge your complaint within 30 days</strong> of receiving it, investigate it without undue delay, keep you informed of progress, and write to you with the outcome. This reflects our statutory duty under the <strong>Data (Use and Access) Act 2025</strong>.</p>
        <p>If you remain dissatisfied, you have the right to complain to the UK Information Commissioner&apos;s Office (ICO), our supervisory authority:</p>
        <ul>
          <li>Online: <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">ico.org.uk/make-a-complaint</a></li>
          <li>Helpline: 0303 123 1113</li>
          <li>Post: Information Commissioner&apos;s Office, Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF</li>
        </ul>
        <p>You can complain to the ICO at any time, but we would welcome the chance to resolve your concern first.</p>

        <h2>Contact</h2>
        <p>For privacy enquiries: privacy@checklyra.com</p>
        <p>For complaints, you can contact the UK Information Commissioner&apos;s Office (ICO) at <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" className="text-[var(--color-sage)]">ico.org.uk</a>.</p>
      </article>
    </main>
  );
}
