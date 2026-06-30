# Weekly Health + Regression + Autonomous Bug-Fix — Claude Code routine

> Runs **weekly**, **global coverage** (both repos, all test types). Mirrors the structure of `DAILY_SECURITY_CHECK_ROUTINE.md`.
> Deterministic test/build runner: `scripts/weekly-health-regression.sh`. The agent does triage, autonomous fixes (on `develop` via `claude/*` PRs), Jira logging, and a **release rehearsal that stops at the manual production gate**.

This routine checks Lyra is healthy, runs the full regression + E2E + build suite across `luisa-sys/lyra` and `luisa-sys/lyra-mcp-server`, **fixes the bugs it can on a fully autonomous basis**, logs everything in Jira, and **rehearses the release pipeline** — stopping before the one step the project forbids automating.

## 🚦 Hard boundaries (do not cross — encoded in the prompt)

1. **Production promote — AUTO for FIXES, MANUAL for FEATURES (owner-authorized 2026-06-21).** The routine MAY auto-promote to production, but **only when *every* change pending on `develop` ahead of `main` is a bug-FIX** (a BUGS/SEC defect, `fix:`-type; no new feature / user-facing capability / route / table / MCP tool / migration) — **never a feature**, and only after the full suite is green through staging + beta. If *any* pending change is a feature, or fix-vs-feature is ambiguous → **STOP and require manual sign-off**. It always promotes via `promote-to-production.yml` (built-in smoke + auto-rollback), never a direct push to `main/beta/staging`. (Supersedes the prior "never automated" default for this routine — see `CLAUDE.md` → Deployment Pipeline.)
2. **Test Integrity Policy.** A failing test means the *code* is wrong, not the test. The routine must **never** modify, weaken, skip, or delete a test to go green. If a fix would require a test change, it **STOPS and reports** for sign-off.
3. **Autonomy with a stop-line.** Fix what's unambiguous and low-risk on a `claude/*` branch → PR to `develop`. For anything ambiguous, architectural, security-sensitive, data-model/RLS/migration, or requiring a test change → **STOP and report to the user**. (Mirrors your instruction: "Stop where you are unsure … otherwise act autonomously.")
4. **No self-merge to protected branches.** Open PRs; the routine may merge its own fix PR to `develop` **only** when CI is green and the change is low-risk — never to `staging/beta/main`.

## How the run is split

| Layer | Driven by | Covers |
|---|---|---|
| Tests + build | `scripts/weekly-health-regression.sh` | lint, type-check, unit, scripts, integration, E2E, build — honest PASS/FAIL/UNVERIFIED |
| Live health | agent (curl / connectors) | `*/api/health`, MCP `/health`, deploy SHAs, CI status |
| Triage + fix | agent | open `claude/*` PR per fix, log Jira (BUGS/SEC), respect the boundaries above |
| Release | agent (GitHub connector) | full chain develop→staging→beta→prod **for fix-only releases**; STOP + manual sign-off if any feature is pending |
| Self-update | agent | propose improvements to THIS routine's script/prompt/doc via a PR (never silent) |

## Prerequisite (same as the other routines)

Routines clone the **default branch (`main`)**; this tooling lives on `develop`. The prompt's first lines check out `develop` (and STOP if the script isn't there).

## Setup

- **Connectors:** GitHub + Atlassian (+ Supabase/Cloudflare/Vercel if you want the agent to read deploy/runtime state). Remove the rest.
- **Setup script** (this routine *does* need one — it runs the suite):
  ```bash
  npm ci
  npx playwright install --with-deps   # for E2E
  ```
  Repeat for `lyra-mcp-server` if covering it in the same run (or use a second routine).
- **Network:** **Custom** allowlist with `*.checklyra.com`, `mcp.checklyra.com`, `mcp-dev.checklyra.com` (for live health + E2E targets) + the default package registries (for `npm ci`).
- **Schedule:** **Weekly** (e.g. Monday 06:00 local — before the workweek; note the Sunday 23:00 UTC develop→staging auto-promote already runs).
- **Permissions:** leave **"Allow unrestricted branch pushes" OFF** (so it can only push `claude/*` — this is what keeps it off `main/beta/staging`). No prod tokens in the env.

## The routine prompt

