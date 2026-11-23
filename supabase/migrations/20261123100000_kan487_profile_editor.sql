-- KAN-487 (epic KAN-482) — v0.8 profile editor backend: one atomic save RPC
-- and the affiliation-name autocomplete RPC.
--
-- Spec v0.8 (20 Nov 2026) §1 / §3 and the KAN-487 plan §B:
--   * After first publication the editor holds every edit client-side and
--     writes it only on "Save Changes". The stored rows ARE the published
--     snapshot; there is no draft table (KAN-485 header).
--   * A save must therefore be ATOMIC: either every changed section lands or
--     none does. public.save_profile(p_payload jsonb, p_mode text) applies one
--     DIFF payload in a single transaction.
--   * Affiliation names autocomplete from names other members already show
--     (public.suggest_affiliation_names), replacing the Google Places lookup.
--
-- Payload (a DIFF — an absent section is left untouched; deletes are explicit
-- id lists, never "absent means delete", the BUGS-74 lesson):
--   { base_updated_at, profile{display_name, headline, city, country,
--     bio_short, gift_voucher_hint, billboard, slug?}, photo{action, avatar_url?},
--     items{upsert[], delete[]}, ai_gifts{approve[], delete[]},
--     affiliations{upsert[], delete[]}, manual_of_me{…6 keys…} | null,
--     questions{upsert[], delete[]} }
-- Modes: 'draft' (never published), 'publish' (the save that precedes
-- publishProfile()), 'published' (Save Changes on a published profile).
-- 'published' requires base_updated_at; it is optional for draft / publish.
-- Returns { updated_at, ids: {client_key: id}, warnings, slug, slug_confirmed,
--   avatar_url, is_published, first_published_at } — the STORED identity, so
--   a refused CheckLyra ID never becomes the editor's baseline.
--
-- Security reasoning:
--   * BOTH functions are SECURITY INVOKER. They run as the calling member, so
--     owner RLS, the SEC-112 is_published guard, and every existing trigger
--     (identity / photo / item caps and limits / affiliation rules / question
--     answer limits) apply unchanged and their messages flow through
--     verbatim. save_profile grants nothing a member cannot already do with
--     direct PostgREST writes to their own rows; it only adds atomicity, an
--     optimistic-concurrency check and stricter shape rules (no origin change,
--     no cross-section moves, no prompt_id change, no affiliation_type change,
--     inserts always origin='user' / approved / visibility='public').
--   * NOT a moderation boundary. The server action (editor-actions.ts) runs
--     the text validators, the moderation / contact-detail filter and the
--     photo-path check BEFORE calling this function. A member who calls
--     save_profile directly via PostgREST skips all of those — exactly as a
--     direct table write to their own rows does today (SEC-147). The DB
--     triggers (identity, photo, item caps and limits, affiliation rules,
--     answer limits) remain the boundary for limits, and they fire here too.
--   * save_profile never assigns is_published (publishing stays with the
--     service-role publishProfile() flow, which carries the age gate). The
--     CheckLyra ID is written only while first_published_at is null.
--   * suggest_affiliation_names is INVOKER (founder-safe, privacy-maximal):
--     RLS already limits a member to show_on_profile affiliations on
--     published, non-suspended profiles plus their own rows, so nothing hidden
--     can leak through it.
--   * SEC-103 inverted Supabase's default function grant, and CLAUDE.md
--     gotcha #26 explains why revoking from PUBLIC alone is a no-op on
--     Supabase: each function is explicitly revoked from public, anon AND
--     authenticated, then granted EXECUTE to authenticated only.
--   * search_path is pinned to `public, pg_temp` on both.
--
-- Columns: profile_items.sort_order and profile_conversation_starters.sort_order
-- already exist (20260324061701, 20260516200200), so no ordering column is added.
--
-- Rollback (manual):
--   drop function if exists public.save_profile(jsonb, text);
--   drop function if exists public.suggest_affiliation_names(text, text, int);
--   drop index if exists public.school_affiliations_type_name_prefix_idx;

