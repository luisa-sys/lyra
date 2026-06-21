'use server';

/**
 * KAN-304 — Contacts/People server actions.
 *
 * All writes go through the RLS client (`createClient` from supabase-server):
 * `contacts`, `contact_methods` and `tribes` are owner-scoped by RLS
 * (`owner_user_id = auth.uid()` / parent-derived), so we stamp
 * `owner_user_id = user.id` and let Postgres enforce ownership — no
 * service-role escalation is needed here (unlike the gathering actions, which
 * escalate only to write the append-only audit log).
 *
 * MCP parity (KAN-222): mirrors `lyra_add_contact` / `lyra_link_contact_profile`
 * in lyra-mcp-server (KAN-307).
 */

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { rateLimit } from '@/lib/rate-limit';
import {
  type AddContactInput,
  type UpdateContactInput,
  type DirectoryProfile,
  CONTACT_LIMITS,
  DIRECTORY_SEARCH_RATE_LIMIT,
  normaliseEmail,
  normalisePhone,
  isValidEmail,
  sanitiseDirectoryQuery,
} from './contacts-helpers';

type Result = { ok: true } | { ok: false; error: string };
type AddResult = { ok: true; contactId: string } | { ok: false; error: string };
type SearchResult = { ok: true; matches: DirectoryProfile[] } | { ok: false; error: string };

const CONTACTS_PATH = '/dashboard/convene/contacts';

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function addContact(input: AddContactInput): Promise<AddResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const name = (input.display_name ?? '').trim();
  if (!name) return { ok: false, error: 'A name is required' };
  if (name.length > CONTACT_LIMITS.displayName) return { ok: false, error: 'That name is too long' };

  const email = normaliseEmail(input.email);
  if (email && !isValidEmail(email)) return { ok: false, error: 'That email address looks invalid' };
  const phone = normalisePhone(input.phone);

  const { data: contact, error } = await supabase
    .from('contacts')
    .insert({
      owner_user_id: user.id,
      display_name: name,
      city: (input.city ?? '').trim() || null,
      country: (input.country ?? '').trim() || null,
      notes: (input.notes ?? '').trim() || null,
    })
    .select('id')
    .single();
  if (error || !contact) return { ok: false, error: 'Could not add contact' };

  const methods: Array<{ contact_id: string; kind: string; value: string; is_primary: boolean }> = [];
  if (email) methods.push({ contact_id: contact.id, kind: 'email', value: email, is_primary: true });
  if (phone) methods.push({ contact_id: contact.id, kind: 'phone', value: phone, is_primary: true });
  if (methods.length > 0) {
    const { error: mErr } = await supabase.from('contact_methods').insert(methods);
    if (mErr) return { ok: false, error: 'Contact added, but saving the email/phone failed' };
  }

  revalidatePath(CONTACTS_PATH);
  return { ok: true, contactId: contact.id };
}

export async function updateContact(input: UpdateContactInput): Promise<Result> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!input.contact_id) return { ok: false, error: 'Missing contact' };

  // RLS scopes this to the owner; the read also gives a clean "not found".
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', input.contact_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Contact not found' };

  const update: Record<string, unknown> = {};
  if (input.display_name !== undefined) {
    const name = input.display_name.trim();
    if (!name) return { ok: false, error: 'A name is required' };
    if (name.length > CONTACT_LIMITS.displayName) return { ok: false, error: 'That name is too long' };
    update.display_name = name;
  }
  if (input.city !== undefined) update.city = (input.city ?? '').trim() || null;
  if (input.country !== undefined) update.country = (input.country ?? '').trim() || null;
  if (input.notes !== undefined) update.notes = (input.notes ?? '').trim() || null;

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('contacts').update(update).eq('id', input.contact_id);
    if (error) return { ok: false, error: 'Could not update contact' };
  }

  // Reconcile primary email/phone. undefined = leave as-is; '' / null = clear.
  for (const kind of ['email', 'phone'] as const) {
    const raw = kind === 'email' ? input.email : input.phone;
    if (raw === undefined) continue;
    const value = kind === 'email' ? normaliseEmail(raw) : normalisePhone(raw);
    if (kind === 'email' && value && !isValidEmail(value)) {
      return { ok: false, error: 'That email address looks invalid' };
    }
    // Replace any existing method of this kind with the new value (or clear it).
    await supabase.from('contact_methods').delete().eq('contact_id', input.contact_id).eq('kind', kind);
    if (value) {
      const { error } = await supabase
        .from('contact_methods')
        .insert({ contact_id: input.contact_id, kind, value, is_primary: true });
      if (error) return { ok: false, error: `Could not update ${kind}` };
    }
  }

  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

export async function deleteContact(contactId: string): Promise<Result> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!contactId) return { ok: false, error: 'Missing contact' };

  // Soft delete (matches the contacts.deleted_at convention).
  const { error } = await supabase
    .from('contacts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', contactId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: 'Could not delete contact' };

  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

export async function linkContactToProfile(contactId: string, profileId: string | null): Promise<Result> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!contactId) return { ok: false, error: 'Missing contact' };

  if (profileId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, is_published')
      .eq('id', profileId)
      .maybeSingle();
    if (!profile) return { ok: false, error: 'That profile could not be found' };
    if (profile.is_published === false) return { ok: false, error: 'That profile is not published' };
  }

  const { error } = await supabase
    .from('contacts')
    .update({ linked_profile_id: profileId })
    .eq('id', contactId)
    .is('deleted_at', null);
  if (error) return { ok: false, error: 'Could not update the profile link' };

  revalidatePath(CONTACTS_PATH);
  return { ok: true };
}

/**
 * Directory search to find a published Lyra profile to link a contact to.
 * Only published profiles are visible (RLS); the result carries no PII beyond
 * what a public profile already shows.
 */
export async function searchDirectoryProfiles(query: string): Promise<SearchResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const safe = sanitiseDirectoryQuery(query);
  if (safe.length < 2) return { ok: true, matches: [] };

  const limit = rateLimit(`contact-directory-search:${user.id}`, DIRECTORY_SEARCH_RATE_LIMIT);
  if (limit.limited) {
    return { ok: false, error: `Too many searches. Please try again in ${limit.retryAfter}s.` };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, slug, city')
    .eq('is_published', true)
    .ilike('display_name', `%${safe}%`)
    .limit(10);
  if (error) return { ok: false, error: 'Search failed. Please try again.' };

  return { ok: true, matches: (data ?? []) as DirectoryProfile[] };
}
