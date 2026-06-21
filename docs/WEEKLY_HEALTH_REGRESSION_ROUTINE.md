# Weekly Health + Regression + Autonomous Bug-Fix — Claude Code routine

> Runs **weekly**, **global coverage** (both repos, all test types). Mirrors the structure of `DAILY_SECURITY_CHECK_ROUTINE.md`.
> Deterministic test/build runner: `scripts/weekly-health-regression.sh`. The agent does triage, autonomous fixes (on `develop` via `claude/*` PRs), Jira logging, and a **release rehearsal that stops at the manual production gate**.

This routine checks Lyra is healthy, runs the full regression + E2E + build suite across `luisa-sys/lyra` and `luisa-sys/lyra-mcp-server`, **fixes the bugs it can on a fully autonomous basis**, logs everything in Jira, and **rehearses the release pipeline** — stopping before the one step the project forbids automating.

## 🚦 Hard boundaries (do not cross — encoded in the prompt)

1. **Production promote is MANUAL — never automated.** `CLAUDE.md`: *"Promotion to production … always manual — never automated"* and *"Never push directly to staging, beta, or main."* The routine validates the chain and **prepares** the prod release, then **STOPS** and reports the exact command for you to run. It must not run `promote-to-production.yml`, push to `main/beta/staging`, or `vercel promote` to production.
2. **Test Integrity Policy.** A failing test means the *code* is wrong, not the test. The routine must **never** modify, weaken, skip, or delete a test to go green. If a fix would require a test change, it **STOPS and reports** for sign-off.
3. **Autonomy with a stop-line.** Fix what's unambiguous and low-risk on a `claude/*` branch → PR to `develop`. For anything ambiguous, architectural, security-sensitive, data-model/RLS/migration, or requiring a test change → **STOP and report to the user**. (Mirrors your instruction: "Stop where you are unsure … otherwise act autonomously.")
4. **No self-merge to protected branches.** Open PRs; the routine may merge its own fix PR to `develop` **only** when CI is green and the change is low-risk — never to `staging/beta/main`.

## How the run is split

| Layer | Driven by | Covers |
|---|---|---|
| Tests + build | `scripts/weekly-health-regression.sh` | lint, type-check, unit, scripts, integration, E2E, build — honest PASS/FAIL/UNVERIFIED |
| Live health | agent (curl / connectors) | `*/api/health`, MCP `/health`, deploy SHAs, CI status |
| Triage + fix | agent | open `claude/*` PR per fix, log Jira (BUGS/SEC), respect the boundaries above |
| Release rehearsal | agent (GitHub connector) | verify chain is promotable; **prepare** prod release; STOP at the manual gate |
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
5. RELEASE REHEARSAL (NO prod deploy):
   - Confirm develop is green and promotable. You MAY trigger develop→staging
     (promote-to-staging.yml is sanctioned/automatable) and confirm staging is healthy.
   - Verify beta and prod are PROMOTABLE (branches in sync, smoke endpoints up) but DO
     NOT promote them. Prepare the production release and STOP.
   - Report: "Pipeline validated through staging; production promote is READY and is the
     manual step — run: gh workflow run promote-to-production.yml -f confirm=PRODUCTION".
6. SELF-UPDATE: if you found a way this routine (script/prompt/doc) should improve, open a
   PR proposing it — do NOT silently change your own behaviour.
7. REPORT + LOG: append a run-log row to this doc (date, PASS/FAIL counts, bugs fixed +
   tickets, what you STOPPED on, release-readiness) via a claude/ PR. If anything is red
   or you stopped on something, put a clear "ACTION NEEDED:" summary at the top of your reply.
```

## Run log

| Date | Runner | Suite result | Bugs fixed → tickets/PRs | Stopped-on (needs user) | Release-ready? |
|---|---|---|---|---|---|
| 2026-06-21 | _(initial — routine authored)_ | — | — | — | manual gate by design |
