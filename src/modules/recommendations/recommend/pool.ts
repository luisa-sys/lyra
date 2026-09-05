/**
 * KAN-139: recommendation pool ported from the original Python
 * /Users/admin/Documents/2026 Lyra/lyra-app/recommend.py (`RECOMMENDATION_POOL`).
 *
 * Each template has a title, description, category, and tag set. The
 * scorer combines these against a profile's preference model to rank
 * matches. Curated by Luisa in 2026-Q1; new entries should go here
 * (NOT in a database table) so the pool is reviewable in PR.
 */

import type { GiftCategoryKey } from './categories';

export interface RecommendationTemplate {
  title: string;
  description: string;
  category: GiftCategoryKey;
  tags: readonly string[];
}

export const RECOMMENDATION_POOL: readonly RecommendationTemplate[] = [
  // Experiences
  { title: 'Cooking class at a local restaurant', description: 'A hands-on cooking experience trying new cuisines', category: 'experiences', tags: ['cooking', 'food', 'experience'] },
  { title: 'Spa day or wellness voucher', description: 'A relaxing day of self-care and pampering', category: 'experiences', tags: ['spa', 'self-care', 'voucher'] },
  { title: 'Theatre or concert tickets', description: 'A live performance at a local venue', category: 'experiences', tags: ['music', 'theatre', 'experience', 'ticket'] },
  { title: 'Wine or cocktail tasting experience', description: 'A guided tasting at a local bar or vineyard', category: 'experiences', tags: ['wine', 'cocktail', 'experience', 'gin'] },
  { title: 'Pottery or ceramics workshop', description: 'A hands-on session making something beautiful', category: 'experiences', tags: ['craft', 'pottery', 'experience', 'art'] },
  { title: 'Escape room experience', description: 'A fun group activity for puzzle lovers', category: 'experiences', tags: ['experience', 'social', 'puzzle'] },
  { title: 'National Trust membership', description: 'Annual access to gardens, houses, and landscapes', category: 'experiences', tags: ['nature', 'garden', 'membership', 'national trust'] },
  { title: 'Art gallery membership or Art Fund pass', description: 'Access to exhibitions and galleries nationwide', category: 'experiences', tags: ['art', 'gallery', 'museum', 'pass'] },
  { title: 'Trail running event entry', description: 'Entry to a scenic organised run', category: 'experiences', tags: ['running', 'trail', 'sport', 'race'] },
  { title: 'Yoga retreat weekend', description: 'A restorative weekend of yoga and mindfulness', category: 'experiences', tags: ['yoga', 'retreat', 'self-care', 'wellness'] },
  { title: 'Supper club or tasting menu', description: 'An intimate dining experience with curated courses', category: 'experiences', tags: ['food', 'dining', 'experience', 'supper'] },
  { title: 'Rock climbing session', description: 'Indoor or outdoor climbing for adventure seekers', category: 'experiences', tags: ['climbing', 'sport', 'adventure'] },
  { title: 'Garden tour or open garden visit', description: 'Explore beautiful private or historic gardens', category: 'experiences', tags: ['garden', 'nature', 'flowers'] },
  { title: 'Live jazz evening at a small venue', description: 'An intimate night of live music', category: 'experiences', tags: ['jazz', 'music', 'live', 'experience'] },
  { title: 'Swimming in the sea — wild swimming voucher', description: 'A guided sea or wild swimming experience', category: 'experiences', tags: ['swimming', 'nature', 'outdoors'] },

  // Food & Drink
  { title: 'Speciality coffee subscription', description: 'Monthly delivery of single-origin beans from small roasters', category: 'food_drink', tags: ['coffee', 'subscription', 'beans'] },
  { title: 'Artisan chocolate box', description: 'High-quality dark chocolate from an independent maker', category: 'food_drink', tags: ['chocolate', 'dark', 'artisan'] },
  { title: 'Loose leaf tea collection', description: 'A curated selection of fine teas', category: 'food_drink', tags: ['tea', 'loose leaf', 'darjeeling', 'earl grey'] },
  { title: 'Natural wine selection', description: 'A box of interesting natural or biodynamic wines', category: 'food_drink', tags: ['wine', 'natural', 'red'] },
  { title: 'Craft gin set', description: 'Small-batch gins with tonics and garnishes', category: 'food_drink', tags: ['gin', 'cocktail', 'negroni'] },
  { title: 'Sourdough starter kit', description: 'Everything needed to start baking sourdough at home', category: 'food_drink', tags: ['baking', 'sourdough', 'bread'] },
  { title: 'Ottolenghi or Meera Sodha cookbook', description: 'Beautiful vegetarian/vegan cookbook', category: 'food_drink', tags: ['cookbook', 'vegetarian', 'vegan', 'cooking'] },
  { title: 'Olive oil and balsamic set', description: 'Premium Italian oils for the home cook', category: 'food_drink', tags: ['cooking', 'italian', 'food'] },
  { title: 'Japanese pantry box', description: 'Miso, soy, dashi, and other Japanese essentials', category: 'food_drink', tags: ['japanese', 'cooking', 'food', 'miso'] },
  { title: 'Hotel Chocolat tasting collection', description: 'An assortment of premium chocolates', category: 'food_drink', tags: ['chocolate', 'hotel chocolat'] },

  // Books & Reading
  { title: 'Waterstones gift card', description: 'Freedom to choose their next favourite read', category: 'books_reading', tags: ['book', 'waterstones', 'gift card'] },
  { title: 'Independent bookshop voucher', description: 'Support local and let them discover something new', category: 'books_reading', tags: ['book', 'independent', 'bookshop'] },
  { title: 'Book subscription (e.g., The Willoughby Book Club)', description: 'A surprise book delivery every month', category: 'books_reading', tags: ['book', 'subscription', 'surprise'] },
  { title: 'Beautiful coffee table book', description: 'A visual feast on a subject they love', category: 'books_reading', tags: ['book', 'photography', 'design', 'art'] },

  // Home & Garden
  { title: 'Scented candle from The White Company', description: 'A luxurious home fragrance candle', category: 'home_garden', tags: ['candle', 'white company', 'homeware'] },
  { title: 'Seasonal flower subscription', description: 'Fresh flowers delivered monthly', category: 'home_garden', tags: ['flower', 'subscription', 'seasonal'] },
  { title: 'Indoor plant — potted succulent or herb', description: 'A living, low-maintenance gift', category: 'home_garden', tags: ['plant', 'succulent', 'herb'] },
  { title: 'Sarah Raven seeds or bulbs', description: 'Beautiful flower or vegetable seeds for the garden', category: 'home_garden', tags: ['seeds', 'garden', 'flowers', 'sarah raven'] },
  { title: 'Handmade pottery mug or bowl', description: 'A unique, artisan-crafted piece', category: 'home_garden', tags: ['pottery', 'handmade', 'mug', 'bowl'] },
  { title: 'Luxury throw or blanket', description: 'A cosy, high-quality throw for the sofa', category: 'home_garden', tags: ['blanket', 'throw', 'cosy', 'homeware'] },
  { title: 'Herb garden kit', description: 'A windowsill herb growing set', category: 'home_garden', tags: ['herb', 'garden', 'growing', 'plant'] },

  // Arts & Crafts
  { title: 'Winsor & Newton paint set', description: 'Professional watercolour or acrylic paints', category: 'arts_crafts', tags: ['paint', 'watercolour', 'art'] },
  { title: 'Sketchbook and quality pen set', description: 'Beautiful tools for drawing and note-taking', category: 'arts_crafts', tags: ['sketch', 'pen', 'stationery', 'art'] },
  { title: 'Art print from an independent artist', description: 'A beautiful print to hang at home', category: 'arts_crafts', tags: ['art', 'print', 'design'] },

  // Music
  { title: 'Vinyl record — a classic album', description: 'A carefully chosen record for their collection', category: 'music_audio', tags: ['vinyl', 'record', 'music'] },
  { title: 'Record shop gift voucher', description: 'Let them find their own treasure', category: 'music_audio', tags: ['vinyl', 'record', 'music', 'gift card'] },

  // Sport & Outdoors
  { title: 'Running socks — Stance or Balega', description: 'High-quality running socks that any runner appreciates', category: 'sport_outdoors', tags: ['running', 'socks', 'sport'] },
  { title: 'Yoga mat or accessories', description: 'A premium mat, blocks, or strap for their practice', category: 'sport_outdoors', tags: ['yoga', 'mat', 'sport'] },
  { title: 'Hiking socks or trail snacks', description: 'Practical gifts for outdoor enthusiasts', category: 'sport_outdoors', tags: ['hiking', 'walking', 'trail', 'outdoors'] },

  // Charitable
  { title: 'Donation to their favourite charity', description: 'A meaningful gift that supports a cause they care about', category: 'charitable', tags: ['donation', 'charity', 'cause'] },
  { title: 'Adopt an animal or tree in their name', description: 'A symbolic adoption supporting conservation', category: 'charitable', tags: ['donation', 'wildlife', 'woodland', 'nature'] },

  // Stationery
  { title: 'Luxury notebook — Leuchtturm or Moleskine', description: 'For lists, sketches, or journaling', category: 'stationery_writing', tags: ['notebook', 'journal', 'stationery'] },
  { title: 'Handwritten letter kit', description: 'Beautiful writing paper and envelopes', category: 'stationery_writing', tags: ['letter', 'handwritten', 'card', 'stationery'] },

  // Fashion
  { title: 'Cashmere socks or scarf', description: 'A small luxury in natural fibres', category: 'fashion_accessories', tags: ['cashmere', 'scarf', 'socks', 'natural'] },
  { title: 'Lululemon gift card', description: "For yoga or activewear they'll love", category: 'fashion_accessories', tags: ['lululemon', 'yoga', 'activewear', 'gift card'] },
] as const;
