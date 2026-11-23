-- KAN-490 (epic KAN-482, v0.8 step 7) — move existing data onto the v0.8
-- model: CheckLyra ID conversion with permanent redirects, external links into
-- gift ideas, and the legacy item categories mapped or archived.
--
-- Spec v0.8 (20 Nov 2026) §1 / §2 01 / §3, ADR-011, and the founder decisions
-- of 2026-11-23 (standing approval, "least destructive option"):
--   1. Every slug that does not meet the v0.8 ID format ^[a-z0-9_]{3,30}$ is
--      converted automatically. Converted profiles that are published OR
--      were ever published (first_published_at set — e.g. unpublished by an
--      admin or the member after KAN-485) get slug_confirmed = true: their ID
--      is locked after conversion, so without the flag they could never
--      publish again (review M1). Never-published drafts keep
--      slug_confirmed = false and choose an ID before publishing. Permanent.
--   2. Mechanical conversion, no special cases (seed "_a0000000" suffixes kept).
--   3. Over 30 characters: shorten the NAME part, keep the "_<8 hex>" suffix.
--   4. Accents via the unaccent extension, inside public.lyra_slugify().
--   5. public.profile_slug_history keeps every old slug (unique without regard
--      to case) so /<old-slug> redirects (308) to the current ID; no profile
--      may take another profile's old slug (guard trigger below).
--   6. external_links are COPIED into the member's own gift ideas where the
--      25 cap allows; the external_links table and rows are kept.
--   7. Published profiles without a photo stay published (grandfathered).
--   8. Legacy categories, PUBLIC items only, within the v0.8 caps / limits:
--        dislikes, allergies, dietary  -> gifts_to_avoid
--        likes                         -> gift_ideas
--        questions                     -> current_problems
--        billboard                     -> profiles.billboard (only if empty, <= 200)
--        helpful_to_know               -> profile_manual_of_me.good_to_know (only if total <= 500)
--        boundaries                    -> profile_manual_of_me.boundaries   (only if total <= 500)
--        mobility, transport, availability_pattern, and anything not public
--                                      -> archive copy only
--      EVERY legacy row is first copied in full to
--      public.profile_items_legacy_archive. Moved rows keep their id and only
--      change category; merged / archived / over-limit rows stay in place
--      untouched. Nothing is deleted. Legacy categories are NOT closed in the
--      KAN-485 trigger here (the legacy wizard and the MCP server still write
--      them) — follow-up.
--
-- Data-driven: no slug, id or name is hard-coded below. Idempotent: a second
-- run converts nothing (every slug is valid), copies no link twice (same
-- profile + title + url already a gift), and re-processes no legacy row (its
-- id is already in the archive).
--
-- Dev measurements (read-only, 2026-11-23, project ilprytcrnqyrsbsrfujj):
-- 33 profiles (30 published), all 33 slugs fail the format, 0 reserved, 0
-- collisions after conversion, 2 conversions over 30 characters; 3
-- external_links on 2 profiles (both under the 25 cap); 24 legacy-category
-- items, all public, on 2 profiles (re-measured in the 2026-11-23 dry run —
-- an earlier read-only count of 0 was wrong): likes 12 -> gift_ideas,
-- dislikes 3 -> gifts_to_avoid, questions 1 -> current_problems, billboard
-- items 2 -> profiles.billboard (both empty), helpful_to_know 3 ->
-- manual_of_me.good_to_know, boundaries 3 -> manual_of_me.boundaries (one new
-- manual_of_me row). All archived first; nothing deleted; caps hold (gift
-- ideas end at 19 and 7 of 25). The full old -> new table is pinned in
-- tests/unit/kan490-lyra-id-convert.test.ts (src/modules/profile/lyra-id-convert.ts
-- is the TypeScript mirror of lyra_slugify + lyra_id_from_legacy).
--
-- Security (CLAUDE.md gotcha #26 / SEC-103):
--   * Both new tables: RLS enabled, NO policies, revoked from public, anon
--     and authenticated — service-role only. Both are person-keyed: they
--     cascade on profile deletion and the SAR export returns them (SEC-117).
--   * lyra_slugify, lyra_id_from_legacy: SECURITY INVOKER, search_path pinned
--     to '', revoked from all three roles, granted to service_role only
--     (internal; this migration runs as the owner).
--   * enforce_lyra_id_not_retired: SECURITY DEFINER because a member's own
--     slug write fires it and the history table is unreadable to members. It
--     takes no argument, reads only profile_slug_history, returns NEW or
--     raises with SQLSTATE 23505 (unique_violation) so save_profile's draft
--     mode turns it into the "taken" warning like any other taken ID. Revoked from all three roles, granted to service_role only (a
--     trigger function needs no EXECUTE grant to fire).
--
-- ============================================================
-- DRY RUN (lead, on dev, BEFORE applying). Paste the whole file between
-- `begin;` and the probes, then `rollback;`. Expected values are for dev.
--   begin;
--   <this file>
--   -- P1 converted vs history (expect 33 / 33):
--   select (select count(*) from public.profile_slug_history) as history,
--          (select count(*) from public.profiles where slug ~ '^[a-z0-9_]{3,30}$') as valid_now;
--   -- P2 the mapping (expect the 33 rows of the unit-test table, e.g.
--   --    rosa-martínez-a0000000 -> rosa_martinez_a0000000,
--   --    e2e-published-activate-user-68db5eb1 -> e2e_published_activat_68db5eb1):
--   select h.old_slug, p.slug, p.is_published, p.slug_confirmed
--     from public.profile_slug_history h join public.profiles p on p.id = h.profile_id
--    order by p.created_at, p.id;
--   -- P3 invariants (expect 0, 0, 0, 0, 0):
--   select (select count(*) from public.profiles where slug !~ '^[a-z0-9_]{3,30}$') as invalid,
--          (select count(*) from public.profiles where is_published and not slug_confirmed) as pub_unconfirmed,
--          (select count(*) from public.profiles where first_published_at is not null
--             and not slug_confirmed) as locked_unconfirmed,
--          (select count(*) from public.profiles p join public.profile_slug_history h on h.profile_id = p.id
--             where p.first_published_at is null and not p.is_published and p.slug_confirmed) as draft_confirmed,
--          (select count(*) from public.profile_slug_history h join public.profiles p
--             on lower(p.slug) = h.old_slug_key and p.id <> h.profile_id) as hijacked;
--   -- P4 links copied (expect 3 rows; gifts per profile <= 25; external_links still 3):
--   select e.profile_id, count(i.id) from public.external_links e
--     left join public.profile_items i on i.profile_id = e.profile_id and i.category = 'gift_ideas'
--      and i.origin = 'user' and i.title = e.title and i.url = e.url group by 1;
--   select count(*) from public.external_links;
--   -- P4b caps (expect 0 rows each): member gifts per profile > 25,
--   --    manual-of-me fields > 500, billboard > 200:
--   select profile_id, count(*) from public.profile_items where category = 'gift_ideas'
--      and origin = 'user' group by 1 having count(*) > 25;
--   select profile_id from public.profile_manual_of_me
--    where length(good_to_know) > 500 or length(boundaries) > 500;
--   select id from public.profiles where length(billboard) > 200;
--   -- P5 legacy (expect 24 archived on dev: 16 moved, 8 merged): select kan490_action, count(*) from
--   --    public.profile_items_legacy_archive group by 1;
--   -- P6 guard (expect ERROR 'Retired CheckLyra ID'): every dev old slug
--   --    fails the ID format, so prove the guard with a valid-format history
--   --    row inside the same transaction:
--   insert into public.profile_slug_history (old_slug, profile_id)
--     select 'kan490_probe_id', id from public.profiles order by created_at limit 1;
--   update public.profiles set slug = 'kan490_probe_id'
--    where id = (select id from public.profiles where not is_published order by created_at limit 1);
--   --    (run P6 last or in a savepoint — the error aborts the transaction.)
--   -- P7 grants (expect only service_role / postgres):
--   select relname, relacl from pg_class where relname in ('profile_slug_history','profile_items_legacy_archive');
--   select proname, proacl, prosecdef from pg_proc where proname in
--     ('lyra_slugify','lyra_id_from_legacy','enforce_lyra_id_not_retired');
--   -- P8 idempotency: run <this file> a second time inside the same
--   --    transaction; P1–P5 must be unchanged and it must not raise.
--   rollback;
-- Apply at a quiet time: every conversion bumps profiles.updated_at
-- (on_profile_updated), so a member with the editor open gets "saved somewhere
-- else" and must reload (nothing is lost; the save is refused, not merged).
-- Then dev -> staging (dry run again: staging/prod may hold legacy items,
-- uppercase slugs or published valid-but-unconfirmed IDs dev does not have)
-- -> production. Take a backup (PITR point / pg_dump of profiles,
-- profile_items, profile_manual_of_me) before staging and production.
--
-- Rollback (manual; needs founder/lead sign-off; backups first). Inside ONE
-- transaction, as the table owner:
--   begin;
--   alter table public.profiles disable trigger profiles_v08_identity;
--   alter table public.profiles disable trigger profiles_v08_lyra_id_not_retired;
--   -- old slugs back (pre-migration every converted profile had
--   -- slug_confirmed = false — P0 below records that before applying):
--   update public.profiles p set slug = h.old_slug, slug_confirmed = false
--     from public.profile_slug_history h where h.profile_id = p.id;
--   -- profiles confirmed WITHOUT conversion (ids printed by the
--   -- 'confirmed without conversion' NOTICE, and recorded by P0):
--   --   update public.profiles set slug_confirmed = false where id in (<ids>);
--   -- moved legacy rows back to their original category:
--   update public.profile_items i set category = a.category::public.item_category
--     from public.profile_items_legacy_archive a
--    where a.id = i.id and a.kan490_action like 'moved:%';
--   -- merged billboard / manual-of-me text: reverse by hand from the archive
--   -- rows with kan490_action like 'merged:%' (the original text is there).
--   -- gifts copied from links: rows created in the migration's transaction
--   -- (created_at = the timestamp in the 'KAN-490 run at' NOTICE):
--   --   delete from public.profile_items i using public.external_links e
--   --    where i.profile_id = e.profile_id and i.category = 'gift_ideas'
--   --      and i.origin = 'user' and i.title = e.title and i.url = e.url
--   --      and i.created_at = '<run timestamp>';
--   alter table public.profiles enable trigger profiles_v08_identity;
--   drop trigger if exists profiles_v08_lyra_id_not_retired on public.profiles;
--   drop function if exists public.enforce_lyra_id_not_retired();
--   drop function if exists public.lyra_id_from_legacy(text, uuid);
--   drop function if exists public.lyra_slugify(text);
--   drop table if exists public.profile_slug_history;          -- drops the redirects
--   drop table if exists public.profile_items_legacy_archive;  -- only after the reversal above
--   commit;
--   -- (unaccent may stay installed; drop extension unaccent only if unused.)
-- P0 (before applying anywhere):
--   select count(*) from public.profiles
--    where slug !~ '^[a-z0-9_]{3,30}$' and slug_confirmed;  -- expect 0
--   -- profiles this migration will confirm because they were ever published
--   -- but are confirmed = false (dev: 30 published, 0 unpublished-after-publish;
--   -- record the ids for the rollback):
--   select id, slug, is_published from public.profiles
--    where first_published_at is not null and not slug_confirmed;
--   -- where unaccent lives, if anywhere (expect no row, or 'extensions'; any
--   -- other schema makes the migration stop with a clear error):
--   select extnamespace::regnamespace from pg_extension where extname = 'unaccent';

-- ============================================================
-- 0. Serialise against concurrent profile / item writes for the duration.
-- ============================================================
lock table public.profiles in share row exclusive mode;
lock table public.profile_items in share row exclusive mode;
lock table public.profile_manual_of_me in share row exclusive mode;
lock table public.external_links in share row exclusive mode;

-- unaccent installed in some other schema would make the create below a no-op
-- and every extensions.unaccent call fail; stop with a clear message instead.
do $unaccent$
declare
  v_schema text;
begin
  select extnamespace::regnamespace::text into v_schema
    from pg_catalog.pg_extension where extname = 'unaccent';
  if v_schema is not null and v_schema <> 'extensions' then
    raise exception 'KAN-490: unaccent is installed in schema %, expected extensions', v_schema;
  end if;
end
$unaccent$;

create extension if not exists unaccent with schema extensions;

-- ============================================================
-- 1. The slug helpers (mirrored in src/modules/profile/lyra-id-convert.ts).
-- ============================================================
-- Lower-case, accents removed, apostrophes dropped, every other run of
-- non-[a-z0-9] characters becomes one underscore, underscores trimmed.
-- The two-argument unaccent with an explicit dictionary is IMMUTABLE-safe.
create or replace function public.lyra_slugify(p_text text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select btrim(
           regexp_replace(
             regexp_replace(
               lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, ''))),
               '[''‘’`´]', '', 'g'),
             '[^a-z0-9]+', '_', 'g'),
           '_');
