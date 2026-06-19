-- KAN-263: Profile redesign — affiliations gain an optional short description
-- and a per-row "show on my profile" flag.
--
-- Redesign decisions (F2.c / F2.d, spec D12): schools / organisations /
-- communities are used to help people FIND you in search, but are HIDDEN on
-- the public profile by default. `show_on_profile` (default false) opts a
-- single affiliation in. `description` is a short free-text note
-- ("Class of 2008"), shown only when the affiliation is visible.
--
-- Additive: `description` is nullable; `show_on_profile` is NOT NULL DEFAULT
-- false, so existing rows backfill to hidden — the privacy-safe default the
-- redesign wants. NOTE: this column has no effect until the public-profile
-- render + Find-Someone logic start reading it (later phase); on its own this
-- migration changes nothing a visitor sees.
--
-- Rollback:
--   alter table public.school_affiliations
--     drop column if exists description,
--     drop column if exists show_on_profile;

alter table public.school_affiliations
  add column if not exists description text,
  add column if not exists show_on_profile boolean not null default false;
