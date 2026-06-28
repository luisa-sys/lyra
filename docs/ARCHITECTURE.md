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
- **Dev Endpoint**: https://mcp-dev.checklyra.com/mcp (points to dev Supabase)

### Database
- **Provider**: Supabase Pro (PostgreSQL 17)
- **Region**: EU West (Ireland)
- **Tables**: profiles, profile_items, external_links, school_affiliations, api_keys
- **Auth**: Supabase Auth (email/password, Google OAuth, email confirmation). Apple Sign-In deferred.
- **Google OAuth**: Client ID 381290542304-46avld4uoubqd259nrf8ssp8pj2h73kn (same across all 3 projects, **In production / brand-verified 2026-06-28**, basic scopes openid/email/profile)
- **Security**: Row Level Security on all tables

### DNS & CDN
- **Provider**: Cloudflare
- **Domain**: checklyra.com
- **Subdomains**: dev.checklyra.com, stage.checklyra.com, mcp.checklyra.com, mcp-dev.checklyra.com, **admin.checklyra.com**

## Environments

| Environment | URL | Branch | Vercel Env | Supabase Project | Protection |
|-------------|-----|--------|------------|-----------------|------------|
| Production | checklyra.com | main | production | llzkgprqewuwkiwclowi | Public |
| Staging | stage.checklyra.com | staging | custom (staging) | uobmlkzrjkptwhttzmmi | Vercel SSO |
| Development | dev.checklyra.com | develop | custom (develop) | ilprytcrnqyrsbsrfujj | Vercel SSO |
| MCP Server | mcp.checklyra.com | main | Railway | llzkgprqewuwkiwclowi (prod) | Public |
| MCP Dev | mcp-dev.checklyra.com | main | Railway | ilprytcrnqyrsbsrfujj (dev) | Public |
| Admin (KAN-309) | admin.checklyra.com | main (prod deploy) | production | llzkgprqewuwkiwclowi (prod) | Cloudflare Access + `is_admin` |

**Vercel Pro plan** — full environment separation. Each branch has its own custom environment with isolated env vars. No cross-environment contamination.

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
| `AGE_VERIFICATION_REQUIRED` | _(unset = off)_ | KAN-319: env-wide age-gate switch. When `true`, a profile can publish only if `age_status='passed'`. |
| `DIDIT_API_KEY` | _(unset = dormant)_ | KAN-282: Didit age-estimation API key. With this + `DIDIT_WORKFLOW_ID` set, `/verify-age` runs the real hosted selfie flow; unset → the page shows "coming soon" (feature inert). |
| `DIDIT_WORKFLOW_ID` | _(unset)_ | KAN-282: the Didit workflow (age estimation + ID fallback). |
| `DIDIT_WEBHOOK_SECRET` | _(unset)_ | KAN-282: HMAC secret for verifying the `/api/age/didit/webhook` signature. Without it the webhook rejects all calls (fail-closed). |
| `DIDIT_API_BASE` | `https://verification.didit.me` | KAN-282: override the Didit API base if needed. |

### Per-user feature entitlements (KAN-309 follow-on)

`feature_entitlements` (per `profile_id` × `feature_key`) lets the admin console switch beta features on/off per user. Keys: `mcp`, `convene`, `paid_gift_links`, `convene_paid_channels`, `media_uploads`, `discovery`. Effective gate everywhere is **per-env flag AND per-user entitlement** (env flag stays the master kill-switch). Defaults live in `src/lib/features/registry.ts` (`mcp`/`convene`/`paid_*` default off; `media_uploads`/`discovery` default on). Writes are service-role only (RLS + self-grant trigger). **MCP-server enforcement of `mcp`/`convene` ships as a follow-up** — until then the `mcp` toggle is recorded but not enforced over `mcp.checklyra.com`.

**One-time setup (ops):** add `admin.checklyra.com` to the Lyra Vercel project (Production env) → Cloudflare DNS `CNAME admin → cname.vercel-dns.com` (proxied) → Cloudflare Access self-hosted app over `admin.checklyra.com/*` (admin allow-list) → set `ADMIN_HOST_ENFORCED=true` on prod and redeploy.

## User Access Lifecycle & Age Verification

How a person goes from a public sign-up to a published, fully-promoted profile — and the 18+ age gate that guards publishing.

### Access model — three independent axes

A user's state is **not** a single status; it's three independent fields on `profiles` plus a few flags. The admin console (`/admin/users`) surfaces all of them, which is why the badges can look overlapping.

| Field | Values | Meaning |
|-------|--------|---------|
| `access_stage` | `waitlist` → `beta` → `live` | Which "door" the user is in. `waitlist` = on the public waiting list (can use the live site, **not** the gated beta app); `beta` = admitted to `beta.checklyra.com`; `live` = promoted to full production. This is what "promote to production" changes. |
| `beta_access_status` | `none` → `requested` → `approved` | The beta **queue** state. Sign-up auto-sets `requested` (the user appears in the admin beta queue); approving sets `approved`. |
| `early_access` | bool | The **"beta features"** flag — eligibility for per-user experimental features. Set alongside enable-beta / promote-with-beta. |
| `is_published` | bool | Profile public vs draft. |
| `is_suspended` | bool | Moderation hide (overrides published). |
| `is_admin` | bool | Back-office access. |

Per-user feature toggles live in `feature_entitlements` (see above); a feature is effective only when **its env master-switch AND the user's entitlement** are both on.

### The journey

