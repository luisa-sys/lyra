# Test Integrity Audit — 2026 Q2

**Ticket:** KAN-168
**Date:** 2026-05-04
**Scope:** All unit, E2E, smoke, and CI workflow tests in `luisa-sys/lyra`

This audit enforces the policies in [CLAUDE.md → Test Integrity Policy](../CLAUDE.md) and [Workflow & Backup Integrity Policy](../CLAUDE.md). The goal is identical to KAN-167 but applied to tests rather than workflows: a test that runs without making any assertion is worse than no test at all because it gives false safety.

## Summary

| Category | Files | Verdict |
|---|---|---|
| Jest unit tests | 22 | ✅ pass — all blocks contain at least one `expect()` |
| Playwright E2E | 1 (`homepage.spec.ts`) | ⚠ pre-existing Jest discovery collision (unrelated to integrity) |
| Smoke shell scripts | 1 (`scripts/smoke-tests.sh`) | ✅ pass — invoked from `health-check.yml` and `promote-to-production.yml` |
| GitHub Actions workflows | 14 | ✅ pass per KAN-167 audit (loop-closure pending — see follow-ups) |
| Jest config silencers | n/a | ✅ pass — no `bail`, `silent: true`, or `verbose: false` in CI |

**Test count regression guard refreshed:** floor was 16 files / 208 tests (set 2026-03-31); refreshed 2026-05-04 to 21 files / 268 static-grep blocks. **Refreshed again 2026-05-05 (KAN-168 follow-up): now 29 files / 320 static-grep blocks**, current 30 files / 327 grep / 351 Jest. Pattern broadened to include `tests/scripts/` after KAN-163 added the UptimeRobot bootstrap test there. New tests added 2026-05-05: KAN-163 UptimeRobot lib (17), BUGS-11 promote-to-production meta (6), KAN-170 secret-rotation parser (4), KAN-173 release-drift script (6), KAN-156-159 homepage refresh (5 new + 2 updated assertions).

**New static-analysis test added:** `tests/unit/test-meta-integrity.test.js` enforces "every `test()` / `it()` block must contain at least one `expect()` call".

## Static grep findings (raw)

| Check | Pattern | Hits | Action |
|---|---|---|---|
| `.skip` / `.only` / `.todo` / `xtest` / `xit` / `xdescribe` | `(test\|it\|describe)\.(skip\|todo\|only)` and `^\s*(xtest\|xit\|xdescribe)` | 0 | none — clean |
| Trivial `expect(true).toBe(true)` placeholders | `expect\((true\|false\|1\|0)\)\.toBe\(\1\)` | 0 | none — clean |
| Solo `.toBeDefined()` (potential weak assertion) | `expect.*\.toBeDefined\(\)` | 4 | inspected — none are solo (see "Solo toBeDefined audit" below) |
| `try { ... expect ... } catch` (swallowed assertions) | `try\s*\{` in `tests/` | 0 | none — clean |
| Empty test bodies | `(test\|it)\([^,]*,\s*\(\(\)\s*=>\|function\s*\(\)\)\s*\{\s*\}` | 0 | none — clean |
| Jest config silencers | `bail` / `silent` / `verbose: false` in `jest.config.js` | 0 | none — clean |

## Solo `toBeDefined()` audit (4 hits)

All 4 cases have additional, stronger assertions in the same block — none are weak-assertion-only.

| File | Line | Block | Verdict |
|---|---|---|---|
| `tests/unit/profile-actions.test.ts` | 163 | `'exists and is non-empty'` | ✅ also asserts `Array.isArray` and `.length > 0` |
| `tests/unit/mcp-discoverability.test.js` | 32 | `'.well-known/mcp.json exists with valid structure'` | ✅ also asserts `.name`, `.transport`, `.tools` content + length |
| `tests/unit/security-audit.test.js` | 35 | `'scheduled for Wednesday 07:00 UTC'` | ✅ also asserts `cron` value matches `'0 7 * * 3'` |
| `tests/unit/security-audit.test.js` | 40 | `'has workflow_dispatch for manual runs'` | ⚠ borderline — only asserts the key is defined. **Action:** non-blocking; if tightening later, change to `.toEqual({})` or assert structure. |

