-- KAN-205 — Convene Phase 1: profile category + visibility additions.
--
-- Adds six new item_category enum values used by Convene's attendee + venue
-- scorers (P3) and the gathering wizard, plus a new visibility_level value
-- `tribe_only` for sharing items with named tribes.
--
-- All additive. No existing rows touched.

alter type public.item_category add value if not exists 'dietary';
alter type public.item_category add value if not exists 'mobility';
alter type public.item_category add value if not exists 'transport';
alter type public.item_category add value if not exists 'availability_pattern';
alter type public.item_category add value if not exists 'favourite_venues';
alter type public.item_category add value if not exists 'allergies';

alter type public.visibility_level add value if not exists 'tribe_only';

-- Helper: which tribes can see a given user's tribe_only items? Returns the
-- set of tribe_ids whose owner is the profile owner. (When P5 wires this into
-- the read path, a viewer must be a member of one of these tribes.)
create or replace function public.tribe_only_visible_tribes(p_profile_user_id uuid)
  returns table (tribe_id uuid)
  language sql
  stable
as $$
  select t.id from public.tribes t
  where t.owner_user_id = p_profile_user_id and t.deleted_at is null;
$$;

comment on function public.tribe_only_visible_tribes(uuid) is 'KAN-205 — returns the tribes that can see a profile owner''s `tribe_only` items. Used by Convene read tools.';
