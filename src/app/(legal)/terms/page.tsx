import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service — Lyra',
  description: 'Terms governing your use of the Lyra platform.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-stone-50">
      <nav className="border-b border-stone-200/60">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center">
          <Link href="/" className="font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink)]">lyra</Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-10 prose prose-stone prose-sm">
        <h1 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">Terms of Service</h1>
        <p className="text-sm text-[var(--color-muted)]">Last updated: 30 March 2026</p>

        <h2>1. Acceptance</h2>
        <p>By creating a Lyra account or using checklyra.com, you agree to these terms. If you do not agree, please do not use the service.</p>

        <h2>2. The service</h2>
        <p>Lyra is a profile platform where you share preferences, gift ideas, and boundaries so people in your life can understand you better. Profiles can be accessed by visitors on the web and by AI companions via the MCP protocol.</p>

        <h2>3. Your account</h2>
        <p>You are responsible for maintaining the security of your account. You must provide accurate information and keep your email address up to date. You must be at least 13 years old to create an account.</p>

        <h2>4. Your content</h2>
        <p>You own all content you add to your profile. By publishing your profile, you grant Lyra a licence to display that content publicly on checklyra.com and via the MCP protocol. You can revoke this licence at any time by unpublishing or deleting your profile.</p>
        <p>You must not add content that is illegal, harmful, abusive, or infringes on others&apos; rights.</p>

        <h2>5. AI companion access</h2>
        <p>Published profiles may be accessed by AI companions (such as Claude, ChatGPT, and Gemini) via the MCP protocol. This is a core feature of Lyra. By publishing your profile, you consent to this access. You can control what information is visible via the visibility settings on each profile item.</p>

        <h2>6. Privacy</h2>
        <p>Your privacy is important to us. Please read our <Link href="/privacy" className="text-[var(--color-sage)]">Privacy Policy</Link> for details on how we handle your data.</p>

        <h2>7. Service availability</h2>
        <p>We aim to keep Lyra available at all times but cannot guarantee uninterrupted access. We may need to take the service offline for maintenance or updates.</p>

        <h2>8. Account deletion</h2>
        <p>You can delete your account at any time from your account settings. Deletion is permanent — all your data will be removed within 30 days.</p>

        <h2>9. Limitation of liability</h2>
        <p>Lyra is provided &quot;as is&quot; without warranties of any kind. We are not liable for any damages arising from your use of the service.</p>

        <h2>10. Changes to these terms</h2>
        <p>We may update these terms from time to time. Continued use of the service after changes constitutes acceptance of the new terms.</p>

        <h2>11. Governing law</h2>
        <p>These terms are governed by the laws of England and Wales.</p>

        <h2>Contact</h2>
        <p>Questions about these terms: hello@checklyra.com</p>
      </article>
    </main>
  );
}
