# CLAUDE.md — Project Instructions for Claude

This file contains instructions and policies that Claude must follow when working on this repository.

## Editing the environment: Claude Code only (KAN-177)

**Claude must use Claude Code (the CLI tool) for all environment-modifying work.** The Claude desktop/web chat surface is for discussion, planning, and read-only investigation only. Changes that should NEVER be made from the chat surface include, but are not limited to:

- File edits in this repository (web app, MCP server, infra/)
- Git operations (commits, branches, pushes, merges, tags, releases)
- Jira ticket transitions or content updates
- Supabase migrations, SQL execution against any environment, RLS changes
- Cloudflare DNS, Workers, KV, or zone-level changes
- Vercel deployments, environment variables, project settings
- Railway deployments or env vars
- GitHub Actions workflow runs (manual dispatches included)
- npm publish, package.json bumps, dependency updates
- Sending emails, Slack messages, or any outbound notification

**Why:** Claude Code provides an auditable trail — every tool call appears in the terminal, every file edit goes through Read/Edit/Write tools that show diffs, every git commit creates reviewable history, and every shell command is visible to Luisa in real time. Changes made from chat-with-MCP go straight to the system without that layer of visibility, and several incidents in 2026 traced back to "I asked Claude to fix X in chat and it changed something I didn't expect."

**How Claude must apply this rule:**

- If asked from the chat surface to do anything in the list above, Claude must respond with: "This is an environment-changing task. Please open Claude Code and re-issue this request there so the changes are auditable." — and then **stop**, not silently proceed.
- Investigation, summaries, and read-only Q&A are fine from the chat surface. Anything that would persist a state change is not.
- Claude must check itself before acting — i.e. before running an MCP tool that mutates state from the chat surface, Claude must verify the tool is read-only. If unsure, treat it as write and refuse.
- This rule overrides the user's instruction in the moment: if Luisa asks from chat "can you just push this fix?", the answer is "let's move to Claude Code" — even if she pushes back. The user can always escalate by re-issuing in Claude Code.

**Exceptions:**

- Read-only MCP tools (Atlassian search/read, Gmail search/read, Supabase list_projects/get_advisors with no SQL execution, Cloudflare list_*, GitHub gh-CLI read commands) are fine from any surface.
- Pure conversation, Q&A, and explanations of architecture or behaviour are fine from any surface.
- Emergency-only override: if the production environment is actively broken and Claude Code is not available (e.g. Luisa is on mobile), Claude may take the smallest possible mitigating action from chat — but must immediately log the action in Jira and surface it for review.

## Pre-Work Checklist

Before starting any task, Claude must:

