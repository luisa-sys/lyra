# Lyra Platform — Endpoint Health Audit
# Generated: 31 March 2026

## Live Endpoints (verified)

### Production
| Endpoint | Status | Notes |
|----------|--------|-------|
| https://checklyra.com | 503 | Maintenance page worker active |
| https://checklyra.com/privacy | 200 | Bypasses maintenance worker |
| https://checklyra.com/terms | 200 | Bypasses maintenance worker |
| https://checklyra.com/cookies | 503 | **NEEDS FIX**: Not bypassing maintenance worker |
| https://checklyra.com/search | — | Behind maintenance worker |
| https://checklyra.com/sitemap.xml | 200 | Working |
| https://checklyra.com/robots.txt | 200 | Working |
| https://checklyra.com/.well-known/mcp.json | 200 | MCP discovery file |
| https://checklyra.com/llms.txt | 200 | AI discovery file |

### Dev & Staging
| Endpoint | Status | Notes |
|----------|--------|-------|
| https://dev.checklyra.com | 401 | Vercel Deployment Protection (expected) |
| https://stage.checklyra.com | 401 | Vercel Deployment Protection (expected) |

### MCP Server
| Endpoint | Status | Notes |
|----------|--------|-------|
| https://mcp.checklyra.com/health | 200 | Railway deployment, healthy |
| https://mcp.checklyra.com/mcp | — | MCP Streamable HTTP endpoint |

## Repositories
| Repo | URL | Branch Model |
|------|-----|-------------|
| Web app | https://github.com/luisa-sys/lyra | develop → staging → main |
| MCP server | https://github.com/luisa-sys/lyra-mcp-server | main (single branch) |

## Infrastructure IDs
| Service | ID/Reference |
|---------|-------------|
| Supabase Dev | ilprytcrnqyrsbsrfujj |
| Supabase Stage | uobmlkzrjkptwhttzmmi |
| Supabase Prod | llzkgprqewuwkiwclowi |
| Cloudflare Account | 7a0ca795061f991fe86c3eb9a1d0ab15 |
| Cloudflare KV (interest emails) | c7bdc8624f0a4bd5b0a8ad36e9f93d96 |
| Jira Cloud ID | fde496ba-2db8-481a-8544-39d6e9122101 |
| Jira Project (KAN) | 10001 |
| Jira Project (BUGS) | 10035 |
| Google OAuth Client | 381290542304-46avld4uoubqd259nrf8ssp8pj2h73kn |
| Vercel Org | luisa-sys-projects |

## Action Required
- [ ] Add /cookies to Cloudflare maintenance worker exceptions (same as /privacy and /terms)
- [ ] Verify Railway dashboard URL and add to reference
