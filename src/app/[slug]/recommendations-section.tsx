/**
 * KAN-139: public-profile "Gift ideas based on this profile" section.
 *
 * Pure server component — receives pre-computed `RecommendationResult[]`
 * from the parent profile page so the recommendation engine call (which
 * touches potentially many keywords) happens once per request, not once
 * per render.
 *
 * Renders nothing if no recommendations are produced (keeps the page
 * clean for sparse profiles). For profiles with very few items the engine
 * naturally returns 0 results, so this is the right behaviour.
 */

import type { RecommendationResult } from '@/lib/recommend';

interface RecommendationsSectionProps {
  /** Display name of the person whose profile this is — used in the heading. */
  displayName: string;
  recommendations: RecommendationResult[];
}

export default function RecommendationsSection({
  displayName,
  recommendations,
}: RecommendationsSectionProps) {
  if (recommendations.length === 0) return null;

  const first = displayName.split(/\s+/)[0] ?? displayName;

  return (
    <section
      aria-labelledby="recommendations-heading"
      className="mt-16 pt-12 border-t border-stone-200"
    >
      <header className="mb-8">
        <h2
          id="recommendations-heading"
          className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]"
        >
          Gift ideas based on {first}&rsquo;s profile
        </h2>
        <p className="text-sm text-[var(--color-muted)] mt-2">
          Automatically generated from what {first} has shared. Not endorsements — just suggestions to spark ideas.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {recommendations.map((rec) => (
          <li
            key={rec.title}
            className="p-5 rounded-xl border border-stone-200 bg-white"
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h3 className="text-base font-medium text-[var(--color-ink)]">
                {rec.title}
              </h3>
              <span className="text-xs uppercase tracking-wider text-[var(--color-muted)] shrink-0">
                {rec.category}
              </span>
            </div>
            <p className="text-sm text-[var(--color-muted)] leading-relaxed">
              {rec.description}
            </p>
            {rec.reasons.length > 0 && (
              <p className="text-xs text-stone-500 mt-3 italic">
                Why: {rec.reasons[0]}
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs text-stone-500 mt-6">
        Suggestions are produced automatically and may not always land — use them as a starting point, not a shopping list.
      </p>
    </section>
  );
}
