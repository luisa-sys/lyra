# Lyra Platform Architecture

> Last updated: 2026-03-29 — Auto-updated with each major feature change.

## Overview

Lyra is a calm, structured public profile platform where users share preferences, gift ideas, and boundaries. AI companions interact via the Model Context Protocol (MCP).

## System Components

### Web Application (lyra)
- **Framework**: Next.js 15 (App Router)
- **Hosting**: Vercel Pro (3 custom environments: production, staging, development)
- **Repository**: https://github.com/luisa-sys/lyra (branches: main, staging, develop)

### MCP Server (lyra-mcp-server)
- **Framework**: TypeScript, Express, @modelcontextprotocol/sdk
- **Hosting**: Railway (auto-deploy from main)
- **Repository**: https://github.com/luisa-sys/lyra-mcp-server
- **Endpoint**: https://mcp.checklyra.com/mcp

### Database
- **Provider**: Supabase Pro (PostgreSQL 17)
- **Region**: EU West (Ireland)
- **Tables**: profiles, profile_items, external_links, school_affiliations, api_keys
- **Auth**: Supabase Auth (email/password, Google OAuth, email confirmation). Apple Sign-In deferred.
- **Google OAuth**: Client ID 381290542304-46avld4uoubqd259nrf8ssp8pj2h73kn (same across all 3 projects, Testing mode)
- **Security**: Row Level Security on all tables

### DNS & CDN
- **Provider**: Cloudflare
- **Domain**: checklyra.com
- **Subdomains**: dev.checklyra.com, stage.checklyra.com, mcp.checklyra.com

## Environments

| Environment | URL | Branch | Vercel Env | Supabase Project | Protection |
|-------------|-----|--------|------------|-----------------|------------|
| Production | checklyra.com | main | production | llzkgprqewuwkiwclowi | Public |
| Staging | stage.checklyra.com | staging | custom (staging) | uobmlkzrjkptwhttzmmi | Vercel SSO |
| Development | dev.checklyra.com | develop | custom (develop) | ilprytcrnqyrsbsrfujj | Vercel SSO |
| MCP Server | mcp.checklyra.com | main | Railway | llzkgprqewuwkiwclowi (prod) | Public |

**Vercel Pro plan** — full environment separation. Each branch has its own custom environment with isolated env vars. No cross-environment contamination.

## CI/CD Pipeline

### Promotion Flow
```
develop → staging → main (production)
```

1. **Push to develop**: lint → typecheck → unit tests → deploy to dev.checklyra.com → health check
2. **Promote to staging**: GitHub Actions workflow_dispatch → verifies dev pipeline passed → merge develop→staging → full test suite → deploy → health checks
3. **Promote to production**: GitHub Actions workflow_dispatch (type "PRODUCTION" to confirm) → verifies staging pipeline passed → merge staging→main → full test suite → deploy → 9-point smoke test → MCP handshake → Git tag

### Cloud-Native Operations (no desktop required)
All operations run via GitHub Actions — no local machine needed:
- **Promote to staging**: Actions tab → "Promote to Staging" → Run workflow → type "promote"
- **Promote to production**: Actions tab → "Promote to Production" → Run workflow → type "PRODUCTION"
- **Health checks**: Run automatically every 6 hours; create GitHub Issue on failure
- **Backups**: Run automatically weekly (Sunday 02:00 UTC)
- **Local scripts**: Still available as convenience wrappers (scripts/promote-to-*.sh)

### Enforcement Rules
- Promotion to staging is blocked if the last dev pipeline failed
- Promotion to production is blocked if the last staging pipeline failed
- All deployments require passing: lint, typecheck, unit tests, build verification
- Post-deploy health checks verify site availability and MCP server connectivity

### Automatic Rollback
- Pipeline failure: staging/production branch force-reset to previous HEAD (local scripts only)
- Health check failure: same rollback mechanism (local scripts only)
- Cloud workflows: fail the job and do not proceed; manual intervention required

### MCP Server Deployment
- Railway auto-deploys on push to lyra-mcp-server main branch
- No staging environment for MCP server (single environment)
- Health check: GET https://mcp.checklyra.com/health

## Database Schema

### Tables
- **profiles**: User profiles (display_name, slug, headline, bio, location, is_published)
- **profile_items**: Items on profiles (category: likes, dislikes, gift_ideas, boundaries, etc.)
- **external_links**: Links attached to profiles (website, social, etc.)
- **school_affiliations**: School connections (school_name, location, relationship)

### Custom Types
- item_category: likes, dislikes, gift_ideas, gifts_to_avoid, boundaries, helpful_to_know, hobbies, allergies
- visibility_level: public, friends, private
- link_type: website, twitter, instagram, linkedin, tiktok, youtube, other
- school_relationship: student, alumni, parent, staff

### Triggers
- handle_new_user(): Auto-creates a profile when a user signs up
- handle_updated_at(): Updates the updated_at timestamp on profile changes

### Row Level Security
- Owners can CRUD their own data
- Public can read published profiles only

## Backup Strategy

