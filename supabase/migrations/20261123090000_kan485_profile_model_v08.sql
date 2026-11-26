-- KAN-485 (epic KAN-482) — spec v0.8 profile data model: field limits,
-- per-section caps, the CheckLyra ID rules and the publish requirements.
--
-- Spec v0.8 (20 Nov 2026) §1–§3, plus the founder decisions of 2026-11-22:
--   * ID: letters, digits and underscore, 3–30, unique without regard to
--     case, reserved words refused, URL checklyra.com/<id>; immutable after
--     first publication.
--   * Country: dropdown (stored as the existing 2-letter code); city free text.
--   * AI gift suggestions in V1, no affiliate links; 10 retained in total;
--     switching AI off keeps approved items (nothing here deletes them).
--   * Removing the photo on a published profile is refused.
--
-- Design notes (why it is built this way):
--   * Category-dependent limits are enforced by TRIGGER ON WRITE, not by table
--     CHECKs, so a legacy row that predates a limit is never made unwritable
--     by an unrelated update. Dev data was measured before writing this
--     (2026-11-22): every existing value fits every new limit, and the largest
--     per-profile count in any category is 9.
--   * Fixed-length profile columns use plain CHECKs (dev data fits them).
--   * Categories that v0.8 no longer has (likes, dislikes, helpful_to_know,
--     boundaries, questions, billboard, dietary, …) are left unconstrained
--     here; KAN-490 migrates their rows and only then can they be closed.
--   * The rule table lives in ONE function, profile_item_rule(), mirrored in
--     src/modules/profile/profile-rules.ts; a test pins both to the spec.
--   * Draft vs published: after first publication the editor holds edits
--     client-side and writes them only on "Save Changes" (KAN-487), so the
--     stored rows ARE the published snapshot. This migration adds only the
--     columns that model needs (first_published_at, slug_confirmed).
--
-- Rollback (manual):
--   drop trigger if exists profile_items_v08_rules on public.profile_items;
--   drop trigger if exists school_affiliations_v08_rules on public.school_affiliations;
--   drop trigger if exists profiles_v08_identity on public.profiles;
--   drop function if exists public.enforce_profile_item_rules();
--   drop function if exists public.enforce_affiliation_rules();
--   drop function if exists public.enforce_profile_identity_rules();
--   drop function if exists public.profile_item_rule(text, text);
--   drop function if exists public.is_reserved_lyra_id(text);
--   alter table public.profile_items drop column if exists origin, drop column if exists approved;
--   alter table public.profiles drop column if exists billboard,
--     drop column if exists first_published_at, drop column if exists slug_confirmed;
--   drop index if exists public.profiles_slug_lower_key;
--   -- then restore the two profile_items read policies from 20260704070000.

-- ============================================================
-- 1. profiles: new columns and fixed-length limits.
-- ============================================================
alter table public.profiles add column if not exists billboard text;
alter table public.profiles add column if not exists first_published_at timestamptz;
alter table public.profiles add column if not exists slug_confirmed boolean not null default false;

-- A profile already published before this migration has, in effect, been
-- published once: record that, so the ID immutability rule applies to it.
update public.profiles
   set first_published_at = coalesce(updated_at, created_at, now())
 where is_published and first_published_at is null;

alter table public.profiles drop constraint if exists profiles_v08_lengths;
alter table public.profiles add constraint profiles_v08_lengths check (
      length(display_name) <= 60
  and (headline          is null or length(headline)          <= 100)
  and (city              is null or length(city)              <= 80)
  and (country           is null or length(country)           <= 80)
  and (bio_short         is null or length(bio_short)         <= 500)
  and (billboard         is null or length(billboard)         <= 200)
  and (gift_voucher_hint is null or length(gift_voucher_hint) <= 350)
);

-- Unique without regard to case. The existing unique index on slug is
-- case-sensitive; dev has zero case-only duplicates (measured), so this is
-- creatable. IDs are also stored lower-case by the trigger below.
create unique index if not exists profiles_slug_lower_key on public.profiles (lower(slug));

