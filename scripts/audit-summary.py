#!/usr/bin/env python3
"""CTL-050 / SEC-136 — read an `npm audit --json` report, or FAIL LOUDLY.

WHY THIS EXISTS
---------------
The Wednesday security audit is the repo's standing dependency-vulnerability
control. Both of its halves used to convert a failure-to-measure into a clean
result, so a run that never audited anything was indistinguishable from a run
that found nothing:

    HIGH=$(python3 -c "
    try:    ... print(high + critical)
    except: print(0)          # <- any parse failure reads as zero
    ")

`HIGH` fed the workflow's only failing step, guarded by
`if: steps.audit.outputs.high_critical_count != '0'`. So on a parse failure the
count was `0`, the `if:` was false, the step was SKIPPED, and the workflow
SUCCEEDED. `scripts/audit-to-email.py` did the same thing from the other side —
its `except` emitted `has_vulnerabilities: False`, which suppressed the alert
email. Green tick, no email, no annotation, nothing measured.

That is the SEC-79 shape (health-check.yml and weekly-report.yml sat disabled
for over a month while reporting green) and forbidden pattern #3 in the
Workflow & Backup Integrity Policy verbatim: *the report must distinguish "0"
from "fetch failed"*.

HOW THE PARSE ACTUALLY BROKE
----------------------------
The workflow merged stderr into the JSON:

    npm audit --json > /tmp/audit-results.json 2>&1

With `--json`, npm writes the report to stdout and warnings to stderr, so ANY
npm warning corrupts the document. npm emits them routinely — deprecation
notices, engine mismatches, config warnings — and this workflow pins Node 20,
which this repo already surfaces a deprecation warning for. Demonstrated:
a clean run parsed fine; prepending one realistic `npm warn config …` line
produced JSONDecodeError, and the old code turned that into `0`.

WHY A FILE RATHER THAN A HEREDOC
--------------------------------
The old parser lived inline in the YAML, where nothing can import or test it.
Workflow YAML is deliberately outside CTL-038's scope, so a `run:` block is
exactly where untested decision logic accumulates. This is a real script with
a `--self-test`, exercised on every PR.

CONTRACT
--------
Prints `high=<n> critical=<n> total=<n>` on success and exits 0.
On ANY failure to measure — missing file, unparseable body, a document that is
not an npm audit report — it prints `::error::` lines naming the cause and
exits 2. It never prints a count it did not read.

Exit 2 is deliberately distinct from 1: 1 would mean "ran, found something",
and a caller that cannot tell those apart is how this defect started.

USAGE
    python3 scripts/audit-summary.py <audit-results.json> [--stderr-log <path>]
    python3 scripts/audit-summary.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


class AuditReadError(RuntimeError):
    """Raised when the report cannot be read. Never swallowed into a count."""


def parse_report(text: str) -> dict[str, int]:
    """Extract the vulnerability counts, or raise.

    Validates that the document IS an npm audit report before trusting it —
    the backup-integrity rules in the same policy require exactly this of SQL
    dumps and JSON exports ("a JSON export does not parse, has success: false,
    or has zero records when records are expected"). A `{}` that parses is not
    a report that says zero.
    """
    if not text.strip():
        raise AuditReadError("audit report is empty — npm produced no output")

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        head = text.lstrip()[:120].replace("\n", " ")
        raise AuditReadError(
            f"audit report is not valid JSON ({exc}). First bytes: {head!r}. "
            f"If this looks like an npm warning, stderr is being merged into the "
            f"report — redirect it to its own file."
        ) from exc

    if not isinstance(data, dict):
        raise AuditReadError(f"audit report is a {type(data).__name__}, not an object")

    # npm audit v2+ always carries this. Its absence means we are holding
    # something else — an error envelope, a partial write, another tool's output.
    if "auditReportVersion" not in data and "metadata" not in data:
        keys = sorted(data)[:6]
        raise AuditReadError(
            f"document is not an npm audit report — no auditReportVersion or "
            f"metadata (top-level keys: {keys})"
        )

    vulns = data.get("metadata", {}).get("vulnerabilities")
    if not isinstance(vulns, dict):
        raise AuditReadError("audit report has no metadata.vulnerabilities object")

    counts: dict[str, int] = {}
    for level in ("info", "low", "moderate", "high", "critical"):
        v = vulns.get(level, 0)
        if not isinstance(v, int):
            raise AuditReadError(f"metadata.vulnerabilities.{level} is {v!r}, not an int")
        counts[level] = v
    counts["total"] = sum(counts.values())
    return counts


def self_test() -> int:
    failures: list[str] = []

    def expect_raises(label: str, text: str) -> None:
        try:
            parse_report(text)
        except AuditReadError:
            return
        failures.append(f"{label}: expected AuditReadError, got a clean parse")

    def expect_counts(label: str, text: str, want: dict[str, int]) -> None:
        try:
            got = parse_report(text)
        except AuditReadError as exc:
            failures.append(f"{label}: unexpected AuditReadError: {exc}")
            return
        for k, v in want.items():
            if got.get(k) != v:
                failures.append(f"{label}: {k} = {got.get(k)!r}, want {v!r}")

    ok = json.dumps(
        {
            "auditReportVersion": 2,
            "vulnerabilities": {},
            "metadata": {
                "vulnerabilities": {"info": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}
            },
        }
    )

    # The happy path must work, or every "it raises" case below passes for the
    # wrong reason.
    expect_counts("a well-formed report", ok, {"high": 3, "critical": 4, "total": 10})
    expect_counts(
        "a clean report reports zero",
        json.dumps({"auditReportVersion": 2, "metadata": {"vulnerabilities": {"high": 0}}}),
        {"high": 0, "critical": 0, "total": 0},
    )

    # Every way the old `except: print(0)` laundered a failure into a clean zero.
    expect_raises("an empty file", "")
    expect_raises("whitespace only", "   \n  ")
    expect_raises("an npm warning prepended to valid JSON", "npm warn config foo\n" + ok)
    expect_raises("an HTML error page", "<html>502 Bad Gateway</html>")
    expect_raises("a JSON array", "[]")
    expect_raises("a JSON null", "null")
    expect_raises("an empty object", "{}")
    expect_raises("an error envelope", '{"error": {"code": "ENOLOCK"}}')
    expect_raises("metadata without vulnerabilities", '{"auditReportVersion": 2, "metadata": {}}')
    expect_raises(
        "a non-integer count",
        '{"auditReportVersion": 2, "metadata": {"vulnerabilities": {"high": "many"}}}',
    )

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


SELF_TEST_CASES = 12


def main() -> int:
    ap = argparse.ArgumentParser(description="CTL-050 — read an npm audit report or fail closed")
    ap.add_argument("report", nargs="?", help="path to `npm audit --json` output")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument(
        "--stderr-log",
        help="npm's stderr, printed on failure — usually it explains the corruption",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if not args.report:
        print("::error::audit-summary: no report path given.")
        return 2

    path = Path(args.report)
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"::error::audit-summary: cannot read {path} — {exc}")
        print("::error::  Failing closed (exit 2): a report that cannot be read is NOT a clean audit.")
        return 2

    try:
        counts = parse_report(text)
    except AuditReadError as exc:
        print(f"::error::audit-summary: {exc}")
        print("::error::  Failing closed (exit 2). This is SEC-136: the previous version turned")
        print("::error::  any parse failure into `0 vulnerabilities`, which skipped the failing")
        print("::error::  step AND suppressed the alert email. Green tick, nothing measured.")
        if args.stderr_log:
            try:
                err = Path(args.stderr_log).read_text(encoding="utf-8", errors="replace").strip()
                if err:
                    print("::error::  npm stderr follows:")
                    for line in err.splitlines()[:20]:
                        print(f"::error::    {line}")
            except OSError:
                pass
        return 2

    # One `key=value` per line: readable by a human in the log AND appendable
    # straight to $GITHUB_OUTPUT, so the workflow never re-parses the report.
    counts["high_critical"] = counts["high"] + counts["critical"]
    for key in ("info", "low", "moderate", "high", "critical", "high_critical", "total"):
        print(f"{key}={counts[key]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
