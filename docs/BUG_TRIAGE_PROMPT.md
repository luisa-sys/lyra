# Bug Triage Prompt — Weekly Report → BUGS Tickets

## When to Run

Every Monday after the weekly report email arrives (sent 07:00 UTC from reports@checklyra.com).

## How to Run

Open Cowork or a new Claude conversation with Gmail and Atlassian MCP connectors enabled. Paste the prompt below.

## The Prompt

```
Search my Gmail for the most recent email from reports@checklyra.com with subject
containing "Lyra Weekly Report". Read the full email body.

Scan the report for any of these issues:

1. ENDPOINT HEALTH: Any endpoint returning non-200 status (EXCEPT 403 from
   checklyra.com which is expected due to Cloudflare maintenance worker)
2. CI/CD FAILURES: Any workflow with failed runs in the past week
3. SECURITY ALERTS: Any open CodeQL alerts (critical or high severity)
4. DEPENDENCY VULNERABILITIES: Any Dependabot critical/high alerts
5. TEST REGRESSION: Test count below 239 (lyra) or 64 (MCP server)
6. BACKUP FAILURE: Database or platform backup reported as failed
7. MUTATION TESTING: Stryker mutation score drop or failure
8. DB METRICS: Any table with 0 rows that should have data (profiles, profile_items)

For each issue found, create a ticket in the BUGS Jira project with:
- Summary: Clear one-line description of the issue
- Description including:
  - What: What the issue is
  - Source: Which section of the weekly report flagged it
  - Severity: Critical / High / Medium / Low
  - Recommended fix: Specific steps to resolve
  - Report date: The date of the weekly report

Before creating each ticket, search BUGS project for existing open tickets with
similar summaries to avoid duplicates. If a matching open ticket exists, add a
comment with the latest occurrence date instead of creating a new ticket.

If the report shows all green / no issues, respond with:
"Weekly report clean — no bugs to raise. All systems healthy."
```

## BUGS Project Details

- Project key: BUGS
- Project ID: 10035
- Issue type: Task (id: 10049)
- Cloud ID: fde496ba-2db8-481a-8544-39d6e9122101

## Severity Guide

| Severity | Criteria | Example |
|----------|----------|---------|
| Critical | Production down, data loss, security breach | All endpoints 500, backup restore failed |
| High | Feature broken, security vuln, test regression | CodeQL critical alert, test count dropped |
| Medium | Degraded performance, non-critical failure | One workflow failed, Dependabot medium alert |
| Low | Cosmetic, minor inconsistency | Stryker score dipped 1%, non-critical endpoint slow |

## Expected "False Positives" (Do NOT raise bugs for these)

- `checklyra.com` returning 403 or 503 → This is the Cloudflare maintenance worker, expected behaviour
- `checklyra.com/cookies` returning 403 → Same, maintenance worker (until worker is redeployed with /cookies in allowedPaths)
- GitHub Actions 403 from smoke tests → Cloudflare blocks CI runner IPs, known and accepted

## Deduplication Rules

1. Search `project = BUGS AND status != Done AND summary ~ "<key phrase>"` before creating
2. If found, add comment: "Still occurring as of [report date]"
3. If not found, create new ticket

## History

- April 2026: Adopted weekly-report-based approach (supersedes KAN-92-95 email scanning service)
- Process uses Cowork/Claude with Gmail + Atlassian MCP connectors
- No custom code or infrastructure needed