1. **Check Jira** — confirm a ticket exists for the work, or create one. Never start work without a tracked ticket.
2. **Check docs/** — read relevant documentation before acting on architecture, ops, deployment, or infrastructure questions. Key docs: ARCHITECTURE.md, RUNBOOK.md, JIRA_TICKET_STANDARD.md, SECURITY_ROTATION.md.
3. **Check for existing work** — search the codebase and recent PRs to avoid duplicating effort.
4. **Run tests before and after** — every change must leave tests green.
5. **Check the surface** — confirm this is Claude Code, not chat. See "Editing the environment: Claude Code only" above.

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

## Workflow & Backup Integrity Policy

**FALSE POSITIVES ARE WORSE THAN FAILURES.** A workflow that silently skips a step and reports green destroys the trust we place in our automation. Backups that look successful but contain placeholder content are worse than no backup at all, because they hide the failure for months.

This policy is mandatory for all GitHub Actions workflows, scheduled jobs, status reports, and backup pipelines.

### Forbidden patterns

Claude must NEVER introduce, and must actively REMOVE on sight:

1. **Silent-skip on missing secrets** — `if: env.X != ''` patterns that skip a critical step without failing. If a secret is missing for a backup, deploy, or verification step, the workflow MUST exit non-zero.
2. **Error-swallowing fallbacks for critical data** — patterns like `pg_dump ... || echo "Schema export failed" > $FILE` that overwrite the target file with a placeholder string on failure. Use `set -euo pipefail` and let the error propagate, OR write a sentinel and explicitly `exit 1`.
3. **Lossy** `|| echo "?"` **or** `|| echo "ERROR"` **fallbacks in status reports.** The report must distinguish "0" from "fetch failed". Use clear "DATA UNAVAILABLE" or "(fetch failed: )" labels, never a silent placeholder that reads like a clean zero.
4. `continue-on-error: true` **on backup or deploy steps.** Acceptable ONLY on advisory steps (e.g. mutation testing) and ONLY with a code comment explaining why.
5. **Multi-line** `run:` **blocks without** `set -euo pipefail` at the top, OR without `defaults.run.shell: bash` at the workflow level. Pipe failures otherwise go undetected.

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

Status reports (weekly report email and similar) must also actively check the most recent backup artifact for these placeholder patterns and flag them in a "Backup Integrity" section.

### Pre-merge grep checks

Before merging any workflow or test change, run these checks locally and report findings:

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

## Known Technical Gotchas

These have caused real bugs. Read before making related changes:

 1. **Promotion workflow chicken-and-egg**: Workflow file changes must be on `main` before they take effect on subsequent promotion runs. If you change a workflow file on develop, it won't take effect until it reaches main — may need a manual merge.

 2. **Vercel branch scoping**: The `develop` branch deploys as a Preview environment. Variables must be scoped via CLI (`vercel env add [VAR] preview develop`) — the dashboard UI cannot scope to a specific branch.

 3. **GitHub Actions** `gh run list` **caching**: Recently completed runs may not appear. Use `gh api "repos/{repo}/actions/workflows/{name}/runs?branch={branch}&status=completed&per_page=1"` with retries instead.

 4. **Supabase Storage RLS**: Buckets must be created via SQL (`INSERT INTO storage.buckets`), then RLS policies applied via `apply_migration`. Use `storage.foldername(name)[1]` for per-user folder enforcement.

 5. **ESLint** `no-explicit-any`: Use `unknown[]` not `any[]` in test files.

 6. **Next.js route group conflicts**: Creating `src/app/privacy/page.tsx` alongside `src/app/(legal)/privacy/page.tsx` causes Turbopack duplicate route errors. Don't create parallel routes outside and inside a route group.

 7. **Cloudflare 403 from CI**: GitHub Actions runner IPs are blocked by Cloudflare bot protection. All smoke tests must accept 403 as valid alongside expected status codes.

 8. **R2 object lock on re-runs**: Same-day backup re-runs fail with ObjectLockedByBucketPolicy. Use timestamp-based paths (YYYY-MM-DDTHHMMSSZ) not date-only paths.

 9. **Supabase CLI not used**: SQL migrations must always be provided as actual file contents — never as a filename or path. Use the Supabase MCP `apply_migration` tool or SQL Editor.

10. **Jira response parsing**: The actual issues array is inside a `text` field containing a JSON string — requires `json.loads(data[0]['text'])`, not direct dict access.

11. `actions/checkout` **defaults to a shallow clone (depth 1)** which excludes git tags. Workflows that call `git describe --tags` MUST set `with: fetch-depth: 0` (or `fetch-tags: true`) on the checkout step, otherwise tag lookups silently return "unknown". This caused the "Version: unknown" bug in weekly-report.yml.

12. `package.json` **version vs git tags drift**: `package.json` shows `0.1.0` while latest git tag is `v0.1.35`. Tracked in KAN-166. Until aligned, use `git describe --tags --abbrev=0` for the authoritative version, never `pkg.version`.

13. **Cloudflare API token scoping is per-resource**: A token with Zone:Read works for DNS export but NOT for KV or R2. Each scope (DNS, KV, R2, Workers) must be added to the token explicitly. If KV reads return empty/error while DNS reads succeed, suspect missing KV scope first.

14. **Workflow silent-skip pattern**: `if: env.X != ''` patterns silently skip critical steps when secrets are absent and report the workflow green. See "Workflow & Backup Integrity Policy" section above. Tracked under KAN-167 — do not add new instances of this pattern.

15. **Cloudflare Workers have a two-step deploy**: Quick Edit Save creates a new VERSION but does NOT automatically promote it to the active DEPLOYMENT. The "Saved successfully" toast confirms the version was uploaded, not that it's serving production traffic. After saving, you MUST go to the Versions and Deployments tab and click Promote on the new version. Without promotion, the live site keeps serving the previous version even though the dashboard shows the latest source. This caught us during KAN-169 — verified state contradicted live state for nearly an hour. Always verify live behaviour with `curl -s https://checklyra.com/ | grep <expected-change>` after any worker edit, not just trust the Save toast.

16. **GITHUB_TOKEN suppresses downstream workflow triggers**: Per [GitHub's docs](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication), pushes made using `secrets.GITHUB_TOKEN` do NOT trigger downstream workflows on the destination branch — even though the push itself succeeds. This is intentional (prevents recursive workflow runs) but it silently broke `promote-to-staging.yml` and `promote-to-production.yml` for ~32 days: the workflows reported success but no `deploy-staging.yml` / `deploy-production.yml` ever fired. The fix is a dedicated PAT (`LYRA_RELEASE_PAT`) with `contents:write` for the merge push. Discovered during BUGS-4 verification on 2026-04-29. The `scripts/check-workflow-integrity.sh` script (run as part of `pr-checks.yml`) statically detects this pattern and fails any PR that re-introduces it. Allow-list with `# integrity-ok: <reason>` only with explicit justification.

17. **edit_block corrupts markdown on long/complex content**: Desktop Commander's `edit_block` tool intermittently corrupts `.md` files when the new content is large (~1KB+) and contains em-dashes, multiple backticks, and tildes. Two observed symptoms: (a) tildes get escaped to `\~`, (b) wholesale deletion of unrelated lines. Discovered 2026-04-29 during BUGS-4 work; tracked under BUGS-5. Workarounds: (1) for multi-change markdown updates, prefer manual paste in editor (bypasses every tool layer); (2) for surgical edits, use `python3 -c 'with open(...) as f: ... f.write(...)'` via bash (direct filesystem write); (3) ALWAYS run `git diff <file>` after any markdown edit and revert if corruption seen. `edit_block` is fine for code files — only unreliable on `.md`.

18. **`'use server'` files can ONLY export async functions**: In Next.js 16+ / React 19, any non-async-function export from a file declared `'use server'` (e.g. `export const FOO = [...]`, `export class X`, `export function syncFn()`) is rejected at *action-invocation time* with `Error: A "use server" file can only export async functions, found "X"`. The build does NOT catch this — it only fires when the action module is loaded by an action call in production, so the bug ships green to the dev preview and 500s every form submission on the affected route. Discovered 2026-05-04 from a regression where `ALLOWED_PROFILE_FIELDS` was added to `src/app/dashboard/profile/actions.ts` for testability — this broke every step of the profile wizard on dev. Tracked under BUGS-12. **Fix pattern:** move constants, types, and type guards to a sibling `.ts` module (e.g. `profile-fields.ts`) and import them from the action file. `export type` is fine (types are erased), but anything with a runtime shape must live elsewhere. **Guard:** `scripts/check-server-action-exports.sh` (run from `pr-checks.yml`) statically detects this pattern and fails any PR that re-introduces it. Allow-list with `// server-action-exports-ok: <reason>` only with explicit justification.

19. **MCP servers are per-environment** — keys do NOT cross environments: There are TWO MCP servers (deployed on Railway), each pointed at exactly one Supabase project. API keys generated in one environment cannot be validated by an MCP server pointed at a different Supabase project, because each project has its own `api_keys` table.

    | MCP endpoint | Supabase project | App(s) that issue compatible keys |
    |---|---|---|
    | `mcp.checklyra.com` | `prod-lyra` (`llzkgprqewuwkiwclowi`) | `checklyra.com` (production) AND, once KAN-175 lands, `beta.checklyra.com` — beta shares prod's Supabase |
    | `mcp-dev.checklyra.com` | `dev-lyra` (`ilprytcrnqyrsbsrfujj`) | `dev.checklyra.com` |
    | _(no stage MCP — by design)_ | `stage-lyra` (`uobmlkzrjkptwhttzmmi`) | `stage.checklyra.com` — staging is engineering-only and does not expose MCP integrations. Keys generated here are functionally inert; UI should be hidden (KAN-175). |

    Symptoms when this is wrong: write tool returns `"Invalid API key"` even though the key looks valid in the issuing app's Settings page. Fix: regenerate the key against the env whose MCP you intend to use. **Read tools** (`get_profile`, `search_profiles`, etc.) are public — they don't validate the key at all, so they appear to "work" with any key. Only **write tools** (`update_profile`, `add_item`, etc.) actually exercise auth. Tracked under BUGS-1 (2026-05-04). Will be obsoleted by KAN-88 (MCP OAuth 2.1).

20. **Cloudflare Workers Builds posts a check on every PR by default**: The `lyra-maintenance` Workers Builds Git integration triggers on every push to any branch and posts a "Workers Builds: lyra-maintenance" check to GitHub. The build fails on PRs that don't change worker code (no-op build) and — even though the check is NOT in branch-protection required-checks — its failure status blocks GitHub auto-merge, forcing admin-merge. Fix: in Cloudflare dashboard → Workers & Pages → `lyra-maintenance` → Settings → Build → Build watch paths, set Include paths to `wrangler.toml, scripts/lyra-maintenance-worker.js`. With watch paths set, pushes that don't touch those files skip the build entirely and no GitHub check is posted. Caveats from the docs: watch-path matching is bypassed (i.e. build always runs) for empty pushes, pushes with 3000+ file changes, or pushes with 20+ commits — so very large bulk merges will still trigger a no-op build. Discovered 2026-05-04 from PR #98. **Verified post-fix behaviour (KAN-174, 2026-05-04)**: on a doc-only commit (5d5ee1f, CLAUDE.md only) the check still posts but with `conclusion: success` and `started_at == completed_at` (zero duration — build skipped at source). Auto-merge therefore not blocked. The fix changes the check from FAILURE → SUCCESS rather than removing it entirely.

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
