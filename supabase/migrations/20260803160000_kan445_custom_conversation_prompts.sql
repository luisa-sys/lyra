-- ============================================================================
-- KAN-445 — "A bit more about me": the founder's ten prompts + three
--           member-written questions.
-- ============================================================================
--
-- WHAT THE LIVE DATA ACTUALLY LOOKED LIKE BEFORE THIS RAN (read 2026-08-03)
-- -------------------------------------------------------------------------
-- `conversation_starter_prompts` held the SAME eight generic prompts, all
-- active, on dev / staging / production — the 2026-05-16 seed, never revised:
--
--     A book that changed how I think            (10)
--     The best advice I've ever received         (20)
--     A skill I'm practising right now           (30)
--     Something I've changed my mind about recently (40)
--     A small thing that makes my day            (50)
--     A question I'm sitting with                (60)
--     What I wish more people asked me           (70)
--     A weird hobby of mine                      (80)
--
-- The founder's own set — recorded in "Lyra-Profile-Mockups-Questions-and-
-- Answers.docx" ("The set questions people can answer") and in
-- "Lyra-Profile-Content-Spec.docx" §8 — never reached the database. Two of the
-- eight ("The best advice I've ever received", "Something I've changed my mind
-- about recently") ARE in the founder's set and are kept, re-ordered; the other
-- six are retired.
--
-- RETIRE, NEVER DELETE. `profile_conversation_starters.prompt_id` is a FK onto
-- these rows, so deleting a prompt would either fail or orphan a member's saved
-- answer. Retirement is `is_active = false`, which the editor query already
-- filters on (`.eq('is_active', true)`), so a retired prompt stops being
-- OFFERED while every existing answer keeps rendering.
--
-- CUSTOM QUESTIONS. The old model FORBADE them: `prompt_id` was `not null` and
-- there was no column for member-supplied question text. This migration drops
-- that NOT NULL, adds `custom_prompt`, and adds an XOR check so a row is either
-- a seeded prompt or a member-written one — never both, never neither.
--
-- `unique (profile_id, prompt_id)` is NULLS DISTINCT (verified on dev:
-- `pg_index.indnullsnotdistinct = false`), so several custom rows per profile
-- do not collide on it. The three-custom cap is enforced by its own trigger.
--
-- ⚠️ THE TOTAL ANSWER CAP IS DELIBERATELY UNTOUCHED HERE.
-- `public.enforce_pcs_cap()` is left exactly as it is, in every environment.
-- Raising the production cap is an open founder decision and is out of scope,
-- so this migration adds a SECOND, independent trigger for the custom subset
-- rather than rewriting `enforce_pcs_cap()` with a hard-coded total. Rewriting
-- it would bake one number into every environment the migration reaches, which
-- is precisely the change that is not ours to make. Seeded-prompt behaviour is
-- therefore preserved by construction, not by careful copying.
--
-- (For the record, and NOT acted on here: `enforce_pcs_cap()` currently reads
-- `>= 10` on dev, staging AND production, even though
-- 20260704130000_raise_pcs_cap_to_10.sql is headed "prod: DO NOT APPLY".
-- Verified 2026-08-03 via `pg_get_functiondef` on all three projects.)
--
-- Safe to apply to dev, staging and production on the normal promotion chain:
-- nothing below changes an existing row's meaning, and the new column is
-- nullable.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   drop trigger if exists pcs_custom_cap on public.profile_conversation_starters;
--   drop function if exists public.enforce_pcs_custom_cap();
--   alter table public.profile_conversation_starters
--     drop constraint if exists pcs_prompt_source_xor;
--   alter table public.profile_conversation_starters
--     drop constraint if exists pcs_custom_prompt_length;
--   -- Only after moving/removing any custom rows, which have prompt_id null:
--   --   delete from public.profile_conversation_starters where prompt_id is null;
--   alter table public.profile_conversation_starters
--     drop column if exists custom_prompt;
--   alter table public.profile_conversation_starters
--     alter column prompt_id set not null;
--   drop index if exists public.conversation_starter_prompts_prompt_key;
--   -- Restore the previous offered set (no prompt row was deleted):
--   update public.conversation_starter_prompts set is_active = true;
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Give the seed an idempotency key.
--    The table had no unique constraint on `prompt`, so `on conflict do
--    nothing` had nothing to conflict ON and a re-run would have duplicated
--    every row. All three environments hold 8 distinct prompts today, so this
--    index builds cleanly.
-- ---------------------------------------------------------------------------
create unique index if not exists conversation_starter_prompts_prompt_key
  on public.conversation_starter_prompts (prompt);

-- ---------------------------------------------------------------------------
-- 2. Seed the founder's ten prompts. Idempotent: the two that already exist
--    are skipped here and re-ordered in step 3.
-- ---------------------------------------------------------------------------
insert into public.conversation_starter_prompts (prompt, sort_order) values
  ('If you could invite anyone, living or dead, to a dinner party — who would you have?', 10),
  ('What are you most proud of that wouldn''t make it onto your CV?', 20),
  ('If you could have any job — real or not — what would it be?', 30),
  ('Skills I''m trying to learn', 40),
  ('Something I''ve changed my mind about recently', 50),
  ('What qualities do you most appreciate in your closest friends?', 60),
  ('The best advice I''ve ever received', 70),
  ('If you could master any skill instantly, what would it be?', 80),
  ('What''s a small, daily act of kindness that usually goes unappreciated?', 90),
  ('What''s your best childhood memory?', 100)
on conflict (prompt) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Activate and order the canonical ten. This is what makes the two
--    survivors land in the founder's order rather than their 2026-05 order,
--    and it re-activates any of the ten a previous run had retired.
-- ---------------------------------------------------------------------------
update public.conversation_starter_prompts p
   set is_active  = true,
       sort_order = v.sort_order
  from (values
    ('If you could invite anyone, living or dead, to a dinner party — who would you have?', 10),
    ('What are you most proud of that wouldn''t make it onto your CV?', 20),
    ('If you could have any job — real or not — what would it be?', 30),
    ('Skills I''m trying to learn', 40),
    ('Something I''ve changed my mind about recently', 50),
    ('What qualities do you most appreciate in your closest friends?', 60),
    ('The best advice I''ve ever received', 70),
    ('If you could master any skill instantly, what would it be?', 80),
    ('What''s a small, daily act of kindness that usually goes unappreciated?', 90),
    ('What''s your best childhood memory?', 100)
  ) as v(prompt, sort_order)
 where p.prompt = v.prompt
   and (p.is_active is distinct from true or p.sort_order is distinct from v.sort_order);

-- ---------------------------------------------------------------------------
-- 4. Retire everything else. NO DELETE — answers reference these rows.
-- ---------------------------------------------------------------------------
update public.conversation_starter_prompts
   set is_active = false
 where is_active is distinct from false
   and prompt not in (
     'If you could invite anyone, living or dead, to a dinner party — who would you have?',
     'What are you most proud of that wouldn''t make it onto your CV?',
     'If you could have any job — real or not — what would it be?',
     'Skills I''m trying to learn',
     'Something I''ve changed my mind about recently',
     'What qualities do you most appreciate in your closest friends?',
     'The best advice I''ve ever received',
     'If you could master any skill instantly, what would it be?',
     'What''s a small, daily act of kindness that usually goes unappreciated?',
     'What''s your best childhood memory?'
   );

-- ---------------------------------------------------------------------------
-- 4b. Keep retired prompts READABLE by the members who answered them.
--
-- Retiring a prompt in step 4 removes it from the OFFERED list, which is the
-- intent. But the only select policy on this table is `using (is_active =
-- true)`, and both editors read the question text for a SAVED answer through
-- the RLS-scoped cookie client via a PostgREST embedded resource — which RLS
-- filters. So without this, every member who answered one of the retired
-- prompts opens their editor and sees their own answer with NO question above
-- it, un-labelled and unidentifiable, while the PUBLIC profile still shows the
-- question correctly (that page uses the service-role client, which bypasses
-- RLS). The editor and the live profile would disagree.
--
-- Policies for the same command are OR'd, so this only ADDS visibility: a
-- member may read a prompt that one of their OWN answers references. It grants
-- nothing about anyone else's answers, and nothing about prompts they have not
-- answered.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'conversation_starter_prompts'
       and policyname = 'Members can read prompts their own answers reference'
  ) then
    create policy "Members can read prompts their own answers reference"
      on public.conversation_starter_prompts
      for select
      using (
        exists (
          select 1
            from public.profile_conversation_starters pcs
            join public.profiles p on p.id = pcs.profile_id
           where pcs.prompt_id = conversation_starter_prompts.id
             and p.user_id = auth.uid()
        )
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Allow a member-written question.
-- ---------------------------------------------------------------------------
alter table public.profile_conversation_starters
  alter column prompt_id drop not null;

alter table public.profile_conversation_starters
  add column if not exists custom_prompt text;

-- 140 chars mirrors the founder spec's "up to 20 words" guide for F8.8a/9a/10a
-- and matches the application-side cap in conversation-starters-fields.ts.
alter table public.profile_conversation_starters
  drop constraint if exists pcs_custom_prompt_length;
alter table public.profile_conversation_starters
  add constraint pcs_custom_prompt_length
  check (
    custom_prompt is null
    or (length(custom_prompt) <= 140 and length(btrim(custom_prompt)) > 0)
  );

-- Exactly one source of the question. Without this, a row could carry both a
-- seeded prompt and a member-written one (which renders twice) or neither
-- (which renders an answer with no question above it).
alter table public.profile_conversation_starters
  drop constraint if exists pcs_prompt_source_xor;
alter table public.profile_conversation_starters
  add constraint pcs_prompt_source_xor
  check ((prompt_id is null) <> (custom_prompt is null));

-- ---------------------------------------------------------------------------
-- 6. Cap member-written questions at three, independently of the total cap.
--
--    `id <> new.id` makes one function correct for both INSERT (where new.id
--    is not yet in the table, so nothing is excluded) and UPDATE (where the
--    row must not count itself). The UPDATE arm matters: without it, a member
--    could sidestep the cap by inserting seeded rows and then flipping them to
--    custom.
--
--    Not SECURITY DEFINER — it only reads the table the caller is already
--    writing, so it needs no elevation, and RLS still applies to the caller's
--    own statement. EXECUTE is revoked anyway (gotcha #26 / BUGS-48/65/69):
--    trigger functions fire on the table privilege, not on EXECUTE of the
--    function, and PostgREST cannot supply TriggerData via /rpc.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_pcs_custom_cap()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.prompt_id is null then
    if (
      select count(*)
        from public.profile_conversation_starters
       where profile_id = new.profile_id
         and prompt_id is null
         and id <> new.id
    ) >= 3 then
      raise exception 'Custom question limit (3) reached';
    end if;
  end if;
  return new;
end$$;

revoke execute on function public.enforce_pcs_custom_cap() from public, anon, authenticated;
grant execute on function public.enforce_pcs_custom_cap() to service_role;

drop trigger if exists pcs_custom_cap on public.profile_conversation_starters;
create trigger pcs_custom_cap
  before insert or update on public.profile_conversation_starters
  for each row execute function public.enforce_pcs_custom_cap();
