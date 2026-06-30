# Lyra Operational Runbook

## Environments

Each environment is a fully independent stack: app + Supabase + (where deployed) MCP server. **Keys, sessions, and data do NOT cross environments.**

| Environment | App URL | MCP URL | Supabase project | Branch | Access |
|---|---|---|---|---|---|
| Production | https://checklyra.com | https://mcp.checklyra.com | `prod-lyra` (`llzkgprqewuwkiwclowi`) | `main` | Public (Cloudflare bot challenge) |
| Beta _(planned — KAN-175)_ | https://beta.checklyra.com | https://mcp.checklyra.com | `prod-lyra` (shared with prod) | `beta` | Vercel SSO + email allowlist |
| Staging | https://stage.checklyra.com | _(none — internal-only)_ | `stage-lyra` (`uobmlkzrjkptwhttzmmi`) | `staging` | Vercel SSO |
| Development | https://dev.checklyra.com | https://mcp-dev.checklyra.com | `dev-lyra` (`ilprytcrnqyrsbsrfujj`) | `develop` | Vercel SSO |

### MCP usage rules

- **Read tools** (`lyra_get_profile`, `lyra_search_profiles`, etc.) are public — no API key required. They will work against any MCP endpoint regardless of which env you're targeting.
- **Write tools** (`lyra_update_profile`, `lyra_add_item`, etc.) require an `api_key` argument. The key must have been generated on the **same Supabase project as the MCP** you're calling. Per-env mapping:
  - Key from `dev.checklyra.com/dashboard/settings` → use `mcp-dev.checklyra.com`
  - Key from `checklyra.com/dashboard/settings` OR `beta.checklyra.com/dashboard/settings` → use `mcp.checklyra.com` (beta and prod share `prod-lyra`, so keys are interchangeable across them)
  - Key from `stage.checklyra.com/dashboard/settings` → currently has no MCP endpoint; staging keys are functionally inert. Staging is engineering-only and does not expose MCP integrations.

If a write call returns `"Invalid API key"`, regenerate against the env whose MCP you're calling. Tracked by BUGS-1 (closed 2026-05-04 as documentation gap, not a code bug).

### Stage's role in the new pipeline

Once KAN-175 lands, stage's purpose narrows to **engineering pre-flight only** — a test mirror against `stage-lyra` that catches build/deploy regressions before code reaches beta testers. Stage will NOT have an MCP server, and the API key generation UI on stage should be hidden or warn-flagged (part of KAN-175 scope).

Real-user beta testing happens on `beta.checklyra.com` with prod credentials, so beta keys are valid prod keys via the existing `mcp.checklyra.com`.

## Release Procedure

Promotions follow develop → staging → beta → main with manual triggers (and one weekly auto-promote to staging — see `docs/RELEASE_POLICY.md`). The full policy + cadence + when-NOT-to-release rules live in `docs/RELEASE_POLICY.md`; this section covers the operational mechanics.

### Promote develop → staging

```bash
gh workflow run promote-to-staging.yml -f confirm=promote --repo luisa-sys/lyra
```

The workflow:

1. Verifies dev CI passed at develop HEAD (filtered by SHA — won't accept stale runs)
2. Merges develop into staging using `LYRA_RELEASE_PAT` (NOT `GITHUB_TOKEN`, which suppresses downstream workflow triggers — see CLAUDE.md gotcha #16)
3. Pushes staging branch
4. Waits up to 7 min for `deploy-staging.yml` to run for the new SHA
5. Verifies via Vercel API that the new SHA is actually deployed and READY
6. Smoke-checks `stage.checklyra.com` and `mcp.checklyra.com/health`

If any step fails, the workflow exits non-zero and no further promotion happens.

### Promote staging → main (production)

```bash
gh workflow run promote-to-production.yml -f confirm=PRODUCTION --repo luisa-sys/lyra
```

Note the case-sensitive confirmation — must be exactly `PRODUCTION`.

The workflow uses a PR-based pattern (because `main` requires PR per branch protection):

1. Verifies staging CI passed at staging HEAD (SHA-filtered)
2. Creates a release branch `release/{date}-prod-{shortsha}` from staging
3. Pushes the release branch using `LYRA_RELEASE_PAT` so PR-checks workflows trigger
4. Opens a PR from release branch → main with full context in the body
5. Enables auto-merge — PR merges automatically when status checks pass
6. Polls until merged (up to 15 min — CodeQL + PR Quality Gate must pass)
7. Waits for `deploy-production.yml` to run for the merge SHA
8. Verifies Vercel production deployment matches the SHA
9. Runs 9 smoke tests on public endpoints
10. If all pass, creates release tag `v0.1.x+1`
11. Cleans up the release branch
12. If smoke tests fail, auto-rollback fires (Vercel `promote` to previous deployment)

### Required secrets

- `LYRA_RELEASE_PAT` — fine-grained PAT with `contents:write` AND `pull-requests:write` on `luisa-sys/lyra`. Used for the merge push so downstream workflows trigger AND for `gh pr create` in the production-promotion flow (BUGS-8). Annual rotation. See `docs/SECURITY_ROTATION.md`.
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — for SHA verification via Vercel API.

### Version pairing (KAN-166)

Every release tag MUST be paired with a `package.json` version bump. The pipeline currently produces the tag automatically (step 10 above) AFTER the merge to main has landed; the bump is the operator's responsibility on the originating PR. Workflow:

1. On the PR that will be promoted, run `npm version <patch|minor|major> --no-git-tag-version` to bump `package.json` AND `package-lock.json`. Commit on the same PR.
2. Promote develop → staging → beta → main as normal (three workflow_dispatches; see the section above). The post-merge tag step (`v0.1.x+1`) will match.
3. The CI test `tests/unit/version-drift.test.js` fails any future PR where `package.json` version doesn't match an existing tag — drift is caught fast, not silently.

**Don't** create a tag without bumping `package.json`, or vice versa. The drift test will reject the next PR until the pair is reunited.

### When NOT to release

- Open Highest-priority bug ticket against the system being released
- Smoke test endpoints already failing (deploy won't make it worse, but you won't get a clean signal)
- Mid-incident (use a hotfix branch directly to main via PR if needed; don't pile a release on top of an active investigation)
- Friday afternoon UK time (no support window for the weekend)

### Verifying a release worked

After the workflow completes successfully:

```bash
# Confirm production SHA matches main HEAD
gh api repos/luisa-sys/lyra/branches/main --jq '.commit.sha'
curl -sf -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID&target=production&limit=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['deployments'][0]; print(f\"Vercel SHA: {d['meta'].get('githubCommitSha')}\")"
```

Both SHAs should match. If they don't, suspect the CodeQL alert dashboard mismatch (alerts only auto-resolve against `main`'s state, may take 24h after merge to refresh).

## Dev E2E & Regression Smoke (post-deploy)

After every `deploy-dev` that touches the dashboard, profile, or onboarding journey, run the checks in **[`docs/DEV_E2E_REGRESSION.md`](DEV_E2E_REGRESSION.md)**. This exists because the CI "Playwright E2E (local build)" gate runs a *local* build with a *fresh* user only — it missed both **BUGS-63** (deployed-build dashboard blank on hard load) and the **KAN-349 `completion_score`** journey gap. Catch these in dev, not in staging/beta/prod.

**The 30-second must-do after any dashboard deploy** — in a logged-in dev browser:

1. Open `https://dev.checklyra.com/dashboard?cb=1` **directly** (a hard load — refresh / typed URL, NOT an in-app soft navigation).
2. The full dashboard must render (header + a widget + profile card), **not** a blank page / lone footer.
3. Console: `document.querySelectorAll('main').length` must be **1**. A `2` (a hidden second `<main>`) means the `loading.tsx` Suspense boundary is stuck again = BUGS-63 regression → diagnostic playbook in the doc.

The full widget-journey state matrix, the fresh-user walkthrough, the "dashboard is blank" diagnostic playbook, and dev test-user management (create/confirm via the DB token, drive states by SQL, reset/clean up) live in `docs/DEV_E2E_REGRESSION.md`.

## Self-Healing Flows (KAN-233)

The KAN-63 epic established a tiered self-healing automation. As of KAN-233 the **smoke-failure auto-rollback** and **abuse-log foundation** are in place; auto-restart and auto-block at the network edge are tracked under KAN-246 / KAN-247 and require user-provisioned secrets.

### Smoke-failure auto-rollback (Part A — shipped)

**What fires it:** `promote-to-production.yml` `smoke-tests` job fails (post-deploy smoke against `checklyra.com` or `mcp.checklyra.com` returned an unexpected response).

**What happens:**

1. `auto-rollback` job runs (lives at the bottom of `promote-to-production.yml`).
2. `scripts/rollback-to-sha.py` promotes the **pre-merge** SHA back to production on Vercel using the captured `verify-source.outputs.main_sha_before_merge`.
3. An alert email is sent via Resend to `luisa@santos-stephens.com` with the SHA, the rollback step's outcome, and a link to the workflow run.

**What you do when it fires:**

1. Read the email. If status was `success`, production is back on the previous green SHA — proceed to step 2.
2. Investigate the failing smoke test in the workflow run (linked from the email).
3. Fix on `develop` → promote `develop → staging → beta` and verify the smoke test passes locally / on beta.
4. Re-run `promote-to-production.yml` once you're confident.

**If the rollback itself fails** (`status: failure` in the email): production is in an inconsistent state. Follow "Deployment Rollback → Via Vercel Dashboard" below to roll back manually, then file a Highest-priority BUGS ticket so the root-cause of the failed auto-rollback is fixed.

**Reference:** BUGS-9 captured the original auto-rollback, KAN-233 added the alerting layer.

### Tier-2 abuse-detection logging (Part of KAN-232, shipped)

Every MCP request now writes a row to `public.mcp_tool_call_log` on the Supabase project the MCP server points at. Aggregated as `mcp_per_ip_recent_count` (rolling 1-hour count per IP). The MCP server gates this behind `MCP_TOOL_CALL_LOG_ENABLED=true` — default OFF; flip the env var on Railway per environment after the migration is promoted.

To inspect:

```sql
-- Top noisy IPs in the last hour (on the relevant Supabase project)
select ip, request_count, last_seen
from public.mcp_per_ip_recent_count
order by request_count desc limit 20;
```

### MCP restart on health-check failure (Part B — deferred, KAN-246)

Not yet shipped. The current `health-check.yml` cron creates a GitHub issue on failure but does not auto-restart the Railway service. Tracked under KAN-246; needs a `RAILWAY_API_TOKEN` secret scoped to restart on the `lyra-mcp-server` project.

### Cloudflare auto-block on abuse threshold (Part C — deferred, KAN-247)

Not yet shipped. KAN-232 built the logging foundation; KAN-247 will consume `mcp_per_ip_recent_count` and add Cloudflare WAF rules for IPs over the threshold. Needs a `CLOUDFLARE_API_TOKEN` with `Zone WAF:Edit` on `checklyra.com`.

### CI workflow auto-triage and self-heal (Tier 4 — shipped)

`.github/workflows/auto-fix-known-failures.yml` reacts to `workflow_run.completed` events from the recurring failure-prone workflows (Anomaly detect, Beta gate smoke, Staging Tests, Affiliate link smoke, Auto-promote develop→staging) and runs `scripts/auto-fix-known-failures.py` to classify the failure against `scripts/auto-fix-patterns.json` and apply one of four remediations:

| Remediation kind | What it does | Idempotent? |
|---|---|---|
| `create_label` | Creates a missing GitHub label; re-runs the failed workflow | Yes (label_exists check) |
| `alert_secret_rotation` | Files (or updates) a deduped issue labeled `autoheal-tracked` + `autoheal/needs-human` listing the rotation steps | Yes (issue_upsert) |
| `pr_pending` | Finds the open PR carrying the fix (by branch substring) and posts a one-time marker comment so the daily failure surfaces on the PR | Yes (marker dedup) |
| `unknown` (fallback) | Files a deduped issue with the log excerpt under label `autoheal/unknown-pattern` so a new pattern can be added | Yes (issue_upsert) |

**Regression guard:** `scripts/auto-fix-known-failures.py --self-test` runs against fixtures in `tests/fixtures/auto-fix-logs/` on every PR via `pr-checks.yml`. It verifies every catalogued pattern still matches its anchor fixture and no pattern false-positives on a sibling fixture within the same workflow. Adding a new pattern requires adding a fixture in the same commit.

**Adding a new pattern:**
1. Save the failing log to `tests/fixtures/auto-fix-logs/<workflow-slug>.log` (or augment an existing fixture if the workflow is already covered).
2. Add a pattern entry to `scripts/auto-fix-patterns.json` — pick a `remediation.kind` from the table above.
3. Add the (fixture, pattern_id) tuple to `FIXTURE_EXPECTATIONS` in both `scripts/auto-fix-known-failures.py` and `tests/unit/auto-fix-patterns.test.js`.
4. Run `python3 scripts/auto-fix-known-failures.py --self-test` and `npx jest tests/unit/auto-fix-patterns.test.js` — both must pass before merge.

**Manual replay** (e.g. to test a new pattern against a real run): `gh workflow run auto-fix-known-failures.yml -f run_id=<id> -f workflow_name="<display name>" -f dry_run=true`.

**What it deliberately does NOT do:** edit code, open PRs with code changes, merge anything, push to any branch, restart any external service. The auto-fix layer is bounded to GitHub-native actions (labels, issues, comments, re-runs). Anything beyond that is a follow-up ticket.

## Deployment Rollback

### Via Vercel Dashboard (recommended)

1. Go to <https://vercel.com/luisa-sys-projects/lyra/deployments>
2. Find the last working deployment
3. Click three dots → "Promote to Production"

### Via CLI

```bash
vercel ls --limit 10
vercel promote <DEPLOYMENT_URL> --yes
```

### Via Git revert

```bash
git revert HEAD
git push
```

## Database Backup

> **Full DR detail + recovery test plan:** see [docs/DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)
> (SEC-23) and the Confluence DR runbook (SEC-5). This section is the quick reference.

### Manual backup

```bash
# Public-only (legacy):
export SUPABASE_DB_URL='your-connection-string'
./scripts/backup-database.sh

# COMPLETE (public + auth + storage + roles) — use this for a real DR backup:
./scripts/backup-database-complete.sh ./backups
```

`backup-database.sh` dumps **only** the `public` schema and therefore CANNOT
reconstruct user accounts (`auth`) — restoring it alone leaves profiles whose
`user_id` points at users that don't exist. Use `backup-database-complete.sh`
(SEC-23) for anything you intend to actually restore from.

### Automated backup

- **Complete + encrypted backup** → GitHub Artifacts + R2 WORM:
  `backup-complete.yml`. The one to rely on. Ships **dispatch-only**; once the
  secrets in [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §8 are provisioned and a
  manual run is green, enable the daily 01:00 UTC schedule (1-line uncomment).
- Weekly public-only backup (legacy): `backup-database.yml` (Sun 02:00 UTC),
  GitHub Artifacts, 90-day retention.
- **Weekly real restore drill**: `backup-restore-test.yml` (Sun 05:00 UTC) now
  restores the latest backup into a throwaway Postgres and asserts the data
  round-trips (table count + RLS + per-table row counts) — it is no longer a
  schema-only check, and no longer silently passes on a missing secret.
- Manually trigger any of these: GitHub → Actions → select workflow → Run.

### Supabase built-in backups

- Free plan: Daily backups, 7-day retention
- Dashboard: Supabase → Project → Database → Backups

### Verifying a backup is real (NEVER skip)

A green workflow run is not proof of a real backup. KAN-167 produced two layers of automated verification that make manual checks the exception, not the rule:

1. **Pre-upload gate** in `backup-platform.yml` — fails the workflow red if the SQL dump is a placeholder, the DNS JSON has `success:false`, or the secrets list contains failure markers. R2 upload is skipped on failure.
2. **Section 13 of the weekly status report** — re-validates the most recent successful backup artifact and surfaces ✅/❌ per file in the Monday email. Drives the report run red if any check fails.

Use the manual procedure below ONLY when:
- Investigating a specific suspect run (e.g., the workflow reported success but a downstream Section 13 check flagged it)
- Verifying a brand-new operator workflow before relying on it
- Spot-checking after a major change to the backup pipeline

#### Manual verification (operator command)

Reach for the helper script — it implements the same three checks Section 13 runs in CI, callable locally against any downloaded artifact:

```bash
# Download the most recent backup-platform artifact
RUN_ID=$(gh run list --workflow=backup-platform.yml --status success --limit 1 --json databaseId -q '.[0].databaseId')
ART_NAME=$(gh api "repos/luisa-sys/lyra/actions/runs/${RUN_ID}/artifacts" --jq '.artifacts[] | select(.name | startswith("lyra-platform-backup-")) | .name' | head -1)
gh run download $RUN_ID -R luisa-sys/lyra --name "$ART_NAME" --dir /tmp/lyra-backup

# Run the same checks Section 13 runs
bash scripts/check-backup-integrity.sh /tmp/lyra-backup
# Exits 0 + ✅ lines if all checks pass
# Exits 1 + ❌ lines if any check fails — file a Highest-priority ticket

# Cleanup when done
rm -rf /tmp/lyra-backup
```

If `check-backup-integrity.sh` exits non-zero, treat ALL backups since the last verified-clean run as suspect. The `❌` line on stdout names the specific failure; investigate the workflow logs for that run. KAN-167 is the parent ticket for the underlying integrity policy.

#### Manual deep-dive (when the script reports failure)

```bash
# SQL dump
head -c 100 /tmp/lyra-backup/supabase-schema.sql       # must start with "--"
grep -c "^CREATE TABLE" /tmp/lyra-backup/supabase-schema.sql  # must be > 0

# DNS JSON
python3 -c "
import json
d = json.load(open('/tmp/lyra-backup/cloudflare-dns.json'))
print('success:', d.get('success'), 'records:', len(d.get('result', [])))
"

# Secrets list — must NOT contain failure markers
grep -E "\(failed to fetch|fetch failed|Resource not accessible" /tmp/lyra-backup/github-secrets-list.txt
# (no output = clean)
```

## Database Restore

### From backup file

```bash
export SUPABASE_DB_URL='your-connection-string'
./scripts/restore-database.sh ./backups/lyra_backup_YYYYMMDD_HHMMSS.sql
```

WARNING: This drops all existing tables before restoring.

### Pre-restore checklist

1. Take a fresh backup of the current state FIRST
2. Verify the backup file is valid: `head -20 backup_file.sql`
3. Test restore on a throwaway Supabase project if possible
4. Notify users of potential downtime

## Database Migration Safety

### Before applying a migration

1. Run `./scripts/backup-database.sh` to create a backup
2. Review the SQL in `supabase/migrations/`
3. Test on dev environment first
4. Apply with `supabase db push`

### Rolling back a migration

```bash
supabase migration repair <VERSION> --status reverted
./scripts/restore-database.sh ./backups/latest_backup.sql
```

## Scheduled Workflows (GitHub Actions)

DayTime (UTC)WorkflowDescriptionSunday02:00backup-database.ymlDatabase backup to GitHub Artifacts (90-day retention)Sunday02:30backup-platform.ymlFull platform backup (repos, DNS, schema) to Cloudflare R2Sunday04:00mutation-testing.ymlStryker mutation testingSunday05:00backup-restore-test.ymlAutomated backup restore verificationMonday07:00weekly-report.ymlWeekly status report emailed via ResendMonday—DependabotDependency update PRs (npm + GitHub Actions)Wednesday07:00security-audit.ymlnpm audit scan; emails alert if high/critical vulns found

All scheduled workflows also support `workflow_dispatch` for manual runs.

### Staging testing program (KAN-176)

Defined in `.github/workflows/staging-tests.yml`. Additive to the Playwright E2E suite that runs inline in `deploy-staging.yml` (KAN-114).

| Layer | What it does | Failure threshold |
|---|---|---|
| axe-core accessibility | Scans homepage, login, signup, privacy, terms, waitlist using `@axe-core/playwright` with WCAG 2.1 A/AA + best-practice tags | Any `serious` or `critical` violation fails the run. `moderate`/`minor` are logged to the step summary and uploaded as the `axe-playwright-report` artifact, but do NOT fail. |
| Lighthouse budget | Single Lighthouse desktop run via `lhci autorun` against the staging Vercel direct URL | Performance < 80 OR Accessibility < 90 OR Best Practices < 90 OR SEO < 90 fails the run. |

**Triggers:**

- `workflow_run` on successful completion of `Deploy to Staging` — so the suite runs after every staging deploy. (Note: `workflow_run` only fires when the workflow definition is on the default branch, so this needs to reach `main` before the post-deploy hook activates. See CLAUDE.md gotcha #1.)
- `schedule: 0 5 * * *` — nightly 05:00 UTC, catches upstream regressions on quiet days.
- `workflow_dispatch` with optional `target_url` override — for manual reruns and ad-hoc testing of arbitrary Vercel deploy URLs.

**SSO bypass:** all requests carry `x-vercel-protection-bypass: ${{ secrets.VERCEL_AUTOMATION_BYPASS }}` and target the direct Vercel deploy URL (`lyra-xxx.vercel.app`), not `stage.checklyra.com`. Same pattern as `deploy-staging.yml`'s `/api/health` step — Cloudflare bot challenge would otherwise block CI runner IPs.

**Where the results go:**

- GitHub Actions run page → `Staging Tests` workflow, with `::error::` / `::notice::` annotations inline.
- Artifacts (retained 14 days): `axe-playwright-report` (HTML + per-page JSON) and `lighthouse-reports` (raw `.lighthouseci/` directory).
- Lighthouse summary also uploads to `temporary-public-storage` and the URL is printed in the job log.

**Reading a failure:**

1. `axe-accessibility` red → open the `axe-playwright-report` artifact, look at `axe-<page>.json`. The `impact` field tells you `critical`/`serious`. Fix the offending elements; do NOT relax the threshold.
2. `lighthouse` red → check the assertion line at the end of the job (`categories:performance: expected >= 0.80, got 0.XX`). Open the `lighthouse-reports` artifact for the full HTML report including opportunities and diagnostics. A regression usually traces to a new heavy dependency, a layout shift introduced by a copy change, or a missing image alt/`<meta description>`.
3. `resolve-target` red → the missing-secret guard tripped, OR the Vercel API returned no READY staging deploy. The latter usually means a deploy is in-flight; rerun once it's READY.

### Security Audit (Wednesday 07:00 UTC)

- Runs `npm audit --json` against lockfile
- Parses results for high/critical severity vulnerabilities
- Emails `luisa@santos-stephens.com` via Resend if any found
- Writes detailed advisory table to GitHub Actions step summary
- Workflow fails (red status) when high/critical vulns detected — visible in GitHub UI
- Manual trigger: GitHub → Actions → "Weekly Security Audit" → Run workflow

## Incident Response

**Primary signal:** UptimeRobot (5-minute interval, KAN-163). Email alerts to luisa@santos-stephens.com and ben@santos-stephens.com when any monitored endpoint goes down or an SSL cert is within 30 days of expiry.

**Secondary signal:** the 6-hourly GitHub Actions health-check workflow. Slower (up to 6h delay) but redundant; useful when UptimeRobot itself is degraded.

**Tertiary signal:** weekly report Monday 07:00 UTC — Section 1 endpoint health is a 7-day summary, not a live signal, but it cross-checks UptimeRobot.

When an alert fires:
1. Check the affected endpoint manually with `curl -I` to confirm it's a real outage rather than a probe blocking issue (Cloudflare bot protection occasionally trips on UptimeRobot's IP — gotcha #7 in CLAUDE.md).
2. Check Vercel deployment status for the affected env.
3. Check Cloudflare for DNS, Workers, or zone-level issues.
4. If MCP-side: check Railway logs.
5. Roll back the deploy if a recent promotion looks responsible — see "Deployment Rollback" above.

UptimeRobot setup, monitor list, and bootstrap procedure: [`docs/UPTIMEROBOT_SETUP.md`](./UPTIMEROBOT_SETUP.md).

## Emergency Contacts

ServiceDashboardSupportVercel[vercel.com/luisa-sys-projects/lyra](http://vercel.com/luisa-sys-projects/lyra)[vercel.com/help](http://vercel.com/help)Supabase[supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj](http://supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj)[supabase.com/support](http://supabase.com/support)Cloudflare[dash.cloudflare.com](http://dash.cloudflare.com)[cloudflare.com/support](http://cloudflare.com/support)GitHub[github.com/luisa-sys/lyra](http://github.com/luisa-sys/lyra)[support.github.com](http://support.github.com)Railwayrailway.app (Lyra project)railway.app/helpUptimeRobot[dashboard.uptimerobot.com](https://dashboard.uptimerobot.com/)[uptimerobot.com/help](https://uptimerobot.com/help)

## MCP Server Operations

### Production MCP ([mcp.checklyra.com](http://mcp.checklyra.com))

- **Hosting**: Railway (auto-deploy from luisa-sys/lyra-mcp-server main branch)
- **Supabase**: Production (llzkgprqewuwkiwclowi)
- **Restart**: Railway dashboard → lyra-mcp-server service → Deployments → Redeploy

### Dev MCP ([mcp-dev.checklyra.com](http://mcp-dev.checklyra.com))

- **Hosting**: Railway (same repo, separate service, auto-deploy from main)
- **Supabase**: Dev (ilprytcrnqyrsbsrfujj)
- **Restart**: Railway dashboard → lyra-mcp-dev service → Deployments → Redeploy
- **Purpose**: Testing write tools with API keys generated on [dev.checklyra.com](http://dev.checklyra.com)

### MCP Health Check

```bash
curl https://mcp.checklyra.com/health      # Production
curl https://mcp-dev.checklyra.com/health   # Dev
```

### MCP-main lockstep cadence (KAN-222)

The MCP server and the main web app are two surfaces of the same product. Drift between them is a long-running platform risk — agents over-promise to users when the MCP exposes less than the web does. Policy:

- **Lockstep epics.** Every user-facing feature that touches data exposable by MCP ships MCP tool coverage in the same epic. Cross-repo PRs (`luisa-sys/lyra` + `luisa-sys/lyra-mcp-server`) are the norm. Linked in PR descriptions.
- **Deferral annotation.** When coverage is intentionally not in scope, the parent KAN ticket must carry `MCP coverage: deferred — <reason> (follow-up: KAN-XYZ)`, and the follow-up ticket must exist before merge.
- **Reviewer checklist** at the bottom of `CLAUDE.md` → "MCP-main lockstep policy".

When deploying a feature with MCP changes:

1. Merge the MCP server PR first (Railway auto-deploys from `main`).
2. Wait for `mcp-dev.checklyra.com/health` to report the new build.
3. Then merge the main-app PR to `develop` (Vercel auto-deploys to `dev.checklyra.com`).
4. End-to-end test exercises the MCP tool from a real agent on `dev.checklyra.com`.

Reverse the order on rollback (web first, then MCP).