-- ============================================================
-- 2. Reserved IDs (also mirrored in profile-rules.ts).
-- ============================================================
create or replace function public.is_reserved_lyra_id(p_id text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select lower(coalesce(p_id, '')) = any (array[
    -- every top-level route under src/app (a test keeps this complete)
    'admin','api','auth','confirm-age','dashboard','examples','how-we-check-your-age',
    'join','oauth','r','search','status','suspended','verify-age','waitlist',
    -- auth and legal pages, and words that would read as official
    'login','logout','signin','signout','signup','register','reset','password',
    'privacy','terms','cookies','legal','about','contact','help','support','faq',
    'accessibility','complaints','guidelines','partners','safe',
    'settings','profile','profiles','account','accounts','me','home','index',
    'lyra','checklyra','official','staff','team','moderator','mod','root',
    'system','null','undefined','www','mail','email','beta','dev','staging',
    'static','assets','public','robots','sitemap','favicon','manifest',
    'report','reports','security','invite','invites','new','edit','preview'
  ]);
$$;

revoke all on function public.is_reserved_lyra_id(text) from public, anon, authenticated;
-- authenticated needs EXECUTE: it is called from a SECURITY INVOKER trigger
-- that fires on a member's own write. Pure lookup over constants — it reads
-- no table and returns nothing a member could not read in this file.
grant execute on function public.is_reserved_lyra_id(text) to authenticated, service_role;

-- ============================================================
-- 3. profiles: ID rules + publish requirements.
-- ============================================================
create or replace function public.enforce_profile_identity_rules()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- CheckLyra ID: validated whenever it changes.
  if tg_op = 'INSERT' or new.slug is distinct from old.slug then
    new.slug := lower(new.slug);
    if new.slug !~ '^[a-z0-9_]{3,30}$' then
      raise exception 'Invalid CheckLyra ID';
    end if;
    if public.is_reserved_lyra_id(new.slug) then
      raise exception 'Reserved CheckLyra ID';
    end if;
    -- Immutable after first publication — except a one-time conversion of a
    -- legacy pre-v0.8 slug (one that does not meet the format), KAN-490.
    if tg_op = 'UPDATE' and old.first_published_at is not null
       and old.slug ~ '^[a-z0-9_]{3,30}$' then
      raise exception 'CheckLyra ID cannot be changed after publishing';
    end if;
  end if;

  -- Publishing: photo, display name and a chosen ID are required.
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    if new.avatar_url is null or btrim(new.avatar_url) = '' then
      raise exception 'Publishing needs a profile photo';
    end if;
    if new.display_name is null or btrim(new.display_name) = '' then
      raise exception 'Publishing needs a display name';
    end if;
    if not new.slug_confirmed or new.slug !~ '^[a-z0-9_]{3,30}$' then
      raise exception 'Publishing needs a CheckLyra ID';
    end if;
    new.first_published_at := coalesce(new.first_published_at, now());
  end if;

  -- A published profile cannot lose its photo (founder decision 2026-11-22).
  if tg_op = 'UPDATE' and new.is_published and old.avatar_url is not null
     and (new.avatar_url is null or btrim(new.avatar_url) = '') then
    raise exception 'A published profile needs a profile photo';
  end if;

  return new;
end$$;

revoke all on function public.enforce_profile_identity_rules() from public, anon, authenticated;
grant execute on function public.enforce_profile_identity_rules() to service_role;

drop trigger if exists profiles_v08_identity on public.profiles;
create trigger profiles_v08_identity before insert or update on public.profiles
  for each row execute function public.enforce_profile_identity_rules();

-- New accounts get a placeholder ID that meets the format but is not
-- confirmed, so it can never be published until the member chooses one.
-- display_name is clipped to the new 60-character limit so a long name or
-- e-mail local part can never make sign-up fail.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.profiles (user_id, display_name, slug, slug_confirmed)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
                  split_part(new.email, '@', 1)), 60),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 10),
    false
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