$$;

revoke all on function public.lyra_slugify(text) from public, anon, authenticated;
grant execute on function public.lyra_slugify(text) to service_role;

-- The per-row v0.8 ID for a legacy slug (before de-duplication):
--   * slugify; a trailing "_<8 hex>" (the legacy "-<first 8 of the uuid>")
--     is the suffix;
--   * over 30: shorten the name part to 21 so name + "_" + suffix = 30;
--     without a suffix, cut to 30; trailing underscores trimmed;
--   * under 3 (or empty): append "_" + the first 8 hex of the profile id
--     ("user_" + 8 hex when nothing is left);
--   * reserved: append "_" + the first 8 hex of the profile id.
create or replace function public.lyra_id_from_legacy(p_slug text, p_profile_id uuid)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_base     text := public.lyra_slugify(p_slug);
  v_fallback text := substr(replace(p_profile_id::text, '-', ''), 1, 8);
  v_match    text[];
  v_name     text;
begin
  if length(v_base) > 30 then
    v_match := regexp_match(v_base, '^(.*)_([0-9a-f]{8})$');
    if v_match is not null then
      v_name := rtrim(left(v_match[1], 21), '_');
      v_base := case when v_name = '' then v_match[2] else v_name || '_' || v_match[2] end;
    else
      v_base := rtrim(left(v_base, 30), '_');
    end if;
  end if;

  if length(v_base) < 3 then
    v_base := case when v_base = '' then 'user' else v_base end || '_' || v_fallback;
  elsif public.is_reserved_lyra_id(v_base) then
    v_base := v_base || '_' || v_fallback;
  end if;

  return v_base;
