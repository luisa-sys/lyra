# Lyra Release Policy (KAN-173)

> Pipelines rot when not exercised. Drift breeds incidents. Force at least one release per week to flush the entire chain.

## Cadence

| Stage | Cadence | Trigger | Why |
|---|---|---|---|
| `develop` → `staging` | **Weekly, automatic** | Sunday 23:00 UTC | Forces the staging chain to run every week so `deploy-staging.yml` doesn't go a month without exercise. |
| `staging` → `beta` | Manual | When ready to expose changes to beta testers | Beta hits real prod data, so the move beyond staging is a deliberate decision. |
| `beta` → `main` | Manual (fix-only exception WITHDRAWN 2026-07-23) | When beta has been exercised against real users | Highest blast radius. Human-supervised, no exception currently active — Luisa withdrew the fix-only auto-promote exception on 2026-07-23. See "What stays manual". |

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
- **`beta` → `main` (production)** — `gh workflow run promote-to-production.yml -f confirm=PRODUCTION`. This is the highest-blast-radius decision in the entire project. **There is no scheduled/auto-promote-to-production workflow** — production is only ever promoted by an explicit `workflow_dispatch` of `promote-to-production.yml` (typing `PRODUCTION` to confirm).

The reasoning is asymmetric:
- Auto-promote to **staging** is safe — staging is gated by Vercel SSO, no real users see it
- Auto-promote to **production** has the same false-positive risk class KAN-167 spent days dismantling — a "green" CI run that's actually broken would auto-ship to users. This is why there is no cron and no standalone auto-promote-to-production workflow.

### The one owner-authorised exception (fix-only, 2026-06-21) — WITHDRAWN 2026-07-23

**Status: inactive.** Luisa withdrew this exception on 2026-07-23. Production promote is **manual-only, no exception**, per `CLAUDE.md` → Deployment Pipeline. The routine (SEC-22) prepares + reports release-readiness and may rehearse as far as staging, but must NOT auto-promote to production under any condition, fix-only or otherwise, until Luisa explicitly reinstates this in writing with a new date. The text below describes the now-inactive exception, retained for historical/audit context only:

The default above ("features are manual, always human-supervised") had a single narrow exception, authorised by Luisa on 2026-06-21 and canonical in `CLAUDE.md` → Deployment Pipeline and `docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md`:

- The **weekly health + regression routine** MAY drive a `beta` → `main` promotion **only when *every* change pending on `develop` ahead of `main` is a bug-FIX** (a BUGS/SEC defect, `fix:`-type — no new feature, user-facing capability, route, table, MCP tool, or migration), with the full suite green through staging + beta.
- If **any** pending change is a feature, or fix-vs-feature is ambiguous → the routine **STOPS and requires manual sign-off**.
- Even in the exception, promotion still runs through the same `promote-to-production.yml` `workflow_dispatch` (built-in smoke + auto-rollback). The routine never pushes to `main`/`beta`/`staging` directly and there is still no scheduled auto-promote-to-production workflow.

**Doc/code reconciliation (SEC-77, finding ci-drift-1):** the fix-only gate is **procedural** — it is applied by the routine agent reading the pending commit range, *not* by a machine-checked guard inside the workflow. `promote-to-production.yml` itself does not yet hard-fail on a pending `feat:` commit. Implementing that machine-checked fix-only guard (hard-fail on any non-`fix:` change in `main..beta`) is tracked as a follow-up hardening on SEC-77; until it lands, the exception's safety depends on the routine's own fix-only judgement plus the manual-dispatch confirmation.

## Release-flow gate (SEC-86 Finding A)

The `beta → main` merge in `promote-to-production.yml` is the highest-blast-radius, effectively irreversible action in the project. It is worth being precise about what gates it today:

