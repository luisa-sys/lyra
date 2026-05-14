-- KAN-143: Per-item visibility levels (public / members_only / draft)
--
-- The original schema (20260324061701_create_lyra_schema.sql) already created
-- the `visibility_level` enum and a `visibility` column on `profile_items`
-- with default 'public'. The existing enum values are: 'public',
-- 'members_only', 'private'.
--
-- This migration:
--   1. Adds 'draft' as a new enum value (additive — does not break anything).
--      'draft' is the user-facing label for items that should be hidden from
--      the public profile entirely; functionally equivalent to the existing
--      'private' value, which we keep for backward-compatibility.
--   2. Backfills any rows with NULL visibility to 'public' (the existing
--      column default; should be a no-op but defensive).
--   3. Replaces the public-read RLS policy with two additive policies:
--        - anonymous viewers see only `visibility = 'public'`
--        - authenticated viewers see `'public'` OR `'members_only'`
--      Draft + private items are owner-only (the existing
--      "Users can manage own profile items" ALL policy already handles that).
--   4. Adds a column COMMENT documenting the three levels.
--
-- Rollback (manual):
--   - DROP POLICY "Members can read members_only items from published profiles" ON public.profile_items;
--   - DROP POLICY "Anyone can read public items from published profiles" ON public.profile_items;
--   - CREATE POLICY "Anyone can read items from published profiles" ON public.profile_items
--       FOR SELECT USING (profile_id IN (SELECT id FROM public.profiles WHERE is_published = true)
--                         AND visibility = 'public');
--   - Removing the enum value 'draft' is non-trivial in Postgres (no
--     DROP VALUE) — leave it in place on rollback.

-- ============================================================
-- 1. Extend the visibility_level enum with 'draft'
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'visibility_level' and e.enumlabel = 'draft'
  ) then
    alter type public.visibility_level add value 'draft';
  end if;
end$$;

-- ============================================================
-- 2. Backfill any NULL rows to 'public' (defensive — column has a default)
-- ============================================================
update public.profile_items
set visibility = 'public'
where visibility is null;

-- ============================================================
-- 3. Document the column
-- ============================================================
comment on column public.profile_items.visibility is
  'Per-item visibility. Values:
     - public:       visible on the public profile to anyone (default)
     - members_only: visible only to authenticated Lyra users
     - draft:        owner-only, hidden from public profile and MCP
     - private:      legacy synonym for draft, kept for backward compatibility';

-- ============================================================
-- 4. Replace the single public-read policy with two additive policies
-- ============================================================
-- The existing "Users can manage own profile items" ALL policy already lets
-- owners see/edit their own items at all visibility levels — we do NOT drop it.

-- Drop the old single public-read policy. We replace it with two policies
-- below; together they cover the same `public` case PLUS the new
-- `members_only` case.
drop policy if exists "Anyone can read items from published profiles" on public.profile_items;

-- Anonymous + authenticated viewers see public items from published profiles.
create policy "Anyone can read public items from published profiles"
  on public.profile_items for select
  using (
    profile_id in (select id from public.profiles where is_published = true)
    and visibility = 'public'
  );

-- Only authenticated viewers see members_only items from published profiles.
create policy "Members can read members_only items from published profiles"
  on public.profile_items for select
  using (
    auth.uid() is not null
    and profile_id in (select id from public.profiles where is_published = true)
    and visibility = 'members_only'
  );

-- draft / private items: NO public-read policy. Only the owner's
-- "Users can manage own profile items" ALL policy applies, so they are
-- invisible to everyone except the owner.
