-- SEC-104 — `public.public_profiles`: the public-visibility predicate, moved
-- from a code convention into a database object.
--
-- WHY
-- ---
-- Lyra's most recurrent security defect class is a visibility predicate applied
-- at one call site and forgotten at its siblings: SEC-44, SEC-47, SEC-57,
-- SEC-58, SEC-80, SEC-81, SEC-83, SEC-84, SEC-85, BUGS-21. Each fix was
-- correct. Each covered the site in front of it. The next site was then found
-- by the next audit rather than by CI.
--
-- `public.profiles` already carries the right RLS policy:
--     "Anyone can read published non-suspended profiles"
--         USING (is_published = true AND is_suspended = false)
-- but the SERVICE-ROLE client bypasses RLS entirely, and 7 of the 8 public read
-- sites use it. That is exactly how SEC-100 happened — suspended members served
-- to public search and to search-engine crawlers three weeks after SEC-44 was
-- closed and verified.
--
-- A WHERE clause in a view body is not a policy. It is part of the query, so it
-- binds every caller including a BYPASSRLS superuser.
--
-- PROVEN, NOT ASSUMED (dev, 2026-08-11, in a rolled-back transaction):
--   running as `postgres` (BYPASSRLS), a profile flipped to is_suspended = true
--   was visible through the TABLE (1 row) and absent through an equivalent VIEW
--   (0 rows). The mutation was asserted to have applied before the measurement
--   was believed, and the transaction was aborted so the row was restored.
--
-- WHAT THIS IS NOT
-- ----------------
-- This is a HARDENING, not a live leak fix. An audit of the client boundary
-- (2026-08-11) found that `src/app/[slug]/page.tsx` fetches all 42 columns via
-- `.select('*')` but NOTHING sensitive crosses into the browser: the only
-- client component in the tree, ReportButton, receives two scalars, and exactly
-- 8 public-by-design columns reach the RSC payload. The fetch is over-broad;
-- the render is not leaking. Both facts are worth stating plainly.
--
-- THE COLUMN SET, AND WHY IT IS 17 AND NOT 42
-- -------------------------------------------
-- Derived from what the 8 public read sites actually use — including columns
-- used only as FILTERS or ORDER BY, which a union of `.select()` lists misses.
-- `is_homepage_example` and `homepage_example_order` are never selected by any
-- site, but /examples filters and orders on them; omitting them would have left
-- that page broken in production.
--
-- Everything else is deliberately absent, and that absence is the control:
-- is_admin, user_status, access_tier, suspension_reason, suspended_at, the six
-- age-verification columns, the search hashes, postcode_prefix, beta_*,
-- recipient_attributes, dashboard_widget_state, completion_score,
-- onboarding_complete, share_availability_with_contacts, created_at, region,
-- discoverable_by_*. A future `select('*')` against this view cannot leak them
-- because they are not here to leak.
--
-- ⚠️ PORTABILITY — THE FOUR COLUMNS THIS VIEW MUST NOT NAME.
-- Measured live on all three databases 2026-08-11: dev and staging carry 42
-- profiles columns, PRODUCTION carries 38. Production alone lacks
-- phone_search_hash, postcode_search_hash, discoverable_by_phone and
-- discoverable_by_postcode (the KAN-153 half of SEC-107). CREATE VIEW naming a
-- column the database does not have fails outright, so a view that named any of
-- them would apply cleanly to dev and staging and then break the production
-- migration. None of the four belongs in a public view anyway — they are search
-- hashes and discovery flags — so the portability constraint and the security
-- design agree. Do not add them here when SEC-107 is closed.
--
-- security_invoker = on:
--   * for anon / authenticated, RLS on `profiles` ALSO applies (defence in
--     depth — the view predicate and the policy must both pass);
--   * for service_role, RLS is bypassed as it always was, and the view
--     predicate is what remains — which is the entire point.
--   With the default (off) the view would run as its owner and bypass RLS for
--   every caller, which is strictly worse. Matches the house convention set by
--   `mcp_per_ip_recent_count` (20260621090200).

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
  -- Tautological here (always true / false), retained so existing call sites
  -- that select or re-assert them keep working during and after the cutover.
  p.is_published,
  p.is_suspended
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
  'production, and not public data).';

-- Grants. Public surfaces are read by logged-out visitors, so anon needs SELECT
-- here (unlike mcp_per_ip_recent_count, which is service-role only). SELECT
-- only: this view is a read surface and must never be a write path.
GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.public_profiles FROM anon, authenticated;
