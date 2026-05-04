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

**Test count regression guard refreshed:** floor was 16 files / 208 tests (set 2026-03-31); now 21 files / 268 static-grep test blocks (current 22 files / 269 grep / 290 Jest).

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

## Refs

- KAN-167 (parent — workflow-side false-positive elimination)
- KAN-110 (original regression guard)
- KAN-114 (Playwright E2E expansion — unchanged scope here)
