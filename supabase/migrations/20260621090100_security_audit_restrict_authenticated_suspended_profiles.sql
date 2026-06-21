-- =====================================================================
-- Security audit 2026-06-21 (F-03b) — close the authenticated-side
-- suspended-profile read gap. The {authenticated} policy "Read own or
-- published profiles" lacked the is_suspended guard, so any logged-in user
-- could still view a suspended (moderated) profile. Admins read via the
-- service-role client (src/app/admin/page.tsx) and are unaffected by RLS.
-- Applied to dev + staging + prod on 2026-06-21 (BUGS-45). Idempotent.
-- ROLLBACK:
--   drop policy if exists "Read own or published profiles" on public.profiles;
--   create policy "Read own or published profiles" on public.profiles
--     for select to authenticated
--     using ( (select auth.uid()) = user_id or is_published = true );
-- =====================================================================
drop policy if exists "Read own or published profiles" on public.profiles;
create policy "Read own or published profiles" on public.profiles
  for select to authenticated
  using ( (select auth.uid()) = user_id or (is_published = true and is_suspended = false) );
