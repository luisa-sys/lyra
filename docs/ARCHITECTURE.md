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
| `AGE_VERIFICATION_REQUIRED` | _(retired 2026-07-20)_ | **Unused.** The age publish-gate was removed; nothing reads this. Unset it. |
| `AGE_GATE_PAUSED` | _(retired 2026-07-20)_ | **Unused.** Paused a gate that no longer exists. Unset it. |
| `DIDIT_API_KEY` | _(retired 2026-07-20)_ | **Unused** — Didit integration dormant. Unset it and revoke the credential. |
| `DIDIT_WORKFLOW_ID` | _(retired 2026-07-20)_ | **Unused** — Didit integration dormant. Unset it and revoke the credential. |
| `DIDIT_WEBHOOK_SECRET` | _(retired 2026-07-20)_ | **Unused** — Didit integration dormant. Unset it and revoke the credential. |
| `DIDIT_API_BASE` | _(retired 2026-07-20)_ | **Unused** — Didit integration dormant. Unset it and revoke the credential. |

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

### Age: 18+ self-declaration (replaced the Didit check, 2026-07-20)

Lyra is an adults-only (18+) service. Age is established by a **self-declaration
at sign-up**, not by a provider check and not by a publish-time gate.

**The question.** `/signup` asks "I confirm I am 18 or over" above *both*
account-creation paths. The tick is required to proceed: the email form's submit
and the "Continue with Google" button are disabled until it's set
(`src/app/(auth)/signup/signup-form.tsx` — this is why that block is a client
component), and `signUp()` re-checks it server-side so a hand-crafted POST can't
skip it.

**Carrying it.** The email path puts the declaration in `user_metadata`
(`age_declared_18: true`) *and* an httpOnly cookie; the Google path has no form
to carry it, so it uses the cookie alone — the same mechanism KAN-337 uses for
the beta-invite code.

**Recording it.** `resolvePostLoginRedirect()` (`src/lib/auth/post-login-redirect.ts`)
is the shared chokepoint for both auth routes, so it stamps
`profiles.age_declared_18_at` once, via the service role. It **degrades open**:
the check is wrapped in try/catch because an attestation must never be able to
lock users out of sign-in.

**The backstop.** `signInWithGoogle` is shared with `/login`, and OAuth always
creates the user if they don't exist — so a brand-new Google account can reach a
session without ever seeing the sign-up form. Anyone who arrives with no
declaration on record (that case, or an account predating this) is diverted to
**`/confirm-age`**, a one-question page, before reaching the dashboard. This is
what makes the 18+ question a real gate rather than a checkbox on one of two
routes. `/confirm-age` is exempt from the beta gate in `middleware.ts` so a
waitlisted user is asked before the waitlist bounce, not after.

**What is NOT collected:** no date of birth, no identity document, no selfie, no
biometric, no age band. `age_declared_18_at` is a bare timestamp. Retiring the
provider check removed Lyra's **only** Article 9 special-category processing —
see `docs/compliance/DPIA.md`.

**Not a security control.** A self-declaration is by construction something any
user can assert. Do not gate anything sensitive on `age_declared_18_at`; it is
evidence that the 18+ rule was put to the user and affirmed, nothing more. It is
deliberately absent from `ALLOWED_PROFILE_FIELDS`, so the profile update action
cannot write it.

**Dormant Didit code.** The provider integration (`src/lib/age/didit.ts`,
`age-service.ts`, `/api/age/didit/webhook`, `/verify-age/callback`) is **left in
the repo, unreferenced**, so the decision is reversible. `/verify-age` is now a
redirect to `/dashboard/profile` rather than a 404, for old links. The legacy
columns (`age_status`, `age_checked_at`, `age_provider`, `age_provider_ref`)
remain in `profiles`, unused — dropping them is destructive and needs its own
sign-off.

**Retired env vars** — unset these; nothing reads them any more:
`AGE_VERIFICATION_REQUIRED`, `AGE_GATE_PAUSED`, `DIDIT_API_KEY`,
`DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_API_BASE` (Vercel, all
scopes) and `AGE_VERIFICATION_REQUIRED` on both Railway MCP services. The MCP
server's mirrored publish gate (`requireAgeVerifiedToPublish`) was removed in
lockstep.

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
- **profiles**: User profiles (display_name, slug, headline, bio, location, is_published, gift_voucher_hint)
- **profile_items**: Items on profiles (category: likes, dislikes, gift_ideas, boundaries, etc.)
- **external_links**: Links attached to profiles (website, social, etc.)
- **school_affiliations**: School connections (school_name, location, relationship)
- **gift_suggestion_dismissals**: _(KAN-443)_ gift suggestions a member has said "not for me" to — `(profile_id, suggestion_key)`, owner-scoped by RLS. `suggestion_key` identifies a recommender CONCEPT, not a product, so a dismissal survives the catalogue resolving a different product for the same idea. Filters both the V1 concept list and the V2 pipeline output on the public profile.

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