end$$;

revoke all on function public.lyra_id_from_legacy(text, uuid) from public, anon, authenticated;
grant execute on function public.lyra_id_from_legacy(text, uuid) to service_role;

-- ============================================================
-- 2. Slug history (redirects) + the anti-hijack guard.
-- ============================================================
create table if not exists public.profile_slug_history (
  old_slug     text not null check (char_length(old_slug) between 1 and 200),
  old_slug_key text generated always as (lower(old_slug)) stored,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint profile_slug_history_old_slug_key unique (old_slug_key)
);

create index if not exists profile_slug_history_profile_idx
  on public.profile_slug_history (profile_id);

alter table public.profile_slug_history enable row level security;
-- No policies on purpose: only service_role (the public page's loader) reads it.
revoke all on table public.profile_slug_history from public, anon, authenticated;

-- No profile may take an ID that is another profile's old slug (that would
-- hijack the old links). Fires after profiles_v08_identity (BEFORE triggers
-- run in name order), so NEW.slug is already lower-cased and format-checked.
create or replace function public.enforce_lyra_id_not_retired()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (tg_op = 'INSERT' or new.slug is distinct from old.slug)
     and exists (
       select 1
         from public.profile_slug_history h
        where h.old_slug_key = lower(new.slug)
          and h.profile_id <> new.id
     ) then
    raise exception 'Retired CheckLyra ID' using errcode = '23505';
  end if;
  return new;
