# Lyra Designer Handover — Dev Environment Readiness Audit

**Date:** 29 March 2026

## Environment status

| Endpoint | Status | Notes |
|----------|--------|-------|
| stage.checklyra.com | ✅ 200 OK | Full Next.js app serving |
| dev.checklyra.com | ⚠️ 401 | Vercel SSO gate — designer needs team access |
| checklyra.com | 🔴 503 | Intentional "Coming Soon" holding page |
| mcp.checklyra.com/health | ❓ | Could not verify from available tools |

## Blocking issues for designer testing

### P0: Signup flow broken
- POST /signup returns 404 "Failed to find Server Action" — Next.js Server Action routing failure
- GET /signup triggers AuthApiError — likely Supabase auth provider misconfiguration after KAN-37 social login work
- **These must be fixed before any designer testing of auth flows**

### P1: Designer access
- dev.checklyra.com requires Vercel SSO — add designer to Vercel team or generate bypass token

## Supabase dev database — healthy

5 tables with RLS: profiles (1 row), profile_items (0), external_links (0), school_affiliations (0), api_keys (0).
Schema is clean. **Database needs sample data seeded for realistic designer testing.**

## Supabase advisories to fix

- 2 security: Functions `handle_updated_at` and `handle_new_user` have mutable `search_path` — add `SET search_path = ''`
- 7 performance: All RLS policies using `auth.uid()` need wrapping as `(select auth.uid())`; 4 tables have duplicate permissive SELECT policies; duplicate index on `profiles`

## Vercel build status

20/20 recent builds pass. Turbopack builds in ~9 seconds. Dual deployment issue: every commit triggers both Git-based and CLI-based deploys.

## Recommended Jira tickets

1. **P0** Fix signup Server Action 404
2. **P0** Fix Supabase AuthApiError on signup
3. **P1** Grant designer Vercel team access
4. **P1** Fix Supabase function search paths (security)
5. **P1** Optimise RLS policies (auth.uid wrapping)
6. **P2** Seed dev database with sample profiles
7. **P2** Audit test coverage (requires GitHub repo access)
8. **P2** Audit CI/CD workflows (requires GitHub repo access)
9. **P3** Eliminate duplicate Vercel deployments
10. **P3** Verify MCP server health endpoint
