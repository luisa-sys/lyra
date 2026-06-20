-- KAN-263: Profile redesign — three more "favourites" lists.
--
-- The redesign's "A few of my favourite things" grid has six lists. Films
-- (favourite_media), books (favourite_books) and quotes already exist; this
-- adds the remaining three (F5c / F5e / F5f):
--   - favourite_tv      — "Favourite TV shows"
--   - favourite_places  — "Favourite places"
--   - favourite_music   — "Favourite music & bands"
--
-- Reuses the existing profile_items table + RLS + sanitiser — same lightweight
-- pattern as 20260516160000_add_current_problems_category.sql. The editor +
-- public-profile UI that surface these come in a later phase; adding the enum
-- values now is harmless and unblocks that work.
--
-- Enum values can't be dropped in Postgres without recreating the type; to
-- remove, stop using them in code and leave the values in place.

alter type item_category add value if not exists 'favourite_tv';
alter type item_category add value if not exists 'favourite_places';
alter type item_category add value if not exists 'favourite_music';
