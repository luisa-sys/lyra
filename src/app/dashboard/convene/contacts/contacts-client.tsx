'use client';

/**
 * KAN-304 — Contacts/People client island.
 *
 * List + add + edit + delete contacts, and link a contact to a published Lyra
 * profile via a directory search. Mutations call the server actions in
 * ./actions and then router.refresh() (the established convene convention,
 * see gatherings/[id]/gathering-actions.tsx).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  addContact,
  updateContact,
  deleteContact,
  linkContactToProfile,
  searchDirectoryProfiles,
} from './actions';
import type { ContactView, DirectoryProfile } from './contacts-helpers';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-sage)]';
const primaryBtn =
  'px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50';
const secondaryBtn =
  'px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-50';
const destructiveBtn =
  'px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm hover:bg-rose-50 disabled:opacity-50';

function methodValue(c: ContactView, kind: 'email' | 'phone'): string {
  return c.methods.find((m) => m.kind === kind)?.value ?? '';
}

export default function ContactsClient({ contacts }: { contacts: ContactView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" className={primaryBtn} disabled={pending} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : '+ Add contact'}
        </button>
      </div>

      {adding && (
        <ContactForm
          pending={pending}
          submitLabel="Add contact"
          onCancel={() => setAdding(false)}
          onSubmit={(values) =>
            run(() => addContact(values), () => setAdding(false))
          }
        />
      )}

      {contacts.length === 0 && !adding && (
        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted)]">
          No contacts yet. Add the first person you’d like to organise something with.
        </div>
      )}

      <ul className="space-y-3">
        {contacts.map((c) => (
          <li key={c.id} className="bg-white rounded-xl border border-[var(--color-border)] p-5">
            {editingId === c.id ? (
              <ContactForm
                pending={pending}
                submitLabel="Save"
                initial={{
                  display_name: c.display_name,
                  email: methodValue(c, 'email'),
                  phone: methodValue(c, 'phone'),
                  city: c.city ?? '',
                  country: c.country ?? '',
                  notes: c.notes ?? '',
                }}
                onCancel={() => setEditingId(null)}
                onSubmit={(values) =>
                  run(
                    () =>
                      updateContact({
                        contact_id: c.id,
                        display_name: values.display_name,
                        email: values.email ?? '',
                        phone: values.phone ?? '',
                        city: values.city ?? '',
                        country: values.country ?? '',
                        notes: values.notes ?? '',
                      }),
                    () => setEditingId(null)
                  )
                }
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--color-ink)]">{c.display_name}</span>
                    {c.linked_profile_id && (
                      <span className="inline-block px-2 py-0.5 rounded-md border border-[var(--color-border)] text-xs text-[var(--color-muted)]">
                        🔗 {c.linked_profile_name ?? 'Linked profile'}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-muted)] space-y-0.5">
                    {methodValue(c, 'email') && <div>{methodValue(c, 'email')}</div>}
                    {methodValue(c, 'phone') && <div>{methodValue(c, 'phone')}</div>}
                    {(c.city || c.country) && (
                      <div>{[c.city, c.country].filter(Boolean).join(', ')}</div>
                    )}
                    {c.notes && <div className="italic">{c.notes}</div>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Link
                    href={`/dashboard/convene/organise?contact=${c.id}`}
                    className={primaryBtn + ' text-center'}
                  >
                    Organise →
                  </Link>
                  <div className="flex gap-2">
                    <button type="button" className={secondaryBtn} disabled={pending} onClick={() => setEditingId(c.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={secondaryBtn}
                      disabled={pending}
                      onClick={() => setLinkingId(linkingId === c.id ? null : c.id)}
                    >
                      {c.linked_profile_id ? 'Link…' : 'Link profile'}
                    </button>
                    <button
                      type="button"
                      className={destructiveBtn}
                      disabled={pending}
                      onClick={() => {
                        if (confirm(`Delete ${c.display_name}? This cannot be undone.`)) {
                          run(() => deleteContact(c.id));
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {linkingId === c.id && editingId !== c.id && (
              <LinkProfilePanel
                contact={c}
                pending={pending}
                onLink={(profileId) =>
                  run(() => linkContactToProfile(c.id, profileId), () => setLinkingId(null))
                }
                onUnlink={() => run(() => linkContactToProfile(c.id, null), () => setLinkingId(null))}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FormValues {
  display_name: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  notes?: string;
}

function ContactForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: FormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(
    initial ?? { display_name: '', email: '', phone: '', city: '', country: '', notes: '' }
  );
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      className="bg-white rounded-xl border border-[var(--color-border)] p-5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <div>
        <label className="block text-sm text-[var(--color-muted)] mb-1">Name *</label>
        <input className={inputCls} value={values.display_name} onChange={set('display_name')} required maxLength={200} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-[var(--color-muted)] mb-1">Email</label>
          <input className={inputCls} type="email" value={values.email} onChange={set('email')} maxLength={320} />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-muted)] mb-1">Phone</label>
          <input className={inputCls} value={values.phone} onChange={set('phone')} maxLength={40} />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-muted)] mb-1">City</label>
          <input className={inputCls} value={values.city} onChange={set('city')} maxLength={120} />
        </div>
        <div>
          <label className="block text-sm text-[var(--color-muted)] mb-1">Country</label>
          <input className={inputCls} value={values.country} onChange={set('country')} maxLength={120} />
        </div>
      </div>
      <div>
        <label className="block text-sm text-[var(--color-muted)] mb-1">Notes</label>
        <textarea className={inputCls} rows={2} value={values.notes} onChange={set('notes')} maxLength={2000} />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" className={secondaryBtn} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryBtn} disabled={pending || !values.display_name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function LinkProfilePanel({
  contact,
  pending,
  onLink,
  onUnlink,
}: {
  contact: ContactView;
  pending: boolean;
  onLink: (profileId: string) => void;
  onUnlink: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function doSearch() {
    setSearching(true);
    setSearchError(null);
    const res = await searchDirectoryProfiles(query);
    setSearching(false);
    if (res.ok) setResults(res.matches);
    else setSearchError(res.error);
  }

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-4 space-y-3">
      {contact.linked_profile_id && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-muted)]">
            Linked to {contact.linked_profile_name ?? 'a profile'}.
          </span>
          <button type="button" className={destructiveBtn} disabled={pending} onClick={onUnlink}>
            Unlink
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="Search Lyra profiles by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSearch();
            }
          }}
        />
        <button type="button" className={secondaryBtn} disabled={searching || query.trim().length < 2} onClick={doSearch}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {searchError && <p className="text-sm text-rose-700">{searchError}</p>}
      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-ink)]">
                {p.display_name}
                {p.city ? <span className="text-[var(--color-muted)]"> · {p.city}</span> : null}
              </span>
              <button type="button" className={secondaryBtn} disabled={pending} onClick={() => onLink(p.id)}>
                Link
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
