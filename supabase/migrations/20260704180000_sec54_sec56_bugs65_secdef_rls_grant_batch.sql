-- SEC-54 / SEC-56 / BUGS-65 — SECURITY DEFINER + RLS + grant hygiene batch
-- Epic KAN-350 (2026-06-30 codebase review). Three defence-in-depth findings,
-- one migration. Apply order: dev -> staging -> prod (supervised; autopilot
-- applies dev only). All statements are idempotent / safe to re-run.
--
-- Rollback (per section): see the inline "-- Rollback:" notes below. None of
-- these changes remove data; they tighten privileges and pin a search_path.

-- ============================================================================
-- SEC-54 (finding web-secdef-1) — pin handle_new_user search_path
-- ============================================================================
-- The handle_new_user SECURITY DEFINER trigger shipped with a mutable
-- (unpinned) search_path — the classic search_path-injection priv-esc vector
-- and the Supabase `function_search_path_mutable` advisor finding. The
-- 2026-06-21 audit pinned ~11 other functions but missed this one.
--
-- Re-create it with `set search_path = ''` AND a fully schema-qualified body,
-- so the function is correct on every environment regardless of whether that
-- env still carries the original (unqualified) body. `public.profiles` is
-- explicitly qualified; split_part/coalesce/lower/replace/substr are pg_catalog
-- built-ins and resolve via the always-implicit pg_catalog even with an empty
-- search_path.
--
-- Rollback: CREATE OR REPLACE the same body without the `SET search_path`
-- clause (restores the mutable search_path — not recommended).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (user_id, display_name, slug)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    lower(replace(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), ' ', '-'))
      || '-' || substr(new.id::text, 1, 8)
  );
  return new;
end;
$function$;

-- ============================================================================
-- SEC-56 (finding web-oauth-5) — lock down oauth_connections direct writes
-- ============================================================================
-- The oauth_connections UPDATE RLS policy was column-unrestricted, so an
-- authenticated user could repoint their refresh_token_secret_id at another
-- user's Vault secret and have the server mint live Google/Microsoft tokens for
-- the victim (cross-user token-theft primitive). Every legitimate write already
-- goes through the service-role upsertConnection path (src/lib/convene/
-- oauth-connections.ts), which is unaffected by these grants. Remove direct
-- INSERT/UPDATE/DELETE from anon + authenticated; owner SELECT (table grant +
-- RLS `oauth_connections_owner_select`) is retained.
--
-- Rollback: GRANT INSERT, UPDATE, DELETE ON public.oauth_connections
--           TO authenticated, anon;  (re-opens the priv-esc — not recommended)
revoke insert, update, delete on public.oauth_connections from authenticated;
revoke insert, update, delete on public.oauth_connections from anon;

-- ============================================================================
-- BUGS-65 (B9 residual, post-BUGS-48) — revoke PUBLIC execute on 2 newer
-- SECURITY DEFINER trigger functions
-- ============================================================================
-- block_admin_is_suspended_self_set and prevent_feature_entitlement_self_grant
-- were created 2026-06-22 (one day after BUGS-48 closed) and so were never
-- included in that revoke sweep. Both RETURNS trigger (grant-independent when
-- fired as triggers — PostgREST cannot supply TriggerData via /rpc), but both
-- still carry the inherited default PUBLIC EXECUTE grant. Mirror BUGS-48's
-- shape: revoke from PUBLIC/anon/authenticated, keep service_role.
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.<fn>() TO public;  (not recommended)
revoke execute on function public.block_admin_is_suspended_self_set() from public, anon, authenticated;
revoke execute on function public.prevent_feature_entitlement_self_grant() from public, anon, authenticated;
grant execute on function public.block_admin_is_suspended_self_set() to service_role;
grant execute on function public.prevent_feature_entitlement_self_grant() to service_role;
