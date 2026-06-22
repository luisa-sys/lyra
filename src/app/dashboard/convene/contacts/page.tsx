import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isConveneEnabledForCurrentUser } from '@/lib/convene/flags-user';
import ContactsClient from './contacts-client';
import type { ContactView } from './contacts-helpers';

export const metadata = {
  title: 'People — Lyra',
  description: 'Your Convene address book — the people you organise gatherings with.',
};

function NotEnabled() {
  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <span className="text-sm text-[var(--color-muted)]">People</span>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-[var(--color-muted)]">Convene is not enabled.</p>
      </div>
    </main>
  );
}

interface ContactRow {
  id: string;
  display_name: string;
  city: string | null;
  country: string | null;
  notes: string | null;
  linked_profile_id: string | null;
  contact_methods: { id: string; kind: string; value: string; is_primary: boolean }[] | null;
}

export default async function ContactsPage() {
  if (!(await isConveneEnabledForCurrentUser())) return <NotEnabled />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/convene/contacts');

  const { data: rows } = await supabase
    .from('contacts')
    .select('id, display_name, city, country, notes, linked_profile_id, contact_methods(id, kind, value, is_primary)')
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .order('display_name', { ascending: true });

  const contactRows = (rows ?? []) as unknown as ContactRow[];

  // Resolve linked-profile display names in one follow-up query (avoids
  // depending on the FK-embed constraint name; RLS only returns published ones).
  const linkedIds = Array.from(
    new Set(contactRows.map((c) => c.linked_profile_id).filter((v): v is string => !!v))
  );
  const nameById = new Map<string, string>();
  if (linkedIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', linkedIds);
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
      if (p.display_name) nameById.set(p.id, p.display_name);
    }
  }

  const contacts: ContactView[] = contactRows.map((c) => ({
    id: c.id,
    display_name: c.display_name,
    city: c.city,
    country: c.country,
    notes: c.notes,
    linked_profile_id: c.linked_profile_id,
    linked_profile_name: c.linked_profile_id ? nameById.get(c.linked_profile_id) ?? null : null,
    methods: (c.contact_methods ?? []).map((m) => ({
      id: m.id,
      kind: m.kind,
      value: m.value,
      is_primary: m.is_primary,
    })),
  }));

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <span className="text-sm text-[var(--color-muted)]">People</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium text-[var(--color-ink)]">People</h1>
            <p className="text-sm text-[var(--color-muted)] mt-1">
              Your address book for Convene. Add the people you want to organise gatherings with, then
              link them to a Lyra profile to unlock shared availability (with their consent).
            </p>
          </div>
          <Link
            href="/dashboard/convene/gatherings"
            className="shrink-0 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)]"
          >
            Gatherings →
          </Link>
        </div>

        <ContactsClient contacts={contacts} />

        <div className="pt-2">
          <Link href="/dashboard" className="text-sm text-[var(--color-sage)] hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
