# Architecture Decision Records (ADRs)

## ADR-001: Vercel + Railway + Supabase over AWS
**Date:** March 2026 | **Status:** Accepted

**Context:** Lyra needs web hosting, a database, auth, and an MCP server host. AWS provides all of these but at significant configuration complexity.

**Decision:** Use Vercel (web hosting + CDN), Supabase (PostgreSQL + auth + storage), and Railway (MCP server) instead of AWS.

**Rationale:** All three are managed platforms with generous free tiers, minimal ops overhead, and excellent developer experience. Total cost ~$25/month vs estimated $50-100/month on AWS with far more configuration. Supabase provides built-in auth, RLS, and Storage that would require multiple AWS services (Cognito, RDS, S3).

**Consequences:** Vendor lock-in risk is low — Supabase is open-source PostgreSQL, Vercel deploys standard Next.js, Railway runs standard Node.js containers. Migration path exists to self-hosted if needed.

---

## ADR-002: MCP-first over API-first
**Date:** March 2026 | **Status:** Accepted

**Context:** Lyra needs an interface for AI companions to read and write profile data. Options: REST API, GraphQL, or MCP (Model Context Protocol).

**Decision:** Build MCP as the primary AI interface, with the web app as a secondary interface.

**Rationale:** MCP is becoming the standard protocol for AI-to-application communication. Claude, ChatGPT, and Gemini all support MCP. Building MCP-first means AI companions can onboard users, create profiles, and search — all without the user touching a website. This is Lyra's key differentiator.

**Consequences:** MCP tooling is newer and less mature than REST/GraphQL. Directory registration processes are still evolving. The bet is that MCP adoption will accelerate rapidly in 2026-2027.

---

## ADR-003: Streamable HTTP over stdio transport
**Date:** March 2026 | **Status:** Accepted

**Context:** MCP supports two transports: stdio (local process) and Streamable HTTP (remote server). Lyra's MCP server needs to be accessible from cloud-based AI companions.

**Decision:** Use Streamable HTTP transport deployed on Railway at mcp.checklyra.com.

**Rationale:** stdio requires the MCP server to run locally on the user's machine. Streamable HTTP allows any AI companion to connect over the internet. This is essential for Claude.ai, ChatGPT, and other cloud-hosted AI services.

**Consequences:** Requires a persistent server (Railway), CORS configuration, and rate limiting. Adds hosting cost but enables the core use case.

---

## ADR-004: Cloudflare DNS-only over proxied
**Date:** March 2026 | **Status:** Accepted

**Context:** Cloudflare can proxy traffic (orange cloud) or just handle DNS (grey cloud). Vercel and Railway provide their own SSL certificates.

**Decision:** Use DNS-only mode for Vercel and Railway subdomains. Cloudflare proxy only for the maintenance page worker on the root domain.

**Rationale:** Proxying through Cloudflare conflicts with Vercel's and Railway's own SSL certificate provisioning. DNS-only avoids certificate conflicts while still providing Cloudflare's DNS performance (fast resolution, anycast).

**Consequences:** Lose Cloudflare's WAF/DDoS on subdomains (dev, stage, mcp). Acceptable at current scale. Can add Cloudflare proxy later if needed by switching to Cloudflare-issued SSL.

---

## ADR-005: Team-managed over company-managed Jira
**Date:** March 2026 | **Status:** Accepted

**Context:** Jira offers two project types: company-managed (classic, complex) and team-managed (next-gen, simple).

**Decision:** Use team-managed for both KAN (design/deployment) and BUGS (bug tracking) projects.

**Rationale:** Team-managed has simpler configuration, consistent transition IDs, and is easier to automate via API. Company-managed adds workflow complexity that a 2-person team doesn't need.

**Consequences:** Some advanced Jira features (custom workflows, screens, field schemes) are not available. Acceptable for current team size.

---

## ADR-006: Three separate Supabase projects per environment
**Date:** March 2026 | **Status:** Accepted

**Context:** Initially all environments shared a single Supabase project. A bad migration on dev could destroy production data.

**Decision:** Create three completely independent Supabase projects: dev (ilprytcrnqyrsbsrfujj), staging (uobmlkzrjkptwhttzmmi), production (llzkgprqewuwkiwclowi).

**Rationale:** Zero cross-contamination between environments. Each has independent auth, storage, and RLS policies. Migrations are tested on dev → applied to staging → applied to production.

**Consequences:** Triple the Supabase cost ($25 × 3 = $75/month if all on Pro). Dev and staging can stay on free tier. Schema must be kept in sync manually via SQL migrations.

---

## ADR-007: Resend for transactional email
**Date:** April 2026 | **Status:** Accepted

**Context:** Need to send weekly reports and potentially signup notifications. Options: Resend, SendGrid, AWS SES, Supabase Edge Functions.

**Decision:** Use Resend with verified checklyra.com domain.

**Rationale:** Simplest API (single curl call), generous free tier (100 emails/day), excellent deliverability, domain verified. Developer experience is significantly better than SendGrid or SES.

**Consequences:** Another vendor dependency. Free tier is sufficient for current volume (1 weekly report + occasional notifications). Can migrate to SES if volume grows significantly.