1. **Sign up** (`/signup`) — passwordless. On the public production deploy the page is the **"Join the waitlist" front door** (KAN-273/287; gated by `isProdDeploy()`, or `LYRA_FORCE_WAITLIST=true` to mirror it on a non-prod env such as dev). A confirm-signup / magic-link email is sent; the link routes through **`/auth/confirm`** (token-hash `verifyOtp`, BUGS-50 — works cross-browser, unlike the old `/auth/callback?code=` PKCE flow). `handle_new_user` creates the profile; sign-up records `access_stage='waitlist'`, `beta_access_status='requested'`.
2. **Beta queue → approved** — in `/admin/users` (filter: Waitlist), select the user and run the **Enable beta** bulk action → `access_stage='beta'`, `beta_access_status='approved'`, `early_access=true`, `is_beta_eligible=true`. A "you're in" email goes out (Resend).
3. **Features** — grant per-user entitlements on `/admin/users/[slug]` (MCP, Convene, paid gift links, …).
4. **Age verification** (when the gate is on) — the user must pass before publishing (see below).
5. **Publish** — the user publishes their own profile from `/dashboard/profile` ("Save & publish"); blocked by the age gate unless `age_status='passed'`.
6. **Promote to production** — run **Promote to live (with / without beta)** in `/admin/users` → `access_stage='live'`.

> **Ops note:** admin **bulk** actions fire a native `confirm("<action> — N users?")` dialog before applying; single-user actions (entitlements, age override, suspend, publish) do not. The bulk transitions live only in the `/admin/users` bulk bar — `/admin/beta-queue` simply redirects to `/admin/users?stage=waitlist`.

### Age verification (KAN-282 / KAN-319) — live on production 2026-06-23

Lyra is an adults-only (18+) service; publishing is gated behind an age check.

**The gate.** When `AGE_VERIFICATION_REQUIRED=true` (Production), a profile may be published only if `age_status='passed'`. Enforced on **both** publish paths (`publishProfile()` and the allow-listed `is_published` field update) in `src/app/dashboard/profile/actions.ts`, via `canPublishWithAge()` in `src/lib/age/gate.ts`. Flag unset → the gate is a no-op.

`age_status` (`profiles.age_status`): `none` (default) · `pending` (in-flight) · `passed` (≥18 confirmed — may publish) · `failed` (<18 / declined) · `manual_review` (borderline 18–22, or provider "in review").

**The Didit flow.** `/verify-age` (logged-in, unverified) → **Start age check** → `createAgeSession()` POSTs to Didit (`/v3/session/`) with the profile id as `vendor_data` → user is redirected to Didit's **hosted selfie** flow (facial age estimation). **Lyra never receives or stores a selfie or DOB — only a yes/no age signal.** Didit posts the signed decision to **`/api/age/didit/webhook`**; the handler verifies the HMAC signature, maps the decision (`mapDecisionToAgeStatus`: ≥23 → `passed`, 18–22 → `manual_review`, <18/declined → `failed`) and persists `age_status` (idempotent; non-terminal `pending` is ignored). `/verify-age/callback` confirms server-side too.

- **Config:** `DIDIT_API_KEY` + `DIDIT_WORKFLOW_ID` (+ `DIDIT_WEBHOOK_SECRET`, optional `DIDIT_API_BASE`). With the first two set, `isDiditConfigured()` is true and the real flow runs; unset → `/verify-age` shows "coming soon".
- **Webhook:** subscribe Didit to the **verification status / decision** event (Approved / Declined / In Review) → `https://checklyra.com/api/age/didit/webhook`; the signing secret must equal `DIDIT_WEBHOOK_SECRET` (fail-closed if absent).
- **Admin override:** `/admin/users/[slug]` has audited age-status buttons (`none`/`pending`/`passed`/`failed`/`manual_review`) — the manual path for borderline / `manual_review` cases (writes `age_provider='admin_override'`, logs to `moderation_logs`).

**Production rollout (2026-06-23):** Didit secrets set on the Production Vercel scope, `AGE_VERIFICATION_REQUIRED=true`, shipped via the standard `develop → … → main` promotion. **Prebuilt-deployment note:** prod runs prebuilt deployments, so env-var changes only take effect on the **next** production release (the prod build bakes them in) — set the gate/secrets *before* the final promote, never expecting a live toggle.

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
- access_stage: waitlist, beta, live _(KAN-273 — the user's access tier; see "User Access Lifecycle")_
- beta_access_status: none, requested, approved _(the beta queue state)_
- age_status: none, pending, passed, failed, manual_review _(KAN-282/319 — see "Age verification")_

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
- **Google OAuth**: Client ID 381290542304-* shared across 3 Supabase projects. Consent screen **published 'In production' (External) and brand-verified 2026-06-28 (KAN-286 / KAN-125)** on **basic scopes** (openid/email/profile) → unlimited public Google Sign-In, no 'unverified app' warning, no 100-test-user cap. ⚠️ Convene's Google **Calendar** integration uses a **separate** OAuth client with **sensitive** scopes (calendar.readonly/events) that still needs its **own** Google sensitive-scope verification before public Calendar use — not covered by the basic-scope brand verification.
- **Apple Sign-In**: Deferred (no Apple Developer account)
- **Audit checklist (KAN-90)**: see `docs/CYBER_LOCKDOWN.md` — quarterly verification of redirect URIs, JavaScript origins, scopes, 2FA on owning Google account, consent screen branding, test users allow-list, IAM members. Re-run the Google Cloud Console section of that doc before each beta/prod launch.

### Known gaps — tracked in Jira
- ✅ Google OAuth consent screen **In production / brand-verified** (KAN-286 / KAN-125) — beta blocker **RESOLVED 2026-06-28**
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
