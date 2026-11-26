import Link from "next/link";

/**
 * KAN-272 — site-wide footer, rendered once in the root layout so it appears
 * on every page. The company line (CheckLyra Ltd registration) is a
 * Companies Act 2006 requirement and must be present on every page, which is
 * exactly why this lives in the root layout rather than per-page.
 *
 * KAN-493 (founder decision 2026-11-25): four links only. The other legal
 * pages were folded into About, Privacy and Contact, or removed; their old
 * URLs 308-redirect to the new sections (LEGAL_PAGE_REDIRECTS in
 * src/modules/marketing-legal/legal-redirects.ts).
 *
 * Styling: warm paper background, muted body text, sage links — using the
 * shared tokens (KAN-268/272) so it stays in step with the rest of the app.
 */

export const FOOTER_LINKS: { href: string; label: string }[] = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

const LINKS = FOOTER_LINKS;

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
          in your own words.
        </p>

        <p className="text-[11.5px] text-[var(--color-muted)] leading-relaxed max-w-[46em] mx-auto">
          © {new Date().getFullYear()} Lyra · a trading name of CheckLyra Ltd,
          registered in England &amp; Wales (company no. 16351012), 71–75
          Shelton Street, Covent Garden, London, WC2H 9JQ.
        </p>
      </div>
    </footer>
  );
}
