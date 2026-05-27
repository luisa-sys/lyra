#!/usr/bin/env python3
"""KAN-63 Tier 4: CI workflow auto-triage and self-heal.

Reacts to recurring GitHub Actions workflow failures by matching the log
output against a known-pattern catalogue (scripts/auto-fix-patterns.json)
and applying the matched remediation idempotently. Patterns that don't
match get a deduped GitHub issue so unknown failures don't fester silently.

Design goals:
  - Stdlib-only Python (matches existing scripts/anomaly-detect.py +
    scripts/cleanup-phantom-check-suites.py conventions).
  - Idempotent: safe to re-run on the same failed run with no side effects
    beyond the first.
  - Conservative: only takes actions in the remediation catalogue. Unknown
    patterns are reported, NEVER guessed at.
  - Auditable: every action emits a `::notice::` line and writes to
    $GITHUB_STEP_SUMMARY when running in CI.

Modes:
  --self-test
      Run the classifier against the fixtures in tests/fixtures/auto-fix-logs/
      and verify each is correctly identified. No GitHub side effects. Used
      by CI as a regression guard so the pattern catalogue can't drift away
      from the fixtures it's tested against.

  --run-id <ID> --workflow-name "<name>"
      Look up the failed run, fetch its log via `gh run view --log-failed`,
      classify against patterns, apply remediation. Reads other context
      from the standard GH_REPOSITORY / GITHUB_REPOSITORY env vars.

  --dry-run
      Classify only; print what WOULD be done without taking action.
      Compose with --run-id for one-shot debugging.

Exit code:
  0 = pattern matched and remediation succeeded (or was a no-op like
      "PR already open"), or self-test passed
  1 = no pattern matched OR remediation hit an unrecoverable error
      (a tracking issue is filed either way)
  2 = invalid invocation
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
PATTERNS_PATH = REPO_ROOT / "scripts" / "auto-fix-patterns.json"
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "auto-fix-logs"

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[mK]")

AUTOHEAL_ISSUE_LABEL = "autoheal-tracked"
NEEDS_HUMAN_LABEL = "autoheal/needs-human"
UNKNOWN_PATTERN_LABEL = "autoheal/unknown-pattern"


# ── Data plumbing ───────────────────────────────────────────────────────


@dataclass
class Pattern:
    id: str
    title: str
    summary: str
    workflows: list[str]
    regex: re.Pattern[str]
    remediation: dict[str, Any]
    rerun_workflow_after_fix: bool

    @classmethod
    def from_json(cls, raw: dict[str, Any]) -> "Pattern":
        return cls(
            id=raw["id"],
            title=raw["title"],
            summary=raw.get("summary", ""),
            workflows=list(raw["workflows"]),
            regex=re.compile(raw["regex"], re.IGNORECASE),
            remediation=dict(raw["remediation"]),
            rerun_workflow_after_fix=bool(raw.get("rerun_workflow_after_fix", False)),
        )


def load_patterns(path: Path = PATTERNS_PATH) -> list[Pattern]:
    raw = json.loads(path.read_text())
    if raw.get("version") != 1:
        raise SystemExit(
            f"auto-fix-patterns.json version {raw.get('version')!r} not supported"
        )
    return [Pattern.from_json(p) for p in raw["patterns"]]


def strip_ansi(text: str) -> str:
    """Strip ANSI escape codes that `gh run view --log-failed` embeds."""
    return ANSI_RE.sub("", text)


# ── Classification ──────────────────────────────────────────────────────


def workflow_matches(pattern: Pattern, workflow_name: str) -> bool:
    """Case-insensitive match of the run's workflow name against the
    pattern's workflows[] list. Accepts both the friendly name ('Anomaly
    detect (KAN-63-A)') and the file slug ('anomaly-detect')."""
    if not workflow_name:
        return False
    norm = workflow_name.strip().lower()
    return any(w.strip().lower() == norm for w in pattern.workflows)


def classify(
    log_text: str, workflow_name: str, patterns: list[Pattern]
) -> tuple[Pattern, re.Match[str]] | None:
    """Return the first (pattern, match) whose workflow + regex matches.
    None if nothing matches. ANSI is stripped before matching."""
    clean = strip_ansi(log_text)
    for p in patterns:
        if not workflow_matches(p, workflow_name):
            continue
        m = p.regex.search(clean)
        if m is not None:
            return (p, m)
    return None


# ── gh CLI helpers ──────────────────────────────────────────────────────