```
FIRST run: git fetch origin develop && git checkout develop
Then verify scripts/weekly-health-regression.sh exists; if not, STOP and say the
checkout failed — do NOT improvise.

Read the repo for context first: CLAUDE.md, docs/RUNBOOK.md, docs/RELEASE_POLICY.md,
docs/ARCHITECTURE.md. Obey them. Two rules are absolute:
  (A) PRODUCTION PROMOTE IS MANUAL — never run promote-to-production.yml, never push
      to main/beta/staging, never vercel-promote to prod. You prepare + report only.
  (B) TEST INTEGRITY — never modify/skip/weaken/delete a test to make it pass. If a fix
      needs a test change, STOP and report for sign-off.

GOAL: confirm Lyra is healthy, run full regression + E2E, fix what you safely can,
log everything, and rehearse the release pipeline up to (not through) the prod gate.

1. HEALTH: curl https://checklyra.com/api/health and https://mcp.checklyra.com/health;
   check the latest CI run on develop is green (GitHub connector). Note anything red.
2. REGRESSION + E2E: run  RUN_E2E=1 bash scripts/weekly-health-regression.sh  and capture
   the PASS/FAIL/UNVERIFIED lines. (For lyra-mcp-server coverage, clone/build/test it too.)
3. TRIAGE + FIX (autonomous, bounded):
   - For each FAIL, find the ROOT CAUSE in the application code and fix it on a new
     claude/ branch. Re-run the suite to confirm green WITHOUT touching any test.
   - Open a PR to develop. If CI is green and the fix is low-risk, you may merge it to
     develop. NEVER merge to staging/beta/main.
   - STOP and report (do not fix) anything ambiguous, architectural, security/RLS/auth,
     migration/data-model, or that would require a test change. List it for the user.
   - Log every bug + fix in Jira the usual way: BUGS (6-section) for defects, SEC for
     security findings, with the failing output + your diagnosis + the PR link.
4. RESIDUAL BUGS: also scan for residual/known issues (open BUGS/SEC tickets, TODO/FIXME,
   flaky tests, Dependabot/CodeQL alerts) and fix the safe ones under the same rules.
5. RELEASE (auto for FIX-ONLY releases; manual for features — see boundary 1):
   - Determine what is pending on develop ahead of main (the changes that WOULD ship to prod):
     git log --oneline origin/main..origin/develop. CLASSIFY every commit.
   - If ALL pending changes are bug-FIXES (BUGS/SEC defects, fix: commits; NO new feature,
     user-facing capability, route, table, MCP tool, or migration) -> you are AUTHORISED to ship:
       a. Bump package.json: npm version patch --no-git-tag-version (per KAN-166), commit on a claude/ PR.
       b. Promote the chain: promote-to-staging.yml -> verify staging green + healthy ->
          promote-staging-to-beta.yml -> verify beta -> promote-to-production.yml -f confirm=PRODUCTION.
       c. The prod workflow runs smoke tests + AUTO-ROLLBACK. If it rolls back, treat as FAIL,
          open a Highest-priority BUGS ticket, and STOP.
       d. Verify prod after: curl https://checklyra.com/api/health and https://mcp.checklyra.com/health.
   - If ANY pending change is a feature, OR you are unsure whether something is a fix vs a feature
     -> DO NOT promote past staging. STOP and report: "release holds a feature / is ambiguous —
     needs manual sign-off: gh workflow run promote-to-production.yml -f confirm=PRODUCTION".
6. SELF-UPDATE: if you found a way this routine (script/prompt/doc) should improve, open a
   PR proposing it — do NOT silently change your own behaviour.
7. REPORT + LOG: append a run-log row to this doc (date, PASS/FAIL counts, bugs fixed +
   tickets, what you STOPPED on, release-readiness) via a claude/ PR. If anything is red
   or you stopped on something, put a clear "ACTION NEEDED:" summary at the top of your reply.
```

## Run log