- The **`merge-and-push` job** performs the `git merge beta` + `git push origin main` (pushed with `LYRA_RELEASE_PAT` so the downstream `deploy-production.yml` fires — see CLAUDE.md gotcha #16). This job declares **no `environment:` block**.
- The **`production` GitHub Environment** — the only place GitHub *required-reviewers* can attach — is referenced solely by `deploy-production.yml`'s `deploy-production` job, which runs **after** the merge to `main`.

**Net residual:** any required-reviewers configured on the `production` Environment guard the Vercel *deploy*, not the *merge*. The sole gate on the irreversible merge is the typed `workflow_dispatch` input (`Type "PRODUCTION"`). Anyone with repo-write who can dispatch the workflow can land `beta` on `main` by typing the fixed string, with no second pair of eyes on the merge itself. Compensating controls that remain in force: `verify-source` (beta CI must be green at HEAD), SHA-matched production smoke tests, and `auto-rollback` on smoke failure.

**Decision pending (Luisa):** either

1. **Add a merge-time reviewer gate** — put `environment: production` on the `merge-and-push` job so required-reviewers fire *before* the merge. This adds a manual approval step to the solo-maintainer release flow (you approve your own dispatch), which may or may not be worth the friction; **or**
2. **Accept the residual** — keep the typed-confirm gate as the merge control and rely on the compensating controls above.

Either way, the `production` Environment's *required-reviewers* setting must be confirmed in **GitHub repo settings** (it is not verifiable from the workflow files).

Until this is decided, the gap is kept **explicit and non-regressing** by `scripts/check-workflow-integrity.sh` **Pattern 5**, which fails CI if a workflow pushes to `main` without either `environment: production` or an `# integrity-ok: sec-86` waiver, and *separately* fails if the typed-confirm compensating control is ever removed.

## Machine-checked fix-only auto-promote gate (SEC-77)

There was one owner-authorised exception (2026-06-21) to "no cron, ever" on `beta → main`, **withdrawn by Luisa on 2026-07-23** (see `CLAUDE.md` → Deployment Pipeline): the SEC-22 weekly health/regression routine was permitted to auto-promote to production **only when every change pending on `beta` ahead of `main` is a bug-FIX — never a feature** (see `docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md`). That authority is currently **inactive** — the routine must not invoke `promote_mode=auto-fix-only` (or otherwise auto-promote to production) unless Luisa reinstates it in writing with a new date. Until SEC-77 this "every pending change is a fix" condition was **procedural** — enforced only by the routine-agent's judgement, with nothing in the workflow to stop a feature slipping through and auto-shipping to a minors' platform unattended.

It is now **machine-enforced**:

- `promote-to-production.yml` takes a `promote_mode` input (`manual` default, or `auto-fix-only`). Both the manual feature release and the SEC-22 auto path share the one workflow; the input is what tells them apart.
- In **`manual`** mode the gate is a no-op — a manual feature release is authorised by Luisa's typed `PRODUCTION` confirm, and features are expected.
- In **`auto-fix-only`** mode the `merge-and-push` job runs `scripts/check-fix-only-promote.sh` **before** the irreversible `git merge beta` + `git push origin main`. The script inspects every non-merge commit in `origin/main..origin/beta` and **hard-fails** (blocking the merge, leaving `main` untouched) if any is a **feature** (`feat`), a **breaking change** (`<type>!:`), or **anything without an unambiguous non-feature conventional-commit type**. Merge commits are skipped; an empty range fails closed.
- The fallback on a hard fail is exactly the policy's prescribed one: **stop the auto-promote and require manual sign-off** (re-dispatch without `promote_mode=auto-fix-only`). A false positive therefore only forces a human — safe — while a false negative (a feature auto-ships) is the failure mode the gate biases hard against.
- **Allow-list (the one policy knob):** the non-feature types treated as fix-only live in `ALLOWED_TYPES` at the top of `scripts/check-fix-only-promote.sh` (`fix revert docs chore ci build test style`). It deliberately errs strict — `perf`/`refactor` are treated as feature-class (they can change runtime behaviour) and force manual sign-off. Widen or narrow it only as a reviewed policy decision.

## Release-flow gate (SEC-86 Finding A)

The `beta → main` merge in `promote-to-production.yml` is the highest-blast-radius, effectively irreversible action in the project. It is worth being precise about what gates it today:

- The **`merge-and-push` job** performs the `git merge beta` + `git push origin main` (pushed with `LYRA_RELEASE_PAT` so the downstream `deploy-production.yml` fires — see CLAUDE.md gotcha #16). This job declares **no `environment:` block**.
- The **`production` GitHub Environment** — the only place GitHub *required-reviewers* can attach — is referenced solely by `deploy-production.yml`'s `deploy-production` job, which runs **after** the merge to `main`.

**Net residual:** any required-reviewers configured on the `production` Environment guard the Vercel *deploy*, not the *merge*. The sole gate on the irreversible merge is the typed `workflow_dispatch` input (`Type "PRODUCTION"`). Anyone with repo-write who can dispatch the workflow can land `beta` on `main` by typing the fixed string, with no second pair of eyes on the merge itself. Compensating controls that remain in force: `verify-source` (beta CI must be green at HEAD), SHA-matched production smoke tests, and `auto-rollback` on smoke failure.

**Decision pending (Luisa):** either

1. **Add a merge-time reviewer gate** — put `environment: production` on the `merge-and-push` job so required-reviewers fire *before* the merge. This adds a manual approval step to the solo-maintainer release flow (you approve your own dispatch), which may or may not be worth the friction; **or**
2. **Accept the residual** — keep the typed-confirm gate as the merge control and rely on the compensating controls above.

Either way, the `production` Environment's *required-reviewers* setting must be confirmed in **GitHub repo settings** (it is not verifiable from the workflow files).

Until this is decided, the gap is kept **explicit and non-regressing** by `scripts/check-workflow-integrity.sh` **Pattern 5**, which fails CI if a workflow pushes to `main` without either `environment: production` or an `# integrity-ok: sec-86` waiver, and *separately* fails if the typed-confirm compensating control is ever removed.

## Credential / separation-of-duties residual (SEC-66)

The same `merge-and-push` job that performs the `beta → main` merge authenticates its push with **`LYRA_RELEASE_PAT`** — a **long-lived, broad** personal-access token (Contents + Workflows: *write*, chosen so the push both lands on `main` and can carry workflow-file changes; see CLAUDE.md gotcha #16). Because the push is made *as that token*, it **structurally bypasses branch protection** on `main`:

- Whoever (or whatever) holds the PAT can write **review-free** to production `main` and to workflow definitions across branches.
- Compromise or misuse of the single secret yields direct, unreviewed write to the highest-blast-radius branch in the project — the separation-of-duties gap SEC-66 tracks.

**The real fix is a credential + repo-settings change (Luisa's call), not a workflow-file edit:**

1. Migrate the promote push to a **short-lived, fine-grained token** — a GitHub App installation token, or an expiring fine-grained PAT scoped to Contents + Workflows on this one repo only — so no long-lived broad credential sits in the release path; **and**
2. Run the promote from a **protected GitHub Environment with a required reviewer**, so the merge push is backed by an approval gate rather than a static secret.

`verify-release-pat.yml` remains the scope-drift canary for the current PAT, and rotation is recorded in `docs/SECURITY_ROTATION.md`. Because the fix lives in credentials and repo settings (not the workflow YAML), the residual is kept **explicit and non-expanding** by `scripts/check-workflow-integrity.sh` **Pattern 6**: any workflow that runs `git push origin main` while referencing `secrets.LYRA_RELEASE_PAT` must carry an `# integrity-ok: sec-66` waiver. This pins the broad-PAT-to-main path to its single audited location (`promote-to-production.yml`'s `merge-and-push` job) and fails CI if a *new* workflow starts pushing to `main` with the broad PAT without that being a documented, reviewed decision. The waiver is **decision-neutral** — like Pattern 5a it does not force a particular fix, only surfaces the residual until SEC-66 is resolved.

## Reference

- KAN-173 (this policy): <https://checklyra.atlassian.net/browse/KAN-173>
- KAN-167 (workflow integrity, the prior art for false-positive prevention): <https://checklyra.atlassian.net/browse/KAN-167>
- BUGS-11 (auto-merge BLOCKED, originally attributed to strict-ancestry): <https://checklyra.atlassian.net/browse/BUGS-11>
- BUGS-16 (auto-merge real root cause — phantom Vercel check_suite): <https://checklyra.atlassian.net/browse/BUGS-16>
- `docs/RUNBOOK.md` — operational procedures
- `.github/workflows/promote-to-staging.yml` — the manual workflow (auto-promote calls the same logic)
- `.github/workflows/promote-to-production.yml` — direct-merge flow as of 2026-05-15 (BUGS-16 fix)
- `.github/workflows/auto-promote-to-staging.yml` — the scheduled wrapper
- `scripts/check-fix-only-promote.sh` — SEC-77 machine-checked fix-only gate for the `auto-fix-only` production promote (unit-tested in `tests/scripts/check-fix-only-promote.test.js`)
