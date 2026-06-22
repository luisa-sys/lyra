# Lyra Platform Architecture

> Last updated: 2026-06-22 — Auto-updated with each major feature change.

## Overview

Lyra is a relationship-intelligence platform that helps people remember, celebrate, and coordinate with the people who matter to them. Users build structured public profiles, manage gatherings via Convene (AI-assisted event management), and receive personalised gift recommendations. AI companions interact via the Model Context Protocol (MCP).

## System Components

### Web Application (lyra)
- **Framework**: Next.js 15 (App Router)
- **Hosting**: Vercel Pro (4 custom environments: production, beta, staging, development)
- **Repository**: https://github.com/luisa-sys/lyra (branches: main, beta, staging, develop)

### MCP Server (lyra-mcp-server)
- **Framework**: TypeScript, Express, @modelcontextprotocol/sdk
- **Hosting**: Railway (auto-deploy from main)
- **Repository**: https://github.com/luisa-sys/lyra-mcp-server
- **Endpoint**: https://mcp.checklyra.com/mcp
- **Dev Endpoint**: https://mcp-dev.checklyra.com/mcp (points to dev Supabase)

### Database
- **Provider**: Supabase Pro (PostgreSQL 17)
- **Region**: EU West (Ireland)
- **Tables**: profiles, profile_items, external_links, school_affiliations, contacts, gatherings, gathering_invite_messages, oauth_connections, oauth_authorization_codes, oauth_access_tokens, oauth_refresh_tokens, oauth_consents, oauth_clients, content_moderation_flags, relationship_signals
- **Auth**: Supabase Auth (email/password, Google OAuth, email confirmation). Apple Sign-In deferred.
- **Google OAuth**: Client ID 381290542304-46avld4uoubqd259nrf8ssp8pj2h73kn (same across all 3 projects, Testing mode)
- **Security**: Row Level Security on all tables

### DNS & CDN
- **Provider**: Cloudflare
- **Domain**: checklyra.com
- **Subdomains**: dev.checklyra.com, stage.checklyra.com, mcp.checklyra.com, mcp-dev.checklyra.com, **admin.checklyra.com**

## Environments

| Environment | URL | Branch | Vercel Env | Supabase Project | Protection |
|-------------|-----|--------|------------|-----------------|------------|
| Production | checklyra.com | main | production | llzkgprqewuwkiwclowi | Public |
| Beta | beta.checklyra.com | beta | custom (beta) | llzkgprqewuwkiwclowi (shared with prod) | In-app beta gate |
| Staging | stage.checklyra.com | staging | custom (staging) | uobmlkzrjkptwhttzmmi | Vercel SSO |
| Development | dev.checklyra.com | develop | custom (develop) | ilprytcrnqyrsbsrfujj | Vercel SSO |
| MCP Server | mcp.checklyra.com | main | Railway | llzkgprqewuwkiwclowi (prod) | Public |
| MCP Dev | mcp-dev.checklyra.com | main | Railway | ilprytcrnqyrsbsrfujj (dev) | Public |
| Admin (KAN-309) | admin.checklyra.com | main (prod deploy) | production | llzkgprqewuwkiwclowi (prod) | Cloudflare Access + `is_admin` |

**Vercel Pro plan** — full environment separation. Each branch has its own custom environment with isolated env vars. No cross-environment contamination.

**Beta shares prod Supabase** — `beta.checklyra.com` uses the same Supabase project as production (`llzkgprqewuwkiwclowi`). Real user data. No separate beta DB. The in-app beta gate controls which features are shown.

### Admin back-office (`admin.checklyra.com`, KAN-309)

The admin tools (`/admin/*`) are served on a private subdomain that points at the **same Production Vercel deployment** as `checklyra.com` (so it uses prod Supabase + prod env, and the shared `.checklyra.com` session cookie from KAN-274 works). Two gates: **Cloudflare Access** (allow-list of admin emails) in front, plus the existing `is_admin` DB check (`getCurrentAdmin`).

Host routing lives in `src/middleware.ts` behind two env vars (set on the **prod** Vercel scope):

