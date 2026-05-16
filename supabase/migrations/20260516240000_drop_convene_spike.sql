-- KAN-205 — drop the P0 spike artifacts.
--
-- The convene_spike_oauth_connections table is superseded by
-- public.oauth_connections (created in migration 20260516230000).
-- The convene_vault_* security-definer functions are KEPT — they are reused
-- by the real OAuth flow that lands in P2.

drop table if exists public.convene_spike_oauth_connections;

-- Sanity comment for future grep — the spike is officially gone.
comment on function public.convene_vault_store_secret(text, text)
  is 'Reused from P0 spike (KAN-204); now serves the canonical oauth_connections table.';
