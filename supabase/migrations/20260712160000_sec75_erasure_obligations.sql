-- SEC-75 leg (b) — record-only erasure obligations (findings compliance-08/09, UK-GDPR Art. 17)
-- Epic KAN-350 (2026-06-30 codebase review).
--
-- What & why: on account deletion the auth.users cascade erases everything we
-- hold in Postgres, but copies still live in EXTERNAL processors (Resend
-- transactional-email logs, Didit biometric verification, Google Calendar OAuth)
-- and in Cloudflare KV (waitlist email). Luisa chose the RECORD-ONLY approach
-- (founder-directed 2026-07-12): rather than call each processor's delete API
-- inline from deleteAccount(), we persist a durable erasure-obligation record so
-- an ops follow-up (which holds the KV/processor write creds) can action and
-- close each obligation. This makes the Art. 17 propagation duty auditable
-- instead of prose-only.
--
-- Apply order: dev -> staging -> prod (supervised; the autopilot applies DEV
-- only, per house rule #4 "no prod DB writes"). All statements are idempotent.
--
-- Rollback:
--   drop function if exists public.record_erasure_obligation(uuid, text, text[], text);
--   drop table if exists public.erasure_obligations;

-- ============================================================================
-- Table — erasure_obligations
-- ============================================================================
-- Deliberately holds NO foreign key to auth.users: the row must SURVIVE the
-- hard-delete of the very user it describes (otherwise the cascade would erase
-- the obligation we just created). subject_user_id / subject_email are captured
-- as plain values at deletion time.
create table if not exists public.erasure_obligations (
  id              uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  subject_email   text,
  processors      text[] not null default '{}',
  status          text not null default 'pending'
                    check (status in ('pending', 'completed', 'not_applicable')),
  notes           text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on table public.erasure_obligations is
  'SEC-75 leg (b): record-only log of external processor / KV copies still to be erased after an account is hard-deleted. Contains residual PII (email of a deleted user) — service-role only, never exposed to anon/authenticated. Ops actions + closes each row.';

create index if not exists erasure_obligations_status_idx
  on public.erasure_obligations (status)
  where status = 'pending';

-- ============================================================================
-- RLS — deny anon/authenticated entirely; only the service role (which bypasses
-- RLS) and the SECURITY DEFINER writer function below may touch it.
-- ============================================================================
alter table public.erasure_obligations enable row level security;
-- No policies are created for anon/authenticated, so RLS denies them by default.
-- Belt-and-braces: revoke table privileges too (a missing policy already denies,
-- but this keeps the grant surface explicit and matches the SEC-56 pattern).
revoke all on table public.erasure_obligations from anon, authenticated;

-- ============================================================================
-- Writer — record_erasure_obligation(...)
-- ============================================================================
-- SECURITY DEFINER so the single insert path is auditable and the caller needs
-- only EXECUTE (granted to service_role). Pinned empty search_path +
-- schema-qualified body per the SEC-54 hardening convention.
create or replace function public.record_erasure_obligation(
  p_subject_user_id uuid,
  p_subject_email   text,
  p_processors      text[],
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if p_subject_user_id is null then
    raise exception 'record_erasure_obligation: subject_user_id is required';
  end if;
  insert into public.erasure_obligations
    (subject_user_id, subject_email, processors, notes)
  values
    (p_subject_user_id, p_subject_email, coalesce(p_processors, '{}'), p_notes)
  returning id into v_id;
  return v_id;
end;
$function$;

-- Only the service role may record obligations (deleteAccount runs under the
-- admin service-role client). Strip the inherited default PUBLIC EXECUTE grant.
revoke execute on function public.record_erasure_obligation(uuid, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.record_erasure_obligation(uuid, text, text[], text)
  to service_role;
