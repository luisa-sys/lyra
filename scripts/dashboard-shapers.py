#!/usr/bin/env python3
"""KAN-165: data-shaping helpers for the weekly dashboard sections.

This is the pure-functional core of the new dashboard sections. Each
function takes raw API JSON (already fetched by the workflow) plus a
"now" timestamp and returns a markdown body string plus a status code
(`ok` / `partial:...` / `failed:...` / `unavailable:...`) that the
workflow appends to the data-quality file.

Per KAN-167 workflow integrity policy:
- Never silently swallow an error. If input JSON is malformed, return a
  status of `failed:<reason>` and a markdown body that explicitly says
  "DATA UNAVAILABLE — <reason>", rather than a clean-looking empty
  table.
- Distinguish "0 records" (legitimate green state) from "fetch failed"
  (failure that needs investigating) in the rendered output.

CLI usage:

    python3 scripts/dashboard-shapers.py <shape>

where <shape> is one of: in_flight, pr_queue, ci_flakiness, mcp_health,
cost_spotcheck, release_cadence. Reads JSON from stdin, writes markdown
body to stdout, and writes a single `section-<N>=<status>` line to
stderr so the workflow can append it to the quality file.

Tested in tests/unit/dashboard-shapers.test.js.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any


# ───────────────────────── helpers ─────────────────────────

def _parse_iso(s: str) -> datetime | None:
    """Parse a GitHub/Jira ISO timestamp into an aware datetime.

    Handles the three formats we see in practice:
      - GitHub:  "2026-05-10T07:00:00Z"
      - Jira:    "2026-05-10T07:00:00.000+0000"  (no colon in offset)
      - Generic: "2026-05-10T07:00:00.000+00:00"
    """
    if not s:
        return None
    try:
        # Strip trailing Z (Python <3.11 doesn't parse it).
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        # Jira's offset has no colon (e.g. "+0000"); convert to "+00:00".
        # Match a 4-digit offset at end of string.
        import re
        s = re.sub(r'([+-])(\d{2})(\d{2})$', r'\1\2:\3', s)
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _days_since(iso: str, now: datetime) -> int | None:
    dt = _parse_iso(iso)
    if dt is None:
        return None
    delta = now - dt
    return max(0, int(delta.total_seconds() // 86400))


# ───────────────────────── shape: release_cadence ─────────────────────────

def shape_release_cadence(payload: dict[str, Any], now: datetime) -> tuple[str, str]:
    """Render Section 15 — Release Cadence.

    payload keys:
      - latest_tag: str (e.g. "v0.1.40")
      - latest_tag_date: ISO timestamp of the tag's commit
      - drift: dict with `commits_ahead`, `days_since_last_commit`, `status` —
        the same shape produced by scripts/check-release-drift.sh

    Output: markdown body + section-15=<status>.
    """
    drift = payload.get('drift') or {}
    tag = payload.get('latest_tag') or 'unknown'
    tag_date = payload.get('latest_tag_date') or ''
    commits_ahead = drift.get('commits_ahead', 'DATA_UNAVAILABLE')
    days_since_commit = drift.get('days_since_last_commit', 'DATA_UNAVAILABLE')
    drift_status = drift.get('status', 'unknown')

    lines = ['## 15. Release Cadence', '']

    # Compute days since release.
    days_since_release: int | str
    if tag_date:
        d = _days_since(tag_date, now)
        days_since_release = d if d is not None else 'DATA_UNAVAILABLE'
    else:
        days_since_release = 'DATA_UNAVAILABLE'

    # Status emoji from the drift script's bucket (already computed there).
    emoji = {
        'green': '🟢',
        'yellow': '🟡',
        'red': '🔴',
        'unknown': '❓',
    }.get(drift_status, '❓')

    lines.append('| Metric | Value |')
    lines.append('|--------|-------|')
    lines.append(f'| Latest tag | `{tag}` |')
    lines.append(f'| Tag date | {tag_date or "DATA UNAVAILABLE"} |')
    lines.append(f'| Days since last release | {days_since_release} |')
    lines.append(f'| Unreleased commits on develop | {commits_ahead} |')
    lines.append(f'| Days since last develop commit | {days_since_commit} |')
    lines.append(f'| Drift status | {emoji} {drift_status} |')
    lines.append('')

    # Status logic for the quality summary.
    if drift_status == 'unknown' or commits_ahead == 'DATA_UNAVAILABLE':
        status = 'failed:drift-data-unavailable'
    elif drift_status == 'red':
        # Red means action needed, but the report itself isn't broken.
        # Surface as partial so the quality summary flags it.
        status = 'partial:drift-red'
    else:
        status = 'ok'

    return '\n'.join(lines) + '\n', status


# ───────────────────────── shape: in_flight ─────────────────────────

def shape_in_flight(payload: dict[str, Any], now: datetime) -> tuple[str, str]:
    """Render Section 16 — In-Flight Work.

    payload keys:
      - issues: list of Jira issues (each with `key`, `fields.summary`,
        `fields.status.name`, `fields.updated`, `fields.assignee.displayName`)
      - error: str | None — if set, render DATA UNAVAILABLE with the message.

    "In progress" is determined by status.name == "In Progress".
    """
    lines = ['## 16. In-Flight Work (Jira: In Progress)', '']

    err = payload.get('error')
    if err:
        lines.append(f'❌ DATA UNAVAILABLE — {err}')
        lines.append('')
        return '\n'.join(lines) + '\n', f'failed:jira-fetch:{err[:40]}'

    issues = payload.get('issues')
    if issues is None:
        lines.append('❌ DATA UNAVAILABLE — Jira `issues` key missing from payload.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'failed:jira-issues-key-missing'

    if not issues:
        lines.append('✅ No tickets currently In Progress.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'ok'

    # Sort oldest first (largest age).
    rows: list[tuple[str, str, str, int, str]] = []
    for it in issues:
        key = it.get('key', 'UNKNOWN')
        f = it.get('fields') or {}
        summary = (f.get('summary') or '')[:80]
        updated = f.get('updated') or ''
        age = _days_since(updated, now)
        age_val = age if age is not None else 0
        assignee_obj = f.get('assignee') or {}
        assignee = assignee_obj.get('displayName') or 'Unassigned'
        rows.append((key, summary, updated, age_val, assignee))

    rows.sort(key=lambda r: r[3], reverse=True)
    oldest_age = rows[0][3]

    lines.append(f'**Total In Progress:** {len(rows)} — oldest is {oldest_age} day(s) since last update.')
    lines.append('')
    lines.append('| Key | Summary | Days since update | Assignee |')
    lines.append('|-----|---------|-------------------|----------|')
    for key, summary, _, age, assignee in rows:
        lines.append(f'| {key} | {summary} | {age} | {assignee} |')
    lines.append('')

    return '\n'.join(lines) + '\n', 'ok'


# ───────────────────────── shape: pr_queue ─────────────────────────

def shape_pr_queue(payload: dict[str, Any], now: datetime) -> tuple[str, str]:
    """Render Section 17 — PR Queue Health.

    payload keys:
      - pulls: list of GitHub PR objects (each with `number`, `title`,
        `base.ref`, `draft`, `created_at`, `user.login`)
      - error: str | None
    """
    lines = ['## 17. PR Queue Health', '']

    err = payload.get('error')
    if err:
        lines.append(f'❌ DATA UNAVAILABLE — {err}')
        lines.append('')
        return '\n'.join(lines) + '\n', f'failed:pr-fetch:{err[:40]}'

    pulls = payload.get('pulls')
    if pulls is None:
        lines.append('❌ DATA UNAVAILABLE — `pulls` key missing from payload.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'failed:pulls-key-missing'

    if not pulls:
        lines.append('✅ No open pull requests.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'ok'

    # Group by base ref.
    by_base: dict[str, list[dict[str, Any]]] = {}
    for pr in pulls:
        base = ((pr.get('base') or {}).get('ref')) or 'unknown'
        by_base.setdefault(base, []).append(pr)

    # Oldest age across all PRs.
    all_ages = [
        _days_since(pr.get('created_at', ''), now) or 0
        for pr in pulls
    ]
    oldest = max(all_ages) if all_ages else 0

    # Author classification: dependabot vs human.
    dep_count = sum(
        1 for pr in pulls
        if ((pr.get('user') or {}).get('login') or '').startswith('dependabot')
    )
    human_count = len(pulls) - dep_count

    # Draft vs ready.
    draft_count = sum(1 for pr in pulls if pr.get('draft'))
    ready_count = len(pulls) - draft_count

    lines.append(
        f'**Total open:** {len(pulls)} — oldest {oldest} day(s) — '
        f'{ready_count} ready / {draft_count} draft — '
        f'{human_count} human / {dep_count} dependabot.'
    )
    lines.append('')

    lines.append('| Base | Count | Oldest (days) |')
    lines.append('|------|-------|---------------|')
    for base in sorted(by_base.keys()):
        prs = by_base[base]
        ages = [_days_since(pr.get('created_at', ''), now) or 0 for pr in prs]
        lines.append(f'| `{base}` | {len(prs)} | {max(ages) if ages else 0} |')
    lines.append('')

    return '\n'.join(lines) + '\n', 'ok'


# ───────────────────────── shape: ci_flakiness ─────────────────────────

def shape_ci_flakiness(payload: dict[str, Any], _now: datetime) -> tuple[str, str]:
    """Render Section 18 — CI Flakiness (last 30 runs).

    payload keys:
      - runs: list of workflow-run objects (each with `name`, `conclusion`).
              `conclusion` may be 'success', 'failure', 'cancelled',
              'skipped', or null (in-progress).
      - error: str | None
    """
    lines = ['## 18. CI Flakiness (last 30 runs grouped by workflow)', '']

    err = payload.get('error')
    if err:
        lines.append(f'❌ DATA UNAVAILABLE — {err}')
        lines.append('')
        return '\n'.join(lines) + '\n', f'failed:ci-fetch:{err[:40]}'

    runs = payload.get('runs')
    if runs is None:
        lines.append('❌ DATA UNAVAILABLE — `runs` key missing from payload.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'failed:runs-key-missing'

    if not runs:
        lines.append('⚠️ No workflow runs in window — investigate, this should never be empty.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'partial:no-runs-in-window'

    by_wf: dict[str, dict[str, int]] = {}
    for r in runs:
        name = r.get('name') or 'unknown'
        conclusion = r.get('conclusion') or 'in_progress'
        agg = by_wf.setdefault(name, {'total': 0, 'success': 0, 'failure': 0, 'other': 0})
        agg['total'] += 1
        if conclusion == 'success':
            agg['success'] += 1
        elif conclusion == 'failure':
            agg['failure'] += 1
        else:
            agg['other'] += 1

    lines.append('| Workflow | Runs | Success rate | Failures |')
    lines.append('|----------|------|--------------|----------|')
    any_flaky = False
    for wf in sorted(by_wf.keys()):
        agg = by_wf[wf]
        # Success rate computed against the non-in-progress denominator.
        denom = agg['success'] + agg['failure']
        if denom == 0:
            rate_str = 'N/A (all in-progress/cancelled)'
        else:
            rate = 100.0 * agg['success'] / denom
            rate_str = f'{rate:.0f}%'
            if rate < 80.0:
                any_flaky = True
                rate_str = f'⚠️ {rate_str}'
        lines.append(f'| {wf} | {agg["total"]} | {rate_str} | {agg["failure"]} |')
    lines.append('')

    status = 'partial:flaky-workflows' if any_flaky else 'ok'
    return '\n'.join(lines) + '\n', status


# ───────────────────────── shape: mcp_health ─────────────────────────

def shape_mcp_health(payload: dict[str, Any], _now: datetime) -> tuple[str, str]:
    """Render Section 19 — MCP Server Health.

    payload keys:
      - monitors: list of UptimeRobot monitor dicts (each with `friendly_name`,
        `status`, `all_time_uptime_ratio` — strings/ints from the API).
      - error: str | None
      - skipped_reason: str | None — set if no API key was configured;
        renders a header-level warning rather than a hard failure.
    """
    lines = ['## 19. MCP Server Health (UptimeRobot)', '']

    skipped = payload.get('skipped_reason')
    if skipped:
        # KAN-167 fail-loud: a missing API key isn't silent — it's surfaced
        # in the section header AND printed as a workflow warning by the
        # caller. The section still appears in the email so the absence is
        # visible to the reader.
        lines.append(f'⚠️ DATA UNAVAILABLE — {skipped}')
        lines.append('')
        return '\n'.join(lines) + '\n', f'unavailable:{skipped[:60]}'

    err = payload.get('error')
    if err:
        lines.append(f'❌ DATA UNAVAILABLE — {err}')
        lines.append('')
        return '\n'.join(lines) + '\n', f'failed:uptimerobot-fetch:{err[:40]}'

    monitors = payload.get('monitors')
    if monitors is None:
        lines.append('❌ DATA UNAVAILABLE — `monitors` key missing from payload.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'failed:monitors-key-missing'

    if not monitors:
        lines.append('⚠️ No UptimeRobot monitors found — bootstrap may not have run yet.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'partial:no-monitors-configured'

    # UptimeRobot monitor.status: 0=paused, 1=not_checked, 2=up, 8=seems-down, 9=down.
    UR_STATUS = {0: '⏸ paused', 1: '… new', 2: '✅ up', 8: '⚠️ seems-down', 9: '❌ down'}
    lines.append('| Monitor | Status | Uptime (all-time) |')
    lines.append('|---------|--------|--------------------|')
    any_down = False
    for m in monitors:
        name = m.get('friendly_name') or 'unknown'
        st = m.get('status')
        try:
            st_int = int(st) if st is not None else -1
        except (ValueError, TypeError):
            st_int = -1
        st_label = UR_STATUS.get(st_int, f'❓ unknown ({st})')
        if st_int in (8, 9):
            any_down = True
        uptime = m.get('all_time_uptime_ratio')
        uptime_str = f'{uptime}%' if uptime is not None else 'DATA UNAVAILABLE'
        lines.append(f'| {name} | {st_label} | {uptime_str} |')
    lines.append('')

    status = 'partial:monitor-down' if any_down else 'ok'
    return '\n'.join(lines) + '\n', status


# ───────────────────────── shape: cost_spotcheck ─────────────────────────

def shape_cost_spotcheck(payload: dict[str, Any], _now: datetime) -> tuple[str, str]:
    """Render Section 20 — Cost Spotcheck.

    payload shape: dict of {provider_name: {"available": bool, "detail": str}}.

    Each entry is independently rendered. If the provider's API isn't
    wired up (no token), `available=False` with a `detail` explaining
    what's missing. Per KAN-167, the section is still rendered; the row
    just says DATA UNAVAILABLE with the reason.
    """
    lines = ['## 20. Cost Spotcheck (best-effort)', '']
    providers = payload.get('providers') or {}
    if not providers:
        lines.append('⚠️ DATA UNAVAILABLE — no providers configured.')
        lines.append('')
        return '\n'.join(lines) + '\n', 'unavailable:no-providers-configured'

    lines.append('| Provider | Status | Detail |')
    lines.append('|----------|--------|--------|')
    any_unavailable = False
    for name in sorted(providers.keys()):
        info = providers[name] or {}
        if info.get('available'):
            lines.append(f'| {name} | ✅ ok | {info.get("detail", "—")} |')
        else:
            any_unavailable = True
            lines.append(
                f'| {name} | ⚠️ DATA UNAVAILABLE | {info.get("detail", "no detail")} |'
            )
    lines.append('')

    status = 'partial:some-cost-providers-unavailable' if any_unavailable else 'ok'
    return '\n'.join(lines) + '\n', status


# ───────────────────────── CLI dispatch ─────────────────────────

SHAPERS = {
    'release_cadence': shape_release_cadence,
    'in_flight': shape_in_flight,
    'pr_queue': shape_pr_queue,
    'ci_flakiness': shape_ci_flakiness,
    'mcp_health': shape_mcp_health,
    'cost_spotcheck': shape_cost_spotcheck,
}

SECTION_NUMBERS = {
    'release_cadence': 15,
    'in_flight': 16,
    'pr_queue': 17,
    'ci_flakiness': 18,
    'mcp_health': 19,
    'cost_spotcheck': 20,
}


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in SHAPERS:
        sys.stderr.write(
            f'Usage: {argv[0]} <{ "|".join(SHAPERS) }>\n'
            'Reads JSON payload from stdin; writes markdown to stdout '
            'and `section-<N>=<status>` to stderr.\n'
        )
        return 2

    shape = argv[1]
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        # Loud, not silent. Emit a failed status so the workflow goes red.
        sys.stdout.write(
            f'## {SECTION_NUMBERS[shape]}. {shape.replace("_", " ").title()}\n\n'
            f'❌ DATA UNAVAILABLE — payload was not valid JSON: {e}\n\n'
        )
        sys.stderr.write(f'section-{SECTION_NUMBERS[shape]}=failed:invalid-json\n')
        return 1

    now = datetime.now(timezone.utc)
    body, status = SHAPERS[shape](payload, now)
    sys.stdout.write(body)
    sys.stderr.write(f'section-{SECTION_NUMBERS[shape]}={status}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
