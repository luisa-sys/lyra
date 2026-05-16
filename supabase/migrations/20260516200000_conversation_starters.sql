-- KAN-181: conversation-starter prompts (KAN-154 sub-feature D).
--
-- Two-table model:
--   * conversation_starter_prompts — admin-seeded reference list, ~8 rows.
--     Curated content the user picks from. Read-only to authenticated users;
--     write access is service-role only (no INSERT policy for 'authenticated')
--     so users cannot inject their own prompts.
--   * profile_conversation_starters — user's answers. FK to both `profiles`
--     and `conversation_starter_prompts`. Cap of 5 answered prompts per
--     profile (UI nudges + DB trigger enforces). Answer is sanitised
--     free text, 1-500 chars.
--
-- Why not reuse profile_items with a new category?
--   Because the curation matters. If users free-type their own "questions",
--   we lose the lightly-curated prompt library that makes this feature
--   distinct from the existing `questions` item_category ("Questions I
--   wish people asked"). FK to the reference table is the cleanest way
--   to keep the prompt list reviewable in one place.
--
-- Applied to all 3 envs on 2026-05-16:
--   dev    (ilprytcrnqyrsbsrfujj): ✓ via apply_migration
--   stage  (uobmlkzrjkptwhttzmmi): ✓ via apply_migration
--   prod   (llzkgprqewuwkiwclowi): ✓ via apply_migration

create table if not exists public.conversation_starter_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  category text,        -- optional grouping (work/personal/fun) — not used in v1
  sort_order integer default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Seed 8 prompts. Adding more later doesn't need a migration — just an
-- INSERT via SQL editor or a future admin UI.
insert into public.conversation_starter_prompts (prompt, sort_order) values
  ('A book that changed how I think', 10),
  ('The best advice I''ve ever received', 20),
  ('A skill I''m practising right now', 30),
  ('Something I''ve changed my mind about recently', 40),
  ('A small thing that makes my day', 50),
  ('A question I''m sitting with', 60),
  ('What I wish more people asked me', 70),
  ('A weird hobby of mine', 80)
on conflict do nothing;

create table if not exists public.profile_conversation_starters (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  prompt_id uuid references public.conversation_starter_prompts(id) not null,
  answer text not null check (length(answer) <= 500 and length(trim(answer)) > 0),
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- One answer per (profile, prompt). Stops accidental double-answers
  -- without needing application-level uniqueness checks.
  unique (profile_id, prompt_id)
);
create index if not exists pcs_profile_id_idx on public.profile_conversation_starters(profile_id);

-- updated_at autoupdater (reuses handle_updated_at from the base schema)
drop trigger if exists on_pcs_updated on public.profile_conversation_starters;
create trigger on_pcs_updated before update on public.profile_conversation_starters
  for each row execute function public.handle_updated_at();

-- 5-answer cap enforced at DB layer so UI can't be the only gate.
create or replace function public.enforce_pcs_cap()
returns trigger as $$
begin
  if (select count(*) from public.profile_conversation_starters where profile_id = new.profile_id) >= 5 then
    raise exception 'Conversation-starter answer limit (5) reached';
  end if;
  return new;
end$$ language plpgsql;

drop trigger if exists pcs_cap on public.profile_conversation_starters;
create trigger pcs_cap before insert on public.profile_conversation_starters
  for each row execute function public.enforce_pcs_cap();

-- RLS
alter table public.conversation_starter_prompts enable row level security;

drop policy if exists "Anyone can read active prompts" on public.conversation_starter_prompts;
create policy "Anyone can read active prompts"
  on public.conversation_starter_prompts for select
  using (is_active = true);
-- No INSERT/UPDATE/DELETE policies — service-role only.

alter table public.profile_conversation_starters enable row level security;

drop policy if exists "Users manage own starters" on public.profile_conversation_starters;
create policy "Users manage own starters"
  on public.profile_conversation_starters for all
  using (profile_id in (select id from public.profiles where user_id = auth.uid()))
  with check (profile_id in (select id from public.profiles where user_id = auth.uid()));

drop policy if exists "Anyone reads starters from published profiles" on public.profile_conversation_starters;
create policy "Anyone reads starters from published profiles"
  on public.profile_conversation_starters for select
  using (
    exists (
      select 1 from public.profiles
      where id = profile_conversation_starters.profile_id
        and is_published = true
        and is_suspended = false
    )
  );
