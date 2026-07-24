-- KAN-275: Beta access queue — schema for the beta access programme (KAN-273).
--
-- Adds a request→approve lifecycle to public.profiles so users who sign up on
-- production checklyra.com can be marked as having "requested" beta access,
-- routed to beta.checklyra.com (where the existing IS_BETA_DEPLOY middleware
-- shows /waitlist), and later "approved" by an admin in /admin/beta-queue.
--
-- Design:
--   * `beta_access_status` enum: 'none' (default — has not asked) → 'requested'
--     (signed up, in the queue) → 'approved' (admin let them in).
--   * `beta_requested_at` / `beta_approved_at` timestamps for ordering the
--     queue and for auditing.
--   * The existing boolean `is_beta_eligible` is kept as the gate the beta
--     middleware already reads; approval sets BOTH `beta_access_status` and
--     `is_beta_eligible=true`. The backfill below reconciles any profile that
--     was already made eligible before this programme existed.
--
-- Additive only — no DROP, no data loss. Safe to run more than once
-- (every statement is idempotent / guarded).
--
-- Rollback:
--   alter table public.profiles
--     drop column if exists beta_access_status,
--     drop column if exists beta_requested_at,
--     drop column if exists beta_approved_at;
--   drop index if exists public.profiles_beta_requested_idx;
--   drop type if exists beta_access_status;

-- 1. Enum type. Guarded so a re-run doesn't error on the existing type.
do $$
begin
  create type beta_access_status as enum ('none', 'requested', 'approved');
exception
  when duplicate_object then null;
end
$$;

-- 2. Columns on profiles. `if not exists` keeps this idempotent.
alter table public.profiles
  add column if not exists beta_access_status beta_access_status not null default 'none',
  add column if not exists beta_requested_at timestamptz,
  add column if not exists beta_approved_at timestamptz;

-- 3. Backfill: any profile already flagged eligible (pre-programme) is treated
--    as already approved so we don't bounce existing beta testers back to the
--    queue. Only touches rows still at the default 'none'.
update public.profiles
set beta_access_status = 'approved',
    beta_approved_at = now()
where is_beta_eligible = true
  and beta_access_status = 'none';

-- 4. Partial index over the queue (status='requested'), ordered by request
--    time — this is exactly what /admin/beta-queue reads.
create index if not exists profiles_beta_requested_idx
  on public.profiles (beta_requested_at)
  where beta_access_status = 'requested';
