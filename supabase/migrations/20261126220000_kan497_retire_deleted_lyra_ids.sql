-- KAN-497 — a deleted account's CheckLyra ID is retired forever.
--
-- Founder decision (2026-11-26): once an account is deleted, its CheckLyra ID
-- can never be taken by anyone else, so old links, notes or bookmarks to
-- checklyra.com/<id> can never show a stranger's page.
--
-- Until now nothing kept a deleted ID: profiles cascade-delete with the auth
-- user, and profile_slug_history (the KAN-490 anti-hijack list of old
-- addresses) cascades with the profile, so every address the member ever had
-- became free again.
--
-- Data minimisation (UK GDPR Art.5(1)(c)): retired_lyra_ids holds the bare ID
-- text and the date only. No user_id, no profile_id, nothing that links it
-- back to the person. Basis: legitimate interests (preventing impersonation).
-- It is not person-keyed, so it is outside the SAR export and erasure
-- cascade by construction (src/modules/contracts/person-keyed-tables.ts).
--
-- What is retired, on DELETE of a profile:
--   * its current ID, if the profile was ever published (first_published_at
--     is set). An ID that was only ever a draft was never public, so no link
--     can point to it; the unconfirmed signup placeholder (user_<hex>) is
--     never retired.
--   * every old address in profile_slug_history (those were public pre-v0.8
--     addresses that still redirect).
--
-- Enforcement: the existing anti-hijack trigger and lyra_id_availability also
-- check the retired list. The trigger keeps its error text 'Retired CheckLyra
-- ID' (23505), which the editor already shows as "That CheckLyra ID is
-- already taken." It checks the list only for a CONFIRMED ID, so sign-up's
-- placeholder can never fail on it.
--
-- No backfill: accounts deleted before this migration left no trace of their
-- ID, by design of the old cascade.
--
-- Rollback:
--   drop trigger if exists profiles_v08_retire_lyra_ids_on_delete on public.profiles;
--   drop function if exists public.retire_lyra_ids_on_profile_delete();
--   -- then re-apply enforce_lyra_id_not_retired() and lyra_id_availability()
--   -- from 20261123130000_kan490 and 20261126181000_kan496;
--   drop table if exists public.retired_lyra_ids;

-- ============================================================
-- 1. The retired list (no link to any person).
-- ============================================================
create table if not exists public.retired_lyra_ids (
  id_key     text primary key check (id_key = lower(id_key) and char_length(id_key) between 1 and 200),
  retired_at timestamptz not null default now()
);

alter table public.retired_lyra_ids enable row level security;
-- No policies on purpose: only SECURITY DEFINER functions read or write it.
revoke all on table public.retired_lyra_ids from public, anon, authenticated;

-- ============================================================
-- 2. Retire on delete. BEFORE DELETE so profile_slug_history rows (which
--    cascade from profiles) are still there to copy. Fires for the
--    auth.users -> profiles cascade too.
-- ============================================================
create or replace function public.retire_lyra_ids_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if old.first_published_at is not null and old.slug is not null and old.slug <> '' then
    insert into public.retired_lyra_ids (id_key)
    values (lower(old.slug))
    on conflict (id_key) do nothing;
  end if;

  insert into public.retired_lyra_ids (id_key)
  select h.old_slug_key
    from public.profile_slug_history h
   where h.profile_id = old.id
  on conflict (id_key) do nothing;

  return old;
end$$;

revoke all on function public.retire_lyra_ids_on_profile_delete() from public, anon, authenticated;
grant execute on function public.retire_lyra_ids_on_profile_delete() to service_role;

drop trigger if exists profiles_v08_retire_lyra_ids_on_delete on public.profiles;
create trigger profiles_v08_retire_lyra_ids_on_delete before delete on public.profiles
  for each row execute function public.retire_lyra_ids_on_profile_delete();

-- ============================================================
-- 3. The anti-hijack guard also refuses a retired ID (confirmed IDs only).
-- ============================================================
create or replace function public.enforce_lyra_id_not_retired()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (tg_op = 'INSERT' or new.slug is distinct from old.slug)
     and (
       exists (
         select 1
           from public.profile_slug_history h
          where h.old_slug_key = lower(new.slug)
            and h.profile_id <> new.id
       )
       or (
         new.slug_confirmed
         and exists (
           select 1 from public.retired_lyra_ids r
            where r.id_key = lower(new.slug)
         )
       )
     ) then
    raise exception 'Retired CheckLyra ID' using errcode = '23505';
  end if;
  return new;
end$$;

revoke all on function public.enforce_lyra_id_not_retired() from public, anon, authenticated;
grant execute on function public.enforce_lyra_id_not_retired() to service_role;

-- ============================================================
-- 4. "Check availability" says taken for a retired ID.
-- ============================================================
create or replace function public.lyra_id_availability(p_id text)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_id  text := lower(btrim(coalesce(p_id, '')));
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_id !~ '^[a-z0-9_]{3,30}$' then
    return 'invalid';
  end if;
  if exists (
    select 1 from public.profiles p
     where lower(p.slug) = v_id
       and p.user_id <> v_uid
  ) then
    return 'taken';
  end if;
  if exists (
    select 1
      from public.profile_slug_history h
      join public.profiles p on p.id = h.profile_id
     where h.old_slug_key = v_id
       and p.user_id <> v_uid
  ) then
    return 'taken';
  end if;
  if exists (select 1 from public.retired_lyra_ids r where r.id_key = v_id) then
    return 'taken';
  end if;
  return 'available';
end$$;

revoke all on function public.lyra_id_availability(text) from public, anon, authenticated;
grant execute on function public.lyra_id_availability(text) to authenticated;
