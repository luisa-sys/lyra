# Jira Ticket Standard — KAN Project

> Every ticket must be small enough to complete in one focused session.
> Every ticket must include tests, security review, and architecture impact.

## Required Description Sections

### 1. What & Why
- What is being changed and why
- Link to parent epic or related tickets
- User-facing impact (if any)

### 2. Implementation
- Specific steps to complete the work
- Files to create/modify
- Code snippets where helpful
- NEEDS DESKTOP flag if local machine access is required

### 3. Tests Required
**This section is mandatory. No ticket ships without tests.**

- **Unit tests**: What functions/modules to test, what to mock, edge cases
- **Functional tests**: Integration points to verify (e.g., Supabase calls, API responses)
- **E2E tests** (if user-facing): Playwright scenarios to add or update
- **Test location**: Which test file(s) to create or modify

### 4. Security Review
**This section is mandatory. Every change has security implications.**

- Threats introduced or mitigated by this change
- RLS / auth impact (new tables? new policies? policy changes?)
- Input validation requirements (new user input? sanitisation needed?)
- Secrets / env vars introduced (where stored? rotation plan?)
- OWASP relevance (which of the Top 10 applies?)
- For MCP changes: prompt injection risk assessment

### 5. Architecture Impact
- Docs to update (ARCHITECTURE.md, RUNBOOK.md, others)
- New environment variables (all 3 envs + Railway if MCP)
- New dependencies (npm packages — check for vulnerabilities first)
- New API endpoints or routes
- Database schema changes (migration SQL required)
- Impact on existing tests (will any break?)

### 6. Acceptance Criteria
- Specific, testable conditions that must be true when done
- Include "all new tests pass in CI" as a standard criterion
- Include "architecture doc updated" if section 5 identified changes

## Work Breakdown Rules

1. **One concern per ticket.** "Add rate limiting AND CORS AND logging" = 3 tickets, not 1.
2. **Subtasks for large work.** If implementation has >5 steps, break into subtasks.
3. **Tests in same PR.** Never create a separate "add tests" ticket for work you just shipped.
4. **Security never deferred.** If section 4 identifies a risk, the mitigation is part of THIS ticket.
5. **Architecture doc updated in same PR.** If section 5 identifies doc changes, they ship together.

## Example: Well-Structured Ticket

```
Summary: Add rate limiting to MCP server Express app

### What & Why
The MCP server accepts unlimited requests from any IP. A single client
could overwhelm the server or abuse the API. The web app already has
rate limiting (KAN-61) but the MCP server does not.

### Implementation
1. Add `express-rate-limit` middleware to `src/index.ts`
2. Global limit: 100 req/min per IP
3. /mcp endpoint: 60 req/min per IP
4. Return standard 429 with Retry-After header

### Tests Required
- Unit test: verify rate limiter returns 429 after threshold
- Unit test: verify different IPs have independent limits
- Unit test: verify Retry-After header is set correctly
- Functional test: send 61 rapid requests, confirm 61st returns 429
- Test file: tests/mcp-rate-limit.test.cjs

### Security Review
- MITIGATES: DoS/DDoS on MCP endpoint
- MITIGATES: API abuse / scraping
- No RLS impact (middleware-level only)
- No new secrets needed
- OWASP: A6 Security Misconfiguration (rate limiting is a baseline)

### Architecture Impact
- Update ARCHITECTURE.md Security Posture section (remove "no rate limiting" gap)
- No new env vars (limits hardcoded, can be made configurable later)
- No new dependencies (express-rate-limit already in package.json)
- Update RUNBOOK.md with rate limit configuration reference

### Acceptance criteria
- MCP server returns 429 after 60 requests/min to /mcp from same IP
- 429 response includes Retry-After header
- All new tests pass in CI
- Architecture doc updated
```

## Tickets That Existed Before This Standard

Tickets created before 29 March 2026 may not follow this format. When picking up
an older ticket, add the missing sections before starting work. Flag any that are
too large and need breaking down.
