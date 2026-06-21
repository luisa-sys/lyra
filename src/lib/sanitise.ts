/**
 * Input sanitisation utilities for server actions.
 * Strips HTML tags, limits length, and normalises whitespace.
 */

/** Strip all HTML tags from a string.
 *
 * KAN-171 / CodeQL alerts #1 + #3 (js/incomplete-multi-character-sanitization,
 * security_severity: high, CWE-020 / CWE-080 / CWE-116):
 *
 * The previous single-pass `input.replace(/<[^>]*>/g, '')` was vulnerable
 * to nested-tag bypass attacks. Example: `<scr<script>ipt>` — when the
 * inner `<script>` is stripped, what's left is `<script>` again.
 *
 * The loop applies the regex repeatedly until the string stabilises,
 * which guarantees no `<…>` substrings can survive even with arbitrary
 * nesting / interleaving. Convergence is fast in practice because each
 * iteration strictly shrinks the string (or terminates), and input is
 * bounded by `maxLength` (default 500 in sanitiseText).
 *
 * The defense-in-depth case applies even though Lyra's downstream
 * consumers (React JSX) auto-escape strings — the function should do
 * what its name and docstring promise, not just "mostly do it".
 */
export function stripHtml(input: string): string {
  let prev: string;
  let current = input;
  do {
    prev = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== prev);
  return current.trim();
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

/**
 * Sanitise a free-text search term before interpolating it into a PostgREST
 * `.or()` / `.ilike()` filter string.
 *
 * SEC-09 (TDD 2026-06-21): user input is interpolated raw into
 * `.or('display_name.ilike.${pattern},…')`. PostgREST parses `.or()` as a filter
 * DSL, so `,` `(` `)` could alter the filter tree, and `%` `_` are ilike wildcards
 * that could turn the query into a match-all. Strip those metacharacters (and the
 * backslash) before the term reaches the query builder. Returns '' when nothing
 * usable remains so the caller can skip the query rather than match everything.
 */
export function sanitiseSearchTerm(input: string, maxLength = 100): string {
  return input
    .replace(/[,()*%_\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Standard action result type — replaces throw new Error() */
export type ActionResult = { success: true } | { success: false; error: string };
