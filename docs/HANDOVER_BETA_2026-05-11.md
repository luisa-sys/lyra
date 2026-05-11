# Handover — Lyra Beta Deploy Continuation

**Created:** 2026-05-11
**For:** new chat session picking up the beta deploy after KAN-175 stand-up
**Status:** infrastructure complete, ready for end-to-end smoke testing + first real promotion

## 2026-05-11 — UPDATE after first real promotion attempt

The first `promote-staging-to-beta.yml` run ([25653670221](https://github.com/luisa-sys/lyra/actions/runs/25653670221)) revealed **[BUGS-13](https://checklyra.atlassian.net/browse/BUGS-13)**: `deploy-beta.yml` has never actually produced a `target=beta` Vercel deployment because the deploy step is missing `--target=beta` and the env pull was scoped to `preview` instead of `beta`. All three CI deploy-beta runs since 2026-05-05 have failed at the same step — nobody noticed because the beta domain still resolves (serving an old 404 page).

**What's true vs. what the rest of this doc says:**

- `beta` branch exists, gets promoted, merges succeed — ✅ true
- `deploy-beta.yml` runs lint, build, deploy steps — ✅ true
- `beta.checklyra.com` returns HTTP 200 — ✅ true, but **the body is a stale 404 page**, not the beta homepage
- Beta is gated by `is_beta_eligible` middleware — ✅ true in source, but **the gate has never actually served traffic** because no fresh deploy has landed
- BUGS-11 will close on the next promotion — ❌ false, because `promote-staging-to-beta.yml` is a direct merge (no PR), so the auto-merge gate isn't exercised. BUGS-11 closes on the next `promote-to-production.yml` run, not the beta one.

**Status now:** PR [#139](https://github.com/luisa-sys/lyra/pull/139) proposes the workflow fix. The Vercel-dashboard side (custom env named `beta` bound to the git branch, with the right env vars + `beta.checklyra.com` aliased to it) must be verified before that PR's effect can be confirmed end-to-end. See BUGS-13 step (b) for the dashboard checklist.


## Context (one paragraph)

Lyra is a Next.js 16 + Supabase profile platform. Repo: `luisa-sys/lyra`. Pipeline is **develop → staging → beta → main**. Beta is a new env (KAN-175) just stood up — `beta.checklyra.com` is publicly reachable but gated by an in-app `is_beta_eligible` flag check in middleware. Non-eligible users redirect to `/waitlist`. Beta uses **production Supabase credentials** (shared `prod-lyra` project), so beta keys are valid prod keys via `mcp.checklyra.com`.

## Environment matrix (current state, all verified clean 2026-05-11)

| Env | App URL | MCP URL | Supabase | Branch | NEXT_PUBLIC_SITE_URL | IS_BETA_DEPLOY |
|---|---|---|---|---|---|---|
| Production | https://checklyra.com | https://mcp.checklyra.com | `prod-lyra` (`llzkgprqewuwkiwclowi`) | `main` | `https://checklyra.com` | (unset) |
| Beta | https://beta.checklyra.com | https://mcp.checklyra.com | `prod-lyra` (shared with prod) | `beta` | `https://beta.checklyra.com` | `true` |
| Staging | https://stage.checklyra.com | _(none — internal-only)_ | `stage-lyra` (`uobmlkzrjkptwhttzmmi`) | `staging` | `https://stage.checklyra.com` | (unset) |
| Dev | https://dev.checklyra.com | https://mcp-dev.checklyra.com | `dev-lyra` (`ilprytcrnqyrsbsrfujj`) | `develop` | `https://dev.checklyra.com` | (unset) |

Prod, stage, and dev are behind **Cloudflare** (orange-cloud proxy + bot challenge on `*.checklyra.com`). Beta + stage + dev are also behind Vercel SSO (custom envs). Production is public (no Vercel SSO, Cloudflare only).

## CI smoke check (KAN-175, working)

- Endpoint: `/api/health` returns `{ ok, siteUrl, isBetaDeploy, vercelEnv }`
- Every deploy workflow (`deploy-dev.yml`, `deploy-staging.yml`, `deploy-beta.yml`, `deploy-production.yml`) hits this endpoint via the **Vercel direct deployment URL** (bypasses Cloudflare bot challenge) using `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS` header
- Asserts `siteUrl` matches env + `isBetaDeploy` correct → `::error::` if wrong, `::warning::` + exit 0 if HTTP non-2xx (Vercel-side issue)
- `VERCEL_AUTOMATION_BYPASS` GitHub secret = Vercel "Protection Bypass for Automation" token

## Bugs ticket status

| Ticket | Status | Notes |
|---|---|---|
| BUGS-1 | ✅ Closed | MCP env mismatch — resolved by per-env MCP architecture (dev MCP exists at `mcp-dev.checklyra.com`) |
| BUGS-9 | ✅ Closed | SHA-verified auto-rollback proven on run 25336633745 |
| BUGS-11 | 🟡 Open (passive) | Auto-merge issue — phantom suites + strict-ancestry + `requiresApprovingReviews` toggle all addressed. Closes when next prod promotion auto-merges unattended. PR #110 (merge-main step) shipped, GitHub branch protection toggle flipped, stale GitHub Apps uninstalled (railway-app + vercel). |
| BUGS-12 | ✅ Closed | Profile wizard `'use server'` non-async export — fixed in `profile-fields.ts` sibling module, live on prod. |

**Net: no blocking bugs. BUGS-11 is the only open one and it self-closes on next clean promotion.**

## Beta env — what's done

- `beta` git branch exists, deploys to `beta.checklyra.com` via `deploy-beta.yml`
- Vercel custom "beta" environment configured with `PROD_SUPABASE_*` secrets + `IS_BETA_DEPLOY=true` + `NEXT_PUBLIC_SITE_URL=https://beta.checklyra.com`
- Cloudflare DNS: `beta.checklyra.com` CNAME → `cname.vercel-dns.com` with proxy ON, SSL Full (strict)
- Vercel Git integration: connected, but auto-deploy disabled via `vercel.json` `{"github":{"enabled":false}}` — CI is the only deploy path
- Supabase migration applied: `is_beta_eligible boolean default false` on `profiles` (dev/stage/prod)
- Middleware gate active: when `IS_BETA_DEPLOY=true`, ineligible users redirected to `/waitlist`
- Waitlist landing page exists at `src/app/waitlist/page.tsx`
- Luisa's prod account flagged `is_beta_eligible = true`
- Promote workflow ready: `gh workflow run promote-staging-to-beta.yml -f confirm=promote`
- KAN-175 PR #122 + follow-up smoke fixes (#123, #124, #126, #130) all merged

## What's left to do for beta deploy

Recommended next steps:

### 1. Smoke test the beta sign-in flow end-to-end

- Visit https://beta.checklyra.com
- Sign in with Luisa's Google account
- Confirm landing on `/dashboard` (not redirected to `/waitlist`)
- Verify profile loads correctly
- Test profile updates (Save & continue on each wizard step)
- Test MCP integration: generate an API key on `beta.checklyra.com/dashboard/settings`, call `lyra_update_profile` via `mcp.checklyra.com/mcp`

### 2. Test the waitlist flow with a second user

- Sign in with a non-flagged Google account
- Verify redirect to `/waitlist`
- Verify the "use the live site" CTA links to checklyra.com correctly

### 3. Decide cookie scoping (deferred from KAN-175)

- Currently per-subdomain; beta and prod don't share session
- If you want seamless SSO across beta + prod (same `prod-lyra` Supabase), update `src/middleware.ts` to scope auth cookies to `.checklyra.com` (parent)
- Risk: any subdomain XSS exposes prod sessions too. Considered acceptable since beta and prod share the same Supabase user pool by design.

### 4. Add more beta testers

Each prod user gets `is_beta_eligible = true` flipped via Supabase dashboard SQL:

```sql
UPDATE profiles SET is_beta_eligible = true
WHERE user_id = (SELECT id FROM auth.users WHERE email = '<their-email>');
```

Or build a tiny admin UI page (out of scope for KAN-175; could be a small follow-up ticket).

### 5. First real beta promotion

- Trigger `promote-staging-to-beta.yml`
- Verify staging→beta promotion auto-merges (with the BUGS-11 fixes shipped)
- This is the unattended-auto-merge test that closes BUGS-11

## Gotchas to know

- **Cloudflare bot challenge blocks all CI/automated curl** to `*.checklyra.com`. Smoke checks hit the Vercel direct URL (`lyra-xxx.vercel.app`) instead. Don't add curl-based monitoring against the custom domains from CI.
- **`'use server'` files must export ONLY async functions** (gotcha #18 in CLAUDE.md). Constants/types go in sibling modules. `scripts/check-server-action-exports.sh` enforces this.
- **`NEXT_PUBLIC_SITE_URL` is build-time inlined.** Changing it in Vercel UI requires a full rebuild (workflow rerun via `gh run rerun <run-id>`) — UI "Redeploy" doesn't work for prebuilt deployments.
- **Vercel branch-scoped env vars** in Preview scope override the default. Each branch (`develop`, `staging`, `beta`) has its own `NEXT_PUBLIC_SITE_URL` Preview entry. Don't edit the wrong one.
- **Production maintenance worker** (`scripts/lyra-maintenance-worker.js`) intercepts `checklyra.com/*` and shows a "Coming Soon" page except for `/api/health` and a few SEO/legal paths. Until you remove the worker, the prod app is gated.
- **Promotion pipeline**:
  - `gh workflow run promote-to-staging.yml -f confirm=promote`
  - `gh workflow run promote-staging-to-beta.yml -f confirm=promote`
  - `gh workflow run promote-to-production.yml -f confirm=PRODUCTION`
  - Each waits for the prior env's CI to pass at HEAD before merging forward.

## Key files for beta work

- `src/middleware.ts` — beta gate logic
- `src/app/waitlist/page.tsx` — landing page
- `src/app/api/health/route.ts` — smoke endpoint
- `.github/workflows/deploy-beta.yml` — beta deploy
- `.github/workflows/promote-staging-to-beta.yml` — promotion
- `supabase/migrations/20260504220000_add_beta_eligible_flag.sql` — migration
- `docs/RUNBOOK.md` — environments table + MCP usage rules
- `CLAUDE.md` gotchas #18, #19 — env-specific patterns

## What to tell the new chat in the first message

> Picking up Lyra beta deploy work. KAN-175 (beta env stand-up) shipped — `beta.checklyra.com` is live with `is_beta_eligible` middleware gate. All 4 envs verified clean on `/api/health`. I want to end-to-end smoke-test the beta sign-in flow + waitlist redirect, then trigger the first real `promote-staging-to-beta.yml` run. BUGS-11 will passively close on that run if auto-merge fires unattended. Full context in `docs/HANDOVER_BETA_2026-05-11.md`.
