# Lyra Operational Runbook

## Environments

EnvironmentURLBranchProtectionProduction<https://checklyra.com>mainPublicDevelopment<https://dev.checklyra.com>developVercel SSOStaging<https://stage.checklyra.com>stagingVercel SSO

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

- `LYRA_RELEASE_PAT` — fine-grained PAT with `contents:write` on `luisa-sys/lyra`. Used for the merge push so downstream workflows trigger. Annual rotation. See `docs/SECURITY_ROTATION.md`.
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — for SHA verification via Vercel API.

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

A green workflow run is not proof of a real backup. Before trusting any backup, verify the artifact contents:

```bash
# Download the most recent backup-platform artifact
RUN_ID=$(gh run list --workflow=backup-platform.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run download $RUN_ID -R luisa-sys/lyra -D /tmp/lyra-backup

# Verify the SQL dump is real (not a placeholder string)
head -c 100 /tmp/lyra-backup/*/supabase-schema.sql
# MUST start with "--" and look like SQL. If it says "Schema export failed", file a bug at Highest priority.

grep -c "^CREATE TABLE" /tmp/lyra-backup/*/supabase-schema.sql
# MUST be > 0

# Verify Cloudflare DNS export is real
python3 -c "
import json, glob
path = glob.glob('/tmp/lyra-backup/*/cloudflare-dns.json')[0]
d = json.load(open(path))
assert d.get('success'), 'API returned failure'
assert len(d.get('result', [])) > 0, 'No DNS records'
print(f'OK: {len(d[\"result\"])} DNS records')
"

# Verify secrets list is real
grep -c "(failed to fetch)" /tmp/lyra-backup/*/github-secrets-list.txt
# MUST be 0

# Cleanup
rm -rf /tmp/lyra-backup
```

If any of the above fails, the backup is suspect and should be re-run. See KAN-167 for ongoing work to make these checks automatic.

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
