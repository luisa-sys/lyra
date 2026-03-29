# MCP connector ecosystem for Lyra's stack

**The Claude.ai connector directory hosts 50+ integrations, and every core service in Lyra's stack — Cloudflare, Supabase, Vercel — has a first-party connector.** Railway lacks a directory connector entirely. Understanding what each connector actually does versus what still requires dashboard access is critical for operations.

## Connector capability matrix

| Operation | Connector Available | Can Do via MCP | Still Needs Dashboard/CLI |
|---|---|---|---|
| Run SQL / manage schema | Supabase | ✅ Full SQL + migrations | — |
| Deploy Edge Functions | Supabase | ✅ Full deploy with files | — |
| Deploy to Vercel | Vercel | ✅ Trigger deploy | Rollbacks, config changes |
| View deployment logs | Vercel | ✅ Build + runtime logs | — |
| Manage env variables | Vercel | ❌ | ✅ Dashboard or CLI required |
| Manage DNS records | Cloudflare | ❌ | ✅ Dashboard or API required |
| Deploy Workers | Cloudflare | ❌ (read-only) | ✅ Wrangler CLI required |
| Manage KV/R2/D1 | Cloudflare | ✅ Full CRUD + D1 SQL | — |
| Query errors | Sentry | ✅ With AI root cause | — |
| Manage payments | Stripe | ✅ Full payment ops | — |
| Railway deployments | Railway | ❌ Not in directory | Custom connector or CLI |
| GitHub repos/PRs/Actions | GitHub | ✅ 60+ tools | Secrets, branch protection |
| Send emails | Resend | ✅ (self-hosted only) | Deploy MCP server first |
| Feature flags | PostHog | ✅ (custom connector) | Add as custom connector first |

## Cloudflare MCP — developer platform tools only

Can do: KV, R2, D1 (full CRUD + SQL), Workers (read-only), documentation search.
Cannot do: DNS, Email Routing, WAF, Worker deployment, Zone management, SSL/TLS.

## Supabase MCP — most capable connector

Can do: Execute arbitrary SQL, apply migrations, deploy Edge Functions, list tables, manage projects/branches, get logs/advisories, generate TypeScript types.
Cannot do directly: Auth provider management, Storage bucket management, Realtime config, Secrets/Vault. (Workarounds via SQL exist.)
**Warning:** Supabase states MCP is "only designed for development and testing purposes."

## Vercel MCP — monitoring and deployment

Can do: Trigger deployments, list/inspect deployments, query runtime logs (powerful filtering), project info, domain availability checks, toolbar comments, documentation search.
Cannot do: Environment variables, domain management, deployment config, rollbacks, Edge Config, Cron Jobs, project creation.

## Railway — needs custom connector

Official MCP server (`@railway/mcp-server`) is stdio-only (works with Claude Desktop/Code, not claude.ai web). Community alternative by Travis-Gilbert supports streamable-http transport — deploy on Railway itself, add URL as custom connector. Covers 17 tools across projects, services, environments, variables, deployments.

## GitHub MCP — exceptionally mature

60+ tools across 18 categories: repos, issues, PRs, Actions, code security, discussions, gists, labels, notifications, projects, users. Supports read-only mode and fine-grained toolset selection. Branch protection rules and Secrets management not directly exposed.

## Recommended additions for Lyra

Sentry (error monitoring with AI root cause analysis), Stripe (full payment lifecycle), PostHog (analytics, feature flags — custom connector), Datadog (alternative to Sentry), Resend (email — self-hosted MCP server required).

## Biggest operational gaps

Vercel environment variables, Cloudflare DNS, and Railway (no directory connector). For Railway, the community streamable-http server is the most viable workaround.
