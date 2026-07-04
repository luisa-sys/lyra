-- KAN-348 — DEV / STAGING ONLY. DO NOT APPLY TO PROD (llzkgprqewuwkiwclowi).
--
-- WHAT
--   A single service-role-only helper the authenticated E2E harness calls right
--   after creating a test user via the admin API. `auth.admin.createUser` leaves
--   the GoTrue token columns (confirmation_token, recovery_token, …) NULL, and a
--   later token operation (generateLink, used by the harness to mint a session)
--   500s with "converting NULL to string is unsupported". This function rewrites
--   those NULLs to '' for a single uid so the mint round-trip works.
--
-- WHY IT IS SAFE (no auth bypass)
--   * It ONLY touches token *string* columns and only where they are NULL — it
--     does NOT confirm emails, grant access, set passwords, or alter any
--     app-level access column. It cannot elevate a user.
--   * EXECUTE is service-role ONLY (revoked from public/anon/authenticated),
--     mirroring the hardening in 20260621120000_revoke_secdef_exec_bugs44.sql.
--     The service-role key exists only in the dev/staging E2E harness, never in
--     the prod app runtime.
--
-- APPLY TO
--   dev (ilprytcrnqyrsbsrfujj) + staging (uobmlkzrjkptwhttzmmi) ONLY.
--   NEVER prod (llzkgprqewuwkiwclowi) — the harness never runs against prod and
--   this function has no reason to exist there.
--
-- ROLLBACK
--   drop function if exists public.e2e_fix_auth_tokens(uuid);

create or replace function public.e2e_fix_auth_tokens(uid uuid)
returns void
language plpgsql
security definer
set search_path = auth, pg_temp
as $$
begin
  update auth.users
     set confirmation_token        = coalesce(confirmation_token, ''),
         recovery_token            = coalesce(recovery_token, ''),
         email_change_token_new     = coalesce(email_change_token_new, ''),
         email_change_token_current = coalesce(email_change_token_current, ''),
         phone_change_token         = coalesce(phone_change_token, ''),
         reauthentication_token     = coalesce(reauthentication_token, '')
   where id = uid
     and (
       confirmation_token is null
       or recovery_token is null
       or email_change_token_new is null
       or email_change_token_current is null
       or phone_change_token is null
       or reauthentication_token is null
     );
end;
$$;

-- Service-role only (mirrors SEC-07 / BUGS-44 lockdown).
revoke execute on function public.e2e_fix_auth_tokens(uuid) from public, anon, authenticated;
grant  execute on function public.e2e_fix_auth_tokens(uuid) to service_role;
