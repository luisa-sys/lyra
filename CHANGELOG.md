# Changelog

All notable changes to the Lyra platform are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow git tags (`git describe --tags --abbrev=0` for the authoritative
current version — see KAN-166 for why `package.json` is not the source of truth).

Each release entry corresponds to a production deployment. Bootstrap commits
to `main` (PRs merged outside the normal `develop → staging → main` flow) are
also recorded with a `[bootstrap]` label.

## [Unreleased]

Commits on `develop` not yet promoted to staging or production. See
`git log origin/main..origin/develop` for the live list.

## [0.1.46] — 2026-05-16

Big shipping day: recommendation engine, admin tools, Sentry activation,
and a wave of supporting documentation.

### Added

- **KAN-139** Recommendation engine ported from the original Python
  app (`src/lib/recommend/` — 6 modules, 22 unit tests). Public profiles
  now render a "Gift ideas based on this profile" section, with a
  matching `GET /api/recommendations/[slug]` endpoint. Scoring algorithm
  identical to the Flask original: 10 categories, 50 templates, dietary
  filtering, similarity veto, diversification.
- **KAN-141** Admin dashboard, reports, and moderation tools.
  Schema (`is_admin`, `is_suspended`, `reports`, `moderation_logs`),
  helpers (`getCurrentAdmin`, `logModerationAction`), 5 admin pages
  (`/admin`, `/admin/reports`, `/admin/users`, `/admin/audit`), inline
  report button on public profiles, append-only audit log. RLS gates
  every read.
- **KAN-154 A+B** Homepage privacy trust signal + shareable dashboard
  invite text with one-click copy.
- **KAN-104** Sentry activation: `activate-sentry.yml` workflow upserts
  `NEXT_PUBLIC_SENTRY_DSN` + `IS_SENTRY_ENABLED` across all five Vercel
  scopes via the v10 env REST API. SDK now live on every environment.
- **KAN-90** `docs/CYBER_LOCKDOWN.md` 11-service hardening checklist
  with Google Cloud Console section codifying KAN-90 acceptance items.
- **KAN-103** `docs/RAILWAY_MCP_SETUP.md` deployment runbook for the
  community Railway MCP server.
- **KAN-88** `docs/MCP_OAUTH_DESIGN.md` architecture decision +
  8-sub-ticket breakdown for MCP OAuth 2.1.

## [bootstrap] 2026-05-04 — BUGS-4 release pipeline fix

Cherry-pick PR #94 merged directly to `main` to bootstrap the release
pipeline fix. This was a one-time bypass of the normal `develop → staging
→ main` flow because the fix itself repairs the promotion workflow.
Subsequent releases use the now-fixed pipeline.

### Fixed

- **BUGS-4** Three false-positive bugs in `promote-to-staging.yml` and
  `promote-to-production.yml` that caused the workflows to report success
  while never actually triggering downstream deploys. The release pipeline
  had been silently broken for ~32 days. Fix: dedicated `LYRA_RELEASE_PAT`
  for merge pushes (so downstream workflows trigger), SHA-matched run
  verification (no more matching stale runs), and Vercel API SHA
  verification on health checks (no more accepting 401 as success).

### Added

- `scripts/check-workflow-integrity.sh` — static scan of workflow YAML
  files for known false-positive patterns. Runs as part of `pr-checks.yml`
  to fail any PR that re-introduces a banned pattern. Allow-list with
  `# integrity-ok: <reason>` only.
- `LYRA_RELEASE_PAT` repository secret — fine-grained PAT with
  `contents:write` on `luisa-sys/lyra` only, 365-day expiry. Used by both
  promotion workflows. Annual rotation (see `docs/SECURITY_ROTATION.md`).

### Changed

- `promote-to-production.yml` rewritten as a PR-based pattern. The workflow
  now creates a release branch, opens a PR to `main`, and uses auto-merge.
  Required because branch protection on `main` requires PRs even with zero
  reviewers. Tag creation moved AFTER smoke tests pass — failed releases
  no longer leave misleading version tags.

### Documented

- `CLAUDE.md` gotchas #16 (`GITHUB_TOKEN` suppresses downstream workflow
  triggers) and #17 (`edit_block` corrupts markdown on long/complex
  content — see BUGS-5).
- `docs/RUNBOOK.md` new `## Release Procedure` section.
- `docs/SECURITY_ROTATION.md` removed nonexistent GitHub App references
  (doc drift), added `LYRA_RELEASE_PAT` and `LYRA_BACKUP_PAT` rows and
  rotation procedures.

### Refs

- BUGS-4 (the fix), BUGS-5 (markdown corruption tracker), KAN-167
  (false-positive prevention lineage), KAN-169 (gotcha #15), KAN-170
  (PAT rotation tracking).