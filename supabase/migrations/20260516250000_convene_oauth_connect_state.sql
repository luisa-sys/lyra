-- KAN-206 — Convene P2: ephemeral OAuth-initiation state.
--
-- When an MCP tool or a web UI button initiates a Convene OAuth flow, we need
-- a CSRF state token that the provider's callback can verify. The state is
-- short-lived (10-minute TTL) and self-cleaning.

create table public.oauth_connect_state (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft', 'apple', 'caldav_generic')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index oauth_connect_state_expires_idx on public.oauth_connect_state (expires_at);

alter table public.oauth_connect_state enable row level security;

-- The state token is opaque and unguessable; reads use the state value itself.
-- We don't expose this table to anon/authenticated via policies — the
-- callback route uses service-role to look up and delete. Auth users can see
-- their own row to render a "connecting…" indicator if needed.
create policy oauth_connect_state_owner_select on public.oauth_connect_state
  for select using (auth.uid() = user_id);

-- Cleanup helper — call periodically to remove stale rows.
create or replace function public.oauth_connect_state_purge_expired()
  returns int
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  deleted int;
begin
  delete from public.oauth_connect_state where expires_at < now();
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function public.oauth_connect_state_purge_expired() from anon, authenticated;

comment on table public.oauth_connect_state is 'KAN-206 — CSRF state for OAuth flows. 10-min TTL, service-role cleanup.';
