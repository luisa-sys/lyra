-- KAN-198: structured recommender-input fields on profiles.
--
-- Per docs/RECOMMENDER_INPUTS.md, the V2 recommender (KAN-139 / KAN-199)
-- needs two new persistent fields on a recipient profile beyond what already
-- exists today: a bucketed age range (NOT a DOB) and a flexible JSONB bag
-- for dietary / allergies / sizes / dislikes etc.
--
-- Both are nullable. Sparse profiles continue to work — the recommender
-- falls back to V1's existing free-text inference when these are unset.
--
-- AADC note: age_range is intentionally a bucket, NOT a date of birth.
-- For under-13 profiles (KAN-155 / KAN-164) the bucket is the only age
-- information stored, keeping us aligned with the Age Appropriate Design
-- Code minimum-data principle.
--
-- Rollback (one-time, do not include in migration body):
--   alter table public.profiles drop column if exists age_range;
--   alter table public.profiles drop column if exists recipient_attributes;

alter table public.profiles
  add column if not exists age_range text
    check (
      age_range is null or
      age_range in ('0_5', '6_12', '13_17', '18_29', '30_44', '45_64', '65_plus')
    );

alter table public.profiles
  add column if not exists recipient_attributes jsonb not null default '{}'::jsonb;

comment on column public.profiles.age_range is
  'Bucketed age band for the recipient. Buckets aligned with KAN-198 / docs/RECOMMENDER_INPUTS.md. NULL = unknown. NOT a DOB — AADC minimum-data principle.';

comment on column public.profiles.recipient_attributes is
  'JSONB bag for structured recipient attributes used by the V2 recommender — dietary, allergies, sizes, dislikes_text, etc. Schema in docs/RECOMMENDER_INPUTS.md. No PII or regulated data.';
