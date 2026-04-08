# Lyra Operational Runbook

## Environments

| Environment | URL | Branch | Protection |
|-------------|-----|--------|------------|
| Production | https://checklyra.com | main | Public |
| Development | https://dev.checklyra.com | develop | Vercel SSO |
| Staging | https://stage.checklyra.com | staging | Vercel SSO |

## Deployment Rollback

### Via Vercel Dashboard (recommended)
1. Go to https://vercel.com/luisa-sys-projects/lyra/deployments
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

## Emergency Contacts

| Service | Dashboard | Support |
|---------|-----------|---------|
| Vercel | vercel.com/luisa-sys-projects/lyra | vercel.com/help |
| Supabase | supabase.com/dashboard/project/ilprytcrnqyrsbsrfujj | supabase.com/support |
| Cloudflare | dash.cloudflare.com | cloudflare.com/support |
| GitHub | github.com/luisa-sys/lyra | support.github.com |
| Railway | railway.app (Lyra project) | railway.app/help |

## MCP Server Operations

### Production MCP (mcp.checklyra.com)
- **Hosting**: Railway (auto-deploy from luisa-sys/lyra-mcp-server main branch)
- **Supabase**: Production (llzkgprqewuwkiwclowi)
- **Restart**: Railway dashboard → lyra-mcp-server service → Deployments → Redeploy

### Dev MCP (mcp-dev.checklyra.com)
- **Hosting**: Railway (same repo, separate service, auto-deploy from main)
- **Supabase**: Dev (ilprytcrnqyrsbsrfujj)
- **Restart**: Railway dashboard → lyra-mcp-dev service → Deployments → Redeploy
- **Purpose**: Testing write tools with API keys generated on dev.checklyra.com

### MCP Health Check
```bash
curl https://mcp.checklyra.com/health      # Production
curl https://mcp-dev.checklyra.com/health   # Dev
```
