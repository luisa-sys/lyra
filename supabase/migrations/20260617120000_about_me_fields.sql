-- KAN-263: Profile redesign — add the two missing "To understand me a little
-- better" boxes to profile_manual_of_me.
--
-- The redesign's "About me" section is six prompts (F3.1–F3.6). Four already
-- exist on profile_manual_of_me (communication_style, working_preferences,
-- energises_me, drains_me); this adds the remaining two:
--   - good_to_know  (F3.1) — "Good to know about me"
--   - boundaries    (F3.2) — "My boundaries"
--
-- Additive + nullable; no backfill needed. Same RLS as the rest of the table.
-- (The two existing fields are also being RE-LABELLED in the editor — that's a
-- UI-only change in a later phase; the column names stay as-is.)
--
-- Rollback:
--   alter table public.profile_manual_of_me
--     drop column if exists good_to_know,
--     drop column if exists boundaries;

alter table public.profile_manual_of_me
  add column if not exists good_to_know text,
  add column if not exists boundaries text;