def run_gh(args: list[str], *, check: bool = True, capture: bool = True) -> str:
    """Wrap `gh` invocations. Returns stdout (stripped). Raises on
    non-zero exit unless check=False."""
    proc = subprocess.run(
        ["gh", *args],
        capture_output=capture,
        text=True,
        check=False,
    )
    if check and proc.returncode != 0:
        sys.stderr.write(
            f"gh {' '.join(args)} failed (exit {proc.returncode}):\n"
            f"  stdout: {proc.stdout!r}\n  stderr: {proc.stderr!r}\n"
        )
        raise SystemExit(1)
    return (proc.stdout or "").strip()


def fetch_failed_log(run_id: str) -> str:
    """`gh run view <id> --log-failed` returns the failed-step logs. We
    don't redirect via check=False since some runs have no failed steps
    (rare but possible if the run was cancelled)."""
    return run_gh(["run", "view", run_id, "--log-failed"], check=False)


def label_exists(label_name: str) -> bool:
    out = run_gh(
        ["label", "list", "--search", label_name, "--json", "name", "--jq", ".[].name"],
        check=False,
    )
    return label_name in out.splitlines()


def label_create(label_name: str, color: str, description: str) -> bool:
    """Returns True if the label was created, False if it already existed."""
    if label_exists(label_name):
        return False
    run_gh(
        [
            "label",
            "create",
            label_name,
            "--description",
            description,
            "--color",
            color,
        ]
    )
    return True


def find_open_issue_by_title(title: str) -> str | None:
    """Returns the issue number as a string if an open issue with this
    exact title exists, else None. Used for dedup."""
    out = run_gh(
        [
            "issue",
            "list",
            "--state",
            "open",
            "--search",
            f'in:title "{title}"',
            "--json",
            "number,title",
            "--jq",
            ".[] | select(.title==\"" + title.replace('"', '\\"') + "\") | .number",
        ],
        check=False,
    )
    nums = [ln for ln in out.splitlines() if ln.strip()]
    return nums[0] if nums else None


def issue_upsert(
    title: str,
    body: str,
    labels: list[str],
) -> tuple[str, bool]:
    """Create the issue if absent, else comment on the existing one with
    the new body. Returns (issue_number, was_created)."""
    existing = find_open_issue_by_title(title)
    if existing:
        run_gh(
            ["issue", "comment", existing, "--body", body],
            check=False,
        )
        return (existing, False)
    # Ensure labels exist before applying — gh errors otherwise.
    for lbl in labels:
        if not label_exists(lbl):
            run_gh(
                [
                    "label",
                    "create",
                    lbl,
                    "--description",
                    "Created by auto-fix-known-failures",
                    "--color",
                    "ededed",
                ],
                check=False,
            )
    label_args: list[str] = []
    for lbl in labels:
        label_args.extend(["--label", lbl])
    url = run_gh(["issue", "create", "--title", title, "--body", body, *label_args])
    # `gh issue create` returns the issue URL on stdout; extract number.
    match = re.search(r"/issues/(\d+)", url)
    return ((match.group(1) if match else url), True)


def find_open_pr_by_branch(branch_hint: str) -> str | None:
    """Returns the PR number (as string) for an open PR whose head branch
    matches branch_hint (substring), else None."""
    out = run_gh(
        [
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "number,headRefName",
            "--jq",
            f'.[] | select(.headRefName | contains("{branch_hint}")) | .number',
        ],
        check=False,
    )
    nums = [ln for ln in out.splitlines() if ln.strip()]
    return nums[0] if nums else None


def pr_comment_once(pr_number: str, marker: str, body: str) -> bool:
    """Comment on a PR only if a comment containing `marker` doesn't
    already exist. Returns True if a new comment was posted."""
    # Fetch existing comments to look for the marker.
    out = run_gh(
        ["pr", "view", pr_number, "--json", "comments", "--jq", ".comments[].body"],
        check=False,
    )
    if marker in out:
        return False
    run_gh(["pr", "comment", pr_number, "--body", body], check=False)
    return True


def rerun_workflow(run_id: str) -> None:
    """Re-trigger the failed run after a fix is applied. Best-effort."""
    run_gh(["run", "rerun", run_id, "--failed"], check=False)


# ── Remediation handlers ────────────────────────────────────────────────


def remediate_create_label(
    pattern: Pattern,
    match: re.Match[str],
    run_id: str,
    workflow_name: str,
    dry_run: bool,
) -> dict[str, Any]:
    """Pattern's regex MUST have a capture group 1 = the missing label name."""
    if not match.groups():
        return {"ok": False, "reason": "regex has no capture group for label name"}
    label_name = match.group(1)
    color = pattern.remediation.get("color", "ededed")
    description = pattern.remediation.get("description", "")
    if dry_run:
        return {"ok": True, "action": "would_create_label", "label": label_name}
    created = label_create(label_name, color, description)
    if pattern.rerun_workflow_after_fix and run_id:
        rerun_workflow(run_id)
    return {
        "ok": True,
        "action": "created_label" if created else "label_already_existed",
        "label": label_name,
        "rerun_triggered": pattern.rerun_workflow_after_fix and bool(run_id),
    }


