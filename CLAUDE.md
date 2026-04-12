# CLAUDE.md — Project Instructions for Claude

This file contains instructions and policies that Claude must follow when working on this repository.

## Pre-Work Checklist

Before starting any task, Claude must:

1. **Check Jira** — confirm a ticket exists for the work, or create one. Never start work without a tracked ticket.
2. **Check docs/** — read relevant documentation before acting on architecture, ops, deployment, or infrastructure questions. Key docs: ARCHITECTURE.md, RUNBOOK.md, JIRA_TICKET_STANDARD.md, SECURITY_ROTATION.md.
3. **Check for existing work** — search the codebase and recent PRs to avoid duplicating effort.
4. **Run tests before and after** — every change must leave tests green.

## Jira Ticket Standard

All work must be tracked in Jira. KAN project for design/deployment, BUGS project for bug tracking.

Every KAN Task/Story description MUST include all six sections:
1. **What & Why**
2. **Implementation steps**
3. **Tests Required** — unit, functional, E2E: what to test, mocks, edge cases
4. **Security Review** — threats introduced, RLS/auth impact, input validation
5. **Architecture Impact** — docs/env vars/dependencies to update
6. **Acceptance Criteria**

Large tasks must be broken into subtasks with one concern per ticket. When picking up older tickets that predate this standard, add the missing sections before starting work.

Full details: `docs/JIRA_TICKET_STANDARD.md`

## Deployment Pipeline

The pipeline is: **develop → staging → main** (promotion-based).

- All feature work goes to `develop` via PR
- Promotion to staging: `gh workflow run promote-to-staging.yml -f confirm=promote`
- Promotion to production: `gh workflow run promote-to-production.yml -f confirm=PRODUCTION`
- **Never push directly to staging or main**
- All environments must be kept in sync
- Commit and push only after verifying code compiles and tests pass

## Testing Requirements

- All deployments to dev must pass unit and build tests
- New features must have unit and functional tests in the same PR/commit — never defer to a separate ticket
- E2E functional testing must be built as new features are created
- Claude must actively look for missing coverage and flag it
- Current test floor: **254 tests** (20 suites) in lyra, **64 tests** (2 suites) in lyra-mcp-server

## Test Integrity Policy

Tests are the safety net. Claude must NEVER modify, weaken, skip, or delete any existing unit, smoke, or E2E test to make it pass. Tests exist to catch real problems — a failing test means the code is wrong, not the test.

### When a test fails, Claude must:

1. **STOP** — do not modify the test
2. **Investigate the root cause** — is it a code bug, a missing dependency, an environment issue, or a genuine content change?
3. **Report the failure** to the user with:
   - Which test(s) failed
   - The exact error message
   - Claude's assessment of the root cause
   - Whether Claude believes the test or the code is wrong, and why
4. **Wait for explicit sign-off** before making any changes

### What requires manual sign-off:

- Changing any assertion (expected values, matchers, thresholds)
- Deleting or skipping a test (`test.skip`, `.only`, commenting out)
- Changing test selectors or locators (CSS selectors, text matchers, aria labels)
- Weakening a test (e.g. changing `toBe` to `toContain`, `toBeVisible` to `toBeAttached`, exact match to regex)
- Removing a test file
- Changing the test environment or configuration (jest.config, playwright.config) in ways that affect test behaviour

### What Claude CAN do without sign-off:

- Fix the application code so the existing test passes as-is
- Add new tests (net new coverage is always welcome)
- Fix test infrastructure that doesn't change assertions (e.g. installing a missing dependency, adding a mock for a new import)

### Process for intentional content changes:

When Claude is deliberately changing site content (e.g. updating a tagline, adding a page), it must:

1. Make the code change
2. Run the tests — they will fail because the content changed
3. List every failing test with the old expected value and the new value
4. Ask for sign-off: "These N tests need updating because the content intentionally changed. May I update them?"
5. Only update the tests after receiving explicit approval

This policy applies to all test types: unit (Jest), E2E (Playwright), smoke, integration, and any future test suites.

## Known Technical Gotchas

These have caused real bugs. Read before making related changes:

1. **Promotion workflow chicken-and-egg**: Workflow file changes must be on `main` before they take effect on subsequent promotion runs. If you change a workflow file on develop, it won't take effect until it reaches main — may need a manual merge.

2. **Vercel branch scoping**: The `develop` branch deploys as a Preview environment. Variables must be scoped via CLI (`vercel env add [VAR] preview develop`) — the dashboard UI cannot scope to a specific branch.

3. **GitHub Actions `gh run list` caching**: Recently completed runs may not appear. Use `gh api "repos/{repo}/actions/workflows/{name}/runs?branch={branch}&status=completed&per_page=1"` with retries instead.

4. **Supabase Storage RLS**: Buckets must be created via SQL (`INSERT INTO storage.buckets`), then RLS policies applied via `apply_migration`. Use `storage.foldername(name)[1]` for per-user folder enforcement.

5. **ESLint `no-explicit-any`**: Use `unknown[]` not `any[]` in test files.

6. **Next.js route group conflicts**: Creating `src/app/privacy/page.tsx` alongside `src/app/(legal)/privacy/page.tsx` causes Turbopack duplicate route errors. Don't create parallel routes outside and inside a route group.

7. **Cloudflare 403 from CI**: GitHub Actions runner IPs are blocked by Cloudflare bot protection. All smoke tests must accept 403 as valid alongside expected status codes.

8. **R2 object lock on re-runs**: Same-day backup re-runs fail with ObjectLockedByBucketPolicy. Use timestamp-based paths (YYYY-MM-DDTHHMMSSZ) not date-only paths.

9. **Supabase CLI not used**: SQL migrations must always be provided as actual file contents — never as a filename or path. Use the Supabase MCP `apply_migration` tool or SQL Editor.

10. **Jira response parsing**: The actual issues array is inside a `text` field containing a JSON string — requires `json.loads(data[0]['text'])`, not direct dict access.

## Supabase Migration Rules

- Always test migrations on dev first, then staging, then production
- Supabase project IDs and connection strings are in environment variables, not hardcoded
- Use `apply_migration` MCP tool with the migration SQL as the `query` parameter
- Never use destructive migrations (DROP TABLE, DROP COLUMN) without explicit sign-off
- Always include rollback SQL in the migration comment or ticket

## Environment Reference

See `docs/ARCHITECTURE.md` for the full environment table. Three environments: dev, staging, production — each with independent Supabase projects, Vercel deployments, and DNS entries.

## Scheduled Workflows

See `docs/RUNBOOK.md` for the full schedule. Key times (UTC):
- Sunday 02:00 — Database backup
- Sunday 02:30 — Platform backup (repos, DNS, schema to R2)
- Sunday 04:00 — Stryker mutation testing
- Sunday 05:00 — Backup restore test
- Monday 07:00 — Weekly report (emails via Resend)
- Wednesday 07:00 — Security audit (npm audit + email alerts via Resend)