end$$;

revoke all on function public.enforce_lyra_id_not_retired() from public, anon, authenticated;
grant execute on function public.enforce_lyra_id_not_retired() to service_role;

drop trigger if exists profiles_v08_lyra_id_not_retired on public.profiles;
create trigger profiles_v08_lyra_id_not_retired before insert or update on public.profiles
  for each row execute function public.enforce_lyra_id_not_retired();

-- ============================================================
-- 3. Legacy item archive (full row copy, before anything moves).
-- ============================================================
create table if not exists public.profile_items_legacy_archive (
  id              uuid primary key,          -- the profile_items.id (kept on the moved row)
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  category        text not null,             -- the ORIGINAL legacy category
  title           text,
  description     text,
  url             text,
  visibility      text,
  sort_order      integer,
  group_label     text,
  origin          text,
  approved        boolean,
  item_created_at timestamptz,
  kan490_action   text not null,
  archived_at     timestamptz not null default now()
);

create index if not exists profile_items_legacy_archive_profile_idx
  on public.profile_items_legacy_archive (profile_id);

alter table public.profile_items_legacy_archive enable row level security;
-- No policies on purpose: a migration record, service-role only (SAR export).
revoke all on table public.profile_items_legacy_archive from public, anon, authenticated;

-- ============================================================
-- 4. The data migration.
-- ============================================================
do $migration$
declare
  r              record;
  v_candidate    text;
  v_try          text;
  v_n            integer;
  v_converted    integer := 0;
  v_history      integer := 0;
  v_inserted     integer;
  v_confirmed    integer;
  v_confirmed_ids text;
  v_links        integer;
  v_legacy       integer;
  v_archived     integer;
  v_moved        integer;
  v_still_legacy integer;
  v_bad          integer;
