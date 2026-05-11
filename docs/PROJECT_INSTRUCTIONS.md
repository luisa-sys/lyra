# Project Instructions (Claude.ai Project Knowledge — Mirror)

> **What this is:** This file mirrors the `lyra.md` Project knowledge file in the Lyra Claude.ai Project. The Project knowledge file is the canonical source — Claude reads it at the start of every chat in the Lyra Project. This repo copy exists so the instructions are version-controlled, reviewable, and recoverable.
>
> **When to update:** When `lyra.md` in the Claude.ai Project changes, update this file to match (or vice versa). The two should never drift.
>
> **Last synced:** 2026-04-25

---

## Claude Surface Policy — Code vs Chat (KAN-177)

**Claude must use Claude Code (the CLI tool) for all environment-modifying work.** The Claude desktop/web chat surface is for discussion, planning, and read-only investigation only. Anything that persists a state change — file edits, git operations, Jira transitions, Supabase migrations, Cloudflare/Vercel/Railway changes, GitHub Actions dispatches, npm operations, sending notifications — must happen in Claude Code so that diffs, terminal history, and git commits provide an audit trail.

When asked from chat to do anything state-changing, Claude must respond: "This is an environment-changing task. Please open Claude Code and re-issue this request there so the changes are auditable." — and **stop**, not silently proceed. Even if pushed back on. The friction is the point.

Read-only operations (Atlassian search/read, Gmail search/read, Cloudflare list_*, Supabase list/get_advisors, GitHub `gh` reads) and pure conversation are fine in chat. Full rules + exceptions in `docs/CLAUDE_SURFACE_POLICY.md`.

**Self-check before invoking any MCP tool from chat:** is it read-only? If unsure, treat as write and refuse.

---

All deployments to dev must pass unit and build tests. New features must have unit and functional tests created and running in the CI/CD pipeline. End-to-end functional testing must be built as new features are created. Any missing test coverage must be added as we go along — Claude must actively look for missing coverage. Check all available skills including in /mnt/user-data/outputs/ before acting. All to-do and in-progress items must be recorded in Jira — KAN project for design and deployment, BUGS project for bug tracking. Claude must create or confirm a Jira ticket exists before starting work on any task. Before starting any actions check the Jira board to avoid duplication of effort and to ensure that the plan is executed consistently.

Key reference documents live in the GitHub repo at github.com/luisa-sys/lyra under the docs/ folder on the develop branch. Before answering architecture, operations, deployment, MCP directory, or connector questions, always check the repo's docs/ folder via Desktop Commander (/Users/admin/Documents/2026 Lyra/lyra/docs/) or GitHub MCP for the latest versions. Current docs: ARCHITECTURE.md, RUNBOOK.md, MCP_DIRECTORY_REGISTRATION.md, MCP_CONNECTOR_ECOSYSTEM.md, DESIGNER_HANDOVER_AUDIT.md, JIRA_TICKET_STANDARD.md. The lyra-project-reference_2.jsx artifact in this project contains all live URLs, dashboard links, and environment IDs. The Lyra Platform Architecture Reference artifact is the canonical technical architecture document — update it when architecture changes.

Jira ticket standard (docs/JIRA_TICKET_STANDARD.md) — every KAN Task/Story description MUST include: (1) What & Why, (2) Implementation steps, (3) Tests Required (unit, functional, E2E — what to test, mocks, edge cases), (4) Security Review (threats introduced, RLS/auth impact, input validation), (5) Architecture Impact (docs/env vars/dependencies to update), (6) Acceptance Criteria. Large tasks must be broken into subtasks with one concern per ticket. Claude must not create tickets missing tests or security sections. When picking up older tickets that predate this standard, add the missing sections before starting work.

## Test Integrity Policy

Tests are the safety net. Claude must NEVER modify, weaken, skip, or delete any existing unit, smoke, or E2E test to make it pass. Tests exist to catch real problems — a failing test means the code is wrong, not the test.

When a test fails, Claude must:

1. STOP — do not modify the test
2. Investigate the root cause — is it a code bug, a missing dependency, an environment issue, or a genuine content change?
3. Report the failure to the user with:
   - Which test(s) failed
   - The exact error message
   - Claude's assessment of the root cause
   - Whether Claude believes the test or the code is wrong, and why
4. Wait for explicit sign-off before making any changes

What requires manual sign-off:

- Changing any assertion (expected values, matchers, thresholds)
- Deleting or skipping a test (test.skip, .only, commenting out)
- Changing test selectors or locators (CSS selectors, text matchers, aria labels)
- Weakening a test (e.g. changing toBe to toContain, toBeVisible to toBeAttached, exact match to regex)
- Removing a test file
- Changing the test environment or configuration (jest.config, playwright.config) in ways that affect test behaviour

What Claude CAN do without sign-off:

- Fix the application code so the existing test passes as-is
- Add new tests (net new coverage is always welcome)
- Fix test infrastructure that doesn't change assertions (e.g. installing a missing dependency, adding a mock for a new import)

Process for intentional content changes:

When Claude is deliberately changing site content (e.g. updating a tagline, adding a page), it must:

1. Make the code change
2. Run the tests — they will fail because the content changed
3. List every failing test with the old expected value and the new value
4. Ask for sign-off: "These N tests need updating because the content intentionally changed. May I update them?"
5. Only update the tests after receiving explicit approval

This policy applies to all test types: unit (Jest), E2E (Playwright), smoke, integration, and any future test suites.

## Workflow & Backup Integrity Policy