| Date | Runner | Suite result | Bugs fixed → tickets/PRs | Stopped-on (needs user) | Release-ready? |
|---|---|---|---|---|---|
| 2026-06-21 | _(initial — routine authored; fix-only auto-promote authorised 2026-06-21)_ | — | — | — | auto for fix-only; features manual |
| 2026-06-24 | Claude Code (Opus) | lyra PASS=5 (lint/type-check/unit/scripts/build); integration+e2e = env gaps → **UNVERIFIED** (no `tests/integration/`; Playwright browsers rev 1194 vs required 1223, CDN blocked) — _not_ product FAILs. lyra-mcp-server: tsc + 565/565 tests green. Health: checklyra.com + mcp.checklyra.com `/health` OK; develop CI (Deploy/Lint&Unit/CodeQL) green. | qs moderate DoS (GHSA-q8mj-m7cp-5q26) in lyra-mcp-server → SEC-35 + draft PR #91 (lockfile qs 6.15.0→6.15.2). BUGS-51 false-FAIL reproduced (PR #352 still pending) → confirmation comment only. | **STOP (sign-off):** PR #352 (BUGS-51 runner-honesty) + PR #91 (SEC-35 qs bump) are draft, awaiting merge. Open HIGH SEC items (SEC-29/30/31/3/23/2) untouched — security/RLS, out of autonomous bounds. integration+e2e need env fix (#352) or browser/CDN allowlist to verify. | **Nothing to release** — develop is 0 commits ahead of main (chain fully flushed). No promotion run. |
| 2026-06-25 | Claude Code (weekly routine) | lyra: lint/type-check/unit (1803/139)/scripts/build **PASS**; e2e + integration **UNVERIFIED** (env gaps — Playwright browsers rev 1194 vs required 1223 + webkit 2287, CDN network-blocked; no `tests/integration/` dir). mcp-server: tsc clean + **583/583** green. Live health green (checklyra `ok`, mcp `ok`); develop HEAD 5a74607 CI + CodeQL green. | None to fix — both FAIL lines are the known **BUGS-51** env-gap false-positives; fix already in **PR #352** (draft, awaiting sign-off — not self-merged per boundary 6). Posted weekly-confirmation comment on BUGS-51. | **BUGS-51** false-FAIL persists → recommend merging **#352**. **BUGS-57** (High): prod MCP OAuth auth rejected — auth/architectural, out of routine scope. npm audit: prod 0, dev 21 moderate. SEC-35 (qs DoS in mcp-server) tracked. | **NO auto-promote** — 12+ `feat()` pending on develop→main (Convene, admin back-office, /status, age-verify, RS256, per-user entitlements, KAN-326). Release holds features → **manual prod sign-off required**: `gh workflow run promote-to-production.yml -f confirm=PRODUCTION`. |
| 2026-06-27 | weekly health/regression routine (Claude Code, remote) | **Real-green.** lyra: lint/type-check/unit/scripts/build PASS; E2E (chromium, against local build with CI dummy-Supabase env) 17 passed / 0 failed / 5 skipped. mcp-server: build OK, 525/525 tests pass. Two script-level **false-FAILs** from `RUN_E2E=1` — both environment/harness gaps, not code defects: (a) `integration` — no `tests/integration` dir exists so jest exits 1 on 0 matches; (b) `e2e` — webkit/`mobile-safari` browser binary absent (download 403 by network policy) **and** the E2E phase runs `npm run dev` with no Supabase env, so `requireEnv` throws on `/waitlist` + `[slug]` 404. Supplying CI's dummy Supabase env + the installed chromium binary → all pass. Tracked: BUGS-51 / BUGS-58. | None — no application defect found; **no test modified/skipped/weakened** (Test Integrity Policy). Health GREEN: checklyra.com/api/health + mcp.checklyra.com/health both ok; latest develop CI green. | Release HELD at the prod gate per this run's **absolute** boundary "production promote is manual — prepare + report only" (GOAL: rehearse *up to, not through* the gate). No push to staging/beta/main, no promote workflow run. | **YES — fix-only, ready for manual promote.** Pending on develop ahead of main = 1 commit: `fix(SEC-40)` cookie-domain scoping (src/lib/cookie-domain.ts + its unit test; no feature/route/table/MCP tool/migration). ACTION NEEDED → manual: `gh workflow run promote-to-staging.yml -f confirm=promote` → verify → `promote-staging-to-beta.yml -f confirm=promote` → verify → `promote-to-production.yml -f confirm=PRODUCTION`. |
| 2026-06-29 | Claude Code | lyra: lint/type-check/unit/scripts/build **PASS**; integration + e2e **UNVERIFIED** (env gap, not code — BUGS-51). lyra-mcp-server: **585 tests PASS** (38 suites). Health: checklyra.com + mcp.checklyra.com **OK**; latest CI green. | BUGS-51 self-update: `weekly-health-regression.sh` now classifies missing-Playwright-browser / no-tests-found as UNVERIFIED not FAIL (+5 unit tests) — draft PR on `claude/nice-meitner-z1zc16`. qs DoS bump (SEC-35/41) — draft PR on lyra-mcp-server `claude/sharp-faraday-z1zc16`. | **No code regressions.** E2E unverifiable in-sandbox: pre-baked browsers (rev 1194) out of lockstep with `@playwright/test@1.60.0` (rev 1223 + webkit 2287) and the Playwright CDN is network-blocked (403). Needs infra: bake matching browsers or allowlist the CDN (BUGS-51 §5). | **No release pending** — develop is 0 commits ahead of main (chain fully flushed); nothing to promote. |
| 2026-06-30 | Weekly Health+Regression (Claude Code) | Health green (`checklyra.com/api/health` ok prod; `mcp.checklyra.com/health` ok; develop HEAD `6cfe7a2` CI + CodeQL green). lyra **PASS=5** (lint/type-check/unit/scripts/build); `e2e`+`integration` are env-gap **UNVERIFIED** not FAIL (BUGS-51 — see note). lyra-mcp-server: `tsc` clean + **585/585** (38 suites) PASS. | **No product bug.** Both raw-runner FAILs are the BUGS-51 false-positive: Playwright browsers rev `1194` ≠ `@playwright/test@1.60.0`'s required `1223`+webkit `2287` (CDN blocked) → every e2e fail is `Executable doesn't exist`, never an assertion; and no `tests/integration/` dir → jest `No tests found`. Fix already merged as **#404** (BUGS-51, +5 unit tests) this session. qs DoS (SEC-35) already in draft PR #91. | **Merge ONE BUGS-51 fix (#404) and close the dup drafts** (#352, #392) — done this session. BUGS-57 (High — prod MCP OAuth clients rejected) still open: auth/architectural → report-only. | **Nothing to release** — `origin/main..origin/develop` = **0 commits** (chain already flushed to main). No promotion run. |
