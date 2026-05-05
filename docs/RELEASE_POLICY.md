# Lyra Release Policy (KAN-173)

> Pipelines rot when not exercised. Drift breeds incidents. Force at least one release per week to flush the entire chain.

## Cadence

| Stage | Cadence | Trigger | Why |
|---|---|---|---|
| `develop` → `staging` | **Weekly, automatic** | Sunday 23:00 UTC | Forces the staging chain to run every week so `deploy-staging.yml` doesn't go a month without exercise. |
| `staging` → `beta` | Manual | When ready to expose changes to beta testers | Beta hits real prod data, so the move beyond staging is a deliberate decision. |
| `beta` → `main` | Manual | When beta has been exercised against real users | Highest blast radius. Always human-supervised. |

**The chain MUST be exercised at least weekly.** If `auto-promote-to-staging.yml` skips for any reason, the weekly report flags it red — see "Skip behaviour" below.

## Drift thresholds

The weekly report's drift counter (Section 15, KAN-173 follow-up) reports `git rev-list --count main..develop` and the days since the most recent develop commit:

| Status | Commits ahead of main | Days since last develop commit | Action |
|---|---|---|---|
| 🟢 Green | < 5 | < 3 | None |
| 🟡 Yellow | 5–14 | 3–6 | Plan a promotion this week |
| 🔴 Red | ≥ 15 OR ≥ 7 days | Promote now |

If we hit red, the weekly report adds a "drift exceeded threshold" line and Luisa schedules a manual promotion the same day.

## Security SLA

A high or critical CodeQL/Dependabot alert that lands on develop must reach **production within 24 hours**, including any necessary review. This is the entire point of forcing a weekly cadence — security fixes can never be allowed to sit on develop indefinitely.

When the security alert is filed:
1. Fix on a branch off `develop` (per Test Integrity + Workflow Integrity policies).
2. Land via PR to develop.
3. Promote develop → staging → beta → main without waiting for the weekly cron — manually via `gh workflow run promote-to-staging.yml -f confirm=promote`.
4. Confirm the alert is closed in GitHub Security tab and the corresponding KAN/BUGS ticket is closed.

## When NOT to release

Don't auto-promote (suspend the cron) and don't manually promote when:
- Open Highest-priority bug ticket against the system being released
- Smoke tests already failing on staging or production
- Mid-incident — use a hotfix branch directly to main via PR if needed; don't pile a release on top of an active investigation
- Friday afternoon UK time — no support window for the weekend
- Beta testers have flagged a regression that hasn't been triaged yet

The `auto-promote-to-staging.yml` workflow has a hard precondition that develop CI is green — it won't promote a red develop. But the human conditions above are NOT machine-checkable and require operator judgement to suspend the cron via GitHub UI.

## Skip behaviour

`auto-promote-to-staging.yml` skips (no promotion, no failure) when:
- Develop CI for the latest develop commit is not green or not yet completed
- HEAD of develop is < 24 hours old (soak time so the latest commits get a chance to fail in dev first)
- Develop is not fast-forward into staging (someone manually changed staging — needs a human)

A skip is reported as `::warning::` in the workflow run and is surfaced in the weekly report Section 15 ("Last auto-promote-to-staging: skipped — reason: …").

A skip is **not the same as a failure**. We never want a green-looking workflow that didn't actually do the promotion (KAN-167 lessons applied). If three consecutive weekly auto-promotes skip, the weekly report escalates to red and Luisa investigates manually.

## What stays manual

- **`staging` → `beta`** — `gh workflow run promote-staging-to-beta.yml -f confirm=promote`. No cron. Decision made when beta-testable changes have soaked on staging.
- **`beta` → `main` (production)** — `gh workflow run promote-to-production.yml -f confirm=PRODUCTION`. No cron, ever. This is the highest-blast-radius decision in the entire project.

The reasoning is asymmetric:
- Auto-promote to **staging** is safe — staging is gated by Vercel SSO, no real users see it
- Auto-promote to **production** has the same false-positive risk class KAN-167 spent days dismantling — a "green" CI run that's actually broken would auto-ship to users

## Reference

- KAN-173 (this policy): <https://checklyra.atlassian.net/browse/KAN-173>
- KAN-167 (workflow integrity, the prior art for false-positive prevention): <https://checklyra.atlassian.net/browse/KAN-167>
- BUGS-11 (auto-merge BLOCKED, the failure mode that triggered the rebase fix): <https://checklyra.atlassian.net/browse/BUGS-11>
- `docs/RUNBOOK.md` — operational procedures
- `.github/workflows/promote-to-staging.yml` — the manual workflow (auto-promote calls the same logic)
- `.github/workflows/auto-promote-to-staging.yml` — the scheduled wrapper
