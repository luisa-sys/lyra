-- KAN-482: shown affiliations are no longer readable with the public anon key.
--
-- DPIA §2a (affiliation-based discovery), rule AD-5 / risk R10. The policy
-- "Anyone can read visible affiliations from published profiles"
-- (20261113120000_hidden_affiliations_public_read_rls.sql) has no `to` clause,
-- so it applies to `anon`: anyone holding the public anon key can list every
-- SHOWN affiliation of every published, non-suspended profile through
-- PostgREST — school name AND location/postcode, relationship, description —
-- filtered by school, up to 1,000 rows per request:
--
--   GET /rest/v1/school_affiliations?select=*&school_name=ilike.*oakfield*
--
-- That is a "people at this school" list with no sign-in, no sanitising and
-- no cap, which AD-5 forbids. Hidden affiliations were already not readable.
--
-- Nothing anonymous needs it: the public profile page and /search read
-- through the service role (src/modules/public-profile/load-public-profile.ts,
-- src/app/search/page.tsx), and the MCP server uses the service role too
-- (lyra-mcp-server src/supabase.ts). Signed-in reads still need it — the
-- editor's affiliation autocomplete, public.suggest_affiliation_names, is
-- SECURITY INVOKER — so the policy is kept for `authenticated`, unchanged
-- otherwise.
--
-- Fix: recreate the same policy restricted `to authenticated`, with the same
-- predicate. The policy NAME is kept (it is referenced by tests and docs) even
-- though "Anyone" now means "any signed-in member"; rename separately if
-- wanted. The owner policy "Manage own school affiliations" is untouched.
--
-- Idempotent (drop-if-exists + create). Not destructive: no table or column
-- is dropped, and service-role reads are unaffected.
--
-- Rollback (manual; re-opens anonymous reads of shown affiliations):
--   drop policy if exists "Anyone can read visible affiliations from published profiles" on public.school_affiliations;
--   create policy "Anyone can read visible affiliations from published profiles"
--     on public.school_affiliations for select
--     using (show_on_profile = true and exists (select 1 from public.profiles
--       where id = school_affiliations.profile_id and is_published = true and is_suspended = false));

drop policy if exists "Anyone can read visible affiliations from published profiles" on public.school_affiliations;
create policy "Anyone can read visible affiliations from published profiles"
  on public.school_affiliations for select
  to authenticated
  using (
    show_on_profile = true
    and exists (
      select 1 from public.profiles
      where id = school_affiliations.profile_id
        and is_published = true
        and is_suspended = false
    )
  );
