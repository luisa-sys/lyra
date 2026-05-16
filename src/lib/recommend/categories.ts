/**
 * KAN-139: gift category taxonomy ported from the original Python
 * /Users/admin/Documents/2026 Lyra/lyra-app/recommend.py (`GIFT_CATEGORIES`).
 *
 * Each category has a list of keyword stems that mark a profile item or
 * recommendation as belonging to that category, plus a base weight that
 * the scorer multiplies into the final match score. Keywords are
 * lowercase substrings; matching is `text.includes(keyword)` after
 * lower-casing — the same shape as the Python source so behaviour
 * stays bit-for-bit identical on the same inputs.
 */

export type GiftCategoryKey =
  | 'experiences'
  | 'food_drink'
  | 'books_reading'
  | 'home_garden'
  | 'arts_crafts'
  | 'fashion_accessories'
  | 'music_audio'
  | 'sport_outdoors'
  | 'charitable'
  | 'stationery_writing';

export interface GiftCategory {
  keywords: readonly string[];
  weight: number;
}

export const GIFT_CATEGORIES: Readonly<Record<GiftCategoryKey, GiftCategory>> = {
  experiences: {
    keywords: [
      'experience', 'ticket', 'class', 'workshop', 'lesson', 'trip',
      'spa', 'massage', 'voucher', 'membership', 'pass', 'entry',
      'escape room', 'supper club', 'concert', 'show', 'festival',
      'climbing', 'swimming', 'running', 'yoga', 'retreat',
    ],
    weight: 1.2,
  },
  food_drink: {
    keywords: [
      'chocolate', 'wine', 'coffee', 'tea', 'gin', 'negroni',
      'food', 'cookbook', 'cooking', 'baking', 'flour', 'beans',
      'restaurant', 'supper', 'cake', 'cocktail', 'matcha',
      'sushi', 'ramen', 'cheese', 'olive oil', 'honey',
    ],
    weight: 1.0,
  },
  books_reading: {
    keywords: [
      'book', 'novel', 'fiction', 'waterstones', 'reading',
      'kindle', 'library', 'author', 'poetry', 'magazine',
      'literary', 'bookshop',
    ],
    weight: 1.0,
  },
  home_garden: {
    keywords: [
      'candle', 'plant', 'garden', 'seed', 'bulb', 'flower',
      'pottery', 'mug', 'bowl', 'vase', 'homeware', 'cushion',
      'blanket', 'throw', 'print', 'art', 'frame', 'succulent',
      'herb', 'pot',
    ],
    weight: 1.0,
  },
  arts_crafts: {
    keywords: [
      'paint', 'watercolour', 'art', 'craft', 'draw', 'sketch',
      'brush', 'canvas', 'gallery', 'museum', 'exhibition',
      'design', 'photography', 'camera', 'calligraphy',
    ],
    weight: 1.0,
  },
  fashion_accessories: {
    keywords: [
      'clothing', 'jewellery', 'scarf', 'hat', 'bag', 'wallet',
      'watch', 'sunglasses', 'socks', 'lululemon', 'cashmere',
      'silk', 'linen',
    ],
    weight: 0.9,
  },
  music_audio: {
    keywords: [
      'music', 'vinyl', 'record', 'headphone', 'speaker',
      'concert', 'jazz', 'guitar', 'instrument', 'playlist',
      'album',
    ],
    weight: 1.0,
  },
  sport_outdoors: {
    keywords: [
      'running', 'cycling', 'walking', 'hiking', 'climbing',
      'swimming', 'yoga', 'fitness', 'trail', 'gear', 'shoe',
      'marathon', 'race',
    ],
    weight: 1.0,
  },
  charitable: {
    keywords: [
      'donation', 'charity', 'cause', 'shelter', 'trust',
      'foundation', 'volunteer', 'ethical', 'sustainable',
      'environment', 'woodland', 'wildlife',
    ],
    weight: 1.1,
  },
  stationery_writing: {
    keywords: [
      'notebook', 'journal', 'pen', 'stationery', 'letter',
      'card', 'handwritten', 'note', 'diary', 'planner',
    ],
    weight: 0.9,
  },
};

export const ALL_CATEGORY_KEYS = Object.keys(GIFT_CATEGORIES) as GiftCategoryKey[];
