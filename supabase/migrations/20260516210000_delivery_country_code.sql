-- KAN-186: add delivery_country_code to profiles.
--
-- Per the KAN-185 geo-signal design, the recipient's delivery country is a
-- separate signal from the buyer's country: the buyer's country drives which
-- affiliate program receives the commission, while the recipient's delivery
-- country filters which products are eligible to recommend (e.g. don't surface
-- US-only items if the gift ships to Germany).
--
-- Why a new column rather than re-using existing `country`:
--   - `country` is freeform text (values seen in dev include 'GB', 'Crawley UK',
--     'United Kingdom') and is used for display, not filtering. Stricter typing
--     here would break existing rows.
--   - `delivery_country_code` is a strict ISO-3166 alpha-2 with a check
--     constraint at the DB level so the recommender + link service can safely
--     index on it.
--
-- NULL semantics: NULL means "unknown — fall back to buyer's country at query
-- time" per KAN-185. We do NOT backfill; existing recipients stay NULL.
--
-- Rollback (one-time, do not include in migration body):
--   alter table public.profiles drop column if exists delivery_country_code;

alter table public.profiles
  add column if not exists delivery_country_code text
    check (delivery_country_code is null or delivery_country_code ~ '^[A-Z]{2}$');

comment on column public.profiles.delivery_country_code is
  'ISO-3166 alpha-2 country where gifts for this profile should ship. NULL = unknown, fall back to buyer country at recommendation time (KAN-185 / KAN-186).';
