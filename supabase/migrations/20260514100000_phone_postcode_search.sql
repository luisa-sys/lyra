-- KAN-153: opt-in, hashed phone-number and postcode discovery
--
-- Privacy model (non-negotiable):
--   * Phone and postcode are NEVER stored in plain text in a searchable column.
--   * A user must explicitly opt in to be discoverable (two independent flags).
--   * When opted in, we store a salted SHA-256 hash of the normalised value,
--     using a server-side pepper (env var LYRA_SEARCH_PEPPER). The pepper
--     never leaves the application server or this SECURITY DEFINER function.
--   * Search performs the same hash on the input and compares — exact match
--     only, no fuzzy / partial / prefix match.
--   * RLS blocks plain SELECT of the hash columns for non-owners; lookups go
--     through the SECURITY DEFINER function `public.search_by_contact_hash`,
--     which enforces the per-row discoverability flag.
--
-- Rollback (manual; not run automatically):
--   DROP FUNCTION IF EXISTS public.search_by_contact_hash(text, text);
--   DROP INDEX IF EXISTS profiles_postcode_search_hash_idx;
--   DROP INDEX IF EXISTS profiles_phone_search_hash_idx;
--   ALTER TABLE public.profiles
--     DROP COLUMN IF EXISTS phone_search_hash,
--     DROP COLUMN IF EXISTS postcode_search_hash,
--     DROP COLUMN IF EXISTS discoverable_by_phone,
--     DROP COLUMN IF EXISTS discoverable_by_postcode;

-- ============================================================
-- 1. Columns on profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_search_hash      text,
  ADD COLUMN IF NOT EXISTS postcode_search_hash   text,
  ADD COLUMN IF NOT EXISTS discoverable_by_phone    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discoverable_by_postcode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.phone_search_hash IS
  'KAN-153: SHA-256(pepper || normalised E.164 phone). NULL when the user has '
  'not opted in. NEVER exposed to non-owners via RLS — search goes through '
  'public.search_by_contact_hash (SECURITY DEFINER).';

COMMENT ON COLUMN public.profiles.postcode_search_hash IS
  'KAN-153: SHA-256(pepper || normalised UK postcode). NULL when the user has '
  'not opted in. NEVER exposed to non-owners via RLS — search goes through '
  'public.search_by_contact_hash (SECURITY DEFINER).';

COMMENT ON COLUMN public.profiles.discoverable_by_phone IS
  'KAN-153: user opt-in for phone-number discovery. Default false. When '
  'flipped on, the application hashes the current phone and stores it in '
  'phone_search_hash. When flipped off, phone_search_hash is set to NULL.';

COMMENT ON COLUMN public.profiles.discoverable_by_postcode IS
  'KAN-153: user opt-in for postcode discovery. Default false. Same '
  'lifecycle as discoverable_by_phone but for postcode_search_hash.';

-- ============================================================
-- 2. Partial indexes (only opted-in rows; keeps the index tiny)
-- ============================================================
CREATE INDEX IF NOT EXISTS profiles_phone_search_hash_idx
  ON public.profiles (phone_search_hash)
  WHERE phone_search_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_postcode_search_hash_idx
  ON public.profiles (postcode_search_hash)
  WHERE postcode_search_hash IS NOT NULL;

-- ============================================================
-- 3. SECURITY DEFINER lookup function
-- ============================================================
-- This is the ONLY path through which non-owners can read anything keyed
-- on these hash columns. It enforces the discoverability flag in the WHERE
-- clause, so application-layer filtering bugs cannot leak rows.
--
-- Parameters:
--   p_kind: 'phone' or 'postcode'.
--   p_hash: SHA-256 hex digest computed by the application (pepper applied
--           on the application side; the pepper never lands in the database).
--
-- Returns: matching profiles' id and slug, ONLY where:
--   * the relevant discoverable_by_* flag is true,
--   * the relevant *_search_hash column equals p_hash,
--   * the profile is published (otherwise the slug isn't reachable anyway).
--
-- Non-matches and lookups against opted-out profiles produce an empty set —
-- the caller cannot distinguish "no such hash exists" from "hash exists but
-- the user is opted out".
CREATE OR REPLACE FUNCTION public.search_by_contact_hash(
  p_kind text,
  p_hash text
)
RETURNS TABLE (id uuid, slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Defensive: only accept the two known kinds. Any other value returns
  -- no rows; we deliberately do NOT raise an error to avoid leaking
  -- timing/behaviour differences for malformed input.
  IF p_kind = 'phone' THEN
    RETURN QUERY
      SELECT p.id, p.slug
      FROM public.profiles p
      WHERE p.discoverable_by_phone = true
        AND p.phone_search_hash = p_hash
        AND p.is_published = true;
  ELSIF p_kind = 'postcode' THEN
    RETURN QUERY
      SELECT p.id, p.slug
      FROM public.profiles p
      WHERE p.discoverable_by_postcode = true
        AND p.postcode_search_hash = p_hash
        AND p.is_published = true;
  ELSE
    RETURN;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.search_by_contact_hash(text, text) IS
  'KAN-153: SECURITY DEFINER lookup for opt-in phone/postcode discovery. '
  'Enforces discoverable_by_* flag at the DB layer so application-side '
  'filtering bugs cannot leak unsubscribed rows.';

-- Lock the function down: only authenticated users should be able to call it.
-- (Anonymous browsing can be reconsidered later, but the default is closed.)
REVOKE ALL ON FUNCTION public.search_by_contact_hash(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_by_contact_hash(text, text) TO authenticated;

-- ============================================================
-- 4. Column-level privilege lockdown on the hash columns
-- ============================================================
-- The existing "Anyone can read published profiles" SELECT policy is a
-- row-level filter that does NOT distinguish columns — without further
-- protection, an authenticated client could SELECT phone_search_hash from
-- any published profile. We block that at the column-privilege layer.
--
-- REVOKE SELECT on the hash columns from anon/authenticated. Owners do
-- NOT need to read the hash itself — only the discoverability flags. The
-- SECURITY DEFINER function bypasses column-level privileges (it runs as
-- the function owner), so search continues to work.
--
-- Note: column-level REVOKE applies on top of RLS — RLS narrows which
-- rows are visible, column privileges narrow which columns within those
-- rows can be referenced. A SELECT * on profiles by a non-superuser will
-- now fail unless the hash columns are explicitly excluded; the client
-- code already selects named columns rather than '*'.

REVOKE SELECT (phone_search_hash, postcode_search_hash)
  ON public.profiles
  FROM anon, authenticated;

-- service_role retains full access for backups, migrations, and the
-- application's own owner-side hash writes through the server action.