| Env var | Default | Purpose |
|---------|---------|---------|
| `ADMIN_HOST` | `admin.checklyra.com` | The hostname that serves the admin tools |
| `ADMIN_HOST_ENFORCED` | _(unset = off)_ | `true` rewrites the admin host → `/admin/*` and blocks `/admin` on other hosts. Leave **off** until the DNS record + Cloudflare Access app are live, then flip on (non-breaking rollout). |
| `SENTRY_READ_TOKEN` | _(optional)_ | Reserved for live Sentry panels on `/admin/monitoring` |
| `UPTIMEROBOT_API_KEY` | _(optional)_ | Lights up the UptimeRobot status on `/admin/monitoring` |
| `PAID_LINKS_COMPLIANCE_READY` | _(unset = off)_ | KAN-309: gates the `paid_gift_links` per-user entitlement. Monetised affiliate links are produced only when this is `true` (FTC/ASA/CMA disclosure KAN-192 + cookie/GDPR consent KAN-193 shipped) **and** the recipient is entitled **and** `SOVRN_API_KEY` is set. |

**`is_admin` self-elevation blocked (SEC-27, 2026-06-22 — CRITICAL):** Any attempt by a user to set `is_admin = true` or to clear their own suspension via a profile-update API call is now explicitly rejected at the server layer.

### Per-user feature entitlements (KAN-309)

`feature_entitlements` (per `profile_id` × `feature_key`) lets the admin console switch beta features on/off per user. Keys in use as of June 2026: `convene`, `mcp_access`, `paid_links`, `media_uploads`, `discovery`. Effective gate everywhere is **per-env flag AND per-user entitlement** (env flag stays the master kill-switch). Defaults live in `src/lib/features/registry.ts`. Writes are service-role only (RLS + self-grant trigger blocked).

> **Note:** The registry originally used `mcp` and `paid_gift_links` as key names; these were renamed to `mcp_access` and `paid_links` in the KAN-309 follow-on (commit `eb95acca`). Verify current names in `src/lib/features/registry.ts` if in doubt.

**One-time setup (ops):** add `admin.checklyra.com` to the Lyra Vercel project (Production env) → Cloudflare DNS `CNAME admin → cname.vercel-dns.com` (proxied) → Cloudflare Access self-hosted app over `admin.checklyra.com/*` (admin allow-list) → set `ADMIN_HOST_ENFORCED=true` on prod and redeploy.

## CI/CD Pipeline

### Promotion Flow
```
develop → staging → beta → main (production)
```

1. **Push to develop**: lint → typecheck → unit tests → deploy to dev.checklyra.com → health check
2. **Promote to staging**: GitHub Actions workflow_dispatch → verifies dev pipeline passed → merge develop→staging → full test suite → deploy → health checks
3. **Promote to beta** (KAN-175): GitHub Actions workflow_dispatch → merge staging→beta → deploy-beta.yml triggers full lint/type/unit/audit/build chain → beta.checklyra.com (uses prod Supabase + in-app beta gate)
4. **Promote to production**: GitHub Actions workflow_dispatch (type "PRODUCTION" to confirm) → verifies beta pipeline passed → merge beta→main → full test suite → deploy → 9-point smoke test → MCP handshake → Git tag

**Beta step is easy to miss** — `promote-to-production.yml` merges `beta → main` (not `staging → main`), so a stale `beta` makes the production-promote a no-op. Always run `promote-staging-to-beta.yml` before `promote-to-production.yml`. Discovered 2026-05-16 during the four-ticket sprint.

### Cloud-Native Operations (no desktop required)
All operations run via GitHub Actions — no local machine needed:
- **Promote to staging**: Actions tab → "Promote to Staging" → Run workflow → type "promote"
- **Promote staging → beta**: Actions tab → "Promote Staging to Beta" → Run workflow → type "promote"
- **Promote to production**: Actions tab → "Promote to Production" → Run workflow → type "PRODUCTION"
- **Health checks**: Run automatically every 6 hours; create GitHub Issue on failure
- **Backups**: Run automatically weekly (Sunday 02:00 UTC)
- **Local scripts**: Still available as convenience wrappers (scripts/promote-to-*.sh)

### Enforcement Rules
- Promotion to staging is blocked if the last dev pipeline failed
- Promotion to beta is blocked if the staging pipeline failed
- Promotion to production is blocked if the last beta pipeline failed
- All deployments require passing: lint, typecheck, unit tests, build verification
- Post-deploy health checks verify site availability and MCP server connectivity

