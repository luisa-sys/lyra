/**
 * KAN-304 — constants, types, and pure helpers for the Contacts/People page.
 *
 * Sibling to the `'use server'` actions file (Gotcha #18 / BUGS-12): anything
 * with a runtime value (consts, classes, non-async functions) MUST live here,
 * because a `'use server'` file may export async functions only. `export type`
 * is fine in the action file, but these helpers + consts are imported from it.
 */

export type ContactMethodKind = 'email' | 'phone';

export interface ContactMethodView {
  id: string;
  kind: string;
  value: string;
  is_primary: boolean;
}

export interface ContactView {
  id: string;
  display_name: string;
  city: string | null;
  country: string | null;
  notes: string | null;
  linked_profile_id: string | null;
  linked_profile_name: string | null;
  methods: ContactMethodView[];
}

export interface AddContactInput {
  display_name: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  notes?: string;
}

export interface UpdateContactInput {
  contact_id: string;
  display_name?: string;
  /** undefined = leave as-is; '' / null = clear the primary email method. */
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
}

export interface DirectoryProfile {
  id: string;
  display_name: string;
  slug: string | null;
  city: string | null;
}

export const CONTACT_LIMITS = {
  displayName: 200,
  email: 320,
  phone: 40,
  city: 120,
  country: 120,
  notes: 2000,
} as const;

/** Directory search: 20 lookups per user per hour (mirrors discoverability search). */
export const DIRECTORY_SEARCH_RATE_LIMIT = { limit: 20, windowSeconds: 3600 } as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise an email: trim + lowercase. Returns null if blank. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/** Loose email validity check (the DB has no email format constraint). */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value) && value.length <= CONTACT_LIMITS.email;
}

/** Normalise a phone: collapse internal whitespace, trim. Returns null if blank. */
export function normalisePhone(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/\s+/g, ' ').trim();
  return v.length > 0 ? v : null;
}

/**
 * Strip characters that are significant inside a PostgREST filter value so a
 * directory `ilike` search can't be turned into an injection vector
 * (mirrors the SEC-09 / F-06 hardening for `.or()` queries). We deliberately
 * drop, rather than escape, these characters.
 */
export function sanitiseDirectoryQuery(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[%,()*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
