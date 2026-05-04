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