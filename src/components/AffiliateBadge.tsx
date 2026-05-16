/**
 * KAN-192: per-card "Affiliate" disclosure badge.
 *
 * FTC 2026 enforcement guidance requires disclosure of affiliate
 * relationships to be unavoidable and adjacent to the recommendation. This
 * is the smallest UI surface that meets that bar: a pill labelled
 * "Affiliate" with a tooltip explaining what it means, plus a link to the
 * full disclosure on /partners.
 *
 * Used by:
 *   - V2 recommendation cards on the public profile (this PR)
 *   - Future email gift-suggestion templates (KAN-192 follow-up)
 *   - MCP-driven AI assistant responses surface the same disclosure as a
 *     string in the response payload, not via this React component
 *     (KAN-201 in lyra-mcp-server)
 *
 * Accessibility:
 *   - The badge has an aria-label that screen readers announce as a full
 *     sentence rather than just "Affiliate".
 *   - The tooltip text is also in the DOM as a hidden span so non-hover
 *     readers (screen readers, keyboard nav users) get the same content.
 */

import Link from 'next/link';

export type AffiliateBadgeProps = {
  /**
   * When false, render a "not monetised" muted variant. Lyra logs the click
   * either way (KAN-189 schema) but the user-facing disclosure should be
   * honest: if no commission is earned on the click, the pill says so.
   */
  monetised?: boolean;
  /** Visual size. The default 'sm' fits the V2 recommendation card. */
  size?: 'sm' | 'md';
  /** Optional className for extra layout. */
  className?: string;
};

export default function AffiliateBadge({
  monetised = true,
  size = 'sm',
  className = '',
}: AffiliateBadgeProps) {
  const label = monetised ? 'Affiliate' : 'Tracked';
  const sentence = monetised
    ? 'Affiliate link — Lyra may earn a commission if you buy via this link, at no extra cost to you.'
    : 'Link tracked for analytics — no commission earned.';

  const sizeClasses =
    size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5'
      : 'text-xs px-2 py-0.5';

  const colourClasses = monetised
    ? 'bg-[var(--color-lyra-sage-50,#eef2ec)] text-[var(--color-lyra-sage,#5a7a5e)] border-[var(--color-lyra-sage,#5a7a5e)]/30'
    : 'bg-stone-100 text-stone-600 border-stone-300';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium uppercase tracking-wider ${sizeClasses} ${colourClasses} ${className}`}
      role="img"
      aria-label={sentence}
      title={sentence}
    >
      {label}
      <Link
        href="/partners"
        rel="noopener"
        className="text-[var(--color-lyra-sage,#5a7a5e)] hover:underline focus:underline outline-none focus:ring-1 focus:ring-[var(--color-lyra-sage,#5a7a5e)] rounded"
        aria-label="What this means — affiliate partners page"
      >
        ?
      </Link>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}