### Automatic Rollback
- Production promotion: smoke-test failure triggers auto-rollback and Resend alert email to operator
- Health check failure: same rollback mechanism
- Cloud workflows: fail the job and do not proceed; manual intervention required

### MCP Server Deployment
- Railway auto-deploys on push to lyra-mcp-server main branch
- No staging environment for MCP server (single prod + single dev environment)
- Health check: GET https://mcp.checklyra.com/health
- Deploy verification: `curl -s https://mcp.checklyra.com/.well-known/mcp.json | jq .build_sha` must match HEAD within ~3 min of push

## Database Schema

### Tables

| Table | Purpose | Notes |
|-------|---------|-------|
| `profiles` | User profiles (display_name, slug, bio, is_published, is_suspended, is_admin) | RLS: public read for non-suspended; owner-write; is_admin/is_suspended server-only |
| `profile_items` | Items on profiles (category: wishlist, favourites, Manual of Me, etc.) | Owner-write |
| `external_links` | Links attached to profiles | Owner-write |
| `school_affiliations` | School connections with `description`, `show_on_profile` (default false) | Owner-write; hidden by default since June 2026 |
| `contacts` | Host-scoped contact records; can link to a profiles row via linked_profile_id | Owner-scoped; deleted_at IS NULL filter required |
| `gatherings` | Convene gathering records (state: draft → live → rescheduled / cancelled / completed) | Owner-read; attendee-read if invited |
| `gathering_invite_messages` | Outbound invite queue (channel: email, sms, whatsapp) | Owner-scoped |
| `oauth_connections` | Calendar OAuth tokens (Google, Microsoft); refresh_token stored encrypted | Owner-only; service-role for refresh |
| `oauth_authorization_codes` | One-time auth codes for MCP OAuth flow (10 min TTL, PKCE S256) | Service-role only |
| `oauth_access_tokens` | JTI registry for JWT revocation | Service-role only |
| `oauth_refresh_tokens` | Opaque refresh tokens; family chain; replay triggers family revocation | Service-role only |
| `oauth_consents` | User consent grants (user_id, client_id, scopes) | Service-role + owner-read |
| `oauth_clients` | Registered OAuth clients | Service-role only |
| `content_moderation_flags` | Warn/block-level moderation audit log (30-day retention) | Owner-read; service-role write |
| `relationship_signals` | Materialised view: engagement signals for attendee recommender | Owner-scoped; refreshed by post-event cron |

### Custom Types
- `item_category`: likes, dislikes, gift_ideas, gifts_to_avoid, boundaries, helpful_to_know, hobbies, allergies, favourite_tv, favourite_places, favourite_music (and more)
- `visibility_level`: public, friends, private
- `link_type`: website, twitter, instagram, linkedin, tiktok, youtube, other
- `school_relationship`: student, alumni, parent, staff

### Triggers
- `handle_new_user()`: Auto-creates a profile when a user signs up
- `handle_updated_at()`: Updates the updated_at timestamp on profile changes

### Row Level Security
- Owners can CRUD their own data
- Public can read published, non-suspended profiles only
- `is_admin` and `is_suspended` cannot be self-set via owner-write paths (SEC-27)

## Backup Strategy

- **Weekly automated backup**: GitHub Actions (Sunday 02:00 UTC) — pg_dump with REST API fallback
- **Backup storage**: GitHub Artifacts (90-day retention)
- **Restore procedure**: scripts/restore-database.sh with safety countdown
- **Connection**: Transaction Pooler at aws-1-eu-west-1.pooler.supabase.com:6543

## MCP Server Tools

Authentication model:
- **Read tools**: No authentication required (public data)
- **Write tools**: Require either a valid HS256 JWT (KAN-88, shipped May 2026) or a legacy `lyra_`-prefixed API key
- **Input sanitisation**: All write operations sanitised via `src/sanitise.ts`

