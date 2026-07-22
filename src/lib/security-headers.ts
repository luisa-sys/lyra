// SEC-63 (KAN-350, findings web-headers-1/2): the nonce-based CSP that
// middleware stages as `Content-Security-Policy-Report-Only`.
//
// The *enforced* header stack (HSTS/CSP/X-Frame-Options/…) still lives inline
// in next.config.ts; tests/unit/security-headers.test.ts reads that file and
// pins every required header/value so a refactor can't silently drop one.
//
// This module holds only the report-only target policy so it can be unit-tested
// as a pure function and imported by the Edge middleware. Emitting it as
// Report-Only lets browsers surface violations without blocking anything;
// flipping it to the enforced `Content-Security-Policy` header (and wiring the
// nonce into first-party scripts) is the follow-up leg of SEC-63.

/**
 * Build the Report-Only nonce CSP for a given per-request nonce.
 *
 * Hardening vs. the currently enforced policy in next.config.ts — all aimed at
 * making CSP a real XSS backstop:
 *  - script-src drops 'unsafe-inline' + 'unsafe-eval' in favour of a
 *    `'nonce-…'` plus `'strict-dynamic'` (the host allow-list is kept as a
 *    CSP2 fallback; CSP3 browsers ignore it once a nonce is present).
 *  - adds `object-src 'none'` and `frame-src 'none'`.
 *
 * style-src intentionally keeps 'unsafe-inline' (styled-jsx / inline styles) —
 * out of scope for SEC-63, which targets script-src. connect-src mirrors the
 * enforced policy so legitimate Supabase/Vercel/Sentry calls don't report.
 */
export function buildCspReportOnly(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://*.sentry.io https://*.de.sentry.io https://*.ingest.sentry.io https://*.ingest.de.sentry.io",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
