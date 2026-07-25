# Staging Soak — Claude Code cloud-routine setup

> **Ticket:** KAN-412 (this routine) · concern **staging-soak** in
> `docs/OPS_ROUTINES_CONTROL_ROOM.md`. Grounded in the official docs:
> [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) ·
> [Routines](https://code.claude.com/docs/en/routines).

This is the **automation** for a daily soak test of the **promoted staging
environment** (`stage.checklyra.com`, branch `staging`, Supabase
`uobmlkzrjkptwhttzmmi`). It runs as a **scheduled Claude Code routine** — a cloud
session that spins up on a timer, checks out the spec, exercises staging
end-to-end *as a user would*, compares the result to the release contract below,
files a deduped BUGS/SEC ticket for anything new, appends a heartbeat row, and
emails on FAIL.

It is modelled 1:1 on the **Daily Security Check** routine
(`docs/DAILY_SECURITY_CHECK_ROUTINE.md`) — same clone/checkout mechanics, same
connector-not-container-secrets model, same no-silent-skip honesty rules — so
read that doc first if anything here is unclear.

> **This routine is DETECT-AND-LOG ONLY.** It identifies an issue and **logs it
> as a bug** (a BUGS ticket; SEC for a genuine security/privacy finding) — then
> stops. It never edits code, never opens a fix PR, never applies a migration,
> and never writes to prod. Fixing a logged bug is a separate human / Backlog
> Autopilot follow-up. The only writes it makes are to the disposable **staging**
> DB via the soak harness, and the heartbeat/run-log PR from a `claude/` branch.

---

## Why a soak test, and what it is NOT

The existing staging coverage is **deploy-gated and point-in-time**:

- `health-check.yml` — shallow HTTP liveness, every 6h (**liveness owner**).
- `staging-tests.yml` — axe + Lighthouse against a *just-deployed* URL, nightly
  05:00 + post-deploy (**deploy-gate**).
- `e2e-authed.yml` / `e2e-tests.yml` — Playwright journeys, **dispatch/PR-gated**.

None of these repeatedly exercises the **live, already-promoted staging build**
over time. A soak does: it is the daily canary that catches drift, degradation,
and journey breakage that appear *between* deploys — config/secret drift, a
migration that landed on the DB but not the app, an invite queue that stops
draining, latency creep, error-budget burn, a published profile that stops
rendering. **staging-soak** is a *new, distinct owner concern* (KAN-361); it
**cites** the liveness/security/regression owners, it does not re-derive them.

**One thing this routine deliberately does NOT test: real user sign-up.** It
drives a **pre-provisioned persistent soak user** and resets it to the initial
account-setup state each run, so it exercises *everything after* account
creation without re-creating the account. Sign-up itself is a **separate,
un-skippable promotion gate** — see `docs/SIGNUP_SURFACE_GATE.md`. If a change
touches the sign-up surface, the promotion-to-staging gate forces a full
sign-up E2E that **cannot be skipped**; the daily soak assumes a valid account
already exists.

---

## The release contract — "what good looks like on staging" (UPDATE THIS WITH RELEASES)

> **This section is the whole point of keeping the spec in git.** When a release
> changes what staging should do, the **same PR updates this contract**, and the
> next soak run tests against the new expectation. A soak that passes against a
> stale contract is worthless — treat editing this section as part of the
> definition-of-done for any change to the routes, journeys, or health signals
> below. CI does not (cannot) prove the contract matches intent; the reviewer
> of the release PR does.

### C1 — Public/edge surface (anonymous, no bypass)
- `stage.checklyra.com` root → **401 or 403** (Vercel deployment protection is
  ON for staging). A **200** anonymous is a FAIL (protection is down).
- `/status` → **200** (public status page, exempt from the beta gate).
- `/api/health` → **200** JSON with `ok:true`. Values must match this env:
  `siteUrl` = `https://stage.checklyra.com`, `isBetaDeploy` = `false`,
  `vercelEnv` = `preview`. A mismatch is a **release-conformance** finding.
- `/robots.txt`, `/sitemap.xml`, `/.well-known/security.txt` → 200 or 403.

### C2 — Authenticated surface (with the Vercel/CF bypass header)
- With `x-vercel-protection-bypass` (+ the CF-skip header when provisioned), the
  key routes return **200** within the latency budget (C4): `/`, `/dashboard`,
  `/dashboard/profile`, `/login`, `/signup`, `/join`, `/<published-slug>`.
- No route in the set returns **5xx** across the repeated soak passes (C4).

### C3 — Persistent-user journey (read-write, staging DB is disposable)
Driven against the soak user (`soak@seed.checklyra.com`), reset to initial first:
1. **Baseline** — after reset the user is *initial account setup*: name only,
   not published, 18+ declared, no items/affiliations/entitlements/gatherings.
2. **Build** — add intro → onboarding state advances `empty → drafted`.
3. **Publish** — publish the profile → state `published_activate`; the public
   `/<slug>` renders the published profile within the latency budget.
4. **Grow** — add a gift + a school affiliation → state `published_grow`; the
   Manual-of-Me edit round-trips to the public profile.
5. **Gather** *(when Convene is entitled on staging)* — create a gathering,
   add the soak user's second identity, then cancel it; no orphaned rows remain.
6. **Reset** — restore initial account setup (afterAll), and assert the baseline
   is clean. **If reset leaves rows behind, FAIL loudly** — the reset table-list
   in `tests/e2e/support/soak-user.ts` is stale and must be extended (this is
   part of the release contract).

### C4 — Soak signals (sustained, not a single hit)
- Each C1/C2 route is probed **N=5** times per run; report p50/p95 latency.
- **Latency budget:** p95 ≤ **2500 ms** for pages, ≤ **800 ms** for
  `/api/health`. Over budget for ≥2 of the 5 passes → a **degradation** finding.
- Any **000/5xx** on any pass (that is not the expected 401/403 protection code)
  → a **reliability** finding.

### C5 — Data / drift on the staging DB (via the Supabase connector)
- `get_advisors(type=security)` and `get_advisors(type=performance)` on
  `uobmlkzrjkptwhttzmmi` → no **new** advisor vs. the last run-log row.
- **Invite queue** is draining (no rows older than 24h stuck un-sent).
- No **NULL-token** `auth.users` rows (the GoTrue-500 quirk — CLAUDE.md gotcha):
  every user has non-NULL `confirmation_token` / `recovery_token` etc.
- No **stale `auth.one_time_tokens`** piling up beyond their TTL.
- **Migration parity:** `supabase migration list` head on staging == the latest
  migration in `supabase/migrations/` on `staging` branch (a migration in the
  repo not applied to the DB, or vice-versa, is a finding).

### C6 — Error budget (last 24h)
- Vercel/Sentry runtime errors on staging over the last 24h below threshold
  (no new *unhandled* error signature vs. the last run-log row). Cite Sentry;
  do not re-derive liveness (that is `health-check.yml`).

---

## How the run is split

| Layer | Driven by | Covers |
|---|---|---|
| Deterministic HTTP + latency probes | `scripts/staging-soak.sh` (curl) | C1, C2, C4 |
| Read-write persistent-user journey | Playwright `soak-journey` project (`tests/e2e/soak/journey.soak.spec.ts` + `tests/e2e/support/soak-user.ts`) | C3 |
| DB drift / advisors / migration parity | the **agent**, via the **Supabase connector** | C5 |
| Error budget + release conformance | the agent (Sentry/Vercel connector + `/api/health`) | C6, C1 |
| Triage + reporting | the agent | dedupe vs Jira, file tickets, heartbeat, email |

The deterministic script needs nothing but `curl`. The journey needs the staging
service-role key + bypass headers in the routine env (below). The DB/error
checks run through **connectors** (routed via Anthropic — no container tokens).

### Graceful degradation (no silent-skip)
If the **CF bot-management** challenge blocks the routine's egress to
`stage.checklyra.com` (the known CI-IP 403 — CLAUDE.md gotcha #7,
`docs/E2E_AUTHED_CF_BYPASS.md`), the affected layer reports **UNVERIFIED**, never
a green PASS and never a false FAIL, and the reply names the exact unblock (a CF
WAF *skip* rule keyed to `E2E_CF_BYPASS_*`). The deterministic C1/C5/C6 layers
still run. UNVERIFIED is a soft-FAIL for the heartbeat, not a pass.

---

## ⚠️ Prerequisite: the spec must be on the branch the routine clones

A routine **clones the repo's default branch** (`main`) each run. This spec +
`scripts/staging-soak.sh` + the soak Playwright files currently live on branch
`claude/staging-soak-routine` → PR into `develop`. Until they reach the clone,
the **first line of the routine prompt** must check out the branch that has
them:

```
git fetch origin develop --depth=1 && git checkout develop
```

Point it at `develop` once the PR merges (recommended); drop the line entirely
once the files ride `develop → staging → beta → main` to `main`. The GitHub
proxy only restricts **pushes**; fetching/checking out another branch to *read*
is fine. **If the script still isn't present after checkout, STOP and say the
checkout failed — do NOT improvise probes.**

---

## Setup (mirror the Daily Security routine)

1. **Setup script:** leave **EMPTY**. `curl`, `jq`, `git`, `node`, `npx`,
   `ripgrep`, `bash` are pre-installed; the script is committed executable.
2. **Network access → Custom → Allowed domains:**
   ```
   checklyra.com
   *.checklyra.com
   stage.checklyra.com
   api.resend.com
   ```
   Tick "Also include default list of common package managers" (Playwright needs
   npm). Add `*.supabase.co` **only** if you run the JS harness's admin client
   directly rather than via the connector.
3. **Connectors:** **Supabase, GitHub, Atlassian** (+ **Sentry/Vercel** if
   available for C6). Remove every other connector — the connector list is a
   scope control.
4. **Permissions:** leave **"Allow unrestricted branch pushes" OFF** — the
   heartbeat/run-log change goes out as a PR from a `claude/` branch; the run
   cannot push to `staging`/`develop`/`main`.
5. **Env vars / secrets** (visible to anyone who can edit the environment — keep
   to these):
   - `RESEND_API_KEY` — FAIL-alert email (reuses `scripts/security-alert-email.sh`).
   - `VERCEL_AUTOMATION_BYPASS` — reach protected staging routes (C2/C3).
   - `E2E_SUPABASE_URL` = `https://uobmlkzrjkptwhttzmmi.supabase.co`,
     `E2E_SUPABASE_SERVICE_ROLE_KEY` = the **staging** service-role key (the
     harness hard-guards against prod — `tests/e2e/support/supabase-admin.ts`).
   - `E2E_CF_BYPASS_HEADER` + `E2E_CF_BYPASS_SECRET` — the CF WAF-skip header
     pair (see `docs/E2E_AUTHED_CF_BYPASS.md`). **If unset, C3 reports
     UNVERIFIED** (the CF challenge blocks the browser) — that is the honest
     result, not a skip.
   - Optional `ALERT_TO` / `ALERT_FROM` (default `luisa@santos-stephens.com` /
     `security@checklyra.com`, a Resend-verified sender).
6. **Schedule:** **Daily ~04:12 UTC** (de-collided from the existing crons:
   01:00 daily-security, 03:20/09:20/… autopilot, 05:00 staging-tests). After
   the overnight jobs, before the nightly staging tests.

---

## The routine prompt

```
First, if scripts/staging-soak.sh is not present on the checked-out branch,
run: git fetch origin develop --depth=1 && git checkout develop
Then verify scripts/staging-soak.sh AND tests/e2e/soak/journey.soak.spec.ts
exist; if either does not, STOP and reply that the develop checkout failed — do
NOT improvise probes, read other docs, or proceed.

You are the Lyra Staging Soak (KAN-412). Target is STAGING ONLY
(stage.checklyra.com / Supabase uobmlkzrjkptwhttzmmi). Staging is disposable:
you MAY write to the staging DB via the soak harness. NEVER touch prod
(llzkgprqewuwkiwclowi) or dev. Read docs/STAGING_SOAK_ROUTINE.md — its "release
contract" section (C1–C6) is what you assert. Treat any UNVERIFIED as a
soft-FAIL, never a pass (Workflow & Backup Integrity Policy).

1. Run: bash scripts/staging-soak.sh   (C1/C2/C4 — capture every
   PASS/FAIL/UNVERIFIED line + the p50/p95 latencies).
2. Run the persistent-user journey (C3):
     E2E_AUTHED= SOAK_JOURNEY=1 BASE_URL=https://stage.checklyra.com \
     npx playwright test --project=soak-journey
   The spec ensures + resets the soak user to initial account setup, drives
   build→publish→grow→(gather), and resets to initial in afterAll. A reset that
   leaves rows behind FAILS — file that as a soak-reset finding.
   If Cloudflare blocks the browser (403 "Just a moment"), record C3 as
   UNVERIFIED with the CF-skip unblock; do NOT mark it PASS or FAIL.
3. Via the Supabase connector on uobmlkzrjkptwhttzmmi (C5): get_advisors
   security+performance; invite-queue drain; NULL-token auth.users rows; stale
   one_time_tokens; migration parity (list vs supabase/migrations on staging).
   READ-ONLY except the soak harness's own writes.
4. C6: last-24h Vercel/Sentry error budget for staging; cite health-check.yml's
   last conclusion for liveness — do NOT re-curl the endpoint list.
5. Compare EVERY result to C1–C6 and the last run-log row in this doc. For any
   NEW finding not already covered by an open ticket (check Jira FIRST):
   - functional/reliability/perf/data → **BUGS** ticket (project BUGS, type
     Task): summary "[SOAK][<sev>] <short>", the 6-section standard, labels
     staging-soak + automated.
   - security/privacy → **SEC** ticket instead (per CLAUDE.md). Do NOT fix code
     or migrations; do NOT touch prod.
6. Append one run-log row (below) + one Ops-Control-Room heartbeat row as your
   FINAL checkpoint, via a PR from a claude/ branch (only that change).
7. If any FAIL: (a) email — pipe a one-paragraph summary into
   `bash scripts/security-alert-email.sh "Lyra staging soak: <N> FAIL"`; and
   (b) put a clear "PAGE:" line at the very top of your final reply.
   If clean: state "all green" with the PASS/UNVERIFIED counts; still write both
   log rows.
```

---

## Reporting

- **Tickets:** deduped against open Jira first. BUGS for functional/reliability/
  perf/data; SEC for security/privacy. Never a fix — the soak observes and
  reports; a human (or the Backlog Autopilot) fixes.
- **Heartbeat:** one row in the Confluence *Ops Routines Control Room*
  Heartbeat/Run-ledger every run, as the FINAL checkpoint (a run with no
  heartbeat is a **missed run** to the watchdog).
- **Email on FAIL:** reuses `scripts/security-alert-email.sh` → Resend. Fails
  loud if `RESEND_API_KEY` is missing or Resend returns non-2xx.
- The **watchdog** in the Daily Security routine covers this routine
  (`staging-soak|1740|<last-iso>|<outcome>` — 24h cadence + 5h grace).

## Why not (only) a GitHub Action?

`staging-tests.yml` already runs the deploy-gated axe/Lighthouse subset from
Actions. The value a routine adds is the parts an Action can't do well: driving
the Supabase/Sentry **connectors** with judgement (C5/C6), triaging against Jira,
and filing well-formed tickets. The Action remains the fallback for the
pure-HTTP subset.

---

## Verifying it works autonomously

Before this routine is trusted unattended, and after any change to
`staging-soak.sh`, the soak spec, or the C1–C6 contract, run the fault-injection
suite in **`docs/STAGING_SOAK_TEST_PLAN.md`**. It proves the routine *detects*
problems (not just that it runs green) and that its own liveness is watched.

## Run log (newest first)

| Date (UTC) | Runner | PASS/FAIL/UNVERIFIED | p95 (page/health) | New tickets | Notes |
|---|---|---|---|---|---|
| _(none yet — first run appends here)_ | | | | | |