## New CI safeguards added in this PR

1. `tests/unit/test-meta-integrity.test.js` — scans every other unit test file, parses `test()` / `it()` blocks via balanced-brace traversal, asserts each contains `expect(`. Self-excluded to avoid matching example strings inside its own JSDoc.
2. `tests/unit/test-regression-guard.test.js` refreshed:
    - File-count floor: 21 (was 16) — catches single-file deletion at current 22
    - Test-count floor: 268 (was 200) — catches single-block deletion at current static-count 269

## Smoke test invocation audit

`scripts/smoke-tests.sh` is invoked from:
- `.github/workflows/health-check.yml:18` — `bash scripts/smoke-tests.sh all`
- `.github/workflows/promote-to-production.yml` — invoked indirectly via the smoke-tests job

✅ Not orphaned. The script is real coverage, not just documentation.

## Workflow loop-closure (deferred to a follow-up)

KAN-168 also asks for **end-to-end verification** that the KAN-167 silent-skip fixes truly fail loud when secrets are deliberately broken:

- [ ] Run `backup-platform.yml` with `CLOUDFLARE_API_TOKEN` set to a known-bad value — confirm RED, not green-with-placeholder
- [ ] Run `weekly-report.yml` with `RESEND_API_KEY` removed — confirm RED
- [ ] Feed `pg_dump` a deliberately broken connection string — confirm `supabase-schema.sql` is not a placeholder

**These tests intentionally degrade production-adjacent infrastructure and are deferred to a separate session under explicit operator supervision.** Filed as a follow-up if not done by next quarterly audit.

## lyra-mcp-server CI gap

The `lyra-mcp-server` repo has no `.github/workflows/` directory — Railway auto-deploys from `main` on every push without any CI gate running its 2 existing test files. **This is out of scope of this PR (cross-repo) and is left as a follow-up:** add a minimal `.github/workflows/test.yml` running `npm test` on push and PR.

## Decisions / accepted risk

- **Test count floor uses static grep, not Jest run** — keeps the regression guard fast (no Jest-in-Jest recursion) at the cost of not expanding `test.each([...])` parametrised cases. Static grep counts 269 blocks; Jest reports 290 because of 5 `.each` patterns. The floor at 268 catches block-level deletion, not individual `.each` case removal.
- **Solo `toBeDefined()` at security-audit.test.js:40** is left as-is — the test's intent is "the dispatch trigger key exists at all," and tightening to assert structure could be over-reach. Documented above for future review.
- **Workflow loop-closure tests deferred** — running them requires deliberately breaking production secrets and observing red runs. That's safer in a coordinated session than as part of an automated audit PR.

## Acceptance criteria status

