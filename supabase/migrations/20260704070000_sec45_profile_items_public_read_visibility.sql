-- SEC-45 (finding web-rls-1) — profile_items over-permissive public-read RLS
--
-- Phase 0 · Severity High.
--
-- The 20260516120000_admin_and_moderation.sql migration re-created a public
-- SELECT policy on profile_items — "Anyone can read items from published
-- non-suspended profiles" — that adds the is_suspended=false check but DROPS
-- the visibility='public' predicate the 20260514054350_profile_items_visibility
-- migration had introduced. Because RLS SELECT policies are OR-combined
-- (permissive), that over-broad policy lets anonymous callers (public anon key,
-- via PostgREST) read members_only / draft / private items of any published,
-- non-suspended profile — defeating KAN-143 per-item visibility. For an
-- under-18 product this leaks data users explicitly chose to keep private
-- (UK-GDPR confidentiality / data-minimisation).
--
-- Fix: drop the over-broad policy and consolidate the public-read paths so each
-- carries BOTH the visibility predicate AND the is_suspended=false predicate:
--   - anonymous + authenticated: visibility='public'       (published + non-suspended)
--   - authenticated only:        visibility='members_only' (published + non-suspended)
-- draft / private items remain owner-only via the existing
-- "Users can manage own profile items" ALL policy, which this migration does
-- NOT touch.
--
-- Note: dev (and possibly other envs) also carried an untracked ad-hoc
-- duplicate policy "Read public items from published profiles" (role
-- {anon,authenticated}, same predicate minus is_suspended). It is dropped here
-- so there is a single canonical public-read definition. The drops are
-- drop-if-exists, so this migration is idempotent and a no-op where a policy is
-- already absent.
--
-- Rollback (manual, NOT recommended — restores the leak):
--   drop policy "Anyone can read public items from published profiles" on public.profile_items;
--   drop policy "Members can read members_only items from published profiles" on public.profile_items;
--   create policy "Anyone can read items from published non-suspended profiles"
--     on public.profile_items for select
--     using (exists (select 1 from public.profiles
--       where id = profile_items.profile_id and is_published = true and is_suspended = false));

-- ============================================================
-- 1. Remove the over-broad policy (no visibility predicate) — the CVE.
-- ============================================================
drop policy if exists "Anyone can read items from published non-suspended profiles" on public.profile_items;

-- ============================================================
-- 2. Remove the untracked ad-hoc duplicate public-read policy, if present.
-- ============================================================
drop policy if exists "Read public items from published profiles" on public.profile_items;

-- ============================================================
-- 3. Canonical public-item read: public items of published, non-suspended
--    profiles — visible to anonymous and authenticated viewers alike.
-- ============================================================
drop policy if exists "Anyone can read public items from published profiles" on public.profile_items;
create policy "Anyone can read public items from published profiles"
  on public.profile_items for select
  using (
    visibility = 'public'
    and profile_id in (
      select id from public.profiles
      where is_published = true and is_suspended = false
    )
  );

-- ============================================================
-- 4. members_only read: authenticated viewers only, published + non-suspended.
-- ============================================================
drop policy if exists "Members can read members_only items from published profiles" on public.profile_items;
create policy "Members can read members_only items from published profiles"
  on public.profile_items for select
  using (
    auth.uid() is not null
    and visibility = 'members_only'
    and profile_id in (
      select id from public.profiles
      where is_published = true and is_suspended = false
    )
  );
