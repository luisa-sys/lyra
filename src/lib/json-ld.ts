/**
 * Safe serialisation for JSON-LD embedded in a <script type="application/ld+json">
 * block via dangerouslySetInnerHTML.
 *
 * SEC-08 (TDD 2026-06-21): JSON.stringify does NOT escape `<`, so a user-controlled
 * field containing `</script><script>...` would break out of the JSON-LD block and
 * execute. Lyra already strips HTML from profile fields on write (sanitiseText), so
 * this is defence-in-depth -- but output encoding is the correct place to guarantee
 * the <script> context can never be escaped, regardless of upstream sanitisation or
 * of fields written via other surfaces (MCP, admin).
 *
 * Escapes characters that can terminate or confuse the script context:
 *   <  >  &  U+2028 (line separator)  U+2029 (paragraph separator)
 * The output is still valid JSON (these are valid JSON string escapes).
 */
export function jsonLdSafe(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
