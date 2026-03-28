# Lyra Platform Architecture

> Last updated: 2026-03-28 — Auto-updated with each major feature change.

## Overview

Lyra is a calm, structured public profile platform where users share preferences, gift ideas, and boundaries. AI companions interact via the Model Context Protocol (MCP).

## System Components

### Web Application (lyra)
- **Framework**: Next.js 15 (App Router)
- **Hosting**: Vercel (3 environments: production, staging, development)
- **Repository**: https://github.com/luisa-sys/lyra (branches: main, staging, develop)

### MCP Server (lyra-mcp-server)
- **Framework**: TypeScript, Express, @modelcontextprotocol/sdk
- **Hosting**: Railway (auto-deploy from main)
- **Repository**: https://github.com/luisa-sys/lyra-mcp-server
- **Endpoint**: https://mcp.checklyra.com/mcp

### Database
- **Provider**: Supabase (PostgreSQL 17)
- **Region**: EU West (Ireland)
- **Tables**: profiles, profile_items, external_links, school_affiliations
- **Auth**: Supabase Auth (email/password, email confirmation)
- **Security**: Row Level Security on all tables

### DNS & CDN
- **Provider**: Cloudflare
- **Domain**: checklyra.com
- **Subdomains**: dev.checklyra.com, stage.checklyra.com, mcp.checklyra.com

## Environments

| Environment | URL | Branch | Vercel Env | Supabase Project | Protection |
|-------------|-----|--------|------------|-----------------|------------|
| Production | checklyra.com | main | production | llzkgprqewuwkiwclowi | Public |
| Staging | stage.checklyra.com | staging | preview | uobmlkzrjkptwhttzmmi | Vercel SSO |
| Development | dev.checklyra.com | develop | preview | ilprytcrnqyrsbsrfujj | Vercel SSO |
| MCP Server | mcp.checklyra.com | main | Railway | llzkgprqewuwkiwclowi (prod) | Public |

**Zero cross-dependencies:** Each environment has its own Supabase database. A destructive action on dev has zero impact on staging or production.

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

| Tool | Purpose | Read/Write |
|------|---------|------------|
| lyra_search_profiles | Search published profiles | Read |
| lyra_get_profile | Get full profile by slug/name | Read |
| lyra_get_section | Get specific category items | Read |
| lyra_recommend_gifts | Get gift ideas with context | Read |
| lyra_get_insights | Profile summary | Read |
| lyra_list_schools | Search school affiliations | Read |

## External Services

| Service | Purpose | Account |
|---------|---------|---------|
| Vercel | Web hosting, CDN, serverless | luisa-sys-projects |
| Supabase | Database, auth | ilprytcrnqyrsbsrfujj |
| Cloudflare | DNS, SSL, CDN proxy | checklyra.com zone |
| Railway | MCP server hosting | lyra-mcp-server |
| GitHub | Source code, CI/CD, secrets | luisa-sys |
| Atlassian/Jira | Project management | checklyra.atlassian.net |
