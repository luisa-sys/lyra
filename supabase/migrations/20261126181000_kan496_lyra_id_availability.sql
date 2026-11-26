-- KAN-496 (epic KAN-482) — "Check availability" for the CheckLyra ID field.
--
-- Founder feedback 2026-11-26: CheckLyra IDs are unique, so the editor needs
-- a button next to the field that says whether an ID is free BEFORE saving.
--
-- public.lyra_id_availability(p_id) returns one of:
--   'invalid'   — not 3–30 lower-case letters, numbers or underscores
--   'taken'     — another profile's ID, or another profile's retired old
--                 address (profile_slug_history; the same rule as the
--                 enforce_lyra_id_not_retired trigger)
--   'available' — free, or already the caller's own
-- Reserved words are checked in the app (RESERVED_LYRA_IDS) before calling.
--
-- Why SECURITY DEFINER: unpublished profiles and profile_slug_history are
-- unreadable to members (RLS / no grants), but a taken ID must still count as
-- taken. The function returns ONE word for ONE ID and nothing about whose it
-- is. This exposes nothing new: a draft save with a taken ID already returns
-- the "taken" warning (save_profile draft mode). Members only (no anon); the
-- app adds a per-user rate limit on top.
--
-- Not a reservation: the unique index (profiles_slug_lower_key) and the
-- retired-ID trigger still decide at save time.
--
-- Rollback (manual):
--   drop function if exists public.lyra_id_availability(text);

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
  return 'available';
end$$;

revoke all on function public.lyra_id_availability(text) from public, anon;
grant execute on function public.lyra_id_availability(text) to authenticated;
