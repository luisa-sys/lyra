/**
 * KAN-493 — permanent (308) redirects for the legal pages that were folded
 * into About, Privacy and Contact (founder decision 2026-11-25).
 *
 * Every destination is a fixed internal path, so these can never act as an
 * open redirect. Read by `next.config.ts` (`redirects()`, `permanent: true`
 * → 308) and pinned by tests/unit/kan493-simplified-footer.test.ts.
 *
 * The words stay in RESERVED_LYRA_IDS, so no member can claim them as a
 * CheckLyra ID.
 */
export const LEGAL_PAGE_REDIRECTS: ReadonlyArray<{
  source: string;
  destination: string;
}> = [
  { source: "/cookies", destination: "/privacy#cookies" },
  { source: "/guidelines", destination: "/about#guidelines" },
  { source: "/safe", destination: "/about#safety" },
  { source: "/help", destination: "/about#help" },
  { source: "/complaints", destination: "/contact#complaints" },
  { source: "/partners", destination: "/privacy" },
  { source: "/accessibility", destination: "/about" },
];
