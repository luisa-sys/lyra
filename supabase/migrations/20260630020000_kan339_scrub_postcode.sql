-- KAN-339 (epic KAN-349) — scrub postcode data; retain the columns nullable.
--
-- Postcode is no longer collected, stored, or used for discovery (replaced by
-- town/city discovery, KAN-341). This NULLs every existing postcode value and
-- disables postcode discovery for all rows. The columns are RETAINED (nullable)
-- so no dependent objects break; the app no longer reads or writes them (see
-- profile-fields.ts ALLOWED_PROFILE_FIELDS + discoverability-*).
--
-- The affiliate geo-signal uses profiles.delivery_country_code (country), NOT
-- postcode, so scrubbing postcode has no effect on recommendations (verified).
--
-- Privacy: postcode plaintext was never stored (only postcode_prefix, which the
-- user typed, and a salted HMAC search hash). Both are erased here.
--
-- Rollback: the DATA is intentionally erased (no rollback). The columns remain.

update public.profiles
set postcode_prefix = null,
    discoverable_by_postcode = false,
    postcode_search_hash = null
where postcode_prefix is not null
   or discoverable_by_postcode is true
   or postcode_search_hash is not null;
