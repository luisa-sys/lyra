-- KAN-484 (epic KAN-482) — v0.8 §09 question bank.
--
-- Spec v0.8 (20 Nov 2026) §09 "Random Questions & Answers":
--   * 16 active predefined questions at launch, plus up to 10 user-created
--     questions. The active preset count is configurable, never hard-coded.
--   * Each preset has a permanent ID, exact wording, answer limit, active
--     flag and display order. Answers refer to the permanent ID.
--   * Deactivating a preset NEVER removes existing answers; reactivation
--     must not duplicate or misassign answers; a substantive rewrite uses a
--     new question ID.
--   * User-created question max 180 chars; answer max 500; up to 10.
-- Founder decision 2026-11-22: the bank is managed from an admin screen.
--
-- How this migration satisfies those rules:
--   * The permanent ID is the existing `conversation_starter_prompts.id`
--     (uuid). Rows are never deleted (no DELETE policy; service-role only,
--     and the admin screen offers no delete), so an answer's prompt_id always
--     resolves to the wording it was given against.
--   * New column `answer_max` holds the per-question limit; a trigger on
--     profile_conversation_starters enforces it server-side.
--   * The 16 v0.8 presets are inserted as NEW rows (new permanent IDs). Every
--     other existing prompt is deactivated, not deleted, so answers given to
--     them stay valid and visible (v0.8 "IMPORTANT" paragraph).
--   * The old total-answer cap (enforce_pcs_cap, 10) is removed: v0.8 allows
--     every active preset plus 10 custom questions, and previously answered
--     inactive presets may remain on top, so "active + 10" is explicitly NOT a
--     hard ceiling. One answer per (profile, prompt) is still guaranteed by
--     the existing unique constraint, which is what prevents duplicates on
--     reactivation.
--   * Custom question cap 3 -> 10, custom question length 140 -> 180.
--   * Table-level answer check widened from 500 to 2000 so per-question limits
--     (up to 1000 in v0.8) can be expressed; the real limit is the trigger.
--
-- Rollback (manual):
--   drop trigger if exists pcs_answer_max on public.profile_conversation_starters;
--   drop function if exists public.enforce_pcs_answer_max();
--   alter table public.conversation_starter_prompts drop column if exists answer_max;
--   -- then re-run 20260704130000 / 20260803160000 to restore the 10/3/140 caps.

-- ============================================================
-- 1. Per-question answer limit.
-- ============================================================
alter table public.conversation_starter_prompts
  add column if not exists answer_max integer not null default 500;

alter table public.conversation_starter_prompts
  drop constraint if exists csp_answer_max_range;
alter table public.conversation_starter_prompts
  add constraint csp_answer_max_range check (answer_max between 50 and 2000);

alter table public.conversation_starter_prompts
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists on_csp_updated on public.conversation_starter_prompts;
create trigger on_csp_updated before update on public.conversation_starter_prompts
  for each row execute function public.handle_updated_at();

-- ============================================================
-- 2. Seed the 16 v0.8 presets (new permanent IDs) and deactivate the rest.
-- ============================================================
insert into public.conversation_starter_prompts (prompt, sort_order, answer_max, is_active) values
  ('Who you’d invite for a dinner party, dead or alive?', 10, 350, true),
  ('What do you think of when you hear the word ‘successful’?', 20, 500, true),
  ('What’s a question you wish people asked you more often?', 30, 350, true),
  ('If you could become an expert in anything overnight, what would you choose?', 40, 350, true),
  ('If you could have a different career and money was irrelevant, what would it be?', 50, 500, true),
  ('What are the places you want to go?', 60, 350, true),
  ('If you could witness any moment in history, which would it be?', 70, 500, true),
  ('What don’t you leave the house with?', 80, 200, true),
  ('What’s the most niche topic you could talk about for 10 minutes with no preparation?', 90, 350, true),
  ('Which ordinary task do you take far too seriously?', 100, 350, true),
  ('Which fictional character would you trust to house-sit for a week?', 110, 350, true),
  ('Who helped shape who you are today?', 120, 500, true),
  ('Which song can change your mood instantly?', 130, 250, true),
  ('Describe your perfect day, start to finish.', 140, 1000, true),
  ('What tradition, from your family or your own, do you love?', 150, 500, true),
  ('What failure set you up for something better later?', 160, 750, true)
on conflict (prompt) do update
  set is_active  = true,
      sort_order = excluded.sort_order,
      answer_max = excluded.answer_max;

update public.conversation_starter_prompts
   set is_active = false
 where is_active is distinct from false
   and prompt not in (
     'Who you’d invite for a dinner party, dead or alive?',
     'What do you think of when you hear the word ‘successful’?',
     'What’s a question you wish people asked you more often?',
     'If you could become an expert in anything overnight, what would you choose?',
     'If you could have a different career and money was irrelevant, what would it be?',
     'What are the places you want to go?',
     'If you could witness any moment in history, which would it be?',
     'What don’t you leave the house with?',
     'What’s the most niche topic you could talk about for 10 minutes with no preparation?',
     'Which ordinary task do you take far too seriously?',
     'Which fictional character would you trust to house-sit for a week?',
     'Who helped shape who you are today?',
     'Which song can change your mood instantly?',
     'Describe your perfect day, start to finish.',
     'What tradition, from your family or your own, do you love?',
     'What failure set you up for something better later?'
   );

-- ============================================================
-- 3. Answers: widen the table check; enforce the per-question limit.
-- ============================================================
alter table public.profile_conversation_starters
  drop constraint if exists profile_conversation_starters_answer_check;
alter table public.profile_conversation_starters
  drop constraint if exists pcs_answer_length;
alter table public.profile_conversation_starters
  add constraint pcs_answer_length
  check (length(answer) <= 2000 and length(btrim(answer)) > 0);

create or replace function public.enforce_pcs_answer_max()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_max integer;
begin
  if new.prompt_id is null then
    v_max := 500;                         -- user-created question answer limit
  else
    select answer_max into v_max
      from public.conversation_starter_prompts
     where id = new.prompt_id;
    if v_max is null then
      raise exception 'Unknown question';
    end if;
  end if;
  if length(new.answer) > v_max then
    raise exception 'Answer is longer than % characters', v_max;
  end if;
  return new;
end$$;

revoke execute on function public.enforce_pcs_answer_max() from public, anon, authenticated;
grant execute on function public.enforce_pcs_answer_max() to service_role;

drop trigger if exists pcs_answer_max on public.profile_conversation_starters;
create trigger pcs_answer_max before insert or update on public.profile_conversation_starters
  for each row execute function public.enforce_pcs_answer_max();

-- ============================================================
-- 4. Remove the total-answer cap; raise the custom cap to 10 and the
--    custom question length to 180.
-- ============================================================
drop trigger if exists pcs_cap on public.profile_conversation_starters;
drop function if exists public.enforce_pcs_cap();

alter table public.profile_conversation_starters
  drop constraint if exists pcs_custom_prompt_length;
alter table public.profile_conversation_starters
  add constraint pcs_custom_prompt_length
  check (
    custom_prompt is null
    or (length(custom_prompt) <= 180 and length(btrim(custom_prompt)) > 0)
  );

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
    ) >= 10 then
      raise exception 'Custom question limit (10) reached';
    end if;
  end if;
  return new;
end$$;

revoke execute on function public.enforce_pcs_custom_cap() from public, anon, authenticated;
grant execute on function public.enforce_pcs_custom_cap() to service_role;
