/**
 * KAN-486 — spec v0.8 §3: the one validator for member-supplied links.
 *
 * "All links must use http/https … open external links with
 * rel=\"noopener noreferrer\". Do not silently embed external content."
 * Founder decision: http and https are both allowed.
 *
 * Unlike `sanitiseUrl` (unchanged, still used elsewhere) this REJECTS with a
 * message instead of returning '' or cutting the input at 2,048 characters.
 *
 * Scheme-less input ("example.com") is rejected here, matching the DB check;
 * the step-4 editor may prefix https:// in the browser before submitting.
 */

import { URL_MAX } from './profile-rules';

export type MemberUrlResult = { ok: true; url: string } | { ok: false; error: string };

// Wording kept from the pre-v0.8 actions so members see the message they already know.
export const URL_SCHEME_ERROR = 'Invalid URL — must start with http:// or https://';
export const URL_TOO_LONG_ERROR = 'That link is too long (limit 2,048 characters).';
export const URL_CREDENTIALS_ERROR = "Links can't include a username or password.";
export const URL_INVALID_ERROR = "That link doesn't look right. Please check it and try again.";

// Any whitespace or control character: the WHATWG parser would silently strip
// tabs/newlines ("java\nscript:"), so refuse them before parsing.
const UNSAFE_CHARS_RE = /[\s\u0000-\u001F\u007F]/;

export function parseMemberUrl(raw: string | null | undefined): MemberUrlResult {
  const input = (typeof raw === 'string' ? raw : '').trim();
  if (input === '') return { ok: false, error: URL_INVALID_ERROR };
  if (UNSAFE_CHARS_RE.test(input)) return { ok: false, error: URL_INVALID_ERROR };
  if (input.length > URL_MAX) return { ok: false, error: URL_TOO_LONG_ERROR };
  if (!/^https?:\/\//i.test(input)) return { ok: false, error: URL_SCHEME_ERROR };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: URL_SCHEME_ERROR };
  if (url.username !== '' || url.password !== '') return { ok: false, error: URL_CREDENTIALS_ERROR };
  if (!url.hostname) return { ok: false, error: URL_INVALID_ERROR };

  const out = url.toString();
  if (out.length > URL_MAX) return { ok: false, error: URL_TOO_LONG_ERROR };
  return { ok: true, url: out };
}
