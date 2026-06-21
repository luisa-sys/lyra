import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isConveneEnabled } from '@/lib/convene/flags';
import OrganiseWizard from './organise-wizard';

export const metadata = {
  title: 'Organise — Lyra',
  description: 'Organise a gathering with the people in your life.',
};

export interface WizardContact {
  id: string;
  display_name: string;
  city: string | null;
  has_linked_profile: boolean;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <span className="text-sm text-[var(--color-muted)]">Organise</span>
        </div>
      </header>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">{children}</div>
    </main>
  );
}

export default async function OrganisePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  if (!isConveneEnabled()) {
    return (
      <Shell>
        <p className="text-[var(--color-muted)]">Convene is not enabled.</p>
      </Shell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard/convene/organise');

  const { data: rows } = await supabase
    .from('contacts')
    .select('id, display_name, city, linked_profile_id')
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .order('display_name', { ascending: true });

  const contacts: WizardContact[] = (rows ?? []).map((c) => ({
    id: c.id as string,
    display_name: c.display_name as string,
    city: (c.city as string | null) ?? null,
    has_linked_profile: !!(c.linked_profile_id as string | null),
  }));

  const sp = await searchParams;
  const preselectId = sp.contact && contacts.some((c) => c.id === sp.contact) ? sp.contact : null;

  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-medium text-[var(--color-ink)]">Organise a gathering</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Choose who to invite, propose a few times, and we’ll create a draft you can finalise and send.
        </p>
      </div>

      {contacts.length === 0 ? (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 text-sm text-[var(--color-muted)]">
          You don’t have any contacts yet.{' '}
          <Link href="/dashboard/convene/contacts" className="text-[var(--color-sage)] hover:underline">
            Add someone first →
          </Link>
        </div>
      ) : (
        <OrganiseWizard contacts={contacts} preselectId={preselectId} />
      )}

      <div className="pt-2">
        <Link href="/dashboard/convene/contacts" className="text-sm text-[var(--color-sage)] hover:underline">
          ← Back to people
        </Link>
      </div>
    </Shell>
  );
}
