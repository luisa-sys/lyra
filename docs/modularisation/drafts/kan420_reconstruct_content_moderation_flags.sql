-- KAN-420 DRAFT — do NOT apply. Reconstruction of the out-of-band object
-- created by applied migration `kan_244_content_moderation_flags` (no git file).
-- Captured 2026-07-27 from dev; fingerprint-identical on staging and prod
-- (see docs/modularisation/KAN-420-migration-parity.md §6).
-- Verify per §6 protocol (Supabase branch + fingerprint diff) before this file
-- moves into supabase/migrations/ under F7.
-- Rollback: drop table public.content_moderation_flags; (moderation data loss —
-- requires explicit sign-off; table is repopulated by the moderation pipeline.)

create table if not exists public.content_moderation_flags (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  field text not null,
  severity text not null constraint content_moderation_flags_severity_check
    check (severity = any (array['warn'::text, 'block'::text])),
  flags text[] not null,
  content_snippet text not null constraint content_moderation_flags_content_snippet_check
    check (length(content_snippet) <= 200),
  source text not null constraint content_moderation_flags_source_check
    check (source = any (array['web_app'::text, 'mcp_server'::text])),
  created_at timestamptz not null default now()
);

create index if not exists idx_content_moderation_flags_profile_ts
  on public.content_moderation_flags (profile_id, created_at desc);
create index if not exists idx_content_moderation_flags_severity_ts
  on public.content_moderation_flags (severity, created_at desc);

alter table public.content_moderation_flags enable row level security;

drop policy if exists own_flags_select on public.content_moderation_flags;
create policy own_flags_select on public.content_moderation_flags
  for select using (
    profile_id is not null
    and profile_id in (select profiles.id from public.profiles where profiles.user_id = auth.uid())
  );

-- Live ACL (all three envs): full table grants to anon/authenticated/service_role;
-- RLS is the effective gate for anon/authenticated.
grant all on table public.content_moderation_flags to anon, authenticated, service_role;