FALSE POSITIVES ARE WORSE THAN FAILURES. A workflow that silently skips a step and reports green destroys the trust we place in our automation. Backups that look successful but contain placeholder content are worse than no backup at all, because they hide the failure for months.

This policy is mandatory for all GitHub Actions workflows, scheduled jobs, status reports, and backup pipelines.

### Forbidden patterns

Claude must NEVER introduce, and must actively REMOVE on sight:

1. Silent-skip on missing secrets — `if: env.X != ''` patterns that skip a critical step without failing. If a secret is missing for a backup, deploy, or verification step, the workflow MUST exit non-zero.

2. Error-swallowing fallbacks for critical data — patterns like `pg_dump ... || echo "Schema export failed" > $FILE` that overwrite the target file with a placeholder string on failure. Use `set -euo pipefail` and let the error propagate, OR write a sentinel and explicitly `exit 1`.

3. Lossy `|| echo "?"` or `|| echo "ERROR"` fallbacks in status reports. The report must distinguish "0" from "fetch failed". Use clear "DATA UNAVAILABLE" or "(fetch failed: <reason>)" labels, never a silent placeholder that reads like a clean zero.

4. `continue-on-error: true` on backup or deploy steps. Acceptable ONLY on advisory steps (e.g. mutation testing) and ONLY with a code comment explaining why.

5. Multi-line `run:` blocks without `set -euo pipefail` at the top, OR without `defaults.run.shell: bash` at the workflow level. Pipe failures otherwise go undetected.

### Required patterns

Every multi-line shell block in a GitHub Actions workflow must:

1. Start with `set -euo pipefail` so any failed command halts execution.
2. Validate critical outputs before declaring success — a SQL dump must start with `--` and contain `CREATE TABLE`; a JSON API response must have `success: true` and a non-empty `result`.
3. Use GitHub's `::error::` and `::warning::` annotations on failure paths so the failure is surfaced in the run summary, not buried in logs.

### Backup integrity requirements

Every backup workflow must include a final "verify integrity" step that fails the workflow if:

- A SQL dump file does not begin with `--` (PostgreSQL comment header)
- A SQL dump contains zero `CREATE` statements
- A SQL dump is suspiciously short (less than 50 lines for the full schema)
- A JSON export does not parse, has `success: false`, or has zero records when records are expected
- A secrets-list export contains the literal string "(failed to fetch)"

### Status reports must surface failed fetches

Status reports (weekly report email and similar) must actively check the most recent backup artifact for placeholder patterns and flag them in a "Backup Integrity" section. Reports must distinguish between:

- A real zero ("0 alerts open today")
- A failed fetch ("DATA UNAVAILABLE — Dependabot API returned 403")

A "?" or "unknown" placeholder is forbidden. If a fetch fails, say so explicitly.

### Pre-merge grep checks for Claude

Before merging any workflow or test change, Claude must run these checks and report findings:

```bash
# Tests that silently skip
grep -rn -E "(test|it|describe)\.(skip|todo|only)" tests/ src/
grep -rn -E "\b(xtest|xit|xdescribe)\b" tests/ src/

# Empty test bodies
grep -rn -E "(test|it)\([^,]*,\s*(\(\)\s*=>|function\s*\(\))\s*\{\s*\}" tests/ src/

# Workflow silent-skip patterns
grep -rn -E "if:.*env\..*!=\s*''" .github/workflows/
grep -rn -E '\|\|\s*echo\s*"' .github/workflows/
grep -rn -E "continue-on-error:\s*true" .github/workflows/
```

If any match, justify it in a code comment or remove it.

### When investigating "all green" status reports

Never trust a green workflow run on its own. To verify a backup was real:

1. Download the most recent artifact: `gh run download <run-id>`
2. Verify each file is not a placeholder:
   - SQL: `head -c 100 <file>.sql` — must be SQL, not the string "Schema export failed"
   - JSON: parse and assert `success: true` and `len(result) > 0`
   - Text lists: `grep -c "(failed to fetch)" <file>.txt` must be 0
3. If any check fails, file a bug at Highest priority and treat the prior backups as suspect until investigated.

This is policy, not a suggestion. Tracked under KAN-167.

## Status Report Verification (Monday review)

The weekly report email arrives Monday 07:00 UTC from reports@checklyra.com. Claude treats it as a starting point, not as ground truth. When asked "show me this week's Lyra status" or similar:

1. Fetch the most recent weekly report email via Gmail MCP (search: from:reports@checklyra.com newer_than:14d)
2. Parse all sections — note any "?", "unknown", "ERROR", or "DATA UNAVAILABLE" markers as data-quality issues, not as zeros
3. If the report references a backup workflow as "1/1 passed", do NOT treat that as proof the backup is real. Cross-check by inspecting the latest backup-platform artifact:
   - `gh run list --workflow=backup-platform.yml --limit 1 --json databaseId`
   - `gh run download <id>` and verify SQL dump starts with "--" and contains CREATE TABLE
   - Verify cloudflare-dns.json has success:true and >0 records
   - Verify github-secrets-list.txt does NOT contain "(failed to fetch)"
4. Cross-reference any failures against the open Jira backlog (KAN + BUGS) — file new tickets for any uncovered issues
5. Surface the findings clearly to Luisa with priority recommendations

This procedure is mandatory because the weekly report itself has historically had silent-skip and lossy-fallback bugs (tracked in KAN-162 and KAN-167). Until KAN-167 is fully delivered, "all green" cannot be trusted.

## Authoritative version source

Use `git describe --tags --abbrev=0` for the current Lyra version. Do NOT use package.json — it has drifted from the tags (currently shows 0.1.0 while tags are at v0.1.35+). Tracked in KAN-166.
