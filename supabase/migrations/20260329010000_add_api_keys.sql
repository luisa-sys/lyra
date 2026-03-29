-- KAN-76: MCP API key authentication
-- Allows AI companions to act on behalf of authenticated users

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  key_hash text not null,
  key_prefix text not null, -- first 8 chars for identification (e.g. "lyra_abc1")
  name text not null default 'Default',
  last_used_at timestamptz,
  created_at timestamptz default now(),
  revoked_at timestamptz
);

create index api_keys_key_hash_idx on public.api_keys(key_hash);
create index api_keys_user_id_idx on public.api_keys(user_id);

-- RLS: users can manage their own API keys
alter table public.api_keys enable row level security;

create policy "Users can manage own API keys"
  on public.api_keys for all
  using (user_id = auth.uid());
