-- KAN-109: Seed dev database with sample profiles for testing
-- Run against dev Supabase only (ilprytcrnqyrsbsrfujj)
-- Safe to rerun: uses ON CONFLICT DO NOTHING for idempotency on items

-- ============================================================
-- Update existing profiles with rich data
-- ============================================================

UPDATE profiles SET 
  headline = 'Mum, coffee enthusiast, amateur gardener',
  bio_short = 'I love a quiet Sunday morning with a good book and too much coffee. My kids think I''m embarrassing but I think I''m hilarious.',
  city = 'Crawley',
  country = 'GB',
  is_published = true
WHERE slug = 'luisa-632df5a4';

UPDATE profiles SET 
  display_name = 'Ben Santos-Stephens',
  headline = 'Dad, tech tinkerer, terrible cook',
  bio_short = 'I build things with code and break things in the kitchen. My idea of a perfect weekend involves a long walk, a pub lunch, and absolutely no DIY.',
  city = 'Crawley',
  country = 'GB',
  is_published = true
WHERE slug = 'ben-e3798c06';

-- ============================================================
-- Profile items — Luisa (1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08)
-- ============================================================

-- Gift ideas
INSERT INTO profile_items (profile_id, category, title, description) VALUES
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Anything from Oliver Bonas', 'I love their candles and homeware'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'A really good hand cream', 'L''Occitane or Aesop — I go through these fast'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Book tokens', 'I always have a reading list')
ON CONFLICT DO NOTHING;

-- Likes, dislikes, boundaries, helpful
INSERT INTO profile_items (profile_id, category, title, description) VALUES
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'likes', 'Earl Grey tea', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'likes', 'Walking in the countryside', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'likes', 'True crime podcasts', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'likes', 'Fresh flowers on the table', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'dislikes', 'Scented candles that smell artificial', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'dislikes', 'Surprise visits', 'Please text first!'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'boundaries', 'No perfume as gifts', 'I''m very particular about scents'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'boundaries', 'Don''t post photos of my kids online', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'helpful_to_know', 'Vegetarian since 2019', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'helpful_to_know', 'Allergic to cats', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'favourite_books', 'Where the Crawdads Sing', 'Read it three times'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'causes', 'Mental health awareness', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'quotes', 'Be yourself; everyone else is already taken', 'Oscar Wilde'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'billboard', 'Kindness is free. Sprinkle it everywhere.', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Profile items — Ben (bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0)
-- ============================================================

INSERT INTO profile_items (profile_id, category, title, description) VALUES
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Craft beer subscription', 'BrewDog, Beavertown, anything hoppy'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Board games', 'Especially strategy ones — Catan, Wingspan'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Socks', 'Seriously, I always need socks. Fun patterns welcome.'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'likes', 'Formula 1', 'McLaren fan since childhood'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'likes', 'Sourdough bread', 'Making it, eating it, talking about it'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'likes', 'Sci-fi films', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'dislikes', 'Mushrooms', 'Texture thing, sorry'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'dislikes', 'Being cold', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'boundaries', 'No surprise birthday parties', 'I will not enjoy it'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'helpful_to_know', 'Lactose intolerant', 'Oat milk is fine'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'favourite_books', 'Project Hail Mary', 'Andy Weir'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'favourite_media', 'Ted Lasso', 'Watched it four times'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'proud_of', 'Ran a half marathon in 2024', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'life_hacks', 'Keep a water bottle at your desk', 'Game changer'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'questions', 'What should we do for our anniversary?', 'Open to ideas that aren''t just dinner'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'billboard', 'Sleep is a superpower. Protect it.', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- External links and school affiliations
-- ============================================================

INSERT INTO external_links (profile_id, title, url, link_type) VALUES
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'Amazon Wishlist', 'https://www.amazon.co.uk/hz/wishlist/example', 'wishlist'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'Favourite bookshop', 'https://www.waterstones.com', 'retailer'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'Board game wishlist', 'https://boardgamegeek.com/collection/user/example', 'wishlist')
ON CONFLICT DO NOTHING;

INSERT INTO school_affiliations (profile_id, school_name, school_location, relationship) VALUES
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'Crawley Primary School', 'Crawley, West Sussex', 'parent'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'St Wilfrid''s Catholic School', 'Crawley, West Sussex', 'parent'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'Crawley Primary School', 'Crawley, West Sussex', 'parent')
ON CONFLICT DO NOTHING;
