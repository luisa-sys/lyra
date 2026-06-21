-- =====================================================================
-- Security audit 2026-06-21 — lock down anon/public-exposed DB surface
-- Findings F-01 (vault RPCs), F-14 (metrics RPC), F-03 (profiles RLS).
-- Applied to dev + staging + prod on 2026-06-21 via Supabase apply_migration;
-- committed here for version control (BUGS-45). Idempotent / safe to re-apply.
-- ROLLBACK (only if a regression is proven — NOT recommended):
--   grant execute on function public.convene_vault_read_secret(uuid)        to anon, authenticated;
--   grant execute on function public.convene_vault_store_secret(text, text) to anon, authenticated;
--   grant execute on function public.convene_vault_revoke_secret(uuid)      to anon, authenticated;
--   grant execute on function public.get_metrics_for_window(timestamptz, timestamptz) to anon;
--   create policy "Anon read published profiles" on public.profiles for select to anon using (is_published = true);
-- =====================================================================

-- F-01: Supabase Vault secret RPCs hold calendar OAuth refresh tokens and are
-- only ever called server-side with the service-role key
-- (lyra/src/lib/convene/vault.ts adminClient; lyra-mcp-server service client).
revoke execute on function public.convene_vault_read_secret(uuid)        from public, anon, authenticated;
revoke execute on function public.convene_vault_store_secret(text, text) from public, anon, authenticated;
revoke execute on function public.convene_vault_revoke_secret(uuid)      from public, anon, authenticated;
grant  execute on function public.convene_vault_read_secret(uuid)        to service_role;
grant  execute on function public.convene_vault_store_secret(text, text) to service_role;
grant  execute on function public.convene_vault_revoke_secret(uuid)      to service_role;

-- F-14: get_metrics_for_window must not be anon-callable. Restore the intended
-- grant set from 20260516220000_metrics_window_fn.sql (authenticated + service_role).
revoke execute on function public.get_metrics_for_window(timestamptz, timestamptz) from public, anon;
grant  execute on function public.get_metrics_for_window(timestamptz, timestamptz) to authenticated, service_role;

-- F-03: drop the over-broad anon SELECT policy on profiles that omits the
-- is_suspended guard. Fail-safe: only drop when the correct {public} non-suspended
-- policy exists to replace it, so we never leave profiles with no anon-read path.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Anyone can read published non-suspended profiles'
  ) then
    drop policy if exists "Anon read published profiles" on public.profiles;
  end if;
end $$;