-- ============================================================
-- 1. save_profile — the atomic editor save.
-- ============================================================
create or replace function public.save_profile(p_payload jsonb, p_mode text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_pid          uuid;
  v_updated_at   timestamptz;
  v_first_pub    timestamptz;
  v_is_pub       boolean;
  v_base         timestamptz;
  v_map          jsonb := '{}'::jsonb;
  v_warn         jsonb := '{}'::jsonb;
  v_section      text := 'profile';
  v_client_key   text := null;
  v_ids          uuid[];
  v_n            integer;
  v_row          jsonb;
  v_id           uuid;
  v_old_category text;
  v_old_origin   text;
  v_old_group    text;
  v_new_group    text;
  v_old_prompt   uuid;
  v_old_type     text;
  v_prof         jsonb;
  v_photo        jsonb;
  v_action       text;
  v_mom          jsonb;
  v_result       jsonb;
  v_constraint   text;
begin
  -- ---------- 1. Lock the caller's profile; mode + concurrency checks ----------
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;
  if p_mode is null or p_mode not in ('draft', 'publish', 'published') then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;

  select p.id, p.updated_at, p.first_published_at, coalesce(p.is_published, false)
    into v_pid, v_updated_at, v_first_pub, v_is_pub
    from public.profiles p
   where p.user_id = auth.uid()
     for update;
  if not found then
    raise exception 'Profile not found' using errcode = '42501';
  end if;

  v_base := nullif(p_payload->>'base_updated_at', '')::timestamptz;
  if v_base is not null and v_base is distinct from v_updated_at then
    raise exception 'Your profile was saved somewhere else. Reload to see the latest version.';
  end if;

  if (p_mode = 'published') <> v_is_pub then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;

  -- Save Changes on a live profile must name the version it was edited from.
  if p_mode = 'published' and v_base is null then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;

  -- ---------- 2. Deletes first (explicit id lists; every id must exist) ----------
  v_section := 'items';
  select coalesce(array_agg(distinct e.value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload->'items'->'delete', '[]'::jsonb)) as e(value);
  if cardinality(v_ids) > 0 then
    delete from public.profile_items
     where profile_id = v_pid and origin = 'user' and id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_ids) then
      raise exception 'Some entries no longer exist. Reload to see your latest profile.';
    end if;
  end if;

  v_section := 'ai_gifts';
  select coalesce(array_agg(distinct e.value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload->'ai_gifts'->'delete', '[]'::jsonb)) as e(value);
  if cardinality(v_ids) > 0 then
    delete from public.profile_items
     where profile_id = v_pid and origin = 'ai' and id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_ids) then
      raise exception 'Some entries no longer exist. Reload to see your latest profile.';
    end if;
  end if;

  v_section := 'affiliations';
  select coalesce(array_agg(distinct e.value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload->'affiliations'->'delete', '[]'::jsonb)) as e(value);
  if cardinality(v_ids) > 0 then
    delete from public.school_affiliations
     where profile_id = v_pid and id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_ids) then
      raise exception 'Some entries no longer exist. Reload to see your latest profile.';
    end if;
  end if;

  v_section := 'questions';
  select coalesce(array_agg(distinct e.value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload->'questions'->'delete', '[]'::jsonb)) as e(value);
  if cardinality(v_ids) > 0 then
    delete from public.profile_conversation_starters
     where profile_id = v_pid and id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_ids) then
      raise exception 'Some entries no longer exist. Reload to see your latest profile.';
    end if;
  end if;

  -- ---------- 3 + 4. Items: updates (id present) and inserts (no id) ----------
  v_section := 'items';
  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload->'items'->'upsert', '[]'::jsonb))
  loop
    v_client_key := v_row->>'client_key';
    -- Only v0.8 categories are editable here; legacy rows stay untouched (KAN-490).
    select g.cap_group into v_new_group
      from public.profile_item_rule(v_row->>'category', 'user') g;
    if v_new_group is null then
      raise exception 'Editor is out of date. Reload to continue.';
    end if;

    if nullif(v_row->>'id', '') is not null then
      v_id := (v_row->>'id')::uuid;
      select i.category::text, i.origin into v_old_category, v_old_origin
        from public.profile_items i
       where i.id = v_id and i.profile_id = v_pid
         for update;
      if not found or v_old_origin <> 'user' then
        raise exception 'Some entries no longer exist. Reload to see your latest profile.';
      end if;
      if v_old_category is distinct from v_row->>'category' then
        select g.cap_group into v_old_group
          from public.profile_item_rule(v_old_category, 'user') g;
        if v_old_group is null or v_old_group <> v_new_group then
          raise exception 'Editor is out of date. Reload to continue.';
        end if;
      end if;
      update public.profile_items
         set category    = (v_row->>'category')::public.item_category,
             title       = v_row->>'title',
             description = nullif(v_row->>'description', ''),
             url         = nullif(v_row->>'url', ''),
             group_label = nullif(v_row->>'group_label', '')
       where id = v_id and profile_id = v_pid and origin = 'user';
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'Some entries no longer exist. Reload to see your latest profile.';
      end if;
    else
      if v_client_key is null or v_client_key = '' then
        raise exception 'Editor is out of date. Reload to continue.';
      end if;
      insert into public.profile_items
        (profile_id, category, title, description, url, group_label, origin, approved, visibility)
      values
        (v_pid, (v_row->>'category')::public.item_category, v_row->>'title',
         nullif(v_row->>'description', ''), nullif(v_row->>'url', ''),
         nullif(v_row->>'group_label', ''), 'user', true, 'public')
      returning id into v_id;
      v_map := v_map || jsonb_build_object(v_client_key, v_id);
    end if;
  end loop;
  v_client_key := null;

  -- ---------- Affiliations ----------
  v_section := 'affiliations';
  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload->'affiliations'->'upsert', '[]'::jsonb))
  loop
    v_client_key := v_row->>'client_key';
    if nullif(v_row->>'id', '') is not null then
      v_id := (v_row->>'id')::uuid;
      select a.affiliation_type into v_old_type
        from public.school_affiliations a
       where a.id = v_id and a.profile_id = v_pid
         for update;
      if not found then
        raise exception 'Some entries no longer exist. Reload to see your latest profile.';
      end if;
      if v_row ? 'affiliation_type' and v_row->>'affiliation_type' is distinct from v_old_type then
        raise exception 'Editor is out of date. Reload to continue.';
      end if;
      update public.school_affiliations
         set school_name     = v_row->>'school_name',
             school_location = nullif(v_row->>'school_location', ''),
             description     = nullif(v_row->>'description', ''),
             show_on_profile = coalesce((v_row->>'show_on_profile')::boolean, show_on_profile)
       where id = v_id and profile_id = v_pid;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'Some entries no longer exist. Reload to see your latest profile.';
      end if;
    else
      if v_client_key is null or v_client_key = '' then
        raise exception 'Editor is out of date. Reload to continue.';
      end if;
      insert into public.school_affiliations
        (profile_id, affiliation_type, school_name, school_location, description, show_on_profile)
      values
        (v_pid, v_row->>'affiliation_type', v_row->>'school_name',
         nullif(v_row->>'school_location', ''), nullif(v_row->>'description', ''),
         coalesce((v_row->>'show_on_profile')::boolean, false))
      returning id into v_id;
      v_map := v_map || jsonb_build_object(v_client_key, v_id);
    end if;
  end loop;
  v_client_key := null;

  -- ---------- Questions (prompt_id never changes) ----------
  v_section := 'questions';
  for v_row in
    select value from jsonb_array_elements(coalesce(p_payload->'questions'->'upsert', '[]'::jsonb))
  loop
    v_client_key := v_row->>'client_key';
    if nullif(v_row->>'id', '') is not null then
      v_id := (v_row->>'id')::uuid;
      select q.prompt_id into v_old_prompt
        from public.profile_conversation_starters q
       where q.id = v_id and q.profile_id = v_pid
         for update;
      if not found then
        raise exception 'Some entries no longer exist. Reload to see your latest profile.';
      end if;
      if nullif(v_row->>'prompt_id', '') is not null
         and (v_row->>'prompt_id')::uuid is distinct from v_old_prompt then
        raise exception 'Editor is out of date. Reload to continue.';
      end if;
      if v_old_prompt is null then
        -- Member-written question: wording, answer and order may change.
        update public.profile_conversation_starters
           set answer        = v_row->>'answer',
               custom_prompt = coalesce(v_row->>'custom_prompt', custom_prompt),
               sort_order    = coalesce((v_row->>'sort_order')::integer, sort_order)
         where id = v_id and profile_id = v_pid;
      else
        -- Preset answer: only the answer changes; presets are never reordered.
        update public.profile_conversation_starters
           set answer = v_row->>'answer'
         where id = v_id and profile_id = v_pid;
      end if;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'Some entries no longer exist. Reload to see your latest profile.';
      end if;
    else
      if v_client_key is null or v_client_key = '' then
        raise exception 'Editor is out of date. Reload to continue.';
      end if;
      if nullif(v_row->>'prompt_id', '') is not null then
        insert into public.profile_conversation_starters (profile_id, prompt_id, answer)
        values (v_pid, (v_row->>'prompt_id')::uuid, v_row->>'answer')
        returning id into v_id;
      else
        insert into public.profile_conversation_starters (profile_id, custom_prompt, answer, sort_order)
        values (v_pid, v_row->>'custom_prompt', v_row->>'answer',
                coalesce((v_row->>'sort_order')::integer, 0))
        returning id into v_id;
      end if;
      v_map := v_map || jsonb_build_object(v_client_key, v_id);
    end if;
  end loop;
  v_client_key := null;

  -- ---------- 5. AI gift approvals (never inserts AI rows) ----------
  v_section := 'ai_gifts';
  select coalesce(array_agg(distinct e.value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p_payload->'ai_gifts'->'approve', '[]'::jsonb)) as e(value);
  if cardinality(v_ids) > 0 then
    update public.profile_items
       set approved = true,
           visibility = 'public'
     where profile_id = v_pid and origin = 'ai' and id = any(v_ids);
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_ids) then
      raise exception 'Some entries no longer exist. Reload to see your latest profile.';
    end if;
  end if;

  -- ---------- 6. Manual of me (full object when present; null clears) ----------
  if p_payload ? 'manual_of_me' then
    v_section := 'manual_of_me';
    v_mom := p_payload->'manual_of_me';
    if v_mom is null or jsonb_typeof(v_mom) <> 'object' then
      v_mom := '{}'::jsonb;
    end if;
    insert into public.profile_manual_of_me
      (profile_id, good_to_know, boundaries, communication_style,
       working_preferences, energises_me, drains_me)
    values
      (v_pid,
       nullif(v_mom->>'good_to_know', ''),
       nullif(v_mom->>'boundaries', ''),
       nullif(v_mom->>'communication_style', ''),
       nullif(v_mom->>'working_preferences', ''),
       nullif(v_mom->>'energises_me', ''),
       nullif(v_mom->>'drains_me', ''))
    on conflict (profile_id) do update
      set good_to_know        = excluded.good_to_know,
          boundaries          = excluded.boundaries,
          communication_style = excluded.communication_style,
          working_preferences = excluded.working_preferences,
          energises_me        = excluded.energises_me,
          drains_me           = excluded.drains_me;
  end if;

  -- ---------- 7. profiles: allowlisted columns only, always bumps updated_at ----------
  v_section := 'profile';
  v_prof := coalesce(p_payload->'profile', '{}'::jsonb);
  if jsonb_typeof(v_prof) <> 'object' then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;
  -- A published profile may not lose its display name (spec v0.8 §01).
  if v_is_pub and v_prof ? 'display_name'
     and btrim(coalesce(v_prof->>'display_name', '')) = '' then
    raise exception 'Add a display name';
  end if;

  update public.profiles
     set display_name      = case when v_prof ? 'display_name'
                                  then coalesce(v_prof->>'display_name', '') else display_name end,
         headline          = case when v_prof ? 'headline'
                                  then nullif(v_prof->>'headline', '') else headline end,
         city              = case when v_prof ? 'city'
                                  then nullif(v_prof->>'city', '') else city end,
         country           = case when v_prof ? 'country'
                                  then nullif(v_prof->>'country', '') else country end,
         bio_short         = case when v_prof ? 'bio_short'
                                  then nullif(v_prof->>'bio_short', '') else bio_short end,
         gift_voucher_hint = case when v_prof ? 'gift_voucher_hint'
                                  then nullif(v_prof->>'gift_voucher_hint', '') else gift_voucher_hint end,
         billboard         = case when v_prof ? 'billboard'
                                  then nullif(v_prof->>'billboard', '') else billboard end,
         updated_at        = now()
   where id = v_pid;

  -- Photo: its own statement, so a photo-trigger error (e.g. a published
  -- profile losing its photo) reports section 'photo', field key 'photo'.
  v_section := 'photo';
  v_photo := p_payload->'photo';
  v_action := coalesce(v_photo->>'action', 'keep');
  if v_action not in ('keep', 'remove', 'set') then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;
  if v_action = 'set' and nullif(btrim(coalesce(v_photo->>'avatar_url', '')), '') is null then
    raise exception 'Editor is out of date. Reload to continue.';
  end if;
  if v_action <> 'keep' then
    update public.profiles
       set avatar_url = case v_action when 'remove' then null else v_photo->>'avatar_url' end
     where id = v_pid;
  end if;

  -- CheckLyra ID: only while it is still unlocked (never published).
  if v_prof ? 'slug' then
    v_section := 'slug';
    if v_first_pub is not null then
      raise exception 'CheckLyra ID cannot be changed after publishing';
    end if;
    begin
      update public.profiles
         set slug = v_prof->>'slug',
             slug_confirmed = true
       where id = v_pid;
    exception
      when unique_violation then
        if p_mode = 'draft' then
          -- The rest of the draft still saves; the editor shows "taken".
          v_warn := v_warn || jsonb_build_object('lyra_id', 'taken');
        else
          raise;
        end if;
    end;
  end if;

  -- The STORED state: a refused slug (draft warning) is not what is returned.
  select jsonb_build_object(
           'updated_at', p.updated_at,
           'ids', v_map,
           'warnings', v_warn,
           'slug', p.slug,
           'slug_confirmed', coalesce(p.slug_confirmed, false),
           'avatar_url', p.avatar_url,
           'is_published', coalesce(p.is_published, false),
           'first_published_at', p.first_published_at)
    into v_result
    from public.profiles p
   where p.id = v_pid;

  return v_result;
