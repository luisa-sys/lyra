/**
 * KAN-486 — spec v0.8 §3: one validator for every member-written profile text field.
 *
 * Replaces `sanitiseText` on the profile write paths, which collapsed every
 * newline and silently CUT over-limit text. v0.8 needs the opposite on both
 * counts:
 *   - "All character limits include spaces and are enforced consistently in
 *     browser and server" → over-limit text is REJECTED with a message, never
 *     truncated.
 *   - Multiline fields (short intro, billboard, section 05, Q&A answers, gift
 *     preference) "preserve intentional line breaks".
 *   - Section 05 and other public text must not carry contact details
 *     (see ./contact-details.ts).
 *
 * Characters are counted as Unicode code points, matching Postgres length()
 * in the step-2 CHECK constraints, so an emoji counts once on both sides.
 *
 * `sanitiseText` itself is unchanged: other modules still use it.
 */

import { stripHtml } from '@/modules/guards/sanitise';
import { findContactDetails } from './contact-details';

export type FreeTextResult = { ok: true; value: string | null } | { ok: false; error: string };

export interface FreeTextSpec {
  /** Field name as the member sees it, used in the error message. */
  label: string;
  max: number;
  /** Keep line breaks (collapsed to at most one blank line). */
  multiline?: boolean;
  /**
   * Contact-detail filter: 'full' (default) blocks email, phone, postcode and
   * street address; 'places' blocks only email and phone; 'off' skips it.
   */
  contact?: 'full' | 'places' | 'off';
  required?: boolean;
}

/** Length in code points (what Postgres length() counts). */
export function countChars(s: string): number {
  return [...s].length;
}

export function tooLongError(label: string, n: number, max: number): string {
  return `${label} is too long: ${n} characters (limit ${max}, including spaces).`;
}

export function contactDetailsError(label: string): string {
  return `${label}: please remove personal information such as contact details (email, phone number or postal address). Your profile is public.`;
}

export function requiredError(label: string): string {
  return `${label} is required.`;
}

// Control characters other than \n (and \t, collapsed below).
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function normaliseWhitespace(input: string, multiline: boolean): string {
  const unified = input.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  if (!multiline) return unified.replace(/\s+/g, ' ').trim();
  return unified
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function validateFreeText(raw: string | null | undefined, spec: FreeTextSpec): FreeTextResult {
  const input = typeof raw === 'string' ? raw : '';
  const value = normaliseWhitespace(stripHtml(input), spec.multiline === true);

  if (value === '') {
    return spec.required ? { ok: false, error: requiredError(spec.label) } : { ok: true, value: null };
  }

  const n = countChars(value);
  if (n > spec.max) return { ok: false, error: tooLongError(spec.label, n, spec.max) };

  const mode = spec.contact ?? 'full';
  if (mode !== 'off' && findContactDetails(value, { allowPlaces: mode === 'places' }).length > 0) {
    return { ok: false, error: contactDetailsError(spec.label) };
  }

  return { ok: true, value };
}
