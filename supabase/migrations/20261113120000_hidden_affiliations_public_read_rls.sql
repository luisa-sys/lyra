-- Hidden affiliations public-read RLS fix (SEC ticket: pending — Jira was
-- unreachable when this was written; add the key to the PR before merge).
--
-- Severity High. Same defect family as SEC-45 (profile_items).
--
-- An affiliation with show_on_profile = false is "searchable but hidden": it
-- must never be returned to a visitor. But both public SELECT policies on
-- school_affiliations check only that the owning profile is published (and,
-- for one of them, not suspended). Neither checks show_on_profile. RLS SELECT
-- policies are OR-combined, so anyone holding the public anon key can read
-- every hidden affiliation of every published profile directly via PostgREST:
--
--   GET /rest/v1/school_affiliations?select=*
--
-- Verified on production 2026-10-14 (read-only catalogue query): 29 hidden
-- rows, all on published profiles, anon SELECT granted.
--
-- The two over-broad policies:
--   1. "Anyone can read schools from published non-suspended profiles"
--      (20260516120000_admin_and_moderation.sql) — no show_on_profile predicate.
--   2. "Read schools from published profiles" (roles anon, authenticated) —
--      created out-of-band, not in any repo migration; no show_on_profile and
--      no is_suspended predicate.
--
-- Fix: drop both and create one canonical public-read policy that requires
-- show_on_profile = true AND a published, non-suspended owning profile.
--
-- Not changed, deliberately:
--   - "Manage own school affiliations" (owner ALL policy): owners still read
--     and edit all their own rows, hidden ones included.
--   - The public profile page already filters to show_on_profile in app code
--     (src/app/[slug]/page.tsx), and search reads via the service role with an
--     explicit show_on_profile = true filter, so no visible behaviour changes.
--   - Admin and account-export reads use the service role or the owner's own
--     session, so they are unaffected.
--
-- All drops are drop-if-exists, so this is idempotent and a no-op where a
-- policy is already absent (e.g. the out-of-band policy on environments that
-- never had it).
--
-- Rollback (manual, NOT recommended — restores the leak):
--   drop policy "Anyone can read visible affiliations from published profiles" on public.school_affiliations;
--   create policy "Anyone can read schools from published non-suspended profiles"
--     on public.school_affiliations for select
--     using (exists (select 1 from public.profiles
--       where id = school_affiliations.profile_id and is_published = true and is_suspended = false));

-- ============================================================
-- 1. Remove the over-broad repo-tracked policy (no show_on_profile predicate).
-- ============================================================
drop policy if exists "Anyone can read schools from published non-suspended profiles" on public.school_affiliations;

-- ============================================================
-- 2. Remove the untracked out-of-band duplicate, if present.
-- ============================================================
drop policy if exists "Read schools from published profiles" on public.school_affiliations;

-- ============================================================
-- 3. Canonical public read: only affiliations the owner chose to show, on
--    published, non-suspended profiles.
-- ============================================================
drop policy if exists "Anyone can read visible affiliations from published profiles" on public.school_affiliations;
create policy "Anyone can read visible affiliations from published profiles"
  on public.school_affiliations for select
  using (
    show_on_profile = true
    and exists (
      select 1 from public.profiles
      where id = school_affiliations.profile_id
        and is_published = true
        and is_suspended = false
    )
  );