begin
  raise notice 'KAN-490 run at %', now();

  -- ---------- 4a. CheckLyra ID conversion ----------
  -- Oldest first, in a fixed order. A de-duplication suffix goes to whichever
  -- profile meets a taken candidate: usually the newer one, but when an
  -- older profile's old slug differs from a newer one's valid ID only by case,
  -- the newer profile already holds that ID and the OLDER one gets "_2".
  for r in
    select p.id, p.slug
      from public.profiles p
     where p.slug !~ '^[a-z0-9_]{3,30}$'
     order by p.created_at, p.id
  loop
    v_candidate := public.lyra_id_from_legacy(r.slug, r.id);
    v_try := v_candidate;
    v_n := 1;
    -- Taken = another profile's current ID (case-insensitive; this also
    -- covers a later, not-yet-converted profile whose old slug lower-cases
    -- to the candidate) or another profile's old slug in the history.
    while exists (select 1 from public.profiles p
                   where p.id <> r.id and lower(p.slug) = v_try)
       or exists (select 1 from public.profile_slug_history h
                   where h.profile_id <> r.id and h.old_slug_key = v_try)
    loop
      v_n := v_n + 1;
      if v_n > 999 then
        raise exception 'KAN-490: could not find a free ID for profile %', r.id;
      end if;
      v_try := rtrim(left(v_candidate, 30 - 1 - length(v_n::text)), '_') || '_' || v_n;
    end loop;

    insert into public.profile_slug_history (old_slug, profile_id)
    values (r.slug, r.id)
    on conflict (old_slug_key) do nothing;
    get diagnostics v_inserted = row_count;
    v_history := v_history + v_inserted;

    update public.profiles
       set slug = v_try,
           slug_confirmed = slug_confirmed or is_published or first_published_at is not null
     where id = r.id;
    v_converted := v_converted + 1;
  end loop;

  -- A published (or once-published) profile whose ID already met the format
  -- is locked by the immutability rule anyway; confirm it so it can
  -- (re-)publish (0 on dev). Ids printed for the rollback.
  with c as (
    update public.profiles
       set slug_confirmed = true
     where (is_published or first_published_at is not null)
       and not slug_confirmed and slug ~ '^[a-z0-9_]{3,30}$'
    returning id
  )
  select count(*), string_agg(id::text, ', ' order by id) into v_confirmed, v_confirmed_ids from c;

  raise notice 'KAN-490: % IDs converted, % history rows, % IDs confirmed without conversion',
    v_converted, v_history, v_confirmed;
  raise notice 'KAN-490: confirmed without conversion: %', coalesce(v_confirmed_ids, '(none)');

  -- ---------- 4b. external_links -> member gift ideas (copy, keep originals) ----------
  insert into public.profile_items
         (profile_id, category, title, description, url, visibility, sort_order, origin, approved)
  select s.profile_id, 'gift_ideas'::public.item_category, btrim(s.title), s.description, s.url,
         'public'::public.visibility_level, s.max_sort + s.rn, 'user', true
    from (
      select d.profile_id, d.title, d.description, d.url,
             row_number() over (partition by d.profile_id
                                order by d.sort_order nulls last, d.created_at, d.id) as rn,
             (select count(*) from public.profile_items g
               where g.profile_id = d.profile_id and g.category = 'gift_ideas'
                 and g.origin = 'user') as existing,
             (select coalesce(max(g.sort_order), 0) from public.profile_items g
               where g.profile_id = d.profile_id and g.category = 'gift_ideas') as max_sort
        from (
          -- One copy per profile + title + url even if external_links holds
          -- the same link twice (NOT EXISTS sees only the pre-statement state).
          select distinct on (e.profile_id, btrim(e.title), e.url)
                 e.id, e.profile_id, e.title, e.description, e.url, e.sort_order, e.created_at
            from public.external_links e
           where btrim(e.title) <> ''
             and length(btrim(e.title)) <= 100
             and (e.description is null or length(e.description) <= 250)
             and length(e.url) <= 2048
             and e.url ~* '^https?://'
             and not exists (
               select 1 from public.profile_items g
                where g.profile_id = e.profile_id and g.category = 'gift_ideas'
                  and g.origin = 'user' and g.title = btrim(e.title)
                  and g.url is not distinct from e.url)
           order by e.profile_id, btrim(e.title), e.url, e.sort_order nulls last, e.created_at, e.id
        ) d
    ) s
   where s.existing + s.rn <= 25;
  get diagnostics v_links = row_count;
  raise notice 'KAN-490: % external links copied into gift ideas (% links kept in external_links)',
    v_links, (select count(*) from public.external_links);

  -- ---------- 4c. Legacy categories: plan, archive, then apply ----------
  drop table if exists pg_temp.kan490_legacy;
  create temporary table kan490_legacy on commit drop as
  select i.id, i.profile_id, i.category::text as category, i.title, i.description, i.url,
         i.visibility::text as visibility, i.sort_order, i.group_label, i.origin, i.approved,
         i.created_at,
         case
           when i.visibility::text <> 'public'                        then null
           when i.category::text in ('dislikes', 'allergies', 'dietary') then 'gifts_to_avoid'
           when i.category::text = 'likes'                            then 'gift_ideas'
           when i.category::text = 'questions'                        then 'current_problems'
         end as target_category,
         case
           when i.visibility::text <> 'public'                        then null
           when i.category::text = 'billboard'                        then 'billboard'
           when i.category::text = 'helpful_to_know'                  then 'good_to_know'
           when i.category::text = 'boundaries'                       then 'boundaries'
         end as merge_target,
         null::text as action
    from public.profile_items i
   where not exists (select 1 from public.profile_item_rule(i.category::text, i.origin))
     and not exists (select 1 from public.profile_items_legacy_archive a where a.id = i.id);

  get diagnostics v_legacy = row_count;

  -- Moves: within the target's title / description / link limits and cap.
  update kan490_legacy l
     set action = case when q.fits and q.existing + q.rn <= q.cap
                       then 'moved:' || l.target_category else 'kept:over_limit' end
    from (
      select l2.id, x.fits, x.cap,
             row_number() over (partition by l2.profile_id, x.cap_group, x.fits
                                order by l2.sort_order nulls last, l2.created_at, l2.id) as rn,
             (select count(*) from public.profile_items g,
                     lateral public.profile_item_rule(g.category::text, g.origin) gr
               where g.profile_id = l2.profile_id and gr.cap_group = x.cap_group) as existing
        from kan490_legacy l2,
             lateral (
               select rule.cap_group, rule.cap,
                      (l2.title is not null and btrim(l2.title) <> ''
                       and length(l2.title) <= rule.title_max
                       and (l2.description is null or length(l2.description) <= rule.description_max)
                       and (l2.url is null or (length(l2.url) <= 2048 and l2.url ~* '^https?://'))
                       and coalesce(l2.origin, 'user') = 'user') as fits
                 from public.profile_item_rule(l2.target_category, 'user') rule
             ) x
       where l2.target_category is not null
    ) q
   where q.id = l.id;

  -- Billboard: the first public billboard item, only into an empty billboard.
  update kan490_legacy l
     set action = case when b.rn = 1 and b.empty_billboard and length(b.txt) between 1 and 200
                       then 'merged:billboard' else 'kept:billboard_not_empty_or_too_long' end
    from (
      select l2.id,
             row_number() over (partition by l2.profile_id
                                order by l2.sort_order nulls last, l2.created_at, l2.id) as rn,
             btrim(coalesce(l2.title, '') || coalesce(E'\n' || nullif(btrim(l2.description), ''), '')) as txt,
             (select coalesce(btrim(p.billboard), '') = '' from public.profiles p where p.id = l2.profile_id)
               as empty_billboard
        from kan490_legacy l2
       where l2.merge_target = 'billboard'
    ) b
   where b.id = l.id;

  -- Manual of me: all of a profile's items for one prompt, or none of them.
  update kan490_legacy l
     set action = case when length(m.combined) <= 500
                       then 'merged:' || l.merge_target else 'kept:manual_of_me_too_long' end
    from (
      select a.profile_id, a.merge_target,
             concat_ws(E'\n',
               nullif(btrim(case a.merge_target when 'good_to_know' then mom.good_to_know
                                               else mom.boundaries end), ''),
               a.agg) as combined
        from (
          select l2.profile_id, l2.merge_target,
                 string_agg(btrim(coalesce(l2.title, ''))
                              || coalesce(' — ' || nullif(btrim(l2.description), ''), ''),
                            E'\n' order by l2.sort_order nulls last, l2.created_at, l2.id) as agg
            from kan490_legacy l2
           where l2.merge_target in ('good_to_know', 'boundaries')
           group by l2.profile_id, l2.merge_target
        ) a
        left join public.profile_manual_of_me mom on mom.profile_id = a.profile_id
    ) m
   where m.profile_id = l.profile_id and m.merge_target = l.merge_target;

  update kan490_legacy
     set action = case when visibility <> 'public' then 'archived:not_public' else 'archived:no_v08_home' end
   where action is null;

  -- Archive FIRST (full row), then apply.
  insert into public.profile_items_legacy_archive
         (id, profile_id, category, title, description, url, visibility, sort_order,
          group_label, origin, approved, item_created_at, kan490_action)
  select id, profile_id, category, title, description, url, visibility, sort_order,
         group_label, origin, approved, created_at, action
    from kan490_legacy
  on conflict (id) do nothing;
  get diagnostics v_archived = row_count;

  update public.profile_items i
     set category = l.target_category::public.item_category
    from kan490_legacy l
   where l.id = i.id and l.action = 'moved:' || l.target_category;
  get diagnostics v_moved = row_count;

  update public.profiles p
     set billboard = b.txt
    from (
      select l.profile_id,
             btrim(coalesce(l.title, '') || coalesce(E'\n' || nullif(btrim(l.description), ''), '')) as txt
        from kan490_legacy l
       where l.action = 'merged:billboard'
    ) b
   where p.id = b.profile_id
     and coalesce(btrim(p.billboard), '') = '';

  insert into public.profile_manual_of_me as mom (profile_id, good_to_know, boundaries)
  select x.profile_id,
         max(case when x.merge_target = 'good_to_know' then x.agg end),
         max(case when x.merge_target = 'boundaries' then x.agg end)
    from (
      select l.profile_id, l.merge_target,
             string_agg(btrim(coalesce(l.title, ''))
                          || coalesce(' — ' || nullif(btrim(l.description), ''), ''),
                        E'\n' order by l.sort_order nulls last, l.created_at, l.id) as agg
        from kan490_legacy l
       where l.action in ('merged:good_to_know', 'merged:boundaries')
       group by l.profile_id, l.merge_target
    ) x
   group by x.profile_id
  on conflict (profile_id) do update
     set good_to_know = case
           when excluded.good_to_know is null then mom.good_to_know
           else concat_ws(E'\n', nullif(btrim(mom.good_to_know), ''), excluded.good_to_know) end,
         boundaries = case
           when excluded.boundaries is null then mom.boundaries
           else concat_ws(E'\n', nullif(btrim(mom.boundaries), ''), excluded.boundaries) end,
         updated_at = now();

  raise notice 'KAN-490: % legacy items found, % archived, % moved to a v0.8 category',
    v_legacy, v_archived, v_moved;

  -- ---------- 4d. Post-checks (any failure rolls the whole migration back) ----------
  select count(*) into v_bad from public.profiles where slug !~ '^[a-z0-9_]{3,30}$';
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % profiles still have an invalid CheckLyra ID', v_bad;
  end if;

  select count(*) into v_bad from public.profiles where is_published and not slug_confirmed;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % published profiles have slug_confirmed = false', v_bad;
  end if;

  -- Once published = ID locked; unconfirmed would mean never publishable again.
  select count(*) into v_bad from public.profiles where first_published_at is not null and not slug_confirmed;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % once-published profiles have slug_confirmed = false', v_bad;
  end if;

  if v_history <> v_converted then
    raise exception 'KAN-490 post-check: % IDs converted but % history rows written', v_converted, v_history;
  end if;

  select count(*) into v_bad
    from public.profile_slug_history h
    join public.profiles p on lower(p.slug) = h.old_slug_key and p.id <> h.profile_id;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % old slugs are another profile''s current ID', v_bad;
  end if;

  if v_archived <> v_legacy then
    raise exception 'KAN-490 post-check: % legacy items found but % archived', v_legacy, v_archived;
  end if;

  select count(*) into v_still_legacy
    from public.profile_items i
    join public.profile_items_legacy_archive a on a.id = i.id
   where a.kan490_action like 'moved:%'
     and i.category::text <> substr(a.kan490_action, 7);
  if v_still_legacy > 0 then
    raise exception 'KAN-490 post-check: % items marked moved are not in their v0.8 category', v_still_legacy;
  end if;

  select count(*) into v_bad
    from public.profile_items i
   where not exists (select 1 from public.profile_item_rule(i.category::text, i.origin))
     and not exists (select 1 from public.profile_items_legacy_archive a where a.id = i.id);
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % legacy items have no archive copy', v_bad;
  end if;

  -- Caps / limits on everything this migration writes into.
  select count(*) into v_bad from (
    select g.profile_id from public.profile_items g
     where g.category = 'gift_ideas' and g.origin = 'user'
     group by g.profile_id having count(*) > 25) x;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % profiles have more than 25 member gift ideas', v_bad;
  end if;

  select count(*) into v_bad from public.profile_manual_of_me
   where length(good_to_know) > 500 or length(boundaries) > 500;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % manual-of-me rows exceed 500 characters', v_bad;
  end if;

  select count(*) into v_bad from public.profiles where length(billboard) > 200;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % billboards exceed 200 characters', v_bad;
  end if;

  -- Every eligible link is a gift now, unless the 25 cap stopped it.
  select count(*) into v_bad
    from public.external_links e
   where btrim(e.title) <> '' and length(btrim(e.title)) <= 100
     and (e.description is null or length(e.description) <= 250)
     and length(e.url) <= 2048 and e.url ~* '^https?://'
     and not exists (
       select 1 from public.profile_items g
        where g.profile_id = e.profile_id and g.category = 'gift_ideas'
          and g.origin = 'user' and g.title = btrim(e.title)
          and g.url is not distinct from e.url)
     and (select count(*) from public.profile_items g
           where g.profile_id = e.profile_id and g.category = 'gift_ideas'
             and g.origin = 'user') < 25;
  if v_bad > 0 then
    raise exception 'KAN-490 post-check: % eligible external links were not copied (cap not reached)', v_bad;
  end if;
end
$migration$;