| Tool | Purpose | Auth | Type |
|------|---------|------|------|
| `lyra_get_profile` | Get full profile by slug/contact ID | None | Read |
| `lyra_get_section` | Get specific profile section | None | Read |
| `lyra_get_insights` | Profile relationship insights | None | Read |
| `lyra_search_profiles` | Search published profiles | None | Read |
| `lyra_get_onboarding_coaching` | Get AI coaching guidance | JWT/Key | Read |
| `lyra_list_schools` | Search school affiliations (show_on_profile=true only) | None | Read |
| `lyra_update_profile` | Update profile fields | JWT/Key | Write |
| `lyra_update_manual_of_me` | Upsert Manual-of-Me fields | JWT/Key | Write |
| `lyra_publish_profile` | Set profile published state | JWT/Key | Write |
| `lyra_add_item` | Add wishlist/favourite item | JWT/Key | Write |
| `lyra_remove_item` | Remove item by ID | JWT/Key | Write |
| `lyra_add_school` | Add school affiliation | JWT/Key | Write |
| `lyra_update_school` | Edit school affiliation visibility/description | JWT/Key | Write |
| `lyra_remove_school` | Remove school affiliation | JWT/Key | Write |
| `lyra_add_link` | Add external link | JWT/Key | Write |
| `lyra_remove_link` | Remove external link | JWT/Key | Write |
| `lyra_list_my_contacts` | List current user's contacts | JWT/Key | Read |
| `lyra_list_my_tribes` | List current user's tribes | JWT/Key | Read |
| `lyra_add_contact` | Add a new contact | JWT/Key | Write |
| `lyra_create_tribe` | Create a new tribe | JWT/Key | Write |
| `lyra_add_contact_to_tribe` | Add contact to a tribe | JWT/Key | Write |
| `lyra_link_contact_profile` | Link contact to a Lyra profile | JWT/Key | Write |
| `lyra_recommend_gifts` | Get gift ideas with affiliate links + FTC disclosure | None | Read |
| `lyra_connect_calendar` | Initiate Google/Microsoft OAuth | JWT/Key | Write |
| `lyra_disconnect_provider` | Disconnect calendar provider | JWT/Key | Write |
| `lyra_get_my_calendar_busy_times` | Host's own busy blocks | JWT/Key | Read |
| `lyra_get_shared_availability` | Fan-out freeBusy for up to 8 attendees (consent-gated) | JWT/Key | Read |
| `lyra_create_gathering` | Create gathering (draft) | JWT/Key | Write |
| `lyra_get_gathering` | Fetch gathering + attendees | JWT/Key | Read |
| `lyra_list_my_gatherings` | List all gatherings | JWT/Key | Read |
| `lyra_update_gathering` | Update gathering details | JWT/Key | Write |
| `lyra_finalise_gathering` | Lock time slot → live state | JWT/Key | Write |
| `lyra_reschedule_gathering` | Propose new slot | JWT/Key | Write |
| `lyra_cancel_gathering` | Cancel gathering | JWT/Key | Write |
| `lyra_propose_attendees` | Suggest contacts to invite | JWT/Key | Read |
| `lyra_suggest_venues` | Suggest venues via Places adapter | JWT/Key | Read |
| `lyra_suggest_substitute` | Suggest replacement attendee | JWT/Key | Read |
| `lyra_send_invite` | Queue invite (email/sms/whatsapp) | JWT/Key | Write |
| `lyra_record_rsvp` | Record RSVP response | JWT/Key | Write |
| `lyra_drain_invite_queue` | Trigger send-worker dispatch | JWT/Key | Write |

## External Services

| Service | Purpose | Account |
|---------|---------|---------|
| Vercel | Web hosting, CDN, serverless | luisa-sys-projects |
| Supabase | Database, auth | 3 projects (dev/staging/prod) |
| Cloudflare | DNS, SSL, CDN proxy | checklyra.com zone |
| Railway | MCP server hosting | lyra-mcp-server + lyra-mcp-dev |
| GitHub | Source code, CI/CD, secrets | luisa-sys |
| Resend | Transactional email (invites, rollback alerts, weekly reports) | checklyra.com verified sender |
| Twilio | SMS and WhatsApp invite channels | lyra account |
| Sentry | Error tracking (web app + MCP server) | DSN per project, env var `SENTRY_DSN` |
| Atlassian/Jira | Project management | checklyra.atlassian.net |


## Security Posture (updated 2026-06-22)

