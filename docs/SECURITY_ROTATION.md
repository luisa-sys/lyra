# Security Rotation Schedule

> Last updated: 29 March 2026 | KAN-119
> Review this document quarterly. Set calendar reminders for 90-day rotations.

## Secrets Inventory

### Infrastructure Secrets (rotate on schedule)

| Secret | Location(s) | Rotation | How to Rotate | Last Rotated |
|--------|------------|----------|---------------|-------------|
| Supabase sb_publishable_ keys (x3) | Vercel env vars, GitHub secrets | Annual or on suspicion | Supabase → Settings → API → Regenerate. Zero-downtime: new key works immediately, old key remains valid during migration window. Update Vercel env vars + GitHub secrets + redeploy all 3 environments. | Initial setup |
| Supabase sb_secret_ keys (x3) | Vercel env vars, GitHub secrets, Railway env vars | Annual or on suspicion | Same as above. **Also update Railway env vars** for MCP server. Multiple keys can coexist — issue new key, deploy, then revoke old. | Initial setup |
| Vercel deploy token | GitHub secret: VERCEL_TOKEN | 90 days | Vercel → Settings → Tokens → Create new → Update GitHub secret → Revoke old token. | Initial setup |
| GitHub App private key | GitHub secret: PRIVATE_KEY | Annual | GitHub → Settings → Developer Settings → GitHub Apps → Lyra CI → Generate new private key → Update GitHub secret → Delete old key. | Initial setup |
| GitHub App ID | GitHub variable: APP_ID | Never (not a secret) | Only changes if App is recreated. | N/A |
| Google OAuth client secret | Supabase Auth config (all 3 projects) | Annual or on suspicion | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Reset Secret → Update in all 3 Supabase project Auth settings. **Causes downtime**: all Google Sign-In sessions invalidated immediately. | Initial setup |
| Railway API token | Local scripts only (not in CI) | 90 days | Railway → Account → Tokens → Create new → Update local env → Revoke old. | Initial setup |
| SUPABASE_DB_URL (pg_dump) | GitHub secret | Annual | Supabase → Settings → Database → Connection string (Transaction Pooler, port 6543). Password changes if database password is reset. | Initial setup |

### User-Facing Secrets (user-controlled)

| Secret | Storage | Rotation | Expiry Policy |
|--------|---------|----------|--------------|
| Lyra API keys (lyra_*) | Supabase api_keys table (SHA-256 hashed) | User-initiated via dashboard | **TODO**: Keys older than 365 days should be flagged in the UI and auto-revoked after 30 days of inactivity. Not yet implemented. |
| Supabase user sessions (JWT) | HTTP cookies via @supabase/ssr | Auto-refresh (1hr access, long-lived refresh) | Handled by Supabase Auth automatically. |

## Rotation Procedures

### Rotating Supabase keys (sb_publishable_ or sb_secret_)
1. Go to Supabase dashboard → Project → Settings → API
2. Click "Regenerate" on the key to rotate
3. New key is active immediately; old key remains valid during migration
4. Update in ALL locations:
   - Vercel env vars (for the matching environment)
   - GitHub secrets (if used in CI)
   - Railway env vars (sb_secret_ only, for MCP server)
5. Redeploy: push to develop → promote to staging → promote to production
6. After confirming all environments work, revoke the old key in Supabase

### Rotating Vercel deploy token
1. Vercel → Settings → Tokens → Create Token (name: "GitHub Actions deploy", scope: full account)
2. Copy the new token
3. GitHub → repo Settings → Secrets → Actions → Update VERCEL_TOKEN
4. Trigger a test deployment: push a trivial change to develop
5. Confirm deploy-dev pipeline succeeds
6. Delete the old token in Vercel → Settings → Tokens

### Rotating Google OAuth client secret
1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs
2. Click the client → "Reset Secret"
3. **WARNING**: This immediately invalidates the old secret. All Google Sign-In will fail until updated.
4. Copy the new secret
5. Update in ALL 3 Supabase projects: Authentication → Providers → Google → Client Secret
6. Test Google Sign-In on dev environment
7. Promote to staging and production

### Rotating GitHub App private key
1. GitHub → Settings → Developer Settings → GitHub Apps → select the Lyra CI app
2. Scroll to "Private keys" → Generate a private key
3. Download the new .pem file
4. GitHub → repo Settings → Secrets → Actions → Update PRIVATE_KEY with the full PEM content
5. Trigger promote-to-staging workflow to confirm it works
6. Delete the old private key in the GitHub App settings

## Emergency Rotation Playbook

If you suspect ANY secret has been compromised:

1. **Immediately rotate the compromised secret** using the procedures above
2. **Check access logs**: Supabase → Logs → Auth, Vercel → Deployments, GitHub → Security → Audit log
3. **Rotate all secrets that share the same access path** (e.g., if GitHub is compromised, rotate VERCEL_TOKEN and PRIVATE_KEY which are stored there)
4. **Review recent deployments** for unauthorised changes
5. **Check Supabase auth.users** for unexpected signups
6. **Document the incident** in a new BUGS ticket with timeline and remediation

## Rotation Calendar

| When | What to rotate |
|------|---------------|
| 1st of every quarter (Jan, Apr, Jul, Oct) | Vercel deploy token, Railway API token |
| 1st of January | All Supabase keys (3 environments), GitHub App private key, Google OAuth secret |
| On any security incident | Everything in the affected service chain |
| When an employee/contractor leaves | All secrets they had access to |

## Lyra API Key Expiry (TODO)

User-facing API keys (lyra_*) currently have no expiry. Future implementation:
- Add `expires_at` column to `api_keys` table
- Default expiry: 365 days from creation
- Warning in dashboard UI at 30 days before expiry
- Auto-revoke keys not used in 90 days (check `last_used_at`)
- Email notification before expiry (requires transactional email — KAN-41)

This is tracked as a future subtask, not part of the initial rotation doc.
