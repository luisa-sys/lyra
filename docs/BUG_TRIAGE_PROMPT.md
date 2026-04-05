# Bug Triage Prompt — Weekly Report Scanning

## Process

Every Monday after the weekly report email arrives (from reports@checklyra.com), use Cowork or Claude.ai to scan the report and raise BUGS tickets.

## Prompt to Use

Copy and paste this into Cowork or a Claude.ai chat with Gmail + Atlassian MCP connectors enabled:

---

**Prompt:**

```
Search my Gmail for the most recent email from reports@checklyra.com with subject containing "Lyra Weekly Platform Report". Read the full email body.

Scan the report for any of these issues:

1. ENDPOINT HEALTH: Any endpoint returning non-200 status (EXCEPT 403 from checklyra.com which is expected due to Cloudflare maintenance worker)
2. CI/CD FAILURES: Any workflow failures reported in the past week
3. SECURITY ALERTS: Any open CodeQL alerts (especially critical/high), any Dependabot critical/high vulnerabilities
4. TEST REGRESSION: Test count below 239 (lyra) or 64 (MCP server), or suite count below 19 (lyra) or 2 (MCP)
5. BACKUP FAILURES: Any database or platform backup failures
6. MUTATION TESTING: Stryker mutation score drop (if reported)
7. DATABASE: Any concerning metrics (e.g. unexpected row count changes, missing tables)

For each issue found, create a Task in the BUGS Jira project (key: BUGS) at checklyra.atlassian.net with:
- Summary: Clear one-line description of the issue
- Description including:
  - What was detected (quote the relevant section from the report)
  - Severity: Critical / High / Medium / Low
  - Recommended fix steps
  - Source: "Weekly report [date]"

DEDUPLICATION: Before creating each ticket, search BUGS project for existing open tickets with similar summary. If a matching ticket exists, add a comment instead of creating a duplicate.

If the report shows ALL GREEN (all endpoints healthy, zero failures, zero alerts, tests at or above floor), respond with: "Weekly report clean — no bugs to raise."
```

---

## Expected Behaviour

- **Clean report**: "Weekly report clean — no bugs to raise."
- **Issues found**: Creates 1 BUGS ticket per distinct issue, with severity and recommended fix
- **Duplicate detection**: Comments on existing tickets rather than creating duplicates

## Severity Guide

| Severity | Criteria | Response Time |
|----------|----------|---------------|
| Critical | Production down, data loss, security breach | Same day |
| High | Feature broken, endpoint failing, security vuln | Within 2 days |
| Medium | Degraded performance, non-critical test failure | Within 1 week |
| Low | Cosmetic, warning-level alert, minor regression | Next sprint |

## Known Exceptions (Do NOT raise bugs for these)

- `checklyra.com` returning 403 — this is the Cloudflare maintenance worker, expected behaviour
- `checklyra.com/cookies` returning 503 — known issue, tracked separately
- Cloudflare bot protection blocking GitHub Actions runner IPs (shows as 403 in smoke tests)

## BUGS Project Details

- Jira project key: `BUGS`
- Project ID: `10035`
- Issue type: Task (ID `10049`)
- Board: https://checklyra.atlassian.net/jira/software/projects/BUGS/board

## Weekly Cadence

1. **Monday ~07:30 UTC**: Weekly report email arrives
2. **Monday morning**: Run the bug triage prompt via Cowork/Claude
3. **Monday**: Review any created BUGS tickets, prioritise
4. **During week**: Fix critical/high bugs, schedule medium/low for next sprint
