'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';

interface ConnectionRow {
  id: string;
  provider: string;
  display_name: string | null;
  scope_granted: string;
  status: string;
  last_used_at: string | null;
  created_at: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google Calendar + Contacts',
  microsoft: 'Microsoft (Outlook)',
  apple: 'Apple iCloud',
  caldav_generic: 'Generic CalDAV',
};

const SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/calendar.readonly': 'Read calendar',
  'https://www.googleapis.com/auth/calendar.events': 'Manage calendar events',
  'https://www.googleapis.com/auth/contacts.readonly': 'Read contacts',
  'https://www.googleapis.com/auth/userinfo.email': 'Email address',
  'https://www.googleapis.com/auth/userinfo.profile': 'Profile basics',
  openid: 'Account identifier',
};

function formatScopes(raw: string): string[] {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => SCOPE_LABELS[s] ?? s);
}

function formatTime(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ConnectionsClient({ connections }: { connections: ConnectionRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect(connectionId: string) {
    if (!confirm('Disconnect this account? Lyra will forget your tokens and any draft gatherings using this calendar will need a new connection.')) {
      return;
    }
    setBusy(connectionId);
    setError(null);
    try {
      const sb = createClient();
      const { error: updErr } = await sb
        .from('oauth_connections')
        .update({ deleted_at: new Date().toISOString(), status: 'revoked' })
        .eq('id', connectionId);
      if (updErr) throw new Error(updErr.message);
      startTransition(() => {
        window.location.reload();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
      setBusy(null);
    }
  }

  if (connections.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
        <h2 className="text-lg font-medium text-[var(--color-ink)] mb-1">No connections yet</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">Connect a calendar so Lyra can help you find time for gatherings.</p>
        <Link
          href="/api/convene/oauth/google/initiate"
          className="inline-block px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90"
        >
          Connect Google
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-sm text-rose-900">
          Disconnect failed: {error}
        </div>
      )}

      {connections.map((c) => (
        <div key={c.id} className="bg-white rounded-xl border border-[var(--color-border)] p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-medium text-[var(--color-ink)]">
                {PROVIDER_LABELS[c.provider] ?? c.provider}
              </h3>
              {c.display_name && (
                <p className="text-sm text-[var(--color-muted)] truncate">{c.display_name}</p>
              )}
              <div className="mt-3 space-y-1 text-xs text-[var(--color-muted)]">
                <div>
                  <span className="font-medium text-[var(--color-ink)]">Status:</span>{' '}
                  <span
                    className={
                      c.status === 'active'
                        ? 'text-emerald-700'
                        : c.status === 'error'
                          ? 'text-rose-700'
                          : 'text-[var(--color-muted)]'
                    }
                  >
                    {c.status}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-[var(--color-ink)]">Connected:</span>{' '}
                  {formatTime(c.created_at)}
                </div>
                <div>
                  <span className="font-medium text-[var(--color-ink)]">Last used:</span>{' '}
                  {formatTime(c.last_used_at)}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium text-[var(--color-ink)] mb-1">Permissions granted:</p>
                <ul className="text-xs text-[var(--color-muted)] list-disc pl-5">
                  {formatScopes(c.scope_granted).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDisconnect(c.id)}
              disabled={busy === c.id}
              className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-50"
            >
              {busy === c.id ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      ))}

      <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
        <h3 className="text-base font-medium text-[var(--color-ink)] mb-1">Connect another</h3>
        <p className="text-sm text-[var(--color-muted)] mb-4">More providers coming in Phase 7 (Microsoft, Apple, CalDAV).</p>
        <Link
          href="/api/convene/oauth/google/initiate"
          className="inline-block px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90"
        >
          Connect Google
        </Link>
      </div>
    </div>
  );
}
