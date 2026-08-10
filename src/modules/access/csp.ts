/**
 * SEC-63 per-request CSP nonce, lifted out of src/middleware.ts — KAN-415 D4.
 *
 * Moved verbatim. The only change is that callers now reach it through a
 * memoised `ctx.csp()` rather than computing it eagerly at the top of the
 * request, because the SEC-36 404 returns before any document is served and
 * should not pay for a nonce it will not use. That laziness is asserted by a
 * getRandomValues spy in middleware-response-contract.test.ts.
 */

/** base64 of 16 random bytes. The edge runtime provides Web Crypto + btoa globally. */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Stamp the staged nonce CSP as Report-Only on a document response.
 *
 * Report-Only NEVER blocks — browsers only surface violations — so this is a
 * zero-risk observation step ahead of enforcing the nonce policy (the follow-up
 * SEC-63 leg, which also wires the nonce into first-party scripts, flips to the
 * enforced header, and adds a deploy-time header smoke).
 *
 * Applied only to DOCUMENT-serving responses; redirects and JSON errors do not
 * need a CSP. Which exits qualify is now pinned as a map in
 * middleware-response-contract.test.ts — before that, nothing in the repo read
 * this header off a middleware response at all.
 */
export function stampCspReportOnly<T extends { headers: Headers }>(res: T, csp: string): T {
  res.headers.set('Content-Security-Policy-Report-Only', csp);
  return res;
}
