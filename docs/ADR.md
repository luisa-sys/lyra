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

---

## ADR-008: `profiles` stays one table — column ownership enforced by triggers, not a split
**Date:** July 2026 | **Status:** Accepted | **Ticket:** KAN-421 (epic KAN-414) | **Evidence:** `docs/modularisation/KAN-421-profiles-god-table.md`

**Context:** `profiles` is a genuine god-table: 41 columns spanning identity, the access model, admin flags, suspension state, age gating, discovery hashes, recommender attributes and three JSON blobs, touched by **96 production call sites across all three repos** and written by 7 modules. Module boundaries in code are only as real as the data boundaries under them, so the modularisation programme had to choose deliberately between (A) declaring it a shared-kernel table with column-level ownership enforced by a CI gate, and (B) splitting it into owner-specific satellite tables.

**Decision:** Adopt **option (A+)** — keep `profiles` as one table with a declared column-ownership map in `modules.json`, enforce it in CI at column granularity, and close the gate's irreducible blind spot with `BEFORE UPDATE` triggers on the security-load-bearing columns. **Defer option (B).**

**Rationale:** A column-granularity grep gate can bound 82 of 96 call sites but only **13 of 21 writes** — the other 8 pass a variable payload (`.update(sanitised)`) whose key set is a runtime value, not source text. No parser fixes that, and those 8 include the generic profile-mutation and admin bulk-transition paths. But the estate **already** enforces column ownership where it matters, in the database: three `BEFORE UPDATE` triggers (SEC-27, KAN-273/309/319) make `is_admin`, `is_suspended`, `user_status`, `access_tier`, `beta_*` and `age_status` un-writable by any caller holding an end-user JWT, and are immune to variable payloads. Extending that pattern costs one migration per column; option (B) costs 8 satellites × a 5-step expand/contract across 3 repos and 4 environments — 105 call sites — with a compatibility window in which a stale read of `is_suspended` un-suspends a user or a stale read of `age_status` un-gates a minor's profile. Beginning that on environments already known to be out of parity (SEC-107) is not a good trade. Only 2 columns are genuinely multi-writer (`is_published`, `user_status`), and both are the same benign pattern: a user action plus an admin override.

**Consequences:** The CI gate must **report its own blind spots** rather than printing "0 violations" over 8 unseen writes — a silent gate here would be the SEC-79 failure mode. Access-model writes get routed through an `access` API so `is_suspended`, `user_status`, `access_tier` and `beta_*` have exactly one writer module (7 call sites); `is_published` keeps two writers by explicit declaration. `is_published` is currently protected by no trigger at all, which is a latent bypass of the KAN-408 age gate — tracked as SEC-112. RLS remains inert on writes because all 96 sites connect as `service_role`; option (B)'s strongest argument is that per-satellite policies would make RLS do real work, and that argument only becomes live if a non-service-role write path is introduced.

**Revisit when:** any non-service-role write path is introduced; `profiles` passes ~55 columns or a tenth module claims columns; a third multi-writer column appears that is not an admin override; column-level GDPR retention schedules diverge; or environment parity is restored **and** an expand/contract migration has been rehearsed end-to-end off production.
