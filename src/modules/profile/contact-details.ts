/**
 * KAN-486 — spec v0.8 §05 / §3: keep contact details out of public profile text.
 *
 * "Do not allow public email addresses, telephone numbers or postal
 * addresses; apply validation server-side and show an explanatory correction
 * message." Founder decision (2026-11-22): an automatic filter plus the report
 * route — the spec itself says filtering alone cannot be perfect.
 *
 * Pure and dependency-free so the browser editor can run the same check.
 *
 * Scope: this is a profile-text rule and is deliberately separate from
 * src/modules/contracts/content-moderation.ts (`containsPII`), which must stay
 * byte-identical to the lyra-mcp-server copy (CTL-043). Both run on the write
 * path; this one runs first and gives the specific correction message.
 *
 * KNOWN GAPS (best effort, documented — the report route is the backstop):
 *   - numbers written as words ("oh seven seven…")
 *   - social handles / "WhatsApp me" with no number
 *   - addresses with no house number, or abbreviated street words (st, rd)
 *   - non-UK postcodes (US ZIP codes are not flagged)
 *   - anything inside an image
 */

export type ContactKind = 'email' | 'phone' | 'postcode' | 'address';

export interface ContactScanOptions {
  /**
   * Skip the postcode and street-address rules. Used where a place is the
   * point of the field (city, affiliation location, favourite places/venues):
   * a public business address there is not a member's contact detail.
   * Email and phone are still caught.
   */
  allowPlaces?: boolean;
}

const EMAIL_PROVIDERS =
  '(?:gmail|googlemail|hotmail|outlook|live|yahoo|icloud|aol|protonmail|proton|btinternet|sky|virginmedia|talktalk|me)';

const EMAIL_RULES: readonly RegExp[] = [
  // E1 literal
  /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/,
  // E2 spaced: "name @ gmail . com"
  /[a-z0-9._%+-]+\s*@\s*[a-z0-9-]+\s*\.\s*[a-z]{2,}/,
  // E3 bracketed: "name[at]gmail[dot]com", "name (at) gmail (dot) com"
  /\w{2,}\s*[[({]\s*at\s*[\])}]\s*[\w-]{2,}\s*(?:[[({]\s*dot\s*[\])}]|\.|\s+dot\s+)\s*[a-z]{2,}/,
  // E4 plain words, gated on a known provider so "look at the dot com boom" passes
  new RegExp(`\\b[\\w.+-]{2,}\\s+at\\s+${EMAIL_PROVIDERS}\\s*(?:dot|\\.)\\s*[a-z]{2,}`),
  // E5 provider with no TLD: "name@gmail"
  new RegExp(`[\\w.+-]+\\s*@\\s*${EMAIL_PROVIDERS}\\b`),
];

// UK postcode (lower-cased input). GIR 0AA is the one irregular code.
const POSTCODE_RE = /\b(?:gir ?0aa|[a-pr-uwyz][a-hk-y]?\d[a-z\d]? ?\d[abd-hjlnp-uw-z]{2})\b/;

const STREET_WORDS =
  'street|road|lane|avenue|drive|close|crescent|court|place|gardens|terrace|way|grove|mews|square|row|walk|parade|hill';

const ADDRESS_RULES: readonly RegExp[] = [
  // a house number, then up to three words, then a street word
  new RegExp(`\\b\\d{1,4}[a-z]?,?\\s+(?:[a-z'’-]+\\s+){0,3}(?:${STREET_WORDS})\\b`),
  /\b(?:flat|apartment|apt|unit)\s+\d+[a-z]?\b/,
  /\bp\.?\s?o\.?\s+box\s+\d+/,
];

const PHONE_SPAN_RE = /[+(]?\d[\d\s().\-–]{7,}\d/g;
const YEAR_GROUP_RE = /^(?:19|20)\d{2}$/;

function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** Join runs of single characters separated by single spaces: "n a m e" → "name". */
function collapseSpacedLetters(text: string): string {
  return text.replace(/(?<!\S)(?:\S )+\S(?!\S)/g, (run) => run.replace(/ /g, ''));
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, ' ');
}

function looksLikePhone(span: string, preceding: string): boolean {
  const digits = span.replace(/\D/g, '');
  const n = digits.length;
  if (/isbn[\s:-]*$/.test(preceding)) return false;
  const groups = span.split(/[^\d]+/).filter(Boolean);
  if (groups.length > 1 && groups.every((g) => YEAR_GROUP_RE.test(g))) return false;
  // International form (+…): 8–15 digits (E.164 max 15). Otherwise 10–15,
  // which covers UK 0-prefixed numbers (10–11 digits) and NANP (10).
  if (span.startsWith('+')) return n >= 8 && n <= 15;
  return n >= 10 && n <= 15;
}

function hasPhone(text: string): boolean {
  for (const m of text.matchAll(PHONE_SPAN_RE)) {
    const start = m.index ?? 0;
    const preceding = text.slice(Math.max(0, start - 8), start);
    if (looksLikePhone(m[0].trim(), preceding)) return true;
  }
  return false;
}

/**
 * The kinds of contact detail found in `text` (empty when none). Never
 * returns the matched text — callers must not echo it back.
 */
export function findContactDetails(text: string, opts: ContactScanOptions = {}): ContactKind[] {
  if (!text) return [];
  const base = normalise(text);
  const collapsed = collapseSpacedLetters(base);
  const variants = base === collapsed ? [base] : [base, collapsed];
  const found = new Set<ContactKind>();

  for (const v of variants) {
    if (EMAIL_RULES.some((re) => re.test(v))) found.add('email');
    if (hasPhone(stripUrls(v))) found.add('phone');
    if (!opts.allowPlaces) {
      if (POSTCODE_RE.test(v)) found.add('postcode');
      if (ADDRESS_RULES.some((re) => re.test(v))) found.add('address');
    }
  }
  return [...found];
}
