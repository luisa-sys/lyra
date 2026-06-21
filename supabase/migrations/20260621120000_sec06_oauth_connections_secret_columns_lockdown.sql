-- SEC-06 (BUGS-28, TDD 2026-06-21): lock down oauth_connections token-secret columns.
--
-- Problem
-- -------
-- The oauth_connections_owner_insert / _update RLS policies
-- (20260516230000_convene_identity_consent.sql) check only
-- `auth.uid() = owner_user_id`. The Vault-reference columns
-- refresh_token_secret_id / access_token_secret_id are therefore writable by the
-- authenticated browser client: a user could INSERT/UPDATE their own connection
-- row while pointing a *_secret_id at ANOTHER user's Vault secret UUID
-- (cross-account token reference). Pairs with SEC-01/BUGS-24 (anon-executable
-- vault RPCs) to form a token-theft chain.
--
-- Why a trigger (not REVOKE)
-- --------------------------
-- Postgres column-level REVOKE does not override a table-level grant, and
-- Supabase grants table-level INSERT/UPDATE to `authenticated`. The legitimate
-- disconnect flow (src/.../connections-client.tsx) UPDATEs non-secret columns
-- (deleted_at, status) as the authenticated user, so we cannot simply drop the
-- UPDATE policy. A BEFORE INSERT/UPDATE trigger enforces exactly the needed rule
-- regardless of grants:
--   * service_role (backend OAuth callback) may set the Vault references;
--   * authenticated/anon may NOT insert connection rows, and may NOT change the
--     *_secret_id columns on update (but may still set deleted_at/status, etc.).
--
-- Non-destructive: no data change; RLS policies are left intact (defence in depth).
--
-- Rollback:
--   drop trigger if exists oauth_connections_guard_secret_cols on public.oauth_connections;
--   drop function if exists public.oauth_connections_guard_secret_cols();
--
-- Apply order: dev -> staging -> prod (per Supabase Migration Rules). After each
-- apply, smoke-test the Convene connect (service-role insert) AND disconnect
-- (authenticated update of deleted_at/status) flows.

create or replace function public.oauth_connections_guard_secret_cols()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Backend writes use the service-role key (auth.role() = 'service_role') and are
  -- the only path allowed to create connections or set the Vault token references.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception
      'oauth_connections: inserts are service-role only (SEC-06)'
      using errcode = '42501';
  end if;

  -- UPDATE by a non-service-role client: permit everything EXCEPT changing the
  -- token-secret references.
  if new.refresh_token_secret_id is distinct from old.refresh_token_secret_id
     or new.access_token_secret_id is distinct from old.access_token_secret_id then
    raise exception
      'oauth_connections: token-secret columns are service-role only (SEC-06)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger oauth_connections_guard_secret_cols
  before insert or update on public.oauth_connections
  for each row
  execute function public.oauth_connections_guard_secret_cols();
