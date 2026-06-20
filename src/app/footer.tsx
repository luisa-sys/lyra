import Link from "next/link";

/**
 * KAN-272 — site-wide footer, rendered once in the root layout so it appears
 * on every page. The company line (CheckLyra Ltd registration) is a
 * Companies Act 2006 requirement and must be present on every page, which is
 * exactly why this lives in the root layout rather than per-page.
 *
 * Content + ordering mirror the June-2026 mock-up footer:
 *   About · Privacy · Cookies · Terms · Guidelines · Keeping people safe ·
 *   Accessibility · Help · Contact
 *
 * Styling: warm paper background, muted body text, sage links — using the
 * shared tokens (KAN-268/272) so it stays in step with the rest of the app.
 */

const LINKS: { href: string; label: string }[] = [
  // The nine mock-up footer links, in order.
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
  { href: "/guidelines", label: "Guidelines" },
  { href: "/safe", label: "Keeping people safe" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/help", label: "Help" },
  { href: "/contact", label: "Contact" },
  // KAN-184: the affiliate "Partners" link must stay reachable from the
  // footer — Sovrn's crawler follows it to verify Lyra owns checklyra.com.
  // Not in the mock-up's nine, appended here to preserve that verification.
  { href: "/partners", label: "Partners" },
];

export function Footer() {
  return (
    <footer
      role="contentinfo"
      className="bg-[var(--color-paper)] border-t border-[var(--color-border)] mt-8"
    >
      <div className="max-w-3xl mx-auto px-5 pt-7 pb-12 text-center">
        <nav
          aria-label="Footer"
          className="flex flex-wrap justify-center items-center mb-4"
        >
          {LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[13px] text-[var(--color-sage)] hover:underline px-3 leading-tight ${
                i < LINKS.length - 1
                  ? "border-r border-[var(--color-border)]"
                  : ""
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <p className="text-[12.5px] text-[var(--color-muted)] leading-relaxed max-w-[46em] mx-auto mb-2">
          Lyra gives every ordinary person a voice — a place to be understood,
          in your own words. Keep it about you.
        </p>

        <p className="text-[11.5px] text-[var(--color-muted)]/85 leading-relaxed max-w-[46em] mx-auto">
          © {new Date().getFullYear()} Lyra · a trading name of CheckLyra Ltd,
          registered in England &amp; Wales (company no. 16351012), 71–75
          Shelton Street, Covent Garden, London, WC2H 9JQ.
        </p>
      </div>
    </footer>
  );
}
