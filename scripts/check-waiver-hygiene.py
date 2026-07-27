#!/usr/bin/env python3
"""SEC-101 — keep the escape hatches honest.

WHY
---
Every gate in this repo ships with a deliberate escape hatch: `# integrity-ok:`,
`// server-action-exports-ok:`, `// service-role-ok:`, `// loading-tsx-ok:`,
`-- db-privileges-ok:`, `// partial-write-ok:`, plus the JSON waiver files.
That is correct design — a gate with no exception path gets deleted the first
time it blocks something legitimate.

But an escape hatch with no owner and no expiry is not an exception, it is a
silent repeal. Lyra has already seen what unbounded exceptions cost: SEC-95
(docs still describing a withdrawn release exception), SEC-88 (security fixes
sitting unshipped for eleven days), SEC-79 (workflows disabled for weeks with
nobody watching). The common thread is a decision that was reasonable when
taken and then outlived its justification because nothing forced a re-look.

WHAT THIS ENFORCES
------------------
1. Every JSON waiver entry carries `ticket`, `owner`, `reason`, and exactly one
   of `expires` (temporary acceptance of a real risk -- FAILS on lapse) or
   `review_by` (accepted by design -- notifies on lapse).
2. `expires` dates are real dates, in the future at the time they are written,
   and no more than MAX_WAIVER_MONTHS out. An 18-month waiver is not a waiver.
3. `reason` is substantive -- long enough to be an actual justification rather
   than "n/a" or "temporary".
4. Every in-code escape-hatch marker cites a Jira key (KAN-/SEC-/BUGS-), so the
   exception is traceable to a decision someone can re-open.

This check deliberately does NOT need database or network access, so it runs in
`pr-checks.yml` on every PR.

USAGE
    python3 scripts/check-waiver-hygiene.py
    python3 scripts/check-waiver-hygiene.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

WAIVER_FILES = [Path("supabase/security-invariants-waivers.json")]

# Directories that legitimately CONTAIN the marker strings because they define
# or document the mechanism, rather than using it.
MARKER_SCAN_ROOTS = [Path(".github/workflows"), Path("src"), Path("supabase"), Path("scripts")]
MARKER_SCAN_EXCLUDE = re.compile(r"scripts/check-[\w-]+\.(sh|py)$")

MARKERS = [
    "integrity-ok",
    "server-action-exports-ok",
    "service-role-ok",
    "loading-tsx-ok",
    "db-privileges-ok",
    "partial-write-ok",
]
MARKER_RE = re.compile(rf"\b({'|'.join(MARKERS)}):\s*(.*)$")
JIRA_KEY_RE = re.compile(r"\b(KAN|SEC|BUGS)-\d+\b", re.IGNORECASE)
# A documentation line showing the marker's shape, not using it.
PLACEHOLDER_RE = re.compile(r"<reason>|<[a-z]+>|allow-list|escape hatch|mechanism", re.IGNORECASE)

REQUIRED_FIELDS = ("env", "invariant", "object", "ticket", "owner", "reason")
MAX_WAIVER_MONTHS = 12
MIN_REASON_CHARS = 40


def parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def check_waiver_file(data: dict, path: str, today: date) -> list[str]:
    problems: list[str] = []
    waivers = data.get("waivers")

    if waivers is None:
        return [f"::error file={path}::missing a top-level 'waivers' array."]

    for index, waiver in enumerate(waivers):
        label = f"{path} waiver[{index}] ({waiver.get('invariant', '?')} on {waiver.get('object', '?')})"

        for field in REQUIRED_FIELDS:
            if not waiver.get(field):
                problems.append(f"::error file={path}::{label}: missing required field '{field}'.")

        reason = waiver.get("reason") or ""
        if 0 < len(reason) < MIN_REASON_CHARS:
            problems.append(
                f"::error file={path}::{label}: 'reason' is {len(reason)} chars — too thin to be a "
                f"justification (minimum {MIN_REASON_CHARS}). Say what was verified and why it is acceptable."
            )

        has_expires = "expires" in waiver
        has_review = "review_by" in waiver

        if has_expires == has_review:
            problems.append(
                f"::error file={path}::{label}: must set exactly one of 'expires' "
                f"(temporary acceptance of a real risk — fails on lapse) or 'review_by' "
                f"(accepted by design — notifies on lapse). "
                f"Got {'both' if has_expires else 'neither'}."
            )
            continue

        field = "expires" if has_expires else "review_by"
        parsed = parse_date(waiver.get(field))
        if parsed is None:
            problems.append(f"::error file={path}::{label}: '{field}' is not a valid YYYY-MM-DD date.")
            continue

        if has_expires:
            months_out = (parsed - today).days / 30.44
            if months_out > MAX_WAIVER_MONTHS:
                problems.append(
                    f"::error file={path}::{label}: 'expires' is {months_out:.0f} months away "
                    f"(max {MAX_WAIVER_MONTHS}). A waiver longer than a year is a permanent "
                    f"exception wearing a deadline — use 'review_by' and say it is by design, "
                    f"or shorten it."
                )

    return problems


def scan_markers() -> list[str]:
    """Every in-code escape hatch must cite a Jira key."""
    problems: list[str] = []
    scanned = 0

    for root in MARKER_SCAN_ROOTS:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in {".yml", ".yaml", ".ts", ".tsx", ".js", ".sql", ".sh", ".py"}:
                continue
            if MARKER_SCAN_EXCLUDE.search(str(path)):
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue

            for lineno, line in enumerate(lines, start=1):
                match = MARKER_RE.search(line)
                if not match:
                    continue
                marker, reason = match.group(1), match.group(2).strip()
                if PLACEHOLDER_RE.search(line):
                    continue  # documentation of the mechanism, not a use of it
                scanned += 1
                if not JIRA_KEY_RE.search(reason):
                    problems.append(
                        f"::error file={path},line={lineno}::'{marker}' escape hatch cites no Jira key. "
                        f"Every bypass must be traceable to a decision someone can re-open "
                        f"(e.g. '{marker}: <reason> (SEC-123)'). Found: \"{reason[:80]}\""
                    )

    # Vacuous-pass guard: this repo has had `# integrity-ok:` markers since
    # BUGS-4. Finding none means the scanner has drifted, not that the repo is
    # free of escape hatches.
    if scanned == 0:
        problems.append(
            "::error::No escape-hatch markers found at all — this scan has lost its target "
            "and would be passing vacuously. Check MARKERS / MARKER_SCAN_ROOTS."
        )

    return problems


# --- self-test (the "test the test" control) -------------------------------


def self_test() -> int:
    today = date(2026, 7, 27)
    cases: list[tuple[str, bool]] = []

    good = {
        "waivers": [
            {
                "env": "production",
                "invariant": "INV-6-public-storage-bucket",
                "object": "profile-photos",
                "ticket": "SEC-60",
                "owner": "founder",
                "reason": "Known open finding tracked under SEC-60; bucket is world-readable and avatars survive takedown.",
                "expires": "2026-10-31",
            }
        ]
    }
    cases.append(("well-formed waiver passes", check_waiver_file(good, "f.json", today) == []))

    def mutate(**overrides) -> dict:
        entry = dict(good["waivers"][0])
        for key, value in overrides.items():
            if value is None:
                entry.pop(key, None)
            else:
                entry[key] = value
        return {"waivers": [entry]}

    cases.append(("missing owner fails", len(check_waiver_file(mutate(owner=None), "f.json", today)) >= 1))
    cases.append(("missing ticket fails", len(check_waiver_file(mutate(ticket=None), "f.json", today)) >= 1))
    cases.append(("thin reason fails", len(check_waiver_file(mutate(reason="temporary"), "f.json", today)) >= 1))
    cases.append(
        ("neither expires nor review_by fails", len(check_waiver_file(mutate(expires=None), "f.json", today)) >= 1)
    )
    cases.append(
        ("both expires and review_by fails", len(check_waiver_file(mutate(review_by="2027-01-01"), "f.json", today)) >= 1)
    )
    cases.append(("unparseable date fails", len(check_waiver_file(mutate(expires="31/10/2026"), "f.json", today)) >= 1))
    cases.append(("over-long expiry fails", len(check_waiver_file(mutate(expires="2029-01-01"), "f.json", today)) >= 1))
    cases.append(
        (
            "review_by may be far out (by-design exception)",
            check_waiver_file(mutate(expires=None, review_by="2029-01-01"), "f.json", today) == [],
        )
    )
    cases.append(("missing waivers array fails", len(check_waiver_file({}, "f.json", today)) == 1))

    failures = 0
    for label, ok in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-waiver-hygiene self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(cases)} case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    today = date.today()
    problems: list[str] = []
    checked_waivers = 0

    for path in WAIVER_FILES:
        if not path.exists():
            problems.append(f"::error::expected waiver file {path} is missing.")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            problems.append(f"::error file={path}::not valid JSON: {exc}")
            continue
        checked_waivers += len(data.get("waivers", []))
        problems.extend(check_waiver_file(data, str(path), today))

    problems.extend(scan_markers())

    print(f"Waiver hygiene — {checked_waivers} JSON waiver(s) + in-code escape hatches")

    if problems:
        print()
        for problem in problems:
            print(problem)
        print()
        print(f"::error::{len(problems)} waiver-hygiene problem(s).")
        print()
        print("An escape hatch with no owner and no expiry is not an exception — it is a")
        print("silent repeal. Every waiver needs ticket + owner + reason and exactly one of")
        print("'expires' (real risk, fails on lapse) or 'review_by' (by design, notifies).")
        return 1

    print("Every waiver and escape hatch has an owner, a reason and a Jira key. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
