-- KAN-137: Add missing profile item categories from original Python/Flask app
-- Adds 8 new category values to the item_category enum type
-- Applied to all 3 environments (dev, staging, production) on 30 March 2026

ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'favourite_books';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'favourite_media';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'causes';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'quotes';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'proud_of';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'life_hacks';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'questions';
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'billboard';
