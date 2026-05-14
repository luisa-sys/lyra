-- KAN-154: "Manual of Me" — profile section describing how to work / interact with the user
--
-- Decision: 1-1 table `profile_manual_of_me` (rather than columns on `profiles`).
-- Rationale:
--   1. Keeps `profiles` lean — already has ~12 columns; adding 4 more text fields would
--      bloat every row read for callers that don't need this data.
--   2. Mirrors the existing pattern for optional profile sections (profile_items,
--      school_affiliations, external_links — all separate tables with profile_id FK).
--   3. RLS policy is identical to other profile sections, easy to reason about.
--   4. Easy to extend in v2 (additional fields) without touching the hot `profiles`
--      table or any migration to add NULLable columns.
--
-- Fields (4, tighter subset chosen for v1):
--   - communication_style   (max 500)  — how I like to be communicated with
--   - working_preferences   (max 1000) — best ways to work with me (longer free text)
--   - energises_me          (max 500)  — what gives me energy at work
--   - drains_me             (max 500)  — what drains my energy
--
-- Excluded for v1 (can be added later if user demand exists):
--   - "hot buttons"          — overlaps with existing `dislikes` and `boundaries` items
--   - "how I handle disagreement" — niche; not enough demand signal
--   - "preferred feedback style"  — possible v2 add
--
-- Rollback:
--   DROP TABLE IF EXISTS public.profile_manual_of_me CASCADE;

-- ============================================================
-- TABLE: profile_manual_of_me (1-1 with profiles)
-- ============================================================
create table public.profile_manual_of_me (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  communication_style text,
  working_preferences text,
  energises_me text,
  drains_me text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-update updated_at on row update
create trigger on_profile_manual_of_me_updated
  before update on public.profile_manual_of_me
  for each row execute function public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Same pattern as other profile-section tables:
--   - Owner can CRUD their own row
--   - Anyone can read rows belonging to published profiles
-- ============================================================
alter table public.profile_manual_of_me enable row level security;

create policy "Users can manage own manual_of_me"
  on public.profile_manual_of_me for all
  using (profile_id in (
    select id from public.profiles where user_id = auth.uid()
  ));

create policy "Anyone can read manual_of_me from published profiles"
  on public.profile_manual_of_me for select
  using (profile_id in (
    select id from public.profiles where is_published = true
  ));
