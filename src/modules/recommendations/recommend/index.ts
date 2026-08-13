/**
 * KAN-139: public API of the Lyra recommendation engine.
 *
 * Ported from the Python module at
 * /Users/admin/Documents/2026 Lyra/lyra-app/recommend.py. Two top-level
 * entry points:
 *
 *   - getRecommendations(profile, opts) — ranked list of gift / experience
 *     suggestions for a profile, with diversification (max 3 per category).
 *
 *   - getProfileInsights(profile) — analyst summary of the profile
 *     (top interests, things to avoid, gift style). Used by the MCP
 *     `lyra_get_insights` tool and by the recommendations UI.
 *
 * Pure functions — DB access happens in the caller. See
 * `src/app/api/recommendations/[slug]/route.ts` for the
 * standard plumbing.
 */

import { RECOMMENDATION_POOL, type RecommendationTemplate } from './pool';
import { buildPreferenceProfile, type ProfileInput, type PreferenceProfile } from './preferences';
import { scoreRecommendation, type ScoredRecommendation } from './score';

export interface RecommendationOptions {
  /** Cap on returned recommendations (post-diversification). Default 10. */
  limit?: number;
  /**
   * Optional title-keyed feedback: positive = upvote (+5), negative =
   * downvote (-20). Mirrors the Python user feedback table. The DB
   * schema for storing this is deferred to a follow-up ticket; the
   * function accepts feedback inline so callers can wire it in later
   * without changing this signature.
   */
  feedback?: Record<string, 1 | -1>;
}

export interface RecommendationResult {
  title: string;
  description: string;
  category: string;
  /** Stable category key (snake_case) — useful for filtering / analytics. */
  categoryKey: RecommendationTemplate['category'];
  score: number;
  reasons: string[];
  tags: readonly string[];
}

/**
 * Returns up to `limit` ranked recommendations. Excludes any
 * recommendation that scored ≤ 0 (i.e. net-negative match). Diversifies
 * by capping each category at 3 entries so a fanatic gardener doesn't
 * see only plant suggestions.
 */
export function getRecommendations(
  profile: ProfileInput,
  opts: RecommendationOptions = {},
): RecommendationResult[] {
  const limit = opts.limit ?? 10;
  const feedback = opts.feedback ?? {};
  const pref = buildPreferenceProfile(profile);

  const scored: ScoredRecommendation[] = RECOMMENDATION_POOL.map((rec) => {
    const out = scoreRecommendation(rec, pref);
    const vote = feedback[rec.title];
    if (vote === 1) {
      out.score += 5;
      out.reasons.unshift('You liked this suggestion');
    } else if (vote === -1) {
      out.score -= 20;
      out.reasons.unshift('You disliked this suggestion');
    }
    return out;
  });

  // Sort by score descending; tie-break by pool order for stability.
  scored.sort((a, b) => b.score - a.score);

  // Filter positive-only + diversify (max 3 per category).
  const out: RecommendationResult[] = [];
  const perCat = new Map<string, number>();
  for (const r of scored) {
    if (r.score <= 0) continue;
    const cat = r.template.category;
    const count = perCat.get(cat) ?? 0;
    if (count >= 3) continue;
    perCat.set(cat, count + 1);
    out.push({
      title: r.template.title,
      description: r.template.description,
      category: cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      categoryKey: cat,
      score: r.score,
      reasons: r.reasons,
      tags: r.template.tags,
    });
    if (out.length >= limit) break;
  }

  return out;
}

export interface ProfileInsights {
  /** Dietary constraints detected from boundary text. */
  dietary: string[];
  /** Inferred gift-giving values (experiences > things, charitable, handmade, minimal). */
  values: string[];
  /** Top 10 keywords from likes + gift ideas, longest-first. */
  topInterests: string[];
  /** Top 5 keywords from avoid items. */
  avoidThemes: string[];
  /** Top 3 preferred gift categories. */
  preferredCategories: string[];
}

/**
 * Returns a high-level summary of what the engine inferred about the
 * profile. Used by the MCP `lyra_get_insights` tool and by the public
 * recommendation UI to caption why suggestions are what they are.
 */
export function getProfileInsights(profile: ProfileInput): ProfileInsights {
  const pref = buildPreferenceProfile(profile);

  const combined = new Map<string, number>();
  for (const k of pref.likes.keys()) {
    combined.set(k, (combined.get(k) ?? 0) + pref.likes.get(k));
  }
  for (const k of pref.gifts.keys()) {
    combined.set(k, (combined.get(k) ?? 0) + pref.gifts.get(k));
  }
  const topInterests = [...combined.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([word]) => word.length > 3)
    .slice(0, 10)
    .map(([w]) => w);

  const avoidThemes = pref.avoids
    .mostCommon(5)
    .filter(([word]) => word.length > 3)
    .map(([w]) => w);

  const values = giftStyleLabels(pref);

  const preferredCategories = pref.preferredCategories
    .mostCommon(3)
    .map(([cat]) => cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

  return {
    dietary: [...pref.dietary].sort(),
    values,
    topInterests,
    avoidThemes,
    preferredCategories,
  };
}

function giftStyleLabels(pref: PreferenceProfile): string[] {
  const out: string[] = [];
  if (pref.valuesExperiences) out.push('Prefers experiences over physical gifts');
  if (pref.valuesCharitable) out.push('Appreciates charitable donations');
  if (pref.valuesHandmade) out.push('Values handmade and independent makers');
  if (pref.valuesMinimal) out.push('Minimalist — avoid adding clutter');
  return out;
}

// Re-export the building blocks so callers can compose / test in isolation.
export type { ProfileInput, ProfileItemInput } from './preferences';
export type { ScoredRecommendation } from './score';