-- ============================================================
-- 4. profile_items: origin + approval (gifts), and the rule table.
-- ============================================================
alter table public.profile_items add column if not exists origin text not null default 'user';
alter table public.profile_items add column if not exists approved boolean not null default true;

alter table public.profile_items drop constraint if exists profile_items_origin_check;
alter table public.profile_items add constraint profile_items_origin_check check (
      origin in ('user', 'ai')
  and (origin = 'ai' or approved)               -- a member's own entry is always approved
  and (origin = 'user' or category = 'gift_ideas')  -- AI only suggests gifts
);

-- Returns the v0.8 rule for a category: which cap group it counts toward,
-- the cap, and the title / description limits. NULL = no v0.8 rule (legacy).
create or replace function public.profile_item_rule(p_category text, p_origin text)
returns table (cap_group text, cap integer, title_max integer, description_max integer)
language sql
immutable
set search_path to ''
as $$
  select r.cap_group, r.cap, r.title_max, r.description_max from (values
    ('causes',           'causes',          6,  250, 250),
    ('proud_of',         'proud_of',        6,  250, 250),
    ('gift_ideas',       'gifts_user',     25,  100, 250),
    ('gifts_to_avoid',   'not_for_me',     15,  100, 200),
    ('quotes',           'fav_quotes',     15,  500, 120),
    ('favourite_media',  'fav_screen',     15,  120, 300),
    ('plays',            'fav_screen',     15,  120, 300),
    ('favourite_tv',     'fav_screen',     15,  120, 300),
    ('favourite_books',  'fav_books',      15,  120, 300),
    ('favourite_places', 'fav_places',     15,  120, 300),
    ('favourite_venues', 'fav_places',     15,  120, 300),
    ('favourite_music',  'fav_others',     15,  120, 300),
    ('favourite_custom', 'fav_others',     15,  120, 300),
    ('life_hacks',       'tips',           15,  120, 500),
    ('current_problems', 'problems',       10,  120, 500)
  ) as r(category, cap_group, cap, title_max, description_max)
  where r.category = p_category and coalesce(p_origin, 'user') = 'user'
  union all
  select 'gifts_ai', 10, 100, 250
  where p_category = 'gift_ideas' and p_origin = 'ai';
$$;

revoke all on function public.profile_item_rule(text, text) from public, anon, authenticated;
-- authenticated needs EXECUTE: it is called from a SECURITY INVOKER trigger
-- that fires on a member's own write. Pure lookup over constants — it reads
-- no table and returns nothing a member could not read in this file.
grant execute on function public.profile_item_rule(text, text) to authenticated, service_role;

create or replace function public.enforce_profile_item_rules()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  r record;
  v_count integer;
begin
  select * into r from public.profile_item_rule(new.category::text, new.origin);
  if not found then
    return new;                       -- legacy category: no v0.8 rule yet (KAN-490)
  end if;

  if new.title is null or btrim(new.title) = '' then
    raise exception 'Title is required';
  end if;
  if length(new.title) > r.title_max then
    raise exception 'Title is longer than % characters', r.title_max;
  end if;
  if new.description is not null and length(new.description) > r.description_max then
    raise exception 'Description is longer than % characters', r.description_max;
  end if;
  if new.url is not null and (length(new.url) > 2048 or new.url !~* '^https?://') then
    raise exception 'Links must start with http:// or https:// and be at most 2048 characters';
  end if;

  -- Cap: counted per cap group (and per origin for gifts). Only checked when
  -- the row joins a group — an INSERT, or an UPDATE that moves category/origin.
  if tg_op = 'INSERT'
     or new.category is distinct from old.category
     or new.origin   is distinct from old.origin then
    select count(*) into v_count
      from public.profile_items i, lateral public.profile_item_rule(i.category::text, i.origin) g
     where i.profile_id = new.profile_id
       and g.cap_group = r.cap_group
       and i.id <> new.id;
    if v_count >= r.cap then
      raise exception 'Section limit (%) reached', r.cap;
    end if;
  end if;

  return new;
end$$;

