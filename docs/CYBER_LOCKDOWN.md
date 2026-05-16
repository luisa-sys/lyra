# Cyber Lockdown Checklist (KAN-36 / KAN-90)

> Service-by-service hardening checklist. Each section is a deliberate audit, not a one-off task — re-run quarterly or whenever a new service is added.

| Service | Section | Audit cadence | Last audited |
|---|---|---|---|
| GitHub | [#github](#github) | Quarterly | _(initial)_ |
| Vercel | [#vercel](#vercel) | Quarterly | _(initial)_ |
| Supabase (×3) | [#supabase](#supabase) | Quarterly | _(initial)_ |
| Cloudflare | [#cloudflare](#cloudflare) | Quarterly | _(initial)_ |
| Railway | [#railway](#railway) | Quarterly | _(initial)_ |
| **Google Cloud Console** | [#google-cloud-console](#google-cloud-console) | Quarterly **+ before each beta/prod launch** | _(KAN-90)_ |
| **Apple Developer** | [#apple-developer](#apple-developer) | When created | _Deferred — no account yet_ |
| Atlassian (Jira/Confluence) | [#atlassian](#atlassian) | Annual | _(initial)_ |
| Resend | [#resend](#resend) | Annual | _(initial)_ |
| UptimeRobot | [#uptimerobot](#uptimerobot) | Annual | _(initial)_ |
| Sentry | [#sentry](#sentry) | Annual | _(KAN-104)_ |

## How to use this checklist

1. Pick a service section
2. Tick each item only when you've **personally verified** it in the relevant console (don't trust memory or previous audits — the consoles change, settings can drift)
3. Write the date in the "Last audited" column above when you complete a section
4. File a BUGS ticket for anything that fails verification — never just "fix it later"

The discipline of re-verifying matters more than the speed. A six-month-old "yes I think 2FA is on" is worth nothing.

---

## GitHub

**Owner account:** `luisa-sys`  •  **Console:** <https://github.com/settings>

- [ ] **2FA enabled with TOTP authenticator app** (not SMS — SIM-swap is a real attack vector)
  - <https://github.com/settings/security> → Two-factor authentication
- [ ] **At least 2 recovery codes saved** offline (1Password / printed in a safe)
- [ ] **Passkey + SSH keys reviewed** — no stale or shared keys
  - <https://github.com/settings/keys>
- [ ] **Personal Access Tokens reviewed** — every active token has a clear purpose
  - <https://github.com/settings/personal-access-tokens> → expires within 1 year, fine-grained where possible
  - Cross-check against `docs/SECURITY_ROTATION.md`
- [ ] **Authorized OAuth apps / GitHub Apps reviewed** — uninstall anything not in active use (this was the BUGS-11 lesson — Vercel/Railway leftover apps cause phantom check_suite)
  - <https://github.com/settings/applications>
- [ ] **`luisa-sys/lyra` branch protections present** on `main`, `staging`, `beta`, `develop`
  - `gh api repos/luisa-sys/lyra/branches/main/protection`
- [ ] **Secret scanning + push protection on** (`luisa-sys/lyra` AND `luisa-sys/lyra-mcp-server`)
  - Settings → Code security and analysis
- [ ] **Dependabot alerts enabled** with auto-PRs targeting `develop` (per `.github/dependabot.yml`)
- [ ] **Code scanning (CodeQL) enabled** — `.github/workflows/codeql.yml` runs on every PR

## Vercel

**Owner account:** `luisa-sys` team  •  **Console:** <https://vercel.com/account>

- [ ] **2FA enabled** with authenticator app
- [ ] **Recovery codes saved** offline
- [ ] **Team membership reviewed** — only members who need access
  - Vercel → Team Settings → Members
- [ ] **Active deploy tokens reviewed** — every token has a clear purpose and the user listed in `docs/SECURITY_ROTATION.md`
  - <https://vercel.com/account/tokens>
- [ ] **Deployment Protection** correctly scoped per environment:
  - Production: `Disabled` (public site)
  - Beta: `Disabled` *(once KAN-185 lands — currently SSO)*
  - Staging: `Standard Protection` (Vercel SSO) until KAN-85 (Cloudflare Access)
  - Dev: `Standard Protection` (Vercel SSO)
- [ ] **Git integration** is connected only to expected repos (`luisa-sys/lyra` only)
- [ ] **Comments / Toolbar** disabled (caused noise + log-leak risk in BUGS-13)
- [ ] **`VERCEL_AUTOMATION_BYPASS` rotated** in line with `SECURITY_ROTATION.md` cadence

## Supabase

**Console:** <https://supabase.com/dashboard>  •  **Projects:** `dev-lyra`, `stage-lyra`, `prod-lyra`

For each project:

- [ ] **2FA / TOTP on the owning Supabase account**
- [ ] **Project members reviewed** — only members who need access
- [ ] **RLS enabled on every user-data table** — there should be no exceptions outside `_lyra_internal` style metadata
  - `select * from pg_catalog.pg_tables where schemaname='public'` cross-referenced against `pg_policies`
- [ ] **Service-role key NOT in the Next.js client bundle** — search `src/` for `SUPABASE_SERVICE_ROLE_KEY` — should appear only in server-side modules
- [ ] **Network restrictions** reviewed (Settings → API → Network Restrictions)
- [ ] **Database password rotated** within the last year (used by `SUPABASE_DB_URL` for `pg_dump`)
- [ ] **Auth providers** match expected list: Email/Password + Google only (no stale providers)
- [ ] **Storage RLS policies** verified per `docs/RUNBOOK.md` — each bucket has user-folder enforcement via `storage.foldername(name)[1]`

## Cloudflare

**Console:** <https://dash.cloudflare.com/>  •  **Zone:** `checklyra.com`

- [ ] **2FA with authenticator app** on the owning account
- [ ] **API tokens reviewed** — each has a single purpose; least-privilege scopes per resource (DNS / Workers / R2 are separate, per CLAUDE.md gotcha #13)
- [ ] **DNS records audited** — no stale subdomains pointing to dead services
- [ ] **Zone-level WAF rules** in place (rate limiting on `/api/*`, bot management on `*.checklyra.com`)
- [ ] **SSL/TLS mode = Full (strict)** on all subdomains
- [ ] **R2 bucket access logged + bucket policy enforces object lock** (24h on the daily backup path)

## Railway

**Console:** <https://railway.com/dashboard>  •  **Service:** `lyra-mcp-server`

- [ ] **2FA on the owning Railway account**
- [ ] **Project access reviewed**
- [ ] **Env vars sealed** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for prod-lyra MUST be marked sealed (one-way write)
- [ ] **Auto-deploy source restricted** — only from `main` of `luisa-sys/lyra-mcp-server`, no fork PRs
- [ ] **API token rotated** quarterly per `SECURITY_ROTATION.md`
- [ ] **Cost / usage alert** set so a runaway loop doesn't silently bill out

## Google Cloud Console

**Owner Google account:** the one that owns the OAuth client below  •  **Console:** <https://console.cloud.google.com/>

### KAN-90 audit (verify each item personally, tick when confirmed)

- [ ] **2FA on the owning Google account** with authenticator app (not SMS — SIM-swap risk is real on a Google account that owns SSO into 3 production Supabase projects)
  - <https://myaccount.google.com/security> → 2-Step Verification → use Authenticator app, not SMS
- [ ] **Recovery codes saved** offline (1Password / printed)
- [ ] **OAuth 2.0 Client `381290542304-46avld4uoubqd259nrf8ssp8pj2h73kn` — authorised redirect URIs are EXACTLY these 3** (delete anything else, including any `localhost`):
  - `https://ilprytcrnqyrsbsrfujj.supabase.co/auth/v1/callback` (dev-lyra)
  - `https://uobmlkzrjkptwhttzmmi.supabase.co/auth/v1/callback` (stage-lyra)
  - `https://llzkgprqewuwkiwclowi.supabase.co/auth/v1/callback` (prod-lyra)
- [ ] **Authorised JavaScript origins are EXACTLY these 4** (delete anything else):
  - `https://dev.checklyra.com`
  - `https://stage.checklyra.com`
  - `https://beta.checklyra.com`
  - `https://checklyra.com`
- [ ] **OAuth scopes are minimal** — only `openid`, `email`, `profile` (no Drive / Calendar / People / etc.)
- [ ] **Consent screen branding correct** — app name "Lyra", logo present, developer contact email is Luisa's, privacy URL `https://checklyra.com/privacy`, terms URL `https://checklyra.com/terms`
- [ ] **Test users allow-list audited** — remove anyone who shouldn't have access
  - Google Auth Platform → Audience → Test users
- [ ] **Publishing status: still Testing** — DO NOT move to Production yet. That move is KAN-125 and is gated by removing Cloudflare lockdown on prod (the consent-screen verifier must be able to reach `checklyra.com/privacy` etc.)
- [ ] **OAuth client secret** rotated within the last 12 months per `SECURITY_ROTATION.md` (or set "Last Rotated" to today if you rotate as part of this audit)
- [ ] **Project IAM members reviewed** — only people who need access have any role
- [ ] **API & Services → Enabled APIs** — only what's needed (Identity Platform / Google+ API for the OAuth flow; nothing else)
- [ ] **No service accounts created without intent** — list under IAM & Admin → Service accounts; each one's purpose noted in `docs/ARCHITECTURE.md`

### Decision log for this audit

When you finish a pass, write a one-line note here so the next audit can compare:

```
2026-XX-XX — XX/XX items verified — no findings | 1 finding: stale localhost redirect URI removed | …
```

## Apple Developer

**Status:** Deferred — no Apple Developer account yet. When created:

- [ ] 2FA on the owning Apple ID (Apple enforces this anyway, but verify the device list is clean)
- [ ] Apple ID **not** an iCloud Family child account (real consequences for the dev cert chain)
- [ ] Sign in with Apple **Service ID** configured with the same 3 Supabase callback URLs as Google
- [ ] App-specific password issued for any CI usage; rotate annually
- [ ] Apple Developer team membership reviewed (no stale members)
- [ ] Update this checklist + `docs/ARCHITECTURE.md` once active

## Atlassian (Jira / Confluence)

- [ ] **2FA on the owning Atlassian account**
- [ ] **API tokens reviewed** — each one has a clear purpose (MCP integration, scripts, etc.)
- [ ] **Site admins reviewed** — only members who need access
- [ ] **Anonymous access OFF** on all projects/spaces (default but worth confirming)

## Resend

- [ ] **2FA on the owning Resend account**
- [ ] **API key rotated** annually per `SECURITY_ROTATION.md`
- [ ] **Sending domain `checklyra.com` SPF/DKIM/DMARC** all green
- [ ] **No sandbox-mode keys** in production env vars

## UptimeRobot

- [ ] **2FA on the owning UptimeRobot account**
- [ ] **API key** stored locally only (never committed) — per `SECURITY_ROTATION.md`
- [ ] **Monitors** match the URLs in `docs/UPTIMEROBOT_SETUP.md`
- [ ] **Alert contacts** are current (email + any phone/SMS endpoints valid)

## Sentry

- [ ] **2FA on the owning Sentry account**
- [ ] `SENTRY_AUTH_TOKEN` **rotated** annually per `SECURITY_ROTATION.md`
- [ ] **Org/project members** reviewed — only members who need access
- [ ] **Data scrubbing settings** in place (no PII captured by default — match `sendDefaultPii: false` in `instrumentation.ts`)
- [ ] **Session Replay OFF** unless deliberately enabled per incident

---

## Quarterly audit log

Append a row each time the full pass is completed:

| Date | Reviewer | Findings | Linked tickets |
|---|---|---|---|
| _(initial — 2026-05-16 — Sections drafted from KAN-90)_ | Luisa | KAN-90 Google Cloud Console items pending personal verification in console | KAN-90 |

## Reference

- KAN-36 — Cybersecurity (broad backlog)
- KAN-90 — Google Cloud + Apple OAuth dashboards (this doc's primary trigger)
- KAN-24 — 2FA audit across all services
- KAN-125 — Move Google OAuth consent screen to Production (gated by removing Cloudflare lockdown)
- KAN-85 — Replace staging Vercel SSO with Cloudflare Access
- `docs/SECURITY_ROTATION.md` — secrets inventory + rotation cadence + emergency playbook
- `docs/ARCHITECTURE.md` — security posture summary
