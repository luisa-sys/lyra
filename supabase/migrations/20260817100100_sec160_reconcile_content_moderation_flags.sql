-- SEC-160 — reconciliation migration: content_moderation_flags
--
-- Companion to 20260817100000_sec160_reconcile_mcp_tool_call_log.sql. Same
-- situation: the table exists on dev, staging and production, was applied out
-- of band under the ledger name `kan_244_content_moderation_flags`, and has no
-- CREATE TABLE anywhere in this repo. Confirmed 2026-08-17.
--
-- Every statement is guarded so that applying this to an existing database is a
-- NO-OP and applying it to an empty one produces the table. See the companion
-- file's header for why both paths matter.
--
-- ⚠️ FIDELITY, NOT IMPROVEMENT — this reproduces production exactly as measured.
--
-- Rollback: `drop table if exists public.content_moderation_flags;`. Note the
-- FK to profiles is ON DELETE CASCADE, so dropping profiles rows removes their
-- flags; that is production's current behaviour, recorded here, not chosen here.

create table if not exists public.content_moderation_flags (
  id              uuid        not null default gen_random_uuid(),
  profile_id      uuid,
  field           text        not null,
  severity        text        not null,
  flags           text[]      not null,
  content_snippet text        not null,
  source          text        not null,
  created_at      timestamptz not null default now(),
  constraint content_moderation_flags_pkey primary key (id),
  constraint content_moderation_flags_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete cascade,
  constraint content_moderation_flags_severity_check
    check (severity = any (array['warn'::text, 'block'::text])),
  constraint content_moderation_flags_source_check
    check (source = any (array['web_app'::text, 'mcp_server'::text])),
  -- The 200-char cap is a data-protection control, not a display convenience:
  -- this column holds a snippet of user-authored text that tripped moderation,
  -- so it is personal data and the bound limits how much is retained.
  constraint content_moderation_flags_content_snippet_check
    check (length(content_snippet) <= 200)
);

create index if not exists idx_content_moderation_flags_profile_ts
  on public.content_moderation_flags using btree (profile_id, created_at desc);

create index if not exists idx_content_moderation_flags_severity_ts
  on public.content_moderation_flags using btree (severity, created_at desc);

alter table public.content_moderation_flags enable row level security;

-- The ONE policy production carries. It is load-bearing: it is what lets a
-- member read their own flags at /dashboard/settings (see
-- src/app/dashboard/settings/actions.ts) through their authenticated client,
-- while denying them everyone else's.
--
-- Note what is NOT here: no INSERT, UPDATE or DELETE policy. With RLS enabled
-- that means those operations are denied to anon and authenticated outright,
-- and the only writer is service_role (src/modules/audit/moderation-audit.ts),
-- which bypasses RLS. That absence is the protection — do not add write
-- policies to "complete the set".
--
-- `create policy` has no IF NOT EXISTS in the Postgres versions this repo
-- targets, so it is guarded by catalogue lookup to keep the file idempotent.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'content_moderation_flags'
      and policyname = 'own_flags_select'
  ) then
    create policy own_flags_select
      on public.content_moderation_flags
      for select
      using (
        profile_id is not null
        and profile_id in (
          select profiles.id from public.profiles
          where profiles.user_id = auth.uid()
        )
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- ⚠️ SAME KNOWN GAP AS THE COMPANION FILE, deliberately not closed here.
--
-- `anon` and `authenticated` hold full DML on this table via Supabase's default
-- privileges (gotcha #26). RLS denies the writes and scopes the reads, so it is
-- not currently exploitable — but `content_snippet` is user-authored personal
-- data and the protection again rests on a single mechanism.
--
-- The revoke belongs on the dev -> staging -> prod path with the writers
-- verified, not in a migration whose job is to record what already exists.
-- ---------------------------------------------------------------------------
