-- KAN-488 (epic KAN-482) — the public profile shows the Billboard.
--
-- Spec v0.8 §2 "10 — Billboard": one optional multiline statement, shown
-- prominently on the public profile when completed. `profiles.billboard`
-- exists since 20261123090000_kan485_profile_model_v08.sql, but the
-- public_profiles VIEW (SEC-104) does not carry it, and public surfaces must
-- read the view, never the base table (CTL-028). So the view gains exactly
-- one column.
--
-- What changes, and what does not:
--   * ONE column added: p.billboard, appended LAST. CREATE OR REPLACE VIEW
--     can only add columns at the end; the existing 17 keep their names,
--     order and types.
--   * security_invoker = on and the WHERE clause (published AND not
--     suspended) are unchanged, so INV-8 and the SEC-104 predicate hold.
--   * Not added: slug_confirmed, first_published_at, or any KAN-153
--     search-hash / discoverability column (absent on production, and not
--     public data).
--
-- Security review note: billboard is public by spec §10 and is already
-- readable by anon through REST under the profiles RLS policy for published
-- rows, so nothing new is exposed. The view holds no functions, and the
-- grants below name roles (no FROM PUBLIC), so gotcha #26 does not apply.
--
-- Order: dev, then staging, then production, after 20261123090000 (kan485).
-- Must reach production before the staging -> beta promote. The app reads
-- the view with select('*') and treats billboard as optional, so code that
-- reaches an environment before this migration still renders (no Billboard).
--
-- Rollback (manual; needs founder/lead sign-off — it drops the view):
--   DROP VIEW public.public_profiles;
--   CREATE VIEW public.public_profiles WITH (security_invoker = on) AS
--   SELECT p.id, p.user_id, p.slug, p.display_name, p.headline, p.bio_short,
--          p.city, p.country, p.avatar_url, p.gift_voucher_hint,
--          p.section_visibility, p.delivery_country_code, p.updated_at,
--          p.is_homepage_example, p.homepage_example_order,
--          p.is_published, p.is_suspended
--   FROM public.profiles p
--   WHERE p.is_published = true AND p.is_suspended = false;
--   GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;
--   REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.public_profiles FROM anon, authenticated;
--   (and restore the SEC-104 COMMENT ON VIEW from 20260811210000.)

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = on) AS
SELECT
  -- Identity + routing
  p.id,
  p.user_id,              -- ownership comparison only (hides "Report" from the owner)
  p.slug,
  -- Rendered profile content
  p.display_name,
  p.headline,
  p.bio_short,
  p.city,
  p.country,
  p.avatar_url,
  p.gift_voucher_hint,
  -- Behaviour
  p.section_visibility,   -- privacy-critical: drives per-item visibility inheritance
  p.delivery_country_code,
  p.updated_at,           -- sitemap lastmod
  -- Curation (filter + order for /examples and /search)
  p.is_homepage_example,
  p.homepage_example_order,
  -- Tautological here (always true / false), kept for existing call sites.
  p.is_published,
  p.is_suspended,
  -- KAN-488: spec v0.8 §10, public when completed.
  p.billboard
FROM public.profiles p
WHERE p.is_published = true
  AND p.is_suspended = false;

COMMENT ON VIEW public.public_profiles IS
  'SEC-104. The public-visibility predicate as a database object rather than a '
  'call-site convention. A view WHERE binds service_role, which RLS does not — '
  'that asymmetry is why SEC-100 happened. Read this instead of public.profiles '
  'for anything a logged-out visitor can see. Deliberately omits every column '
  'not needed by a public surface; do not widen it without a security review, '
  'and never add the KAN-153 search-hash / discoverability columns (absent on '
  'production, and not public data). KAN-488 added billboard (public by spec '
  'v0.8 §10).';

-- Restated (idempotent): SELECT for the public read surface, never a write path.
GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.public_profiles FROM anon, authenticated;