def remediate_alert_secret_rotation(
    pattern: Pattern,
    match: re.Match[str],
    run_id: str,
    workflow_name: str,
    dry_run: bool,
) -> dict[str, Any]:
    """Create or comment on a deduped issue describing the secret rotation."""
    secret = pattern.remediation.get("secret_name", "<unknown>")
    title = f"[auto-heal] {secret} needs rotation — {pattern.id}"
    steps = pattern.remediation.get("steps", [])
    related = pattern.remediation.get("related_ticket", "")
    body_lines = [
        f"## Pattern: `{pattern.id}`",
        "",
        pattern.summary or "",
        "",
        f"**Triggering workflow:** {workflow_name} (run [{run_id}](https://github.com/luisa-sys/lyra/actions/runs/{run_id}))" if run_id else f"**Triggering workflow:** {workflow_name}",
        "",
        "### Rotation steps",
        "",
        *[f"{i + 1}. {step}" for i, step in enumerate(steps)],
        "",
        f"_Related_: {related}" if related else "",
        "",
        "_This issue was opened automatically by `.github/workflows/auto-fix-known-failures.yml`. It will be updated on each recurrence, not duplicated. Close it once the secret has been rotated._",
    ]
    body = "\n".join(ln for ln in body_lines if ln is not None)
    if dry_run:
        return {"ok": True, "action": "would_open_secret_rotation_issue", "title": title}
    issue, created = issue_upsert(
        title,
        body,
        labels=[AUTOHEAL_ISSUE_LABEL, NEEDS_HUMAN_LABEL],
    )
    return {
        "ok": True,
        "action": "opened_secret_rotation_issue" if created else "updated_secret_rotation_issue",
        "issue": issue,
    }


def remediate_pr_pending(
    pattern: Pattern,
    match: re.Match[str],
    run_id: str,
    workflow_name: str,
    dry_run: bool,
) -> dict[str, Any]:
    """If an open PR matches the branch hint, comment on it (once) noting
    the daily failure recurrence. If no PR, file a tracking issue."""
    branch_hint = pattern.remediation.get("pr_branch_hint", "")
    fix_summary = pattern.remediation.get("fix_summary", "")
    title = f"[auto-heal] {pattern.title} — fix pending on PR"
    marker = f"<!-- auto-fix-known-failures: {pattern.id} -->"
    body_for_pr = (
        f"{marker}\n\n"
        f":robot: Auto-heal saw `{workflow_name}` fail with the `{pattern.id}` pattern "
        f"again (run [{run_id}](https://github.com/luisa-sys/lyra/actions/runs/{run_id})).\n\n"
        f"This PR carries the fix — once it merges to develop and propagates through the "
        f"pipeline to main, the recurring failure will stop.\n\n"
        f"_Posted once per PR by `auto-fix-known-failures.yml`. Subsequent failures will "
        f"NOT add more comments to keep the PR clean._"
    )
    pr_number = find_open_pr_by_branch(branch_hint) if branch_hint else None
    if dry_run:
        if pr_number:
            return {"ok": True, "action": "would_comment_on_pr", "pr": pr_number}
        return {"ok": True, "action": "would_open_tracking_issue", "title": title}
    if pr_number:
        posted = pr_comment_once(pr_number, marker, body_for_pr)
        return {
            "ok": True,
            "action": "commented_on_pr" if posted else "pr_already_acknowledged",
            "pr": pr_number,
        }
    # No PR open → file a tracking issue so the work doesn't get lost.
    body_for_issue = (
        f"## Pattern: `{pattern.id}`\n\n"
        f"{pattern.summary}\n\n"
        f"**Expected fix branch:** `{branch_hint}` (not currently open as a PR)\n\n"
        f"**Fix summary:** {fix_summary}\n\n"
        f"**Triggering workflow:** {workflow_name} (run "
        f"[{run_id}](https://github.com/luisa-sys/lyra/actions/runs/{run_id}))"
        if run_id else ""
    )
    issue, created = issue_upsert(
        title,
        body_for_issue,
        labels=[AUTOHEAL_ISSUE_LABEL],
    )
    return {
        "ok": True,
        "action": "opened_tracking_issue" if created else "updated_tracking_issue",
        "issue": issue,
    }


