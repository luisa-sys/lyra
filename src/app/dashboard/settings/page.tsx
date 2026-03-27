import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { SettingsClient } from './settings-client';

export const metadata = {
  title: 'Account Settings — Lyra',
  description: 'Manage your Lyra account, export data, or delete your account.',
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink)]">Lyra</Link>
          <span className="text-sm text-[var(--color-muted)]">Account Settings</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-medium text-[var(--color-ink)]">Account Settings</h1>
          <p className="text-[var(--color-muted)] mt-1">Manage your data and privacy.</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="text-lg font-medium text-[var(--color-ink)] mb-1">Account information</h2>
          <p className="text-sm text-[var(--color-muted)] mb-4">Your basic account details.</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Email</span>
              <span className="text-[var(--color-ink)]">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Account created</span>
              <span className="text-[var(--color-ink)]">{new Date(user.created_at).toLocaleDateString('en-GB')}</span>
            </div>
          </div>
        </div>

        <SettingsClient />

        <div className="text-sm text-[var(--color-muted)] space-y-1">
          <p>Read our <Link href="/privacy" className="text-[var(--color-sage)] hover:underline">Privacy Policy</Link> and <Link href="/terms" className="text-[var(--color-sage)] hover:underline">Terms of Service</Link>.</p>
          <p>Questions? Email privacy@checklyra.com</p>
        </div>
      </div>
    </main>
  );
}
