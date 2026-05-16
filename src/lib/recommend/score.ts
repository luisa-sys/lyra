/**
 * KAN-139: score a single recommendation template against a
 * preference profile. Higher score = better match.
 *
 * Ported from `_score_recommendation` in
 * /Users/admin/Documents/2026 Lyra/lyra-app/recommend.py. Same weights,
 * same penalties, same reason strings — bit-for-bit identical scoring
 * on the same inputs.
 */

import { extractKeywords } from './keywords';
import { GIFT_CATEGORIES } from './categories';
import type { PreferenceProfile } from './preferences';
import type { RecommendationTemplate } from './pool';

export interface ScoredRecommendation {
  template: RecommendationTemplate;
  score: number;
  reasons: string[];
}

/** "Soft reject" sentinel returned for items too similar to existing gift ideas. */
const SIMILARITY_VETO = -100;

/**
 * Returns the union of two iterables as a set — used for cheap
 * keyword overlap checks against Counter keys.
 */
function intersect(a: Iterable<string>, b: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const v of a) if (b.has(v)) out.push(v);
  return out;
}

/**
 * Title-cased label for a category, used in reason strings ("Matches
 * preferred category: Food Drink").
 */
function categoryLabel(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function scoreRecommendation(
  rec: RecommendationTemplate,
  pref: PreferenceProfile,
): ScoredRecommendation {
  const recText = `${rec.title} ${rec.description}`.toLowerCase();
  const recWords = new Set([...extractKeywords(recText), ...rec.tags.map((t) => t.toLowerCase())]);
  const titleWords = new Set(extractKeywords(rec.title));

  // 0. Similarity veto — if more than half the title words overlap an
  // existing gift idea title, skip. Stops the engine recommending
  // "Cashmere scarf" when the user already wrote "Cashmere socks or scarf".
  for (const existing of pref.existingGiftTitles) {
    const existingWords = new Set(extractKeywords(existing));
    if (titleWords.size === 0 || existingWords.size === 0) continue;
    let shared = 0;
    for (const w of titleWords) if (existingWords.has(w)) shared++;
    const overlap = shared / titleWords.size;
    if (overlap > 0.5) {
      return {
        template: rec,
        score: SIMILARITY_VETO,
        reasons: ['Too similar to an existing gift idea'],
      };
    }
  }

  let score = 0;
  const reasons: string[] = [];

  // 1. Category match — boost if they've listed gifts in this category.
  const catCount = pref.preferredCategories.get(rec.category);
  if (catCount > 0) {
    score += catCount * 2.0;
    reasons.push(`Matches preferred category: ${categoryLabel(rec.category)}`);
  }

  // 2. Anti-category penalty.
  if (pref.antiCategories.get(rec.category) > 0) {
    score -= 10;
    reasons.push('Conflicts with things they avoid');
  }

  // 3. Keyword overlap with likes.
  const likesKeys = new Set(pref.likes.keys());
  const likeOverlap = intersect(recWords, likesKeys);
  if (likeOverlap.length > 0) {
    const bonus = likeOverlap.reduce((sum, w) => sum + pref.likes.get(w), 0) * 1.5;
    score += bonus;
    reasons.push(`Matches interests: ${likeOverlap.slice(0, 3).sort().join(', ')}`);
  }

  // 4. Keyword overlap with existing gift ideas (mild positive — they
  // clearly like this theme even though we've vetoed near-duplicates).
  const giftsKeys = new Set(pref.gifts.keys());
  const giftOverlap = intersect(recWords, giftsKeys);
  if (giftOverlap.length > 0) {
    const bonus = giftOverlap.reduce((sum, w) => sum + pref.gifts.get(w), 0) * 1.0;
    score += bonus;
    reasons.push('Similar to gifts they want');
  }

  // 5. Keyword overlap with avoids = strong penalty.
  const avoidsKeys = new Set(pref.avoids.keys());
  const avoidOverlap = intersect(recWords, avoidsKeys);
  if (avoidOverlap.length > 0) {
    const penalty = avoidOverlap.reduce((sum, w) => sum + pref.avoids.get(w), 0) * 3.0;
    score -= penalty;
    reasons.push(`May conflict: ${avoidOverlap.slice(0, 2).sort().join(', ')}`);
  }

  // 6. Experience bonus — they prefer experiences over things.
  if (pref.valuesExperiences && rec.category === 'experiences') {
    score += 3.0;
    reasons.push('They value experiences over objects');
  }

  // 7. Charitable bonus.
  if (pref.valuesCharitable && rec.category === 'charitable') {
    score += 3.0;
    reasons.push('They value charitable giving');
  }

  // 8. Minimalism — boost experiences, penalise physical clutter.
  if (pref.valuesMinimal) {
    if (rec.category === 'experiences') {
      score += 2.0;
    } else if (
      rec.category === 'home_garden'
      || rec.category === 'fashion_accessories'
      || rec.category === 'stationery_writing'
    ) {
      score -= 1.5;
    }
  }

  // 9. Dietary filtering on food/drink recs.
  if (rec.category === 'food_drink' && pref.dietary.size > 0) {
    if (pref.dietary.has('vegan')) {
      const fineForVegans = ['chocolate', 'wine', 'gin', 'coffee', 'tea', 'cocktail'];
      const animalProducts = ['cheese', 'honey', 'cream'];
      if (!fineForVegans.some((w) => recText.includes(w))
          && animalProducts.some((w) => recText.includes(w))) {
        score -= 10;
        reasons.push('Conflicts with vegan diet');
      }
    }
    if (pref.dietary.has('gluten-free')) {
      const glutenous = ['sourdough', 'bread', 'flour', 'baking'];
      if (glutenous.some((w) => recText.includes(w))) {
        score -= 10;
        reasons.push('Conflicts with gluten-free diet');
      }
    }
  }

  // 10. Category base weight.
  score *= GIFT_CATEGORIES[rec.category].weight;

  // 11. Faint general signal — every keyword the rec shares with anything
  // in the profile nudges the score slightly. Prevents zero-scoring on
  // light-data profiles by giving partial credit.
  const allKeys = new Set(pref.all.keys());
  const allOverlap = intersect(recWords, allKeys);
  if (allOverlap.length > 0) {
    score += allOverlap.length * 0.3;
  }

  if (reasons.length === 0) {
    reasons.push('General match based on profile analysis');
  }

  return {
    template: rec,
    score: Math.round(score * 100) / 100,
    reasons,
  };
}