def remediate_unknown(
    workflow_name: str,
    run_id: str,
    log_excerpt: str,
    dry_run: bool,
) -> dict[str, Any]:
    """Pattern didn't match anything. File a deduped 'unknown' issue so
    the failure surfaces for human triage and a new pattern can be added."""
    title = f"[auto-heal] Unknown failure pattern: {workflow_name}"
    body = (
        f"## Unknown failure\n\n"
        f"`auto-fix-known-failures` couldn't classify the most recent failure of `{workflow_name}`.\n\n"
        f"**Run:** [{run_id}](https://github.com/luisa-sys/lyra/actions/runs/{run_id})\n\n"
        f"### Log excerpt (last 40 lines, ANSI stripped)\n\n"
        f"```\n{log_excerpt[-3500:]}\n```\n\n"
        f"### Next steps\n\n"
        f"1. Triage the failure: is this a real new bug or a flaky run?\n"
        f"2. If recurring, add a new pattern entry to `scripts/auto-fix-patterns.json` and a fixture under `tests/fixtures/auto-fix-logs/`.\n"
        f"3. Close this issue once the pattern is captured (or the underlying bug is fixed)."
    )
    if dry_run:
        return {"ok": True, "action": "would_open_unknown_issue", "title": title}
    issue, created = issue_upsert(
        title,
        body,
        labels=[AUTOHEAL_ISSUE_LABEL, UNKNOWN_PATTERN_LABEL],
    )
    return {
        "ok": False,
        "action": "opened_unknown_issue" if created else "updated_unknown_issue",
        "issue": issue,
    }


REMEDIATION_DISPATCH = {
    "create_label": remediate_create_label,
    "alert_secret_rotation": remediate_alert_secret_rotation,
    "pr_pending": remediate_pr_pending,
}


# ── Step-summary writer ─────────────────────────────────────────────────


def emit_step_summary(result: dict[str, Any]) -> None:
    """Append a brief summary of the action taken to GITHUB_STEP_SUMMARY,
    so the workflow run page shows what was done at a glance."""
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    pattern_id = result.get("pattern_id", "—")
    action = result.get("action", "—")
    lines = [
        "## auto-fix-known-failures",
        "",
        f"- Workflow: `{result.get('workflow_name')}`",
        f"- Run: [{result.get('run_id')}](https://github.com/luisa-sys/lyra/actions/runs/{result.get('run_id')})",
        f"- Pattern: `{pattern_id}`",
        f"- Action: `{action}`",
    ]
    if "label" in result:
        lines.append(f"- Label: `{result['label']}`")
    if "issue" in result:
        lines.append(f"- Issue: #{result['issue']}")
    if "pr" in result:
        lines.append(f"- PR: #{result['pr']}")
    Path(summary_path).write_text(
        (Path(summary_path).read_text() if Path(summary_path).exists() else "")
        + "\n".join(lines)
        + "\n"
    )


# ── Main: live mode ─────────────────────────────────────────────────────


def handle_live(args: argparse.Namespace) -> int:
    patterns = load_patterns()
    run_id = args.run_id
    workflow_name = args.workflow_name
    log = fetch_failed_log(run_id)
    if not log.strip():
        # Run had no failed steps — likely cancelled or success. No-op.
        print(f"::notice::Run {run_id} has no failed-step logs; nothing to triage.")
        return 0
    classification = classify(log, workflow_name, patterns)
    if classification is None:
        excerpt = strip_ansi(log)
        result = remediate_unknown(workflow_name, run_id, excerpt, args.dry_run)
        result.update({"workflow_name": workflow_name, "run_id": run_id, "pattern_id": "unknown"})
        print(f"::warning::Unknown failure pattern — opened issue #{result.get('issue')}.")
        emit_step_summary(result)
        # Exit 1 to make the auto-fix workflow itself show as failed when
        # we couldn't fix anything — this keeps the noise visible.
        return 1
    pattern, match = classification
    handler = REMEDIATION_DISPATCH.get(pattern.remediation["kind"])
    if handler is None:
        print(
            f"::error::Pattern {pattern.id} declares unknown remediation kind "
            f"{pattern.remediation['kind']!r}; check scripts/auto-fix-patterns.json."
        )
        return 1
    result = handler(pattern, match, run_id, workflow_name, args.dry_run)
    result.update({"workflow_name": workflow_name, "run_id": run_id, "pattern_id": pattern.id})
    print(f"::notice::Matched pattern {pattern.id} → action: {result.get('action')}")
    emit_step_summary(result)
    return 0 if result.get("ok") else 1


# ── Main: self-test mode ────────────────────────────────────────────────