- [x] Audit report committed (this file)
- [x] Every flagged item either fixed in this PR or has a documented decision
- [x] Meta-test "every test has an expect()" added and passing
- [x] Regression guard floors refreshed
- [x] No new test `skip` / `only` / `todo` / `xtest` introduced (verified by static grep at PR time)
- [ ] CI integrity grep check added to `pr-checks.yml` — **deferred** to a follow-up; the new meta-test runs in the unit suite which `pr-checks.yml` already gates on, providing equivalent coverage
- [ ] Mutation-testing scores reviewed — deferred (Stryker runs Sundays; review next Monday's report against the 60% threshold)
- [ ] lyra-mcp-server CI gate — deferred to follow-up (cross-repo)
- [ ] Workflow loop-closure tests — deferred to a coordinated session

## 2026-07 update — Documentation Definition-of-Done gate (KAN-359)

KAN-359 (Phase-4 documentation hygiene, epic KAN-350) adds a **Documentation
Definition-of-Done**: every epic must update the live system map (Architecture &
Infrastructure / Data Model & Security), record ADRs for design decisions, and
cross-link Jira ↔ wiki before it closes; every PR ticks a _"Docs / system map
updated — or N/A with reason"_ checklist item. Gates recorded here:

- **`tests/unit/doc-dod.test.js`** — asserts the DoD is present in
  `docs/RUNBOOK.md`, `CLAUDE.md`, and `.github/PULL_REQUEST_TEMPLATE.md`, so the
  guardrail cannot be silently deleted.
- **PR-template checklist item** — _"Docs / system map updated — or N/A with
  reason"_ (complements the existing ops-routine / Control-Room registry item).
- **`DOC_SYNC_HEALTHCHECK_ROUTINE`** — weekday watcher for doc-sync drift
  (`docs/DOC_SYNC_HEALTHCHECK_ROUTINE.md`).

These are process/documentation gates; they add net-new coverage and do **not**
change any existing test assertion.

## Refs

- KAN-167 (parent — workflow-side false-positive elimination)
- KAN-110 (original regression guard)
- KAN-114 (Playwright E2E expansion — unchanged scope here)
- KAN-359 (Documentation Definition-of-Done gate — added 2026-07-08)

## Addendum — 2026-07-27 (KAN-417)

The KAN-414 modularisation scoping epic re-measured the whole test estate at
`lyra@2f330f1` / `lyra-mcp-server@31c114b` / `lyra-admin-mcp-server@6b8dfb3`:
271 Jest files classified behavioural / convertible-text-scan / structural /
guard, plus the E2E + soak layer (confirmed URL-coupled, resilient to file
moves). Full inventory, path-manifest design, `jest.mock` re-pointing plan and
the F4 sign-off request: `docs/modularisation/KAN-417-test-decoupling.md`
(re-runnable classifier: `docs/modularisation/kan417-classify-tests.mjs`).

---

## Addendum — 2026-08-16 (SEC-46 / SEC-112 / SEC-152 / SEC-153)

Recorded because the KAN-359 Documentation Definition-of-Done requires this doc
to be refreshed when **test gates, floors, or coverage change**, and all three
moved in one day.

**Floor: 3,926 → 4,000 tests (295 → 301 suites).** Net-new coverage, not drift.
The enforced floor is `tests/support/test-floor-baseline.json`, regenerated in
the same commit as each change; the prose line in `CLAUDE.md` was re-measured
against it each time rather than incremented by hand.

| ticket | tests | subject |
|---|---|---|
| SEC-46 Phase C | +10, one suite | RFC 8707 resource binding at `/oauth/authorize` |
| SEC-46 follow-up | +14, one suite | the default resource, as a TABLE over all four deployments |
| SEC-153 / CTL-065 | +9, one suite (+12 in-script `--self-test` cases) | production deploy drift |
| SEC-152 | +4, existing suite | the third UI-ownership trailer |

**Every one of them was mutation-proven**, each mutation asserted to have
actually applied before the suite's verdict was trusted (the KAN-415 D7 lesson:
a replace that silently matches nothing produces a green run indistinguishable
from a green run), and each restore verified byte-exact with `cmp` rather than
by "the tests pass again".

Three observations worth carrying forward, all of them about *test shape*
rather than test count:

1. **A rule that holds on the environment you develop against will look
   correct.** SEC-46's default-resource fallback was right on dev and wrong on
   beta and production. It was caught by enumerating environments, not by
   adding assertions — so its suite is written as a **table over all four
   deployments** rather than a spot check. Reinstating the defect reddens 7 of
   14. Prefer a table wherever a value varies per environment.

2. **A control's help text and its logic drift apart independently.** SEC-152
   needed two mutations, not one: dropping the regex alternative reddens the
   accept case, and removing the trailer from the *help text alone* reddens a
   different one. Telling someone to write a trailer the gate will reject is
   the CTL-042 shape. Where a control prints instructions, assert the
   instructions too.

3. **Check where a hand-rolled harness consumes its failure list.** CTL-065's
   `--self-test` deliberately evaluates its verdict at the end, because SEC-140
   found eight cases appended *after* the `if failures:` check — assertions
   that ran, were never read, and raised the case count while covering nothing.

**Gates added:** CTL-065 (`scripts/check-production-deploy-drift.py`,
registered, wired into `weekly-report.yml`). **Gates widened:**
`check-ui-copy-ownership.sh` accepts a third trailer, with the surface
(`is_protected`) deliberately UNCHANGED; `check-routine-ownership.sh` gained a
marker pinning Section 15b's deferral to the release owner.

