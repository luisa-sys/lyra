/**
 * Input sanitisation utilities for server actions.
 * Strips HTML tags, limits length, and normalises whitespace.
 */

/** Strip all HTML tags from a string */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

/** Sanitise a text field: strip HTML, limit length, normalise whitespace */
export function sanitiseText(input: string, maxLength = 500): string {
  const stripped = stripHtml(input);
  const normalised = stripped.replace(/\s+/g, ' ').trim();
  return normalised.slice(0, maxLength);
}

/** Sanitise a URL: basic validation and length limit */
export function sanitiseUrl(input: string, maxLength = 2048): string {
  const trimmed = input.trim().slice(0, maxLength);
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Standard action result type — replaces throw new Error() */
export type ActionResult = { success: true } | { success: false; error: string };
