-- BUGS-60 — restore EXECUTE for `authenticated` on the admin user-list RPCs.
--
-- SEC-29 revoked EXECUTE on admin_list_users + admin_filter_profile_ids from
-- anon, authenticated and PUBLIC. The anon/PUBLIC revoke is correct defence-in-
-- depth, but revoking `authenticated` broke the admin console: the admin pages
-- call these SECURITY DEFINER functions via the *authenticated* admin session
-- (src/app/admin/users/page.tsx, actions.ts), which they MUST — the functions
-- gate on `auth.uid()` (`... where user_id = auth.uid() and is_admin = true`),
-- so a service-role call (auth.uid() = null) would fail their own admin check.
-- Symptom: "Could not load users: permission denied for function admin_list_users".
--
-- Granting `authenticated` is safe: the functions self-gate on is_admin, so a
-- non-admin authenticated caller gets `admin only` (42501), never data. anon and
-- PUBLIC stay revoked. This migration documents the intended end-state ACL for
-- fresh DBs (the live grant was applied to dev/staging/prod on 2026-06-28).
--
-- Rollback: `revoke execute ... from authenticated` — but that re-breaks the
-- admin console, so don't, unless the admin pages move to a service-role caller
-- that injects the admin's JWT.

revoke execute on function public.admin_list_users(text, text, boolean, boolean, boolean, integer, integer) from anon, public;
revoke execute on function public.admin_filter_profile_ids(text, text, boolean, boolean, boolean, integer) from anon, public;

grant execute on function public.admin_list_users(text, text, boolean, boolean, boolean, integer, integer) to authenticated;
grant execute on function public.admin_filter_profile_ids(text, text, boolean, boolean, boolean, integer) to authenticated;
