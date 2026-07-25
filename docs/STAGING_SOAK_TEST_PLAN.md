# Staging Soak — Test Plan (proving it works autonomously)

> **Ticket:** KAN-412. Companion to `docs/STAGING_SOAK_ROUTINE.md` (the routine)
> and `docs/SIGNUP_SURFACE_GATE.md` (the un-skippable signup gate).

## The problem this plan solves

A monitoring routine that is left alone has two silent failure modes, and a
green dashboard hides both:

1. **False green** — it runs, reports PASS, but would not actually *detect* a
   real problem (a rubber stamp).
2. **Silent death** — it stops running (disabled, crashing, checkout broken) and
   nobody notices, so "no alerts" is mistaken for "all healthy".

So this plan does **not** just check "does it run and go green". It
**deliberately breaks things and proves the routine catches them and logs a
bug**, and it proves the routine's own liveness is monitored. The routine is
trusted for autonomous operation only after **Section B (detection)** and
**Section C (self-liveness)** pass, plus the Section E soak-in period.

Legend: each test lists **Do → Expect → Pass criteria**. "Log a bug" means a
`[SOAK]` BUGS ticket (SEC for security). Detect-and-log only — no test expects
the routine to *fix* anything.

---

## A. Commissioning (one-time, before first trust)

**A1 — deterministic layer runs and is honest.**
Do: `bash scripts/staging-soak.sh` locally (no bypass), then in the routine env
(with `VERCEL_AUTOMATION_BYPASS`).
Expect: locally → `C1-gate PASS` (302 gated) + content/latency `UNVERIFIED` (not
FAIL); with bypass → `C1-*`/`C4-*` real `200`s + p50/p95 numbers.
Pass: no false FAIL when the only "problem" is a missing bypass; exit code
2=FAIL / 1=UNVERIFIED / 0=all-PASS matches the printed summary.

**A2 — journey harness runs end-to-end.**
Do: `SOAK_JOURNEY=1 BASE_URL=https://e2e-dev.checklyra.com npx playwright test
--project=soak-journey` with the staging E2E secrets.
Expect: C3.1–C3.5 pass; `afterAll` reset leaves a clean baseline (no assertion
failure).
Pass: the 5 tests green **and** the run made no leftover rows (assertInitialBaseline
returns `[]`).

**A3 — trigger configuration audit.** Confirm on the claude.ai routine:
- Setup script **empty**; Network allowlist has `*.checklyra.com` + `api.resend.com`.
- Connectors = **Supabase, GitHub, Atlassian** (+ Sentry/Vercel if used); nothing else.
- "Allow unrestricted branch pushes" **OFF**.
- Env: `RESEND_API_KEY`, `VERCEL_AUTOMATION_BYPASS`, `E2E_SUPABASE_URL`,
  `E2E_SUPABASE_SERVICE_ROLE_KEY`, (optional) `E2E_CF_BYPASS_*`.
- Schedule = daily **04:12 UTC**; prompt's first line checks out `develop`.
Pass: all present; a manual dispatch does **not** report "checkout failed / script missing".

**A4 — first supervised live run.** Dispatch the routine once against a healthy
staging.
Expect: a PASS/UNVERIFIED summary, **one** heartbeat row + **one** run-log row
appended, **zero** new tickets.
Pass: heartbeat written as the final step; no spurious bugs on a healthy env.

---

## B. Detection (fault injection) — the core of the plan

Each test injects a **known** problem, runs the relevant layer, and confirms the
routine FAILs the right check and logs a bug. **Always clean up after.**

> **Why these specific variants (do not "simplify" them).** An earlier draft
> injected faults that the harness's own `resetSoakUserToInitial()` silently
> undoes *before* the assertion runs — so the test went green while proving
> nothing (a false-green, the exact failure this plan exists to catch). Every
> row below is written to survive the reset, or to target a layer the reset
> doesn't touch. If you change the harness, re-derive these.

