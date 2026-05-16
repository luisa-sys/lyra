/**
 * KAN-139: behaviour tests for the recommendation engine.
 *
 * Locks in the rules that have user-visible consequences:
 *  - similarity veto (don't suggest near-duplicates of existing gifts)
 *  - dietary filtering (vegan / gluten-free)
 *  - anti-category penalty (avoid items reduce that category's score)
 *  - diversification (max 3 per category)
 *  - feedback boost / penalty
 *  - empty-profile safety
 */

import { getRecommendations, getProfileInsights, type ProfileInput } from '@/lib/recommend';
import { buildPreferenceProfile } from '@/lib/recommend/preferences';
import { scoreRecommendation } from '@/lib/recommend/score';
import { RECOMMENDATION_POOL } from '@/lib/recommend/pool';
import { extractKeywords, Counter } from '@/lib/recommend/keywords';

function profileWith(items: ProfileInput['items']): ProfileInput {
  return { bio: null, headline: null, items };
}

describe('KAN-139 recommend — extractKeywords', () => {
  test('drops stopwords and short tokens', () => {
    expect(extractKeywords('I love the smell of fresh coffee in the morning'))
      .toEqual(['smell', 'fresh', 'coffee', 'morning']);
  });

  test('handles null / empty gracefully', () => {
    expect(extractKeywords(null)).toEqual([]);
    expect(extractKeywords(undefined)).toEqual([]);
    expect(extractKeywords('')).toEqual([]);
  });

  test('lowercases consistently', () => {
    expect(extractKeywords('SOURDOUGH bread BAKING')).toEqual(['sourdough', 'bread', 'baking']);
  });
});

describe('KAN-139 recommend — Counter', () => {
  test('counts repeats and ranks by frequency', () => {
    const c = new Counter();
    c.add(['coffee', 'tea', 'coffee', 'wine', 'coffee']);
    expect(c.get('coffee')).toBe(3);
    expect(c.get('tea')).toBe(1);
    expect(c.get('not-there')).toBe(0);
    expect(c.mostCommon(2)).toEqual([['coffee', 3], ['tea', 1]]);
  });
});

describe('KAN-139 recommend — buildPreferenceProfile', () => {
  test('classifies items into the right buckets by category', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'gift_ideas', title: 'Cashmere scarf', description: null },
      { category: 'likes', title: 'Strong coffee in the morning', description: null },
      { category: 'dislikes', title: 'Scented candles', description: 'Migraine triggers' },
      { category: 'boundaries', title: 'Vegan diet', description: 'No animal products' },
    ]));
    expect(pref.gifts.get('cashmere')).toBe(1);
    expect(pref.likes.get('coffee')).toBe(1);
    expect(pref.avoids.get('scented')).toBe(1);
    expect(pref.boundaries.get('vegan')).toBe(1);
    expect(pref.dietary.has('vegan')).toBe(true);
    expect(pref.existingGiftTitles.has('cashmere scarf')).toBe(true);
  });

  test('detects value signals from gift idea wording', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'gift_ideas', title: 'Cooking class', description: 'A workshop with a chef' },
      { category: 'gift_ideas', title: 'Donation to woodland trust', description: null },
    ]));
    expect(pref.valuesExperiences).toBe(true);
    expect(pref.valuesCharitable).toBe(true);
    expect(pref.valuesMinimal).toBe(false);
  });

  test('detects minimalism signal regardless of category', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'helpful_to_know', title: 'I am minimal about possessions', description: null },
    ]));
    expect(pref.valuesMinimal).toBe(true);
  });

  test('maps gifts_to_avoid into the anti-category bucket', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'gifts_to_avoid', title: 'Scented candles and plants', description: null },
    ]));
    expect(pref.antiCategories.get('home_garden')).toBeGreaterThan(0);
  });
});

