-- KAN-175: beta-tester flag for the upcoming beta.checklyra.com env
--
-- Adds a single boolean column on profiles. The middleware (when running on
-- the beta deploy with IS_BETA_DEPLOY=true) reads this column and redirects
-- users without the flag to /waitlist.
--
-- Default false: every new signup AND every existing user starts as
-- non-beta-eligible. The flag is flipped manually from the Supabase dashboard
-- (or via a small admin UI later) when a tester is approved.
--
-- Idempotent: uses `if not exists` so re-running on a project where the
-- column already exists is a no-op. Safe to apply across dev / stage / prod
-- (only prod actually consults it via beta deploy, but having the column
-- everywhere keeps schemas aligned).
--
-- Rollback: `ALTER TABLE public.profiles DROP COLUMN is_beta_eligible;`

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_beta_eligible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_beta_eligible IS
  'KAN-175: when true, allows the user to access beta.checklyra.com. '
  'Default false; flip per-user via Supabase dashboard.';

-- Index for the middleware lookup. The query is `eq('user_id', X) select is_beta_eligible`.
-- profiles already has an index on user_id, so we don't need a new index — the
-- existing one covers the lookup. Documenting that decision here.
