-- KAN-408: environment-scoped GLOBAL feature switches.
--
-- WHAT
--   An admin-managed, per-ENVIRONMENT on/off table so the back-office can switch
--   a feature ON/OFF for EVERY user in an environment (dev / staging / beta /
--   prod): Convene, paid referrals (paid_gift_links), age verification.
--
--   Effective gate at every call site is:
--     <existing env/credential gates>            (unchanged, fail-closed)
--     AND globalSwitch(environment, feature_key) (THIS table, default ON)
--     AND perUserEntitlement(user, feature)      (unchanged; inert + hidden when
--                                                  the global switch is off)
--   The AND makes an off switch un-overridable per user.
--
-- WHY keyed by (environment, feature_key)
--   beta.checklyra.com and checklyra.com SHARE this (prod-lyra) Supabase project
--   (CLAUDE.md gotcha #19) and are separated ONLY by IS_BETA_DEPLOY=true. A
--   single (feature_key) row could not hold a different value for beta vs prod,
--   so the environment is part of the key and is resolved at request time by
--   src/lib/deploy-env.ts getDeployEnv(). dev and staging each have their own
--   Supabase project, so their rows are naturally isolated; keying every env
--   uniformly avoids a special-case.
--
-- DEFAULT-ON
--   Absence of a row = ENABLED (see resolveGlobalSwitches in
--   src/lib/features/global-features.ts). So this migration changes NOTHING at
--   runtime until an admin explicitly writes an enabled=false row — the existing
--   env gates keep deciding effective behaviour. No seed rows on purpose.
--
-- SECURITY (mirrors feature_entitlements / SEC-24: an off-switch is a kill
--           switch and a paid_gift_links flip touches money + compliance)
--   - writes are SERVICE-ROLE ONLY: REVOKE write privs + RLS (no write policy)
--     + a BEFORE trigger that rejects any auth.uid()-context write (42501).
--   - SELECT: readable by any authenticated user (feature flags are not secret;
--     lets cookie-client gate reads work) and by anon (public legal pages read
--     the same switch to drive dynamic content — KAN-408 phase 2).
--
-- APPLIED TO
--   dev (ilprytcrnqyrsbsrfujj): apply_migration after review.
--   staging / beta+prod: user-gated promotion (each env's own project; beta+prod
--   share prod-lyra so one apply covers both).
--
-- ROLLBACK
--   drop table if exists public.global_feature_switches cascade;
--   drop function if exists public.prevent_global_feature_switch_user_write();

create table if not exists public.global_feature_switches (
  id           uuid primary key default gen_random_uuid(),
  environment  text not null check (environment in ('dev', 'staging', 'beta', 'prod')),
  feature_key  text not null,
  enabled      boolean not null default true,
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (environment, feature_key)
);

create index if not exists global_feature_switches_env_idx
  on public.global_feature_switches (environment);

-- User-write guard: only service-role / migrations (auth.uid() IS NULL) may write.
create or replace function public.prevent_global_feature_switch_user_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    raise exception 'global_feature_switches are admin-only (KAN-408)'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists global_feature_switches_no_user_write on public.global_feature_switches;
create trigger global_feature_switches_no_user_write
  before insert or update or delete on public.global_feature_switches
  for each row execute function public.prevent_global_feature_switch_user_write();

-- RLS: everyone may READ (flags aren't secret); NO write policy (service-role only).
alter table public.global_feature_switches enable row level security;

drop policy if exists "anyone reads global switches" on public.global_feature_switches;
create policy "anyone reads global switches"
  on public.global_feature_switches for select to anon, authenticated
  using (true);

-- Defense in depth: strip write privileges from the user-facing roles.
revoke insert, update, delete on public.global_feature_switches from authenticated, anon;
