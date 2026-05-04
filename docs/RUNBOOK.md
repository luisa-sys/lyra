# Lyra Operational Runbook

## Environments

Each environment is a fully independent stack: app + Supabase + (where deployed) MCP server. **Keys, sessions, and data do NOT cross environments.**

| Environment | App URL | MCP URL | Supabase project | Branch | Access |
|---|---|---|---|---|---|
| Production | https://checklyra.com | https://mcp.checklyra.com | `prod-lyra` (`llzkgprqewuwkiwclowi`) | `main` | Public (Cloudflare bot challenge) |
| Staging | https://stage.checklyra.com | _(not deployed yet — see below)_ | `stage-lyra` (`uobmlkzrjkptwhttzmmi`) | `staging` | Vercel SSO |
| Development | https://dev.checklyra.com | https://mcp-dev.checklyra.com | `dev-lyra` (`ilprytcrnqyrsbsrfujj`) | `develop` | Vercel SSO |

### MCP usage rules

- **Read tools** (`lyra_get_profile`, `lyra_search_profiles`, etc.) are public — no API key required. They will work against any MCP endpoint regardless of which env you're targeting.
- **Write tools** (`lyra_update_profile`, `lyra_add_item`, etc.) require an `api_key` argument. The key must have been generated on the **same env as the MCP** you're calling. Per-env validation:
  - Key from `dev.checklyra.com/dashboard/settings` → use `mcp-dev.checklyra.com`
  - Key from `checklyra.com/dashboard/settings` → use `mcp.checklyra.com`
  - Key from `stage.checklyra.com/dashboard/settings` → currently has no MCP endpoint; staging keys cannot be used until a stage MCP is deployed.

If a write call returns `"Invalid API key"`, regenerate against the env whose MCP you're calling. Tracked by BUGS-1 (closed 2026-05-04 as documentation gap, not a code bug).

### Staging MCP — current gap

Staging issues API keys via its Settings page but has no MCP server pointed at `stage-lyra`, so those keys are functionally inert. Decision pending on whether to:

1. Deploy a third Railway service `mcp-stage.checklyra.com → stage-lyra` so staging mirrors prod's full stack (recommended for beta testers who need MCP integration).
2. Hide the API key generation UI on `stage.checklyra.com` until (1) is in place.
3. Reframe staging as a beta channel for prod data — would require pointing `stage.checklyra.com` at `prod-lyra` Supabase, with corresponding loss of isolation for testing.

See "Stage strategy" discussion 2026-05-04 for context.

## Release Procedure

Promotions follow develop → staging → main with manual triggers and automated verification.

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
2. Promote develop → staging → main as normal. The post-merge tag step (`v0.1.x+1`) will match.
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

### Manual backup

```bash
export SUPABASE_DB_URL='your-connection-string'
./scripts/backup-database.sh
```

Backups are saved to `./backups/lyra_backup_YYYYMMDD_HHMMSS.sql`

### Automated backup

- Weekly backups run via GitHub Actions (Sundays 02:00 UTC)
- Stored as GitHub Artifacts with 90-day retention
- Manually trigger: GitHub → Actions → "Weekly Database Backup" → Run workflow

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

### Security Audit (Wednesday 07:00 UTC)

- Runs `npm audit --json` against lockfile
- Parses results for high/critical severity vulnerabilities
- Emails `luisa@santos-stephens.com` via Resend if any found
- Writes detailed advisory table to GitHub Actions step summary
- Workflow fails (red status) when high/critical vulns detected — visible in GitHub UI
- Manual trigger: GitHub → Actions → "Weekly Security Audit" → Run workflow

## Emergency Contacts

ServiceDashboardSupportVercel[vercel.com/luisa-sys-projects/lyra](http://vercel.com/luisa-sys-projects/lyra)[vercel.com/help](http://vercel.com/help)Supabase[supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj](http://supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj)[supabase.com/support](http://supabase.com/support)Cloudflare[dash.cloudflare.com](http://dash.cloudflare.com)[cloudflare.com/support](http://cloudflare.com/support)GitHub[github.com/luisa-sys/lyra](http://github.com/luisa-sys/lyra)[support.github.com](http://support.github.com)Railwayrailway.app (Lyra project)railway.app/help

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