# Map fixture filename → expected pattern id. This is the source-of-truth
# regression contract: every pattern in the catalogue must classify its
# fixture, and the fixture/pattern wiring must stay consistent.
FIXTURE_EXPECTATIONS: dict[str, tuple[str, str]] = {
    "anomaly-detect.log": ("anomaly-detect", "anomaly-missing-github-label"),
    "beta-gate-smoke.log": ("beta-gate-smoke", "vercel-automation-bypass-rotated"),
    "staging-tests.log": ("staging-tests", "lighthouse-seo-on-noindex-target"),
    "affiliate-link-smoke.log": ("affiliate-link-smoke", "affiliate-smoke-locale-mismatch"),
    "auto-promote-to-staging.log": (
        "auto-promote-to-staging",
        "lyra-release-pat-insufficient-scopes",
    ),
}


def handle_self_test(_args: argparse.Namespace) -> int:
    patterns = load_patterns()
    pattern_by_id = {p.id: p for p in patterns}
    failures: list[str] = []

    # 1. Every catalogued pattern must have a fixture (otherwise the
    #    regex is untested and may rot silently).
    expected_ids = {pat_id for (_wf, pat_id) in FIXTURE_EXPECTATIONS.values()}
    for p in patterns:
        if p.id not in expected_ids:
            failures.append(
                f"pattern {p.id!r} has no fixture in FIXTURE_EXPECTATIONS; add one"
                f" to tests/fixtures/auto-fix-logs/ so the regex is tested."
            )

    # 2. Every fixture must classify to its expected pattern.
    for fixture_name, (workflow_name, expected_pid) in FIXTURE_EXPECTATIONS.items():
        path = FIXTURES_DIR / fixture_name
        if not path.exists():
            failures.append(f"fixture missing: {path}")
            continue
        text = path.read_text(errors="replace")
        result = classify(text, workflow_name, patterns)
        if result is None:
            failures.append(
                f"fixture {fixture_name}: expected pattern {expected_pid!r} but no pattern matched"
            )
            continue
        matched_pattern, _m = result
        if matched_pattern.id != expected_pid:
            failures.append(
                f"fixture {fixture_name}: expected {expected_pid!r}, got {matched_pattern.id!r}"
            )

    # 3. Cross-fixture cleanliness: no pattern should match a fixture
    #    that's NOT its own (false-positive guard).
    for fixture_name, (workflow_name, expected_pid) in FIXTURE_EXPECTATIONS.items():
        path = FIXTURES_DIR / fixture_name
        if not path.exists():
            continue
        text = strip_ansi(path.read_text(errors="replace"))
        for p in patterns:
            if p.id == expected_pid:
                continue
            # Only test cross-matches where the workflow name would route
            # us to the same pattern — otherwise the workflow gate already
            # protects us. Here, force workflow mismatch by ignoring the
            # workflow filter and seeing whether the REGEX alone fires.
            if p.regex.search(text):
                # Allow if the pattern's workflows would never overlap
                # with this fixture's workflow.
                overlap = any(
                    w.strip().lower() == workflow_name.strip().lower()
                    for w in p.workflows
                )
                if overlap:
                    failures.append(
                        f"fixture {fixture_name}: pattern {p.id!r} regex matches "
                        f"a different fixture's content AND shares a workflow — false positive"
                    )

    # 4. Every pattern's remediation kind is known.
    known_kinds = set(REMEDIATION_DISPATCH.keys())
    for p in patterns:
        kind = p.remediation.get("kind")
        if kind not in known_kinds:
            failures.append(
                f"pattern {p.id!r} has unknown remediation kind {kind!r}; "
                f"add a handler to REMEDIATION_DISPATCH in scripts/auto-fix-known-failures.py"
            )

    if failures:
        print("self-test FAILED:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"self-test OK — {len(patterns)} patterns × {len(FIXTURE_EXPECTATIONS)} fixtures classified correctly")
    # Acknowledge unused arg & dispatch for IDE.
    _ = pattern_by_id
    return 0


# ── CLI ─────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="Run classifier regression checks against fixtures.")
    parser.add_argument("--run-id", help="The failed workflow run ID to triage.")
    parser.add_argument("--workflow-name", help="Display name of the workflow that failed.")
    parser.add_argument("--dry-run", action="store_true", help="Classify only; do not call gh to take actions.")
    args = parser.parse_args()

    if args.self_test:
        return handle_self_test(args)

    if not args.run_id or not args.workflow_name:
        parser.error("either --self-test, or both --run-id and --workflow-name, are required")
        return 2

    return handle_live(args)


if __name__ == "__main__":
    sys.exit(main())