describe('KAN-139 recommend — scoreRecommendation', () => {
  test('vetoes a near-duplicate of an existing gift idea title', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'gift_ideas', title: 'Waterstones gift card', description: null },
    ]));
    const waterstones = RECOMMENDATION_POOL.find((r) => r.title.includes('Waterstones'))!;
    const out = scoreRecommendation(waterstones, pref);
    expect(out.score).toBeLessThan(-50);
    expect(out.reasons[0]).toMatch(/Too similar/);
  });

  test('boosts experiences when the user values experiences', () => {
    const expExperiences = buildPreferenceProfile(profileWith([
      { category: 'gift_ideas', title: 'Pottery workshop', description: 'A class' },
    ]));
    const expThings = buildPreferenceProfile(profileWith([
      { category: 'gift_ideas', title: 'Cashmere socks', description: null },
    ]));
    const concert = RECOMMENDATION_POOL.find((r) => r.title.includes('Theatre or concert'))!;
    expect(scoreRecommendation(concert, expExperiences).score)
      .toBeGreaterThan(scoreRecommendation(concert, expThings).score);
  });

  test('penalises food/drink recommendations that conflict with vegan diet', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'boundaries', title: 'Strict vegan diet', description: 'No animal products' },
      { category: 'gift_ideas', title: 'Italian cookbook', description: null },
    ]));
    // Cheese is the canonical conflicter — there's no cheese template in
    // the pool, so synthesise one for this assertion.
    const cheese = { title: 'Artisan cheese box', description: 'Aged cheddar selection', category: 'food_drink' as const, tags: ['cheese', 'dairy'] };
    const result = scoreRecommendation(cheese, pref);
    expect(result.reasons).toContain('Conflicts with vegan diet');
  });

  test('penalises sourdough kit when user is gluten-free', () => {
    const pref = buildPreferenceProfile(profileWith([
      { category: 'boundaries', title: 'Gluten-free / coeliac', description: null },
    ]));
    const sourdough = RECOMMENDATION_POOL.find((r) => r.title.includes('Sourdough'))!;
    const result = scoreRecommendation(sourdough, pref);
    expect(result.reasons).toContain('Conflicts with gluten-free diet');
    expect(result.score).toBeLessThan(0);
  });

  test('rewards keyword overlap with likes', () => {
    const coffeeFan = buildPreferenceProfile(profileWith([
      { category: 'likes', title: 'Single-origin coffee', description: 'I drink it every morning' },
    ]));
    const noSignal = buildPreferenceProfile(profileWith([]));
    const coffee = RECOMMENDATION_POOL.find((r) => r.title.includes('coffee subscription'))!;
    expect(scoreRecommendation(coffee, coffeeFan).score)
      .toBeGreaterThan(scoreRecommendation(coffee, noSignal).score);
  });
});

describe('KAN-139 recommend — getRecommendations', () => {
  test('returns at most `limit` results', () => {
    const out = getRecommendations(profileWith([
      { category: 'likes', title: 'Coffee, wine, books, yoga, gardens', description: null },
    ]), { limit: 5 });
    expect(out.length).toBeLessThanOrEqual(5);
  });

  test('diversifies — no category appears more than 3 times', () => {
    // A wide-net profile that matches many categories.
    const out = getRecommendations(profileWith([
      { category: 'likes', title: 'Wine coffee tea chocolate', description: 'Books gardens art music' },
      { category: 'gift_ideas', title: 'Wine subscription', description: null },
      { category: 'gift_ideas', title: 'Coffee subscription', description: null },
    ]), { limit: 30 });
    const counts: Record<string, number> = {};
    for (const r of out) counts[r.categoryKey] = (counts[r.categoryKey] ?? 0) + 1;
    for (const c of Object.values(counts)) expect(c).toBeLessThanOrEqual(3);
  });

  test('excludes net-negative recommendations', () => {
    const out = getRecommendations(profileWith([]), { limit: 20 });
    for (const r of out) expect(r.score).toBeGreaterThan(0);
  });

  test('handles an empty profile without throwing', () => {
    expect(() => getRecommendations(profileWith([]))).not.toThrow();
  });

  test('upvote feedback rises the score, downvote lowers it', () => {
    const profile = profileWith([
      { category: 'likes', title: 'Coffee in the morning', description: null },
    ]);
    const target = 'Speciality coffee subscription';
    const base = getRecommendations(profile, { limit: 20 }).find((r) => r.title === target)!;
    const upvoted = getRecommendations(profile, { limit: 20, feedback: { [target]: 1 } })
      .find((r) => r.title === target)!;
    expect(upvoted.score).toBeGreaterThan(base.score);
    expect(upvoted.reasons[0]).toMatch(/You liked/);

    const downvoted = getRecommendations(profile, { limit: 20, feedback: { [target]: -1 } });
    // -20 should knock it out of the positive-only list entirely.
    expect(downvoted.find((r) => r.title === target)).toBeUndefined();
  });
});

describe('KAN-139 recommend — getProfileInsights', () => {
  test('returns dietary, values and top interests', () => {
    const insights = getProfileInsights(profileWith([
      { category: 'boundaries', title: 'Vegan', description: null },
      { category: 'gift_ideas', title: 'Cooking class', description: 'A workshop with a chef' },
      { category: 'likes', title: 'Coffee, gardens, running', description: null },
    ]));
    expect(insights.dietary).toContain('vegan');
    expect(insights.values).toContain('Prefers experiences over physical gifts');
    expect(insights.topInterests.length).toBeGreaterThan(0);
  });

  test('handles a profile with no items', () => {
    const insights = getProfileInsights(profileWith([]));
    expect(insights.dietary).toEqual([]);
    expect(insights.values).toEqual([]);
    expect(insights.topInterests).toEqual([]);
    expect(insights.avoidThemes).toEqual([]);
    expect(insights.preferredCategories).toEqual([]);
  });
});

describe('KAN-139 recommend — pool integrity', () => {
  test('every recommendation has a valid category', () => {
    const validCats = new Set([
      'experiences', 'food_drink', 'books_reading', 'home_garden',
      'arts_crafts', 'fashion_accessories', 'music_audio',
      'sport_outdoors', 'charitable', 'stationery_writing',
    ]);
    for (const r of RECOMMENDATION_POOL) {
      expect(validCats.has(r.category)).toBe(true);
    }
  });

  test('no duplicate titles (curation hygiene)', () => {
    const titles = RECOMMENDATION_POOL.map((r) => r.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
