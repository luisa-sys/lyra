/**
 * Helpers for resolving a public profile's dynamic `[slug]` route param.
 *
 * Kept in a sibling module (not `page.tsx`) so the logic can be unit-tested in
 * isolation without importing the full server component and its dependencies.
 */

/**
 * Normalise a `[slug]` route param for lookup against the stored slug.
 *
 * The param can arrive PERCENT-ENCODED for any non-ASCII slug (e.g.
 * "rosa-martínez" → "rosa-mart%C3%ADnez"). The profile lookup compares text
 * byte-for-byte (`.eq('slug', …)`), so an undecoded value never matches the
 * stored "í" and the profile 404s. We URL-decode, then NFC-normalise (slugs are
 * stored in Unicode NFC) so a decomposed (NFD) request still matches. Pure-ASCII
 * slugs are unaffected — both steps are no-ops. Malformed `%` sequences (which
 * throw in decode) fall back to the raw value, which simply won't match → 404.
 */
export function decodeSlug(rawSlug: string): string {
  let decoded = rawSlug;
  try {
    decoded = decodeURIComponent(rawSlug);
  } catch {
    // Malformed percent-encoding — keep the raw value (will 404).
  }
  return decoded.normalize('NFC');
}
