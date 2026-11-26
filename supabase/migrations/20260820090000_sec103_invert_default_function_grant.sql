-- SEC-103 — invert the Supabase default function grant.
--
-- WHAT WAS WRONG
-- --------------
-- Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role`, so every function created in `public` is born
-- callable by `anon` and `authenticated` over PostgREST. On top of that,
-- Postgres' own built-in default grants EXECUTE to PUBLIC. A migration that
-- forgets its revoke does not fail; it publishes.
--
-- That default is the root cause of ten tickets -- SEC-12, 15, 27, 28, 29, 42,
-- 43 and BUGS-48, 65, 69 -- and of gotcha #26. Every control shipped for this
-- class (CTL-023, CTL-024, `check-migration-privileges.py`, INV-2) is a
-- DETECTOR. Adding better alarms on top of an unsafe default is strictly weaker
-- than inverting the default, which is what this migration does: after it, a
-- forgotten grant is a 403 (an availability bug, caught by the soak) instead of
-- a data leak. Supabase is making this the platform default for existing
-- projects on 2026-10-30, so it changes under us either way.
--
-- MEASURED, NOT ASSUMED (dev-lyra, 2026-08-20)
-- --------------------------------------------
-- Negative control, run BEFORE this migration: creating a throwaway
-- SECURITY DEFINER function produced
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- i.e. BOTH vectors present at once -- the leading `=X/postgres` is the
-- built-in PUBLIC grant, and `anon`/`authenticated` are direct grants from
-- Supabase's altered default. `has_function_privilege` returned true for anon
-- and for authenticated.
--
-- THE TRAP THIS MIGRATION AVOIDS
-- ------------------------------
-- The built-in EXECUTE-to-PUBLIC default is GLOBAL, not per-schema. The
-- statement revoking it must therefore be written WITHOUT `in schema public`,
-- or it is a silent no-op that still returns success (supabase/supabase#43884).
-- Both forms are present below and they are not interchangeable.
--
-- STATED GAP -- ONE GRANTOR IS UNREACHABLE FROM A MIGRATION
-- ---------------------------------------------------------
-- `pg_default_acl` on every Lyra database carries TWO grantors for
-- `public`/`f`: `postgres` and `supabase_admin`. SEC-103 step 2 asks for each
-- statement to run twice, once per grantor. That is NOT possible here and this
-- migration deliberately does not pretend otherwise: migrations run as
-- `postgres`, which is not a member of `supabase_admin`, and the attempt was
-- made and refused --
--   ERROR: 42501: permission denied to change default privileges
-- The residual exposure is bounded and was measured: all 42 functions in
-- `public` on dev are owned by `postgres`, so the `supabase_admin` default can
-- only bite for a function created BY the platform in `public`, which no Lyra
-- migration does. Closing it needs Supabase support or the dashboard SQL editor
-- running as a superuser -- Luisa's, and tracked on the ticket, not silently
-- dropped.
--
-- SCOPE OF THE BLAST RADIUS
-- -------------------------
-- ALTER DEFAULT PRIVILEGES affects objects created FROM NOW ON. It does not
-- touch a single existing ACL, so nothing that works today stops working today.
-- `CREATE OR REPLACE` on an existing function also leaves its ACL untouched
-- (Postgres docs), so re-deploying an existing function is safe too. The real
-- future vector is a signature change, which creates a NEW overload -- and that
-- overload now arrives locked instead of open, which is the entire point.
--
-- ROLLBACK
-- --------
--   alter default privileges for role postgres in schema public
--     grant execute on functions to anon, authenticated;
--   alter default privileges for role postgres
--     grant execute on functions to public;
--   -- and drop the explicit grants re-asserted at the end of this file.
--
-- db-privileges-ok: SEC-103 -- this migration creates no function; it changes
-- the default privilege posture itself and re-asserts existing grants.

begin;

-- 1. Remove the direct anon/authenticated EXECUTE default that Supabase ships.
--    Per-schema form: this one MUST name `in schema public`.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- 2. Remove Postgres' built-in EXECUTE-to-PUBLIC default.
--    GLOBAL form: this one MUST NOT name `in schema public`. Writing
--    `in schema public` here succeeds and does nothing -- see above.
alter default privileges for role postgres
  revoke execute on functions from public;

-- 3. Re-assert, explicitly, the EXECUTE grants the application actually needs.
--
--    These three are the complete set of RPCs Lyra calls with an anon-key or
--    cookie-session client (i.e. as `authenticated`), enumerated from the
--    `.rpc(` call sites across all three repositories and checked against the
--    client each one uses. Every other RPC call in the estate -- including both
--    MCP servers, which connect with SUPABASE_SERVICE_ROLE_KEY -- runs as
--    `service_role`, whose default is untouched above.
--
--    These grants are no-ops against today's ACLs. They exist so the
--    requirement is written down in the repository rather than surviving only
--    as a side effect of a platform default that this migration has just
--    removed.
--    Signatures are the live `pg_get_function_identity_arguments` values, read
--    from the catalogue rather than written from memory: each of the three has
--    exactly ONE overload today, and naming a signature that does not exist
--    would fail loudly here but naming a DIFFERENT overload would quietly grant
--    the wrong function -- the second vector in gotcha #26.
grant execute on function
  public.admin_list_users(text, text, boolean, boolean, boolean, integer, integer)
  to authenticated;
grant execute on function
  public.admin_filter_profile_ids(text, text, boolean, boolean, boolean, integer)
  to authenticated;
grant execute on function
  public.search_by_contact_hash(text, text)
  to authenticated;

-- 4. `get_metrics_for_window` is DELIBERATELY ABSENT from the list above.
--
--    Read this before "completing" the set. A naive enumeration -- grep for
--    `.rpc(`, keep the ones using the cookie client -- yields FOUR functions,
--    and the fourth is this one, via `getAnomalyWindow` and
--    `getMetricsForWindow` in src/modules/observability/metrics.ts. Granting it
--    would re-open F-14 / SEC-07 by letting any logged-in user call a
--    SECURITY DEFINER counts function.
--
--    Both of those call sites are DEAD: the only live caller is
--    `getAnomalyWindowAdmin`, which routes through the service-role client
--    precisely because BUGS-71 found the authenticated read failing with a
--    swallowed 42501. Live ACL on dev confirms it: {postgres,service_role} and
--    no `authenticated`. It stays that way.
--
--    The general lesson, since this is the migration that removes the safety
--    net: after inversion the enumeration of grants is the load-bearing step,
--    and a dead call site reads exactly like a live one to grep.

commit;
