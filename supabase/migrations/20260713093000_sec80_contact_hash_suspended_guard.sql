-- =====================================================================
-- SEC-80 (KAN-295 audit 2026-07-11, label security-audit-2026-07-11):
-- search_by_contact_hash must not return SUSPENDED profiles.
--
-- The SECURITY DEFINER function public.search_by_contact_hash(text, text)
-- bypasses RLS and filters only is_published = true, so a published+suspended
-- profile is still discoverable (id + slug) by phone/postcode hash even though
-- the canonical public-read RLS policy on profiles requires
--   is_published = true AND is_suspended = false.
-- This deviates from the F-13 / SEC-44 suspended-guard contract and is
-- safeguarding-relevant (the platform includes under-18 profiles).
--
-- Fix: re-create the function with `AND p.is_suspended = false` added to BOTH
-- the phone and postcode branches, mirroring the profiles RLS policy. Tightens
-- (never loosens) exposure; callers are unchanged (no app-code change).
--
-- Guarded so it is a no-op where the function is absent (e.g. production,
-- pre-Convene/pre-discovery). CREATE OR REPLACE preserves the existing EXECUTE
-- ACL from 20260621090300 (authenticated, service_role) — grants are NOT reset.
--
-- Apply order: dev -> staging -> prod (prod founder-gated).
-- Applied to dev (ilprytcrnqyrsbsrfujj) + staging (uobmlkzrjkptwhttzmmi) 2026-07-13.
--
-- ROLLBACK: re-create the function without the `AND p.is_suspended = false`
-- predicates (i.e. the 20260514100000 / pre-SEC-80 body).
-- =====================================================================
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'search_by_contact_hash'
  ) then
    execute $fn$
      create or replace function public.search_by_contact_hash(p_kind text, p_hash text)
        returns table(id uuid, slug text)
        language plpgsql
        security definer
        set search_path to 'public', 'pg_temp'
      as $body$
      begin
        if p_kind = 'phone' then
          return query
            select p.id, p.slug
            from public.profiles p
            where p.discoverable_by_phone = true
              and p.phone_search_hash = p_hash
              and p.is_published = true
              and p.is_suspended = false;
        elsif p_kind = 'postcode' then
          return query
            select p.id, p.slug
            from public.profiles p
            where p.discoverable_by_postcode = true
              and p.postcode_search_hash = p_hash
              and p.is_published = true
              and p.is_suspended = false;
        else
          return;
        end if;
      end;
      $body$;
    $fn$;
  end if;
end $$;