| # | Injected fault | Run | Expect | Cleans up |
|---|---|---|---|---|
| **B1** (C3 reset-rot) | In `tests/e2e/support/soak-user.ts`, temporarily **comment out only the `profile_items` line** of the `DELETE` loop in `resetSoakUserToInitial()` — leave `assertInitialBaseline` untouched (the journey's C3.5 inserts a `profile_items` row) | `SOAK_JOURNEY=1 … --project=soak-journey` | `afterAll` `assertInitialBaseline` FAILs **"profile_items still has 1 row(s) after reset"** → journey red → bug logged. Proves the no-silent-rot guard actually fires. | **restore the deleted line**, then rerun once to confirm green |
| **B2** (C4 latency) | `PAGE_BUDGET_MS=1 HEALTH_BUDGET_MS=1 VERCEL_AUTOMATION_BYPASS=$BYPASS bash scripts/staging-soak.sh` | script | every reachable `C4-*` reports **DEGRADED FAIL** (both budgets, else `/api/health` still passes) | none (read-only) |
| **B3** (C1 conformance) | `STAGE_SITE=https://dev.checklyra.com VERCEL_AUTOMATION_BYPASS=$BYPASS bash scripts/staging-soak.sh` | script | `C1-health` **FAIL** release-conformance (`siteUrl`/`vercelEnv` mismatch vs staging) | none |
| **B4** (honesty / unreachable) | `STAGE_SITE=https://nope.checklyra.invalid bash scripts/staging-soak.sh` | script | `C1-gate` **UNVERIFIED (000)** — never a false PASS or FAIL | none |
| **B5** (C4 challenge-safety) | `VERCEL_AUTOMATION_BYPASS=notarealtoken bash scripts/staging-soak.sh` (a bypass that will NOT clear protection → pages 302) | script | every `C4-*` reports **UNVERIFIED "returned HTTP 302 … latency NOT measured"** — proves a Cloudflare/redirect challenge can't false-PASS as fast (regression guard for the fix). | none |
| **B6** (C5 DB drift) | Seed **one NEW** NULL-token `auth.users` row on **staging** with a **non-seed** email (e.g. `soaktest.nulltoken@example.invalid`) so it is distinguishable from the 8 baseline `seed.%` rows | routine C5 (Supabase connector) | routine flags the **new** NULL-token user (not the 8 baseline) → bug logged | **delete the row** |
| **B7** (signup gate) | On a throwaway branch, touch a signup-surface file (`echo "" >> "src/app/(auth)/actions.ts"`) and run `bash scripts/check-signup-surface-gate.sh origin/staging HEAD` | script | exit **10 = TOUCHED** → "signup E2E required". Then revert and rerun → exit **0 = CLEAN**. Proves the gate can't be skipped by omission. | revert the file |
| **B8** (dedup) | Leave a real fault (e.g. B6's NULL-token row) in place across **two** consecutive live routine runs | routine ×2 | run 2 finds run 1's open ticket and opens **no** duplicate (stable `[SOAK][<sev>] <short>` summary) | close the ticket + delete the row |

Pass criteria for Section B: **every** row produces the expected FAIL/UNVERIFIED
**and** the expected single bug (B8 proves dedup). A row that goes green is a
false-green — do not trust the routine until it's fixed.

### Coverage map
`C1 conformance → B3` · `C1 gate anon-200 → code path (FAIL); not safely
injectable on shared staging — reviewed by reading staging-soak.sh` · `C4 latency
→ B2` · `C4 challenge-safety → B5` · `honesty/unreachable → B4` · `C3 reset-rot →
B1` · `C3 app-render correctness → covered by A2 (real-deploy run) + the strict,
un-weakenable assertions (Test Integrity Policy), not a fault-injection (a
genuinely broken deploy can't be manufactured on demand)` · `C5 DB drift → B6` ·
`signup gate → B7` · `dedup → B8`. **C6 error-budget is UNCOMMISSIONED** until a
Sentry/Vercel connector is attached to the routine — mark it out-of-scope in the
contract or wire the connector + add a C6 injection before claiming it works.

> **Do NOT use these masked variants** (they read green without testing anything,
> because the reset undoes them first): setting `age_declared_18_at=NULL` on the
> soak user (reset re-sets it in `beforeAll`); unpublishing the user (C3.4
> re-publishes); corrupting `slug` (reset never restores `slug`, so it would
> leave the soak user's public page 404-ing and FAIL C3.4 **every day** —
> self-inflicted alarm).

---

## C. Self-liveness (prove it can't silently die)

**C1 — heartbeat is the final checkpoint.** After any run, confirm a heartbeat
row exists. Pass: no run ever completes without appending one (a run with no
heartbeat is, by definition, a missed run to the watchdog).

**C2 — watchdog catches a stalled routine.** The Daily Security routine's
watchdog covers staging-soak. Feed it a stale timestamp:
`bash scripts/routine-watchdog.sh 'staging-soak|1740|2026-01-01T00:00:00Z|PASS'`.
Expect: `FAIL`/`OVERDUE` line + non-zero exit → the daily-security run emails +
puts `ACTION NEEDED` at the top. Pass: a >~29h-old heartbeat is flagged, not
silently graced. (1740 = 24h cadence + 5h grace, in minutes.)

**C3 — email-on-FAIL fires.** Force a FAIL (e.g. B4) on a live routine run.
Expect: `scripts/security-alert-email.sh` POSTs to Resend and a `PAGE:` line
tops the reply; it **fails loud** if `RESEND_API_KEY` is missing. Pass: the
email arrives (or the run fails loudly on a missing key — never a silent skip).

**C4 — a disabled trigger is detectable.** Disable the routine trigger for a
day. Expect: no heartbeat appears → C2's watchdog flags it OVERDUE the next day.
Pass: turning the routine off is caught within one watchdog cycle, not weeks
later (this is the SEC-79 failure mode the watchdog exists to prevent).

---

## D. No false positives (don't cry wolf)

**D1 — clean staging → clean run.** On a healthy staging with all secrets set:
all `PASS`/`UNVERIFIED`, **zero** new tickets, heartbeat = PASS.
**D2 — environment-blocked ≠ broken.** Remove `E2E_CF_BYPASS_*` so Cloudflare
challenges the browser. Expect: C3 = **UNVERIFIED** with the CF-skip unblock
noted — **not** a FAIL and **not** a bug storm. Pass: an environment limitation
degrades to UNVERIFIED, and at most one standing note, never a daily new bug.

---

## E. Acceptance — "it is working autonomously"

Trust the routine for unattended operation only after **all** of:

- [ ] Sections A, B, C, D pass at least once.
- [ ] **C3 reads PASS, not a standing UNVERIFIED.** A permanent C3=UNVERIFIED
      means the CF-bypass / `e2e-stage` alias isn't provisioned and the soak's
      **core journey layer is dark** — and it will **not** self-alert, because
      `routine-watchdog.sh` treats a fresh heartbeat whose last outcome is
      UNVERIFIED as PASS (email fires only on FAIL). Treat a repeated
      C3=UNVERIFIED as an explicit action item, never an acceptable steady state.
- [ ] **≥10 consecutive daily runs**, each appending a heartbeat row (Section C1).
- [ ] At least **one** Section-B fault-injection detection reproduced on the
      live routine (not just locally) — proves the live wiring detects + logs.
- [ ] **Zero duplicate-ticket storms** over the soak-in period (B8 dedup holds).
- [ ] The watchdog fired correctly in the C2 test and **never** fired spuriously
      on a healthy day.
- [ ] Every genuine FAIL in the period produced exactly **one** actionable
      `[SOAK]` bug + an email.
- [ ] Weekly eyeball of the run-log: p95 latency stable, UNVERIFIED count not
      creeping (a rising UNVERIFIED count means the env is drifting out of reach,
      which is itself worth a ticket).

### Ongoing (steady state)
- The **weekly-report** cites this routine's last heartbeat (reporting owner).
- The Section-B injections are cheap; re-run the full B suite after any change to
  `staging-soak.sh`, the soak spec, or the release contract (C1–C6) — a contract
  edit that isn't matched by a detection test is how a false-green creeps back in.
