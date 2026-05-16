-- KAN-141: admin dashboard + reports + moderation tooling.
--
-- This migration is the schema half of KAN-141; the route + UI work follows
-- in subsequent PRs (KAN-141-B through KAN-141-H). After applying, bootstrap
-- the first admin manually via:
--
--   update public.profiles set is_admin = true where slug = '<your-slug>';
--
-- Rollback (run in reverse order):
--   drop policy if exists "Admins write moderation logs" on public.moderation_logs;
--   drop policy if exists "Admins read moderation logs" on public.moderation_logs;
--   drop policy if exists "Admins update reports" on public.reports;
--   drop policy if exists "Admins read reports" on public.reports;
--   drop policy if exists "Authenticated users can file reports" on public.reports;
--   drop table if exists public.moderation_logs;
--   drop table if exists public.reports;
--   drop type if exists public.report_status;
--   drop type if exists public.report_reason;
--   alter table public.profiles
--     drop column if exists is_admin,
--     drop column if exists is_suspended,
--     drop column if exists suspended_at,
--     drop column if exists suspension_reason;
--   drop policy if exists "Anyone can read published non-suspended profiles" on public.profiles;
--   create policy "Anyone can read published profiles" on public.profiles for select using (is_published = true);

-- ============================================================
-- 1. Extend profiles: admin flag + suspension state
-- ============================================================

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists is_suspended boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text;

-- Partial index — vast majority of rows have is_admin = false, so a normal
-- index would waste space. We only ever query "is this user an admin?",
-- which is exactly what a `where is_admin = true` partial covers.
create index if not exists profiles_is_admin_idx
  on public.profiles(is_admin) where is_admin = true;

create index if not exists profiles_is_suspended_idx
  on public.profiles(is_suspended) where is_suspended = true;

-- ============================================================
-- 2. Enums for reports
-- ============================================================

do $$ begin
  create type public.report_reason as enum (
    'spam',
    'harassment',
    'impersonation',
    'inappropriate',
    'other'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.report_status as enum (
    'pending',
    'reviewed',
    'actioned',
    'dismissed'
  );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 3. Reports table — user-filed reports against profiles or items
-- ============================================================

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Optional: report a single item rather than the whole profile. Both
  -- IDs are set when an item is reported (profile_id derived from the
  -- item's parent so we can index by profile too).
  profile_item_id uuid references public.profile_items(id) on delete cascade,
  -- `set null` rather than cascade so historical reports survive a user
  -- account deletion — moderation history is forever.
  reporter_user_id uuid references auth.users(id) on delete set null,
  reason public.report_reason not null,
  note text,
  status public.report_status not null default 'pending',
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reports_status_idx on public.reports(status);
create index if not exists reports_profile_id_idx on public.reports(profile_id);
create index if not exists reports_created_at_idx on public.reports(created_at desc);

-- ============================================================
-- 4. Moderation log — every admin action recorded, append-only
-- ============================================================

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  -- The admin who took the action. Not nullable — every entry must have
  -- a responsible party. If the user is later deleted, we keep the row
  -- (`set null` would orphan the audit; `cascade` would delete the
  -- audit trail). We don't expect admins to be deleted; if it ever
  -- happens, the FK constraint will block the delete and force a manual
  -- decision.
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete set null,
  target_item_id uuid references public.profile_items(id) on delete set null,
  -- Action strings (text rather than enum so adding new actions doesn't
  -- need a migration): suspend, unsuspend, delete_item, warn,
  -- resolve_report, dismiss_report, restore_item, grant_admin,
  -- revoke_admin. Validated in application code; DB is permissive so
  -- we can log unexpected actions for forensics rather than rejecting
  -- them.
  action text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists moderation_logs_actor_idx on public.moderation_logs(actor_user_id);
create index if not exists moderation_logs_target_profile_idx on public.moderation_logs(target_profile_id);
create index if not exists moderation_logs_created_idx on public.moderation_logs(created_at desc);

-- ============================================================
-- 5. RLS — reports
-- ============================================================

alter table public.reports enable row level security;

-- Anyone authenticated can file a report. reporter_user_id MUST match
-- the authenticated user — prevents impersonating other users as the
-- source of a report.
create policy "Authenticated users can file reports"
  on public.reports for insert
  to authenticated
  with check (auth.uid() = reporter_user_id);

-- Reporters can read their own reports (so a future "my reports" UI
-- works) but cannot see other people's reports.
create policy "Users read own reports"
  on public.reports for select
  to authenticated
  using (reporter_user_id = auth.uid());

-- Admins read all reports.
create policy "Admins read all reports"
  on public.reports for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where user_id = auth.uid() and is_admin = true
    )
  );

-- Admins update report status / resolution.
create policy "Admins update reports"
  on public.reports for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where user_id = auth.uid() and is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where user_id = auth.uid() and is_admin = true
    )
  );

-- ============================================================
-- 6. RLS — moderation_logs (admin read + write, no update / delete)
-- ============================================================

alter table public.moderation_logs enable row level security;

create policy "Admins read moderation logs"
  on public.moderation_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where user_id = auth.uid() and is_admin = true
    )
  );

create policy "Admins write moderation logs"
  on public.moderation_logs for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where user_id = auth.uid() and is_admin = true
    )
    and actor_user_id = auth.uid()
  );

-- Deliberately no UPDATE or DELETE policies — append-only audit trail.
-- Service-role bypasses RLS and can clean up if absolutely needed, but
-- regular admins cannot rewrite history.

-- ============================================================
-- 7. Profiles — suspended profiles are not public
-- ============================================================
-- Replace the "Anyone can read published profiles" policy with a tighter
-- version that also excludes suspended profiles. Owners can still read
-- their own (existing "Users can read own profile" policy) so they see
-- their suspended-state in the dashboard.

drop policy if exists "Anyone can read published profiles" on public.profiles;

create policy "Anyone can read published non-suspended profiles"
  on public.profiles for select
  using (is_published = true and is_suspended = false);

-- ============================================================
-- 8. Items / links / schools — also hidden when parent profile suspended
-- ============================================================
-- These existing "Anyone can read X from published profiles" policies
-- need the same is_suspended check so a suspended profile's content is
-- fully invisible to the public.

drop policy if exists "Anyone can read items from published profiles" on public.profile_items;
create policy "Anyone can read items from published non-suspended profiles"
  on public.profile_items for select
  using (
    exists (
      select 1 from public.profiles
      where id = profile_items.profile_id
        and is_published = true
        and is_suspended = false
    )
  );

drop policy if exists "Anyone can read links from published profiles" on public.external_links;
create policy "Anyone can read links from published non-suspended profiles"
  on public.external_links for select
  using (
    exists (
      select 1 from public.profiles
      where id = external_links.profile_id
        and is_published = true
        and is_suspended = false
    )
  );

drop policy if exists "Anyone can read schools from published profiles" on public.school_affiliations;
create policy "Anyone can read schools from published non-suspended profiles"
  on public.school_affiliations for select
  using (
    exists (
      select 1 from public.profiles
      where id = school_affiliations.profile_id
        and is_published = true
        and is_suspended = false
    )
  );