**Stated gap:** SEC-151 — the committed schema snapshots can be stale in
dimensions no control measures (nullability, enum membership, view
updatability). Investigated the same day and deliberately **not** built: the
cheap route (extending CTL-048) rests on PostgREST's OpenAPI `required` array,
which is NOT a NOT NULL list. Reasoning and the two sound alternatives are on
the ticket.

---

## Addendum — 2026-08-21 (KAN-356 §C — source-scan inventory, CTL-077)

**What changed.** KAN-356 finding **web-tests-06** — *"the suite mixes
source-grep tests with behavioural ones without distinction"* — is now
bounded by a gate. `scripts/check-source-scan-inventory.py` (**CTL-077**, in
`pr-checks.yml`) ratchets, per test file, the number of assertion blocks that
read source text where a positive runtime assertion was available instead.

**Landed measurement: 143 files / 328 convertible blocks**, recorded in
`tests/support/source-scan-inventory-baseline.json`.

| gate | +tests | suites | what it pins |
| --- | --- | --- | --- |
| KAN-356 / CTL-077 | +16, one suite (`tests/scripts/check-source-scan-inventory.test.js`) | 309 → 310 | source-text scanning may not grow, and may not silently improve either |

Measured on this branch off `develop` `087ffcc`: **4193 tests / 310 suites**,
against a base of 4177 / 309 — so the +16 / +1 is arithmetic on two readings,
not an estimate. The generated floor moved 3585 → 3601 blocks.

### Three things worth keeping from building it

1. **It reuses the classifier rather than restating it.**
   `scripts/triage-source-text-tests.py` (KAN-414 F4) already bucketed every
   `readFileSync`-backed assertion — and it was **triage**: it printed a report,
   nothing invoked it, so the number could only go up. A measurement nobody is
   accountable to is a number, not a control. The gate imports that module. A
   second copy of the bucket regexes would drift, and a control that
   reimplemented the classifier it polices would be the **CTL-038** defect
   wearing the badge of the guard against it. The two agree by construction:
   the gate's 328 is the triage headline's 328.

2. **Only the convertible bucket is counted, and that is the design.**
   Structural scans — `absence`, `existence`, `migration`, `surface`,
   `ordering`, `copy-pin` — cannot be observed by a running program, so
   "converting" one produces a test that looks more modern and proves less.
   Counting all 523 blocks would have made the ratchet unpayable, and an
   unpayable ratchet is one somebody turns off. Repointing `COUNTED_BUCKET` at
   a structural bucket reddens 142 files, which is the evidence the choice is
   load-bearing rather than cosmetic.

3. **Keyed per file, and two-way.** An aggregate lets one file improve while
   another regresses and nets out green — the blindness CTL-055 carried before
   its ESCALATED case. And an improved-but-still-baselined count fails as
   **STALE**, so the win is locked in rather than left as headroom for the next
   regression. That second half is the one people forget to build; it is also
   what caught this change's own floor staleness (309 → 310) on the run that
   added it.

**Mutation-proven eight ways** — NEW on a real file, STALE on an annotated one,
fail-closed (exit 2) both when the classifier is unreachable and when the
corpus is empty, an inverted self-test expectation reddening the self-test
(proving its verdict is *read* — SEC-140, catalogue failure mode 9), the
bucket repoint above, and two jest-visible mutations (deleting the STALE half,
and making the missing-baseline path return 0) each reddening 3 cases.

⚠️ **One harness bug in the new suite is worth recording, because it passed.**
The sandbox cases originally invoked the *real* script with a sandbox `cwd`;
the script derives its repo root from its own location, so every sandbox
assertion was quietly measuring `develop` instead of the fixture. Seven cases
went green for the wrong reason (catalogue failure mode 6). The gate is now
invoked from its sandbox copy, and mutations M7/M8 exist specifically to prove
the sandbox cases can still fail.

**Stated gap — the second half of criterion 6 is NOT built.** CTL-077 bounds
the *quantity* of source-text scanning. It does not require a behavioural
assertion to exist alongside a source scan on critical surfaces (auth,
age-gate, publish, suspension, ownership). That remains open on KAN-356, as do
legs **A** (runtime cross-user isolation in `lyra-mcp-server`), **B** (Stryker
scope + a measured `thresholds.break`) and **D** (the authenticated E2E
journey).
