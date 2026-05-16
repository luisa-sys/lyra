/**
 * KAN-191 (rendering) + KAN-192 (FTC affiliate badge): V2 "Gift ideas"
 * section on the public profile page.
 *
 * Server component — receives pre-computed V2Recommendation[] from the
 * parent profile page so the V2 pipeline call (which can do remote IO
 * against Sovrn once live) happens once per request.
 *
 * Each card shows: product title, merchant + price range, rationale,
 * affiliate disclosure badge, and a CTA anchor with the affiliate URL.
 *
 * The anchor uses `rel="sponsored noopener nofollow"` per FTC guidance
 * + Google search-engine best practice for paid links.
 *
 * Returns null for empty input (sparse profile + nothing in the curated
 * catalogue + Sovrn not yet live) so the parent component can fall back
 * to the V1 concept-only section gracefully.
 */

import Link from 'next/link';
import type { V2Recommendation } from '@/lib/recommender/v2/types';
import AffiliateBadge from '@/components/AffiliateBadge';
import { formatPriceRange, merchantLabel } from './v2-recommendations-helpers';

interface V2RecommendationsSectionProps {
  /** Display name of the recipient — used in the section heading. */
  displayName: string;
  /** Output of the V2 pipeline. */
  recommendations: V2Recommendation[];
}

export default function V2RecommendationsSection({
  displayName,
  recommendations,
}: V2RecommendationsSectionProps) {
  if (recommendations.length === 0) return null;

  const first = displayName.split(/\s+/)[0] ?? displayName;

  return (
    <section
      aria-labelledby="v2-recommendations-heading"
      className="mt-16 pt-12 border-t border-stone-200"
    >
      <header className="mb-8">
        <h2
          id="v2-recommendations-heading"
          className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]"
        >
          Gift ideas for {first}
        </h2>
        <p className="text-sm text-[var(--color-muted)] mt-2">
          Selected based on {first}&rsquo;s profile. Lyra may earn a commission on
          some links &mdash;{' '}
          <Link href="/partners" className="text-[var(--color-lyra-sage,#5a7a5e)] hover:underline">
            see how this works
          </Link>
          .
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {recommendations.map((rec) => {
          const price = formatPriceRange(rec.product);
          const merchant = merchantLabel(rec.product.merchantId);
          return (
            <li
              key={rec.affiliate.clickId}
              className="p-5 rounded-xl border border-stone-200 bg-white flex flex-col"
            >
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <h3 className="text-base font-medium text-[var(--color-ink)] leading-snug">
                  {rec.product.title}
                </h3>
                <AffiliateBadge monetised={rec.affiliate.monetised} />
              </div>
              <p className="text-xs text-stone-500 mb-2">
                {merchant}
                {price ? <span className="text-stone-400"> &middot; {price}</span> : null}
              </p>
              <p className="text-sm text-[var(--color-muted)] leading-relaxed flex-1">
                {rec.rationale}
              </p>
              <div className="mt-4">
                <a
                  href={rec.affiliate.url}
                  rel="sponsored noopener nofollow"
                  target="_blank"
                  className="inline-flex items-center text-sm font-medium text-[var(--color-lyra-sage,#5a7a5e)] hover:underline"
                >
                  View at {merchant} &rarr;
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-stone-500 mt-6">
        Suggestions are auto-generated &mdash; not endorsements. Read the{' '}
        <Link href="/partners" className="text-[var(--color-lyra-sage,#5a7a5e)] hover:underline">
          partners disclosure
        </Link>{' '}
        for details on how Lyra works with affiliate networks.
      </p>
    </section>
  );
}
