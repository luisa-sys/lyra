-- SEC-57 (retain leg) — suspension must invalidate credentials ALREADY issued.
--
-- WHAT WAS WRONG
-- --------------
-- The "obtain" half of SEC-57 landed in PR #448: a suspended account can no
-- longer mint an API key or complete an OAuth consent. Suspension was still
-- purely forward-looking. Both suspend writers touch `profiles` and nothing
-- else --
--   * web bulk action  src/app/admin/users/actions.ts (computeAccessTransition)
--   * admin-MCP tool   admin_suspend_user
-- so a suspended user's existing `lyra_...` API key and OAuth grant stayed
-- structurally valid indefinitely. API keys have no expiry at all.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE
-- -------------------------------------
-- This defect family is the one CLAUDE.md/SEC-101 names as recurring: "eight
-- tickets for a suspension guard added to one call site but not its siblings".
-- There are already TWO writers of profiles.is_suspended in two repositories,
-- and a third (a support script, or runbook SQL applied with the Supabase MCP)
-- is entirely plausible -- gotcha #9 means DDL and DML reach a database without
-- passing through a pull request at all. Duplicating the revocation in each
-- application path is exactly how the sibling-call-site defect recurs.
--
-- The `profiles.is_suspended` transition is the single chokepoint every writer
-- shares, present and future. Enforcing here makes "a new suspend path that
-- forgets to revoke" IMPOSSIBLE rather than merely DETECTABLE, which is the
-- ordering SEC-101 asks for.
--
-- DELIBERATELY ONE-WAY
-- --------------------
-- Unsuspending restores NOTHING. Re-arming a credential that may itself be the
-- reason for the suspension is the wrong default, and re-minting is cheap and
-- now correctly gated by PR #448. `oauth_consents` is revoked for the same
-- reason: an unsuspended user must pass a fresh consent screen rather than
-- silently inheriting the grant that was live at the moment of moderation.
-- Documented in docs/RUNBOOK.md so support does not read a re-mint as a bug.
--
-- FAIL CLOSED. An error inside this function aborts the suspending
-- transaction. That is correct and intentional: failing the suspend loudly is
-- better than recording a suspension whose credentials are still live. Do NOT
-- wrap the body in an exception handler -- that is the error-swallowing
-- fallback the Workflow & Backup Integrity Policy forbids.
--
-- SCOPE. Every write is filtered on `new.user_id` alone. `bulkUserAction` is
-- multi-user (BULK_MAX = 500) but the trigger is FOR EACH ROW, so a bulk
-- suspend revokes exactly the rows whose profile transitioned and nobody
-- else's. There is no `.in()` list to mis-scope.
--
-- KEY JOIN. `profiles.user_id` is `auth.users.id`, which is the same FK used by
-- api_keys.user_id, oauth_access_tokens.user_id, oauth_refresh_tokens.user_id
-- and oauth_consents.user_id -- verified against the live dev catalogue, not
-- assumed. Note this is `user_id`, NOT `profiles.id`; they are different
-- columns and using the wrong one revokes nothing while appearing to work.
--
-- WHAT THIS DOES NOT CLOSE ON ITS OWN (SEC-46 dependency).
-- Stamping `oauth_access_tokens.revoked_at` is INERT until a resource server
-- actually reads it. Both MCP servers check it behind OAUTH_REVOCATION_CHECK,
-- which is SEC-46 leg 1. Until that flips, the OAuth half buys containment only
-- via the refresh-family and consent revocation: no NEW access token can be
-- minted and the live one dies at its ~1h TTL. The `api_keys` half is fully
-- effective immediately and independent of SEC-46 -- lyra-mcp-server's
-- authenticateApiKey already rejects on revoked_at.
--
-- ROLLBACK
--   drop trigger if exists profiles_revoke_credentials_on_suspend on public.profiles;
--   drop function if exists public.sec57_revoke_credentials_on_suspend();
-- Note that is not an undo: credentials already revoked stay revoked. That is
-- acceptable -- the affected accounts are suspended.

create or replace function public.sec57_revoke_credentials_on_suspend()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_keys int;
  v_access int;
  v_refresh int;
  v_consents int;
begin
  update public.api_keys
     set revoked_at = v_now
   where user_id = new.user_id
     and revoked_at is null;
  get diagnostics v_keys = row_count;

  update public.oauth_access_tokens
     set revoked_at = v_now
   where user_id = new.user_id
     and revoked_at is null;
  get diagnostics v_access = row_count;

  -- oauth_refresh_tokens has no revoked_at column -- `used_at` is its kill
  -- switch, matching revokeFamily() in src/modules/oauth-as/lib/refresh.ts.
  -- Writing revoked_at here would fail at runtime, so this asymmetry is load
  -- bearing rather than an inconsistency to tidy up.
  update public.oauth_refresh_tokens
     set used_at = v_now
   where user_id = new.user_id
     and used_at is null;
  get diagnostics v_refresh = row_count;

  update public.oauth_consents
     set revoked_at = v_now
   where user_id = new.user_id
     and revoked_at is null;
  get diagnostics v_consents = row_count;

  raise log 'SEC-57: suspension of user_id=% revoked % api_keys, % access_tokens, % refresh_tokens, % consents',
    new.user_id, v_keys, v_access, v_refresh, v_consents;

  return new;
end
$$;

-- `of is_suspended` plus the false->true `when` clause means the trigger fires
-- ONLY on the transition, so re-suspending an already-suspended user, or a bulk
-- update touching other columns on a suspended row, is a no-op and does not
-- re-stamp timestamps. The `where ... is null` guards preserve an existing
-- revoked_at rather than overwriting it.
drop trigger if exists profiles_revoke_credentials_on_suspend on public.profiles;
create trigger profiles_revoke_credentials_on_suspend
  after update of is_suspended on public.profiles
  for each row
  when (new.is_suspended is true and coalesce(old.is_suspended, false) is false)
  execute function public.sec57_revoke_credentials_on_suspend();

-- Gotcha #26: a SECURITY DEFINER function is born holding Supabase's default
-- EXECUTE grants for anon and authenticated. `revoke ... from public` alone is
-- a no-op against those two roles, which is the single mis-specified revoke
-- behind SEC-28/29/42/43. Name all three explicitly. A trigger function needs
-- no caller EXECUTE at all -- the trigger invokes it -- so nothing beyond
-- service_role is granted.
revoke all on function public.sec57_revoke_credentials_on_suspend() from public, anon, authenticated;
grant execute on function public.sec57_revoke_credentials_on_suspend() to service_role;