### Application Security — implemented
- **Security headers**: CSP, HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, COOP, CORP, Permissions-Policy, X-XSS-Protection (next.config.ts)
- **Auth rate limiting**: 10 attempts per 15 minutes per IP on login/signup (middleware.ts + rate-limit.ts)
- **Input sanitisation**: stripHtml, sanitiseText (length-limited), sanitiseUrl (protocol validation) on both web app and MCP server
- **PKCE auth flow**: Middleware uses getUser() with JWT revalidation, not getSession()
- **Per-request Supabase client**: No module-scope client leaks in Vercel's Fluid Compute environment
- **Centralised env validation**: env.ts fails fast on missing vars
- **HS256 JWT auth (KAN-88, shipped 2026-05)**: MCP write tools accept OAuth-issued JWTs in addition to legacy API keys. JWT validated on every request (signature, issuer, expiry, optional jti revocation check)
- **API key auth**: MCP write tools require lyra_ prefixed keys, stored as SHA-256 hashes with revocation support
- **RLS on all tables**: All user-owned tables with owner-based access policies
- **security.txt**: Published at /.well-known/security.txt (contact: security@checklyra.com)
- **Admin privilege protection (SEC-27, 2026-06-22 — CRITICAL)**: is_admin/is_suspended cannot be self-elevated via profile-update mutations
- **DB-error sanitization (SEC-17, 2026-06-22)**: MCP write tools route errors through a sanitizing helper; raw Postgres error text never returned to clients
- **MCP per-API-key rate limiting (SEC-17, 2026-06-22)**: /mcp endpoint keys on API key/JWT (60 req/min), not just IP
- **Contact-discovery HMAC (SEC-18, 2026-06-21)**: Discovery queries are HMAC-keyed; raw identifiers not sent in plaintext to the search layer
- **Shared-availability consent gate (SEC-18, 2026-06-21)**: lyra_get_shared_availability checks consent before fanning out freeBusy
- **Suspend-outright login block (KAN-319, 2026-06-22)**: Suspended users are blocked at the auth layer, not just filtered from public queries
- **Error monitoring**: Sentry integrated on both lyra and MCP server (SEC-4, 2026-06-21)

### Pipeline Security — implemented
- **CodeQL**: security-extended analysis on every push/PR + weekly (SEC-9, 2026-06-21)
- **GitHub Actions least-privilege + SHA-pinned (SEC-20, 2026-06-22)**: All workflows use explicit `permissions:` blocks and SHA-pinned third-party actions
- **npm audit**: Blocking at high/critical level on all 3 deployment pipelines
- **Dependabot**: Weekly scans for npm and GitHub Actions dependencies
- **Secret scanning**: GitHub secret scanning with push protection enabled
- **PR quality gate**: Scans for eslint-disable/ts-ignore without Jira reference

### OAuth Security — partially configured
- **Google OAuth**: Client ID 381290542304-* shared across 3 Supabase projects. Consent screen in **Testing mode** — only allow-listed emails can sign in. **Must move to Production mode before beta launch (KAN-125), which is itself gated by removing Cloudflare lockdown on prod so the Google verifier can reach the consent screen URLs.** Google verification takes days/weeks — submit early.
- **Apple Sign-In**: Deferred (no Apple Developer account)
- **Audit checklist (KAN-90)**: see `docs/CYBER_LOCKDOWN.md` — quarterly verification of redirect URIs, JavaScript origins, scopes, 2FA on owning Google account, consent screen branding, test users allow-list, IAM members.

### Known gaps — tracked in Jira
- Google OAuth consent screen in Testing mode — **beta blocker** (KAN-125)
- No OWASP ZAP automated pen testing (KAN-36 backlog)
- No account lockout after repeated failed attempts (KAN-36 backlog)
- Cloudflare WAF auto-block on abuse threshold (KAN-247 — roadmap)
- MCP server auto-restart on health-check failure (KAN-246 — roadmap)
- MCP OAuth → RS256 + JWKS (deferred roadmap; HS256 + shared secret currently)
- 2FA audit incomplete — 7 services to verify (KAN-24)

### Service inventory for security lockdown
GitHub, Vercel, Supabase (x3), Cloudflare, Railway, Google Cloud Console, Atlassian/Jira, Resend, Twilio, Sentry


### Token rotation
See `docs/SECURITY_ROTATION.md` for the complete secrets inventory, rotation procedures, emergency playbook, and quarterly rotation calendar.
