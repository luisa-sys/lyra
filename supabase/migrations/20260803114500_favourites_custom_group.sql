-- KAN-444: "Add your own" — a member-named favourites group.
--
-- The five fixed favourites groups (Books · Movies/Plays/TV · Quotes · Music ·
-- Places) are a pure regrouping of item_category values that already exist and
-- need nothing here. This migration exists only for the sixth, member-named
-- group, which needs somewhere to keep the name the member chose.
--
-- WHY A COLUMN RATHER THAN AN ENCODING
-- ------------------------------------
-- profile_items carries exactly three member-supplied text fields — title,
-- description and url — and a favourite already spends all three on
-- name / note / link. The group's name is a fourth value with nowhere to
-- live. Every encoding alternative corrupts a reader that is already using
-- those fields: putting the name in `title` changes what the MCP profile
-- tools and the gift recommender return, and `url` is rejected outright by
-- sanitiseUrl unless it is http(s). An additive nullable column costs one
-- DDL and leaves every existing reader untouched.
--
-- WHY A SEPARATE ENUM VALUE TOO
-- -----------------------------
-- Custom items could technically be stored under an existing favourites
-- category, but then a "Board games" entry would read as a book to the MCP
-- tools, the recommender and search. Their own category means an unfamiliar
-- reader skips them rather than mis-filing them. Reusing a spare value was
-- ruled out: `likes` is still live in the legacy wizard and feeds the gift
-- recommender (src/lib/recommend/preferences.ts), and `favourite_venues`
-- belongs to Convene.
--
-- Additive and reversible. No backfill, no data migration, no new table (so
-- no RLS obligation — profile_items keeps the policies it already has, which
-- cover this column automatically because they are row-scoped).
--
-- Rollback:
--   alter table public.profile_items drop column if exists group_label;
--   -- the enum value cannot be dropped in place; leaving 'favourite_custom'
--   -- unused is harmless (this is why the enum add is `if not exists`).

-- Note: `alter type ... add value` may not be USED in the same transaction
-- that adds it. Nothing below uses it — the column add is independent DDL —
-- so the two statements sit safely in one migration.
alter type public.item_category add value if not exists 'favourite_custom';

alter table public.profile_items
  add column if not exists group_label text;

comment on column public.profile_items.group_label is
  'KAN-444: member-supplied heading for a custom favourites group. Only read for category = favourite_custom; NULL everywhere else.';
