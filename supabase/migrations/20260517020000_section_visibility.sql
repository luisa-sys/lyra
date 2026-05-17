-- KAN-221 Phase 3 — Hybrid section + item visibility (foundation).
--
-- Adds a `section_visibility` JSONB column to `profiles`. Stores per-section
-- visibility defaults that items inherit when their own `visibility` is
-- unset. Per-item visibility (KAN-143) continues to win when explicitly
-- set, which gives us the "section default with per-item override"
-- semantics — see the parent KAN-218 / phase-3 docs.
--
-- JSONB shape (validated in application code, NOT at the DB level — keeps
-- the column flexible so future additions to the controllable-section
-- allowlist don't require a CHECK-constraint rewrite):
--
--   { "gifts": "members_only", "boundaries": "draft", ... }
--
-- Allowed keys: any section key the application recognises. The
-- application-side `coerceSectionVisibility` filter drops unknown keys
-- on write so trash never lands here.
--
-- Allowed values: 'public', 'members_only', 'draft'. Application-side
-- `coerceVisibility` (KAN-143) filters values on write.
--
-- Default '{}' means "no overrides set" — every section falls back to
-- 'public' in the application code.
--
-- Rollback:
--   alter table public.profiles drop column if exists section_visibility;

alter table public.profiles
  add column section_visibility jsonb not null default '{}'::jsonb;

comment on column public.profiles.section_visibility is
  'KAN-221: section-key → visibility-level. Effective item visibility = item.visibility (if set) ?? section_visibility[sectionKey] ?? public. Allowed section keys + values are validated in application code (see src/app/dashboard/profile/section-visibility.ts).';
