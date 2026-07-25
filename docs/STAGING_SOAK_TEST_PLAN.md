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
routine FAILs the right check and logs a bug. **Always clean up after.** Prefer
running injections against `dev`/`e2e-dev` or the soak user so staging config is
never left broken.

| # | Injected fault | Run | Expect | Cleans up |
|---|---|---|---|---|
| **B1** | Set the soak user's `age_declared_18_at = NULL` (service-role) | soak-journey | `beforeAll` baseline assert FAILs ("age_declared missing") **or** mint-session cannot reach `/dashboard` → journey FAILs → bug logged | reset restores it |
| **B2** | Insert a stray `profile_items` row for the soak user, then skip a table in `DERIVED_PROFILE_TABLES` locally | soak-journey | `assertInitialBaseline` returns a violation → afterAll FAILs "…still has rows" → bug logged (proves the reset can't silently rot) | delete the row |
| **B3** | Run `staging-soak.sh` against **dev** (`STAGE_SITE=https://dev.checklyra.com`) with bypass | script | `C1-health` FAILs release-conformance (`siteUrl`/`vercelEnv` mismatch) → bug logged | none (read-only) |
| **B4** | `PAGE_BUDGET_MS=1 bash scripts/staging-soak.sh` (with bypass) | script | `C4-*` report **DEGRADED** FAIL | none |
| **B5** | `STAGE_SITE=https://nope.checklyra.invalid bash scripts/staging-soak.sh` | script | `C1-gate` / content = **UNVERIFIED (000)**, never a false PASS or FAIL | none |
| **B6** | Seed a NULL-token `auth.users` row on staging (the GoTrue quirk) | routine C5 (Supabase connector) | routine flags the NULL-token user → bug logged | delete the user |
| **B7** | Unpublish the soak user (`is_published=false`) after C3.3, or corrupt its `slug` | soak-journey | C3.4 public-profile render assertion FAILs → bug logged | reset republishes |
| **B8** | Leave a real B-series fault in place across **two** consecutive runs | routine ×2 | run 2 finds the open ticket from run 1 and does **not** open a duplicate | close the ticket |

Pass criteria for Section B: **every** row produces the expected FAIL/UNVERIFIED
**and** the expected single bug (B8 proves dedup). A row that goes green is a
false-green — do not trust the routine until it's fixed.

### Coverage map (every contract check has a detection test)
`C1 gate/conformance → B3,B5` · `C2/C4 latency → B4,B5` · `C3 journey/reset →
B1,B2,B7` · `C5 DB drift → B6` · `dedup → B8`. (C6 error-budget: assert Sentry
shows a known test error signature in the last 24h → routine reports it; low
priority, add when Sentry connector is wired.)

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