revoke all on function public.enforce_profile_item_rules() from public, anon, authenticated;
grant execute on function public.enforce_profile_item_rules() to service_role;

drop trigger if exists profile_items_v08_rules on public.profile_items;
create trigger profile_items_v08_rules before insert or update on public.profile_items
  for each row execute function public.enforce_profile_item_rules();

-- Unapproved AI suggestions must never reach an anonymous or member reader
-- (v0.8 §3: "must not expose … unapproved AI content in APIs"). Same two
-- read policies as 20260704070000, each with `approved` added.
drop policy if exists "Anyone can read public items from published profiles" on public.profile_items;
create policy "Anyone can read public items from published profiles"
  on public.profile_items for select
  using (
    approved
    and visibility = 'public'::public.visibility_level
    and profile_id in (
      select profiles.id from public.profiles
       where profiles.is_published = true and profiles.is_suspended = false
    )
  );

drop policy if exists "Members can read members_only items from published profiles" on public.profile_items;
create policy "Members can read members_only items from published profiles"
  on public.profile_items for select
  using (
    approved
    and auth.uid() is not null
    and visibility = 'members_only'::public.visibility_level
    and profile_id in (
      select profiles.id from public.profiles
       where profiles.is_published = true and profiles.is_suspended = false
    )
  );

-- ============================================================
-- 5. school_affiliations: 7 per group; field limits.
-- ============================================================
create or replace function public.enforce_affiliation_rules()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_count integer;
begin
  if new.school_name is null or btrim(new.school_name) = '' then
    raise exception 'Name is required';
  end if;
  if length(new.school_name) > 120 then
    raise exception 'Name is longer than 120 characters';
  end if;
  if new.description is not null and length(new.description) > 250 then
    raise exception 'Description is longer than 250 characters';
  end if;
  if new.school_location is not null and length(new.school_location) > 120 then
    raise exception 'Location is longer than 120 characters';
  end if;
  -- Schools: postcode required, 12 characters — checked when the entry is
  -- created or its postcode is edited, so pre-v0.8 rows (free-text
  -- locations up to 20 characters on dev) stay editable.
  if new.affiliation_type = 'school'
     and (tg_op = 'INSERT' or new.school_location is distinct from old.school_location) then
    if new.school_location is null or btrim(new.school_location) = '' then
      raise exception 'Postcode is required for a school';
    end if;
    if length(new.school_location) > 12 then
      raise exception 'Postcode is longer than 12 characters';
    end if;
  end if;

  if tg_op = 'INSERT' or new.affiliation_type is distinct from old.affiliation_type then
    select count(*) into v_count
      from public.school_affiliations
     where profile_id = new.profile_id
       and affiliation_type = new.affiliation_type
       and id <> new.id;
    if v_count >= 7 then
      raise exception 'Section limit (7) reached';
    end if;
  end if;
  return new;
end$$;

revoke all on function public.enforce_affiliation_rules() from public, anon, authenticated;
grant execute on function public.enforce_affiliation_rules() to service_role;

drop trigger if exists school_affiliations_v08_rules on public.school_affiliations;
create trigger school_affiliations_v08_rules before insert or update on public.school_affiliations
  for each row execute function public.enforce_affiliation_rules();

-- ============================================================
-- 6. profile_manual_of_me: 500 per prompt, 1000 for "If you ever come to my
--    house" (working_preferences). Matches MANUAL_OF_ME_MAX in the app.
-- ============================================================
alter table public.profile_manual_of_me drop constraint if exists manual_of_me_v08_lengths;
alter table public.profile_manual_of_me add constraint manual_of_me_v08_lengths check (
      (good_to_know        is null or length(good_to_know)        <= 500)
  and (boundaries          is null or length(boundaries)          <= 500)
  and (communication_style is null or length(communication_style) <= 500)
  and (working_preferences is null or length(working_preferences) <= 1000)
  and (energises_me        is null or length(energises_me)        <= 500)
  and (drains_me           is null or length(drains_me)           <= 500)
);
