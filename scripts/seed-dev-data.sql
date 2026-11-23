-- KAN-109: Seed dev database with sample profiles for testing
-- Run against dev Supabase only (ilprytcrnqyrsbsrfujj)
--
-- KAN-490 (v0.8 step 7, 2026-11-23): rewritten so it still runs after the
-- v0.8 data model (KAN-485 triggers) and the ID conversion:
--   * targets the two profiles by UUID (their slugs changed in the KAN-490
--     conversion: luisa-632df5a4 -> luisa_632df5a4, ben-e3798c06 -> ben_e3798c06);
--   * v0.8 categories only (the old likes / dislikes / boundaries /
--     helpful_to_know / questions / billboard rows now go to gift_ideas,
--     gifts_to_avoid, the manual-of-me prompts, current_problems and
--     profiles.billboard);
--   * school rows carry affiliation_type = 'school' and a postcode of at most
--     12 characters, as the KAN-485 affiliation trigger requires;
--   * wishlist links become gift ideas with a URL (v0.8 has no links section);
--   * idempotent WITHOUT relying on a unique key: every insert is
--     `insert ... select ... where not exists (same profile + category + title)`
--     (the old `ON CONFLICT DO NOTHING` had no unique key to conflict on, so
--     every rerun duplicated rows); text fields are only filled when empty;
--   * it no longer forces is_published = true: publishing now needs a photo
--     and a confirmed ID (KAN-485), so it only keeps a profile published if
--     it already was.
-- It targets the SAME two accounts as before (decision 9 of 2026-11-23).
--
-- ⚠️ OPEN QUESTION FOR THE FOUNDER (spec v0.8 §3): "Do not seed illustrative
-- sample content into real accounts." These two profiles belong to real
-- people's sign-ins on dev. This script is unchanged in WHICH accounts it
-- writes to until the founder decides whether it should instead create
-- dedicated seed accounts (like tests/e2e/support/seed-user.ts does).

-- ============================================================
-- Profile text (only fills empty fields — never overwrites a member's edit)
-- ============================================================

UPDATE profiles SET
  headline  = coalesce(nullif(headline, ''),  'Mum, coffee enthusiast, amateur gardener'),
  bio_short = coalesce(nullif(bio_short, ''), 'I love a quiet Sunday morning with a good book and too much coffee. My kids think I''m embarrassing but I think I''m hilarious.'),
  city      = coalesce(nullif(city, ''),      'Crawley'),
  country   = coalesce(nullif(country, ''),   'GB'),
  billboard = coalesce(nullif(billboard, ''), 'Kindness is free. Sprinkle it everywhere.')
WHERE id = '1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08';

UPDATE profiles SET
  display_name = coalesce(nullif(display_name, ''), 'Ben Santos-Stephens'),
  headline  = coalesce(nullif(headline, ''),  'Dad, tech tinkerer, terrible cook'),
  bio_short = coalesce(nullif(bio_short, ''), 'I build things with code and break things in the kitchen. My idea of a perfect weekend involves a long walk, a pub lunch, and absolutely no DIY.'),
  city      = coalesce(nullif(city, ''),      'Crawley'),
  country   = coalesce(nullif(country, ''),   'GB'),
  billboard = coalesce(nullif(billboard, ''), 'Sleep is a superpower. Protect it.')
WHERE id = 'bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0';

-- ============================================================
-- Profile items (v0.8 categories), idempotent per profile + category + title
-- ============================================================

INSERT INTO profile_items (profile_id, category, title, description, url)
SELECT v.profile_id::uuid, v.category::item_category, v.title, v.description, v.url
FROM (VALUES
  -- Luisa (1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08)
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Anything from Oliver Bonas', 'I love their candles and homeware', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'A really good hand cream', 'L''Occitane or Aesop — I go through these fast', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Book tokens', 'I always have a reading list', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Earl Grey tea', NULL, NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Fresh flowers on the table', NULL, NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gift_ideas', 'Amazon Wishlist', NULL, 'https://www.amazon.co.uk/hz/wishlist/example'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gifts_to_avoid', 'Scented candles that smell artificial', NULL, NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'gifts_to_avoid', 'Perfume', 'I''m very particular about scents', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'favourite_books', 'Where the Crawdads Sing', 'Read it three times', NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'causes', 'Mental health awareness', NULL, NULL),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'quotes', 'Be yourself; everyone else is already taken', 'Oscar Wilde', NULL),
  -- Ben (bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0)
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Craft beer subscription', 'BrewDog, Beavertown, anything hoppy', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Board games', 'Especially strategy ones — Catan, Wingspan', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Socks', 'Seriously, I always need socks. Fun patterns welcome.', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gift_ideas', 'Board game wishlist', NULL, 'https://boardgamegeek.com/collection/user/example'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gifts_to_avoid', 'Mushrooms', 'Texture thing, sorry', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'gifts_to_avoid', 'Anything with dairy', 'Lactose intolerant — oat milk is fine', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'favourite_books', 'Project Hail Mary', 'Andy Weir', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'favourite_media', 'Ted Lasso', 'Watched it four times', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'proud_of', 'Ran a half marathon in 2024', NULL, NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'life_hacks', 'Keep a water bottle at your desk', 'Game changer', NULL),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'current_problems', 'What should we do for our anniversary?', 'Open to ideas that aren''t just dinner', NULL)
) AS v(profile_id, category, title, description, url)
WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = v.profile_id::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM profile_items i
     WHERE i.profile_id = v.profile_id::uuid
       AND i.category = v.category::item_category
       AND i.title = v.title
  );

-- ============================================================
-- To understand me a little better (manual of me) — only empty prompts
-- ============================================================

INSERT INTO profile_manual_of_me (profile_id, good_to_know, boundaries)
SELECT v.profile_id::uuid, v.good_to_know, v.boundaries
FROM (VALUES
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'Vegetarian since 2019. Allergic to cats.', 'Please don''t post photos of my kids online. Text before visiting.'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'Lactose intolerant — oat milk is fine. Formula 1 fan since childhood.', 'No surprise birthday parties, please.')
) AS v(profile_id, good_to_know, boundaries)
WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = v.profile_id::uuid)
ON CONFLICT (profile_id) DO UPDATE SET
  good_to_know = coalesce(nullif(profile_manual_of_me.good_to_know, ''), excluded.good_to_know),
  boundaries   = coalesce(nullif(profile_manual_of_me.boundaries, ''),   excluded.boundaries);

-- ============================================================
-- Where you might know me from — schools (v0.8: type + postcode <= 12)
-- ============================================================

INSERT INTO school_affiliations (profile_id, school_name, school_location, relationship, affiliation_type)
SELECT v.profile_id::uuid, v.school_name, v.postcode, 'parent'::school_relationship, 'school'
FROM (VALUES
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'Crawley Primary School', 'RH10 1AA'),
  ('1bc7f0af-6d7b-4f61-82f0-69eb4b43ca08', 'St Wilfrid''s Catholic School', 'RH11 8PG'),
  ('bd5fcdbc-604a-484d-9a15-4d9d8cd1c7c0', 'Crawley Primary School', 'RH10 1AA')
) AS v(profile_id, school_name, postcode)
WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = v.profile_id::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM school_affiliations s
     WHERE s.profile_id = v.profile_id::uuid
       AND s.affiliation_type = 'school'
       AND s.school_name = v.school_name
  );
