-- 18+ self-declaration — replaces the Didit provider age check (KAN-282/KAN-319).
--
-- Lyra is an adults-only (18+) service. Age is now established by an explicit
-- self-declaration at sign-up ("I confirm I am 18 or over") rather than a
-- biometric facial age-estimation performed by a third-party provider. This
-- column is the evidence record: WHEN the user made that declaration.
--
-- Privacy: this stores no date of birth, no selfie, no biometric, and no age
-- band. Retiring the provider check removed ALL Article 9 special-category
-- processing from Lyra (see docs/compliance/DPIA.md).
--
-- NOT a security control. A self-declaration is by construction something any
-- user can assert — do not gate anything sensitive on this column. It exists so
-- we can evidence that the 18+ rule was put to the user and affirmed.
--
-- Written by the SERVICE ROLE only, at the shared post-login chokepoint
-- (src/lib/auth/post-login-redirect.ts) and by the /confirm-age action. It is
-- deliberately absent from ALLOWED_PROFILE_FIELDS, so the user-facing profile
-- update action cannot set it.
--
-- Additive and nullable by design: existing accounts (created before the
-- declaration existed) keep NULL and are asked to confirm on their next sign-in
-- rather than being backfilled with a declaration they never actually made.
--
-- The legacy provider columns (age_status, age_checked_at, age_provider,
-- age_provider_ref) are intentionally LEFT IN PLACE, unused. Dropping them is a
-- destructive change that needs its own sign-off (see CLAUDE.md, "Supabase
-- Migration Rules"); the Didit integration is dormant, not deleted.
--
-- APPLIED TO: dev (ilprytcrnqyrsbsrfujj) 2026-07-20 + verified. staging/prod founder-gated.
--
-- ROLLBACK:
--   alter table public.profiles drop column if exists age_declared_18_at;

alter table public.profiles
  add column if not exists age_declared_18_at timestamptz;

comment on column public.profiles.age_declared_18_at is
  'When the user self-declared they are 18 or over at sign-up. Attestation only — NOT a verified age check, and not a security control. Null = declared before this existed / not yet asked.';
