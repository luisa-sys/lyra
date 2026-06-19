/**
 * /dashboard/convene/connections — KAN-206 P2.
 *
 * Lists the user's calendar/contacts OAuth connections, shows scopes + last
 * used, and offers Disconnect. Connect button kicks off the OAuth initiate
 * flow. Gated behind isConveneEnabled().
 */

import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isConveneEnabled } from '@/lib/convene/flags';
import { ConnectionsClient } from './connections-client';

export const metadata = {
  title: 'Calendar Connections — Lyra Convene',
  description: 'Manage your connected calendars and contacts providers.',
};

interface ConnectionRow {
  id: string;
  provider: string;
  display_name: string | null;
  scope_granted: string;
  status: string;
  last_used_at: string | null;
  created_at: string;
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!isConveneEnabled()) {
    return (
      <main className="min-h-screen bg-[var(--color-paper)] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-medium text-[var(--color-ink)]">Convene is not enabled</h1>
          <p className="text-[var(--color-muted)] mt-2">Check back soon.</p>
        </div>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/convene/connections');

  const { data: connections } = await supabase
    .from('oauth_connections')
    .select('id, provider, display_name, scope_granted, status, last_used_at, created_at')
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const sp = await searchParams;
  const flash = sp.convene_oauth;
  const provider = sp.provider;

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <span className="text-sm text-[var(--color-muted)]">Calendar Connections</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-medium text-[var(--color-ink)]">Calendar Connections</h1>
          <p className="text-[var(--color-muted)] mt-1">
            Connect your calendar so Lyra Convene can suggest times that work for everyone. Your
            tokens are encrypted; event titles are never stored.
          </p>
        </div>

        {flash === 'connected' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-900">
            ✓ Connected to {provider ?? 'provider'} successfully.
          </div>
        )}
        {flash === 'error' && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-900">
            Something went wrong. {sp.reason && <span className="block mt-1 font-mono text-xs">Reason: {sp.reason}</span>}
          </div>
        )}

        <ConnectionsClient connections={(connections ?? []) as ConnectionRow[]} />

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <h2 className="text-lg font-medium text-[var(--color-ink)] mb-2">What Lyra does with this</h2>
          <ul className="text-sm text-[var(--color-muted)] space-y-1 list-disc pl-5">
            <li>Reads free/busy windows from your calendar to suggest times that work.</li>
            <li>Writes events to your calendar when you finalise a gathering.</li>
            <li>Reads your contacts so you can invite people without retyping.</li>
            <li>Event titles, descriptions, and contacts are <strong>never</strong> stored on Lyra&apos;s servers — only free/busy windows and IDs.</li>
            <li>Refresh tokens are encrypted in Supabase Vault.</li>
            <li>You can disconnect at any time; we&apos;ll forget your tokens immediately.</li>
          </ul>
        </div>

        <div className="text-sm text-[var(--color-muted)]">
          <Link href="/dashboard" className="text-[var(--color-sage)] hover:underline">← Back to dashboard</Link>
        </div>
      </div>
    </main>
  );
}
