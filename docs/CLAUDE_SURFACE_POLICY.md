# Claude Surface Policy — Code vs Chat (KAN-177)

> Claude Code is the auditable surface. Claude chat is the discussion surface. Anything that changes state must happen in Claude Code.

## The rule

**Claude must use Claude Code (the CLI tool) for all environment-modifying work.** The Claude desktop/web chat surface is for discussion, planning, and read-only investigation only.

## Why

Several 2026 incidents traced back to one pattern: "I asked Claude in chat to fix X, and it changed something I didn't expect." The chat surface bundles many MCP tools (Supabase, Cloudflare, Atlassian, Gmail, Vercel) that can mutate state — but the changes happen out-of-sight, with no diff to review, no terminal history to scroll back through, and no git commit trail.

Claude Code, by contrast:

- Routes every file edit through Read/Edit/Write tools that show diffs and require explicit content
- Routes every shell command through a visible Bash tool with exit codes
- Creates auditable git history (commits, branches, PRs) for every code change
- Shows every tool call in the terminal in real time, so Luisa sees what's happening as it happens
- Can be paused or interrupted between tool calls

That visibility is the difference between "Claude did something I'll see in a PR" and "Claude did something that's now part of production state."

## What requires Claude Code

Non-exhaustive list of state-changing actions that must happen in Claude Code, never in chat:

| Surface | Action | Why it must be in Code |
| --- | --- | --- |
| Repo | File edits in `lyra` or `lyra-mcp-server` | Diff visibility + git history |
| Repo | Git operations (commit, branch, push, merge, tag, release) | Reviewable trail |
| Jira | Ticket transitions (To Do → In Progress → Done) | Documented in ticket comments by Claude Code |
| Jira | Content updates to ticket descriptions | Same as above |
| Supabase | SQL migrations, RLS changes, table creates/drops | Migration file lives in repo, not in cloud |
| Supabase | `execute_sql` with INSERT/UPDATE/DELETE | All writes need a migration file or ticket trail |
| Cloudflare | DNS changes, Workers deploys, KV writes | Zone-level changes need explicit user approval per change |
| Vercel | Env vars, project settings, deployments | Reproducible via repo + workflow |
| Railway | Env vars, deploys | Same as Vercel |
| GitHub Actions | `workflow_dispatch` runs | Audit trail in repo's Actions tab |
| Package mgmt | `npm install`, `package.json` edits, publish | Locked to a branch + PR |
| Notifications | Sending emails, Slack messages, iMessage | Recipient should know it came from a tracked source |

## What is fine in chat

- Reading anything (Atlassian search, Gmail search/read, Cloudflare list_*, Supabase list_projects/get_advisors, GitHub `gh` read commands)
- Summaries, explanations, plans, design discussion
- Architecture questions
- Asking Claude to explain why something works the way it does
- Rough drafts of code that Luisa will paste into Claude Code later

## How Claude must apply the rule

When asked from the chat surface to do anything in the "must be in Code" list, Claude must respond with:

> This is an environment-changing task. Please open Claude Code and re-issue this request there so the changes are auditable.

…and then **stop**. Not silently proceed. Not "just this once." Not "I'll do it but please open Code next time."

If Luisa pushes back ("just do it from chat please") the answer is still: "Let's move to Claude Code." She can always escalate by re-issuing in Claude Code if she really wants the action — but the friction is the point.

## Self-check before acting

Before invoking any MCP tool from the chat surface, Claude must self-check:

1. Is this a read-only operation? (e.g. `lyra_search_profiles`, `searchJiraIssuesUsingJql`, `gmail_search_messages`)
   - If yes → proceed
2. Does this tool persist a change? (e.g. `lyra_add_item`, `addCommentToJiraIssue`, `apply_migration`)
   - If yes → refuse and ask user to switch to Claude Code

If the tool's read/write status is unclear from its name, treat it as write and refuse.

## Exceptions

- **Emergency-only override**: production actively broken AND Claude Code unavailable (Luisa on mobile, no laptop). Claude may take the smallest possible mitigating action from chat — and must immediately log the action in Jira with `[chat-emergency]` label.
- **Discussion of state**: "show me my current Jira board" or "what does my latest weekly report say" is read-only and fine in chat.

## Where this rule lives

- This document (canonical text)
- [`CLAUDE.md`](../CLAUDE.md) section "Editing the environment: Claude Code only"
- [`PROJECT_INSTRUCTIONS.md`](./PROJECT_INSTRUCTIONS.md) — same rule, slightly shorter framing
- Claude's auto-memory system (`memory/feedback_claude_code_only_for_writes.md`)
- Luisa's Lyra profile prompt (per ticket KAN-177 — pending update)

## Reference

- KAN-177 (this ticket): <https://checklyra.atlassian.net/browse/KAN-177>
- Related: ARCHITECTURE.md, RUNBOOK.md, CLAUDE.md
