-- KAN-326 / KAN-329: surface the clean status model in the admin user list.
-- admin_list_users now also returns user_status, access_tier, is_published,
-- age_status (for the computed publish-status badge) and has_revoked_ga_feature
-- (any GA/default-on feature turned off -> "features disabled" badge).
--
-- Same signature as 20260622120000 -> CREATE OR REPLACE just swaps the body
-- (no new overload, grants unchanged). Filters still key off the legacy columns,
-- which are kept in sync until the legacy-drop migration.
--
-- ROLLBACK: restore the admin_list_users body from 20260622120000.

create or replace function public.admin_list_users(
  p_search    text    default null,
  p_stage     text    default null,
  p_early     boolean default null,
  p_suspended boolean default null,
  p_admin     boolean default null,
  p_limit     int     default 20,
  p_offset    int     default 0
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total  bigint;
  v_rows   json;
  v_limit  int  := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not exists (
    select 1 from public.profiles
     where user_id = auth.uid() and is_admin = true
  ) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where (v_search is null
          or u.email          ilike '%' || v_search || '%'
          or p.display_name   ilike '%' || v_search || '%'
          or p.slug           ilike '%' || v_search || '%')
     and (p_stage     is null or p.access_stage::text = p_stage)
     and (p_early     is null or p.early_access       = p_early)
     and (p_suspended is null or p.is_suspended       = p_suspended)
     and (p_admin     is null or p.is_admin           = p_admin);

  select coalesce(json_agg(r), '[]'::json) into v_rows
    from (
      select p.id,
             p.user_id,
             u.email,
             p.display_name,
             p.slug,
             p.created_at,
             p.user_status,
             p.access_tier,
             p.is_published,
             p.age_status,
             p.access_stage,
             p.early_access,
             p.is_beta_eligible,
             p.beta_access_status,
             p.beta_requested_at,
             p.beta_approved_at,
             p.is_suspended,
             p.is_admin,
             exists (
               select 1 from public.feature_entitlements fe
                where fe.profile_id = p.id
                  and fe.enabled = false
                  and fe.feature_key in ('media_uploads', 'discovery') -- GA (tier='ga') keys; see src/lib/features/registry.ts
             ) as has_revoked_ga_feature
        from public.profiles p
        join auth.users u on u.id = p.user_id
       where (v_search is null
              or u.email        ilike '%' || v_search || '%'
              or p.display_name ilike '%' || v_search || '%'
              or p.slug         ilike '%' || v_search || '%')
         and (p_stage     is null or p.access_stage::text = p_stage)
         and (p_early     is null or p.early_access       = p_early)
         and (p_suspended is null or p.is_suspended       = p_suspended)
         and (p_admin     is null or p.is_admin           = p_admin)
       order by p.created_at desc
       limit v_limit offset v_offset
    ) r;

  return json_build_object('rows', v_rows, 'total', v_total);
end;
$$;