exception
  when others then
    -- Re-raise unchanged (message + SQLSTATE + constraint), adding where it failed.
    get stacked diagnostics v_constraint = constraint_name;
    if coalesce(v_constraint, '') = '' then
      raise using
        message = sqlerrm,
        errcode = sqlstate,
        detail  = jsonb_build_object('section', v_section, 'client_key', v_client_key)::text;
    else
      raise using
        message    = sqlerrm,
        errcode    = sqlstate,
        constraint = v_constraint,
        detail     = jsonb_build_object('section', v_section, 'client_key', v_client_key)::text;
    end if;
end
$$;

revoke all on function public.save_profile(jsonb, text) from public, anon, authenticated;
grant execute on function public.save_profile(jsonb, text) to authenticated;

-- ============================================================
-- 2. suggest_affiliation_names — autocomplete from visible names.
-- ============================================================
create or replace function public.suggest_affiliation_names(
  p_type   text,
  p_prefix text,
  p_limit  int default 8
)
returns table (name text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select min(btrim(a.school_name)) as name
    from public.school_affiliations a
   where p_type in ('school', 'organisation', 'community')
     and length(btrim(coalesce(p_prefix, ''))) >= 3
     and a.affiliation_type = p_type
     and lower(btrim(a.school_name)) like
           replace(replace(replace(lower(btrim(p_prefix)),
             '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
   group by lower(btrim(a.school_name))
   order by count(distinct a.profile_id) desc, lower(btrim(a.school_name)) asc
   limit least(greatest(coalesce(p_limit, 8), 1), 10);
$$;

revoke all on function public.suggest_affiliation_names(text, text, int) from public, anon, authenticated;
grant execute on function public.suggest_affiliation_names(text, text, int) to authenticated;

-- ============================================================
-- 3. Prefix index for the autocomplete.
-- ============================================================
create index if not exists school_affiliations_type_name_prefix_idx
  on public.school_affiliations (affiliation_type, lower(btrim(school_name)) text_pattern_ops);
