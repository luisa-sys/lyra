-- SEC-112 [HIGHEST]: `is_published` is self-writable via PostgREST — a latent
-- bypass of the KAN-408 provider age gate.
--
-- THREAT: `authenticated` holds a TABLE-level UPDATE grant on public.profiles;
-- the "Update own profile" RLS policy is `auth.uid() = user_id` with a NULL
-- with_check, so a user may update any column of their own row; and no trigger
-- protected `is_published`. The existing guards cover is_admin/is_suspended
-- (SEC-27), the beta/access/age columns (prevent_beta_self_elevation) and
-- is_homepage_example — `is_published` was in none of them.
--
-- So an authenticated user could send
--   PATCH /rest/v1/profiles?user_id=eq.<own-uid>   {"is_published": true}
-- with the browser-available publishable key and their own session JWT, and
-- publish without passing publishProfile() — which is where the KAN-408 age
-- gate lives. The row then becomes anon-readable through the
-- "Anyone can read published non-suspended profiles" policy.
--
-- Exposure was LATENT, not live: `global_feature_switches` carries no
-- `age_verification` row on any environment and that key's `defaultEnabled` is
-- false (src/modules/features/global-features.ts), so the gate enforces nothing
-- for anyone today. It matters because the control becomes silently ineffective
-- the moment an admin turns the switch on. On a service holding minors' data, a
-- gate that is quietly inert when enabled is the whole risk.
--
-- FIX: a BEFORE UPDATE trigger rejecting any user-context change to
-- `is_published`, following the SEC-27 shape exactly (service role and
-- migrations — auth.uid() IS NULL — pass through, so the admin
-- publish/unpublish path via getAdminServiceClient() is unaffected).
--
-- ⚠️ THIS MIGRATION REQUIRES THE PAIRED CODE CHANGE AND MUST NOT BE APPLIED
-- WITHOUT IT. Before SEC-112, publishProfile() wrote `is_published` on the
-- client from createClient() — the ANON key carrying the end user's session
-- JWT — so auth.uid() was the user and THIS TRIGGER WOULD HAVE REFUSED THE REAL
-- PRODUCT PUBLISH FLOW, not just the bypass. That is the BUGS-60 over-revoking
-- failure mode. The paired change moves that one write to
-- createServiceRoleClient(), scoped by the server-validated user id, keeping the
-- age gate immediately in front of it. Deploy order therefore matters: the code
-- must be live in an environment before this migration is applied there.
--
-- The alternative — evaluate the age gate inside the trigger so the user
-- credential could keep the write — is not available. The gate reads
-- global_feature_switches filtered by getDeployEnv(), which is application-side:
-- `beta` and `prod` are two environments sharing ONE Supabase project with two
-- different switch rows, so a trigger cannot tell which is asking. Passing the
-- environment into an RPC only moves the lie to the caller.
--
-- ⚠️ NO COLUMN REVOKE HERE, DELIBERATELY — AND SEC-27's IS INERT.
-- The natural next line, mirroring 20260622170000_block_admin_suspended_self_set.sql:
--     revoke update (is_published) on public.profiles from authenticated, anon;
-- does NOTHING, and shipping it would plant a false belief in a second layer
-- that does not exist. A column-level REVOKE cannot subtract from a TABLE-level
-- grant; Postgres warns "no privileges could be revoked for column ..." and
-- carries on. Measured on prod 2026-08-14: pg_class.relacl is
-- {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
-- (w = UPDATE, at table level) while pg_attribute.attacl is NULL for every one
-- of the 38 columns — i.e. SEC-27's own "defence in depth" line has been inert
-- since 2026-06-22 and only its trigger is enforcing. Reproduced on dev with a
-- scratch table: after `grant update on t to authenticated;` then
-- `revoke update (b) on t from authenticated;`, attacl stays NULL and
-- has_column_privilege('authenticated', t, 'b', 'UPDATE') is still true.
-- Narrowing the table-level grant to an explicit column list is the real fix and
-- is tracked separately — it is a 38-column change that diverges by environment
-- (dev has 42) and does not belong in a trigger migration.
--
-- The trigger is sufficient on its own regardless: a grant controls whether the
-- UPDATE may be attempted, the trigger controls whether it takes effect.
--
-- ROLLBACK:
--   drop trigger if exists profiles_block_is_published_self_set on public.profiles;
--   drop function if exists public.block_is_published_self_set();
--   -- and revert publishProfile() to the user-context client, or publishing breaks.

create or replace function public.block_is_published_self_set()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role / migrations (no JWT subject): allow. This is the escape hatch
  -- that keeps publishProfile() and the admin console working; it must be
  -- preserved verbatim (SEC-27, BUGS-60).
  if auth.uid() is null then
    return new;
  end if;
  if new.is_published is distinct from old.is_published then
    raise exception 'is_published may only be set by the publish flow, which carries the age gate (SEC-112)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_is_published_self_set on public.profiles;
create trigger profiles_block_is_published_self_set
  before update on public.profiles
  for each row execute function public.block_is_published_self_set();

-- Gotcha #26 / R2: a SECURITY DEFINER function is born holding the Supabase
-- default grants (ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role), so every migration revokes explicitly from all
-- three roles. Without this INV-1 ("anon holds EXECUTE on a SECURITY DEFINER
-- function") would fire on this function in every environment.
--
-- This does NOT disable the trigger: Postgres does not check EXECUTE on a
-- trigger function when firing a trigger, it invokes it as part of the DML.
-- Not taken on faith — the three sibling guards already live on production
-- revoked to exactly this ACL ({postgres=X/postgres,service_role=X/postgres})
-- and fire correctly, and the revoked form was re-verified end-to-end on dev
-- before this line was written. (Note those three carry the revoke on the
-- DATABASE but not in their migration files, which is a CTL-049
-- applied-not-in-repo divergence rather than anything wrong with them.)
--
-- Unlike the column revoke discussed above, this one is real: a function ACL is
-- the level the privilege is actually held at.
revoke all on function public.block_is_published_self_set() from public, anon, authenticated;
grant execute on function public.block_is_published_self_set() to service_role;
