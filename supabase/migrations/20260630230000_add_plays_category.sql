-- KAN-404: add 'plays' to the item_category enum so profiles can list favourite
-- Plays (theatre) alongside films/books/TV/music/places/quotes.
--
-- Rollback: enum values cannot be dropped in Postgres without recreating the
-- type; 'plays' is additive and harmless if unused.
alter type public.item_category add value if not exists 'plays';