- **Weekly automated backup**: GitHub Actions (Sunday 02:00 UTC) — pg_dump with REST API fallback
- **Backup storage**: GitHub Artifacts (90-day retention)
- **Restore procedure**: scripts/restore-database.sh with safety countdown
- **Connection**: Transaction Pooler at aws-1-eu-west-1.pooler.supabase.com:6543

## MCP Server Tools

| Tool | Purpose | Auth | Read/Write |
|------|---------|------|------------|
| lyra_search_profiles | Search published profiles | None | Read |
| lyra_get_profile | Get full profile by slug/name | None | Read |
| lyra_get_section | Get specific category items | None | Read |
| lyra_recommend_gifts | Get gift ideas with context | None | Read |
| lyra_get_insights | Profile summary | None | Read |
| lyra_list_schools | Search school affiliations | None | Read |
| lyra_update_profile | Update profile fields | API key | Write |
| lyra_add_item | Add like/dislike/gift idea/boundary | API key | Write |
| lyra_remove_item | Remove item by ID | API key | Write |
| lyra_add_school | Add school affiliation | API key | Write |
| lyra_remove_school | Remove school affiliation | API key | Write |
| lyra_add_link | Add external link | API key | Write |
| lyra_remove_link | Remove external link | API key | Write |
| lyra_publish_profile | Set profile published/unpublished | API key | Write |
| lyra_get_onboarding_coaching | Get AI coaching guidance | API key | Read |

### MCP Authentication
- **Read tools**: No authentication required (public data)
- **Write tools**: API key required (`lyra_` prefix, SHA-256 hashed, stored in `api_keys` table)
- **Future**: OAuth 2.1 for seamless auth flow (KAN-88)
- **Input sanitisation**: All write operations sanitised via `src/sanitise.ts`

## External Services

| Service | Purpose | Account |
|---------|---------|---------|
| Vercel | Web hosting, CDN, serverless | luisa-sys-projects |
| Supabase | Database, auth | ilprytcrnqyrsbsrfujj |
| Cloudflare | DNS, SSL, CDN proxy | checklyra.com zone |
| Railway | MCP server hosting | lyra-mcp-server |
| GitHub | Source code, CI/CD, secrets | luisa-sys |
| Atlassian/Jira | Project management | checklyra.atlassian.net |


## Security Posture (updated 29 March 2026)

### Application Security — implemented
- **Security headers**: CSP, HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, COOP, CORP, Permissions-Policy, X-XSS-Protection (next.config.ts)
- **Auth rate limiting**: 10 attempts per 15 minutes per IP on login/signup (middleware.ts + rate-limit.ts)
- **Input sanitisation**: stripHtml, sanitiseText (length-limited), sanitiseUrl (protocol validation) on both web app and MCP server
- **PKCE auth flow**: Middleware uses getUser() with JWT revalidation, not getSession()
- **Per-request Supabase client**: No module-scope client leaks in Vercel's Fluid Compute environment
- **Centralised env validation**: env.ts fails fast on missing vars
- **API key auth**: MCP write tools require lyra_ prefixed keys, stored as SHA-256 hashes with revocation support
- **RLS on all tables**: 5 tables with owner-based access policies
- **security.txt**: Published at /.well-known/security.txt (contact: security@checklyra.com)

### Pipeline Security — implemented
- **CodeQL**: security-extended analysis on every push/PR + weekly Sunday 03:00 UTC
- **GitHub Actions SHA-pinned**: All 9 workflows use full SHA hashes (no tag-based supply chain risk)
- **npm audit**: Blocking at high/critical level on all 3 deployment pipelines
- **Dependabot**: Weekly scans for npm and GitHub Actions dependencies
- **Secret scanning**: GitHub secret scanning with push protection enabled
- **PR quality gate**: Scans for eslint-disable/ts-ignore without Jira reference

### OAuth Security — partially configured
- **Google OAuth**: Client ID 381290542304-* shared across 3 Supabase projects. Consent screen in **Testing mode** — only allow-listed emails can sign in. **Must move to Production mode before beta launch (KAN-125).** Google verification takes days/weeks — submit early.
- **Apple Sign-In**: Deferred (no Apple Developer account)
- **Action needed (KAN-90)**: Verify redirect URIs, JavaScript origins, scopes, 2FA on owning Google account

### Known gaps — tracked in Jira
- Google OAuth consent screen in Testing mode — **beta blocker** (KAN-125)
- MCP server has no rate limiting or CORS (KAN-118) — **DONE 29 Mar 2026**
- Token rotation schedule documented (KAN-119) — **DONE 29 Mar 2026**
- Prompt injection defence for user-generated profile data read by AI (KAN-120) — **DONE 29 Mar 2026**
- MCP write tool annotations (KAN-117) — **DONE 29 Mar 2026**
- 2FA audit incomplete — 7 services to verify (KAN-24)
- No OWASP ZAP automated pen testing (KAN-36 backlog)
- No account lockout after repeated failed attempts (KAN-36 backlog)

### Service inventory for security lockdown
GitHub, Vercel, Supabase (x3), Cloudflare, Railway, Google Cloud Console, Atlassian/Jira


### Token rotation
See `docs/SECURITY_ROTATION.md` for the complete secrets inventory, rotation procedures, emergency playbook, and quarterly rotation calendar.
