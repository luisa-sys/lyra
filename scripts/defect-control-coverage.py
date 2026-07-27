#!/usr/bin/env python3
"""SEC-101 — the Defect Feedback Loop engine.

THE PROBLEM THIS SOLVES
-----------------------
Lyra has closed 163 BUGS and SEC tickets. The same root causes keep coming
back: nine separate tickets for Postgres EXECUTE grants, eight for a
suspension guard added to one call site but not its siblings, fourteen for
release workflows that report SUCCESS while doing nothing. Each was fixed
properly. What was missing was the step *after* the fix — deciding what would
have caught it, and making that permanent.

Without that step, a bug fix is a one-off repair. With it, every defect
permanently raises the floor.

WHAT THIS DOES
--------------
Given the set of BUGS/SEC tickets closed in a period, cross-references
``controls/registry.json`` and reports:

  COVERED  the ticket appears in some control's ``prevents`` list — a control
           now exists that would have caught it
  GAP      the ticket is closed but no control claims it. Either a control
           needs building, or the defect needs recording as unpreventable with
           a reason. This is the queue the loop works from.

It also reports controls that claim tickets which are still OPEN — usually a
sign the control was written from the ticket's description before the fix
actually landed, and worth a second look.

Input comes from the routine's Jira query, not from this script: Jira access
belongs to the agent driving the routine, while the analysis needs to be
deterministic and testable. See docs/DEFECT_FEEDBACK_LOOP.md.

INPUT FORMAT (--closed-tickets)
    [ {"key": "BUGS-74", "summary": "...", "resolutiondate": "2026-07-26",
       "status": "Done", "labels": ["data-loss"]}, ... ]

EXIT CODES
    0  every closed defect in the window is covered by a control
    1  at least one gap — the loop has work to do (not a build failure;
       the routine turns these into tickets)
    2  malformed input or a missing registry

USAGE
    python3 scripts/defect-control-coverage.py --closed-tickets closed.json
    python3 scripts/defect-control-coverage.py --closed-tickets closed.json --format json
    python3 scripts/defect-control-coverage.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REGISTRY_PATH = Path("controls/registry.json")

# Defect classes that are, by agreed policy, not preventable by a pre-merge
# gate. A ticket carrying one of these labels is reported separately rather
# than as a gap. Keep this list SHORT and justified — it is the loop's only
# blanket exemption, and a long exemption list is how a feedback loop dies.
UNPREVENTABLE_LABELS = {
    "third-party-outage",
    "upstream-bug",
    "vendor-config",
}


def load_registry(path: Path = REGISTRY_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_coverage_index(registry: dict) -> dict[str, list[dict]]:
    """Map every ticket key -> the control(s) claiming to prevent it."""
    index: dict[str, list[dict]] = {}
    for control in registry.get("controls", []):
        for key in control.get("prevents") or []:
            index.setdefault(key.upper(), []).append(control)
    return index


def analyse(closed_tickets: list[dict], registry: dict) -> dict:
    index = build_coverage_index(registry)

    covered: list[dict] = []
    gaps: list[dict] = []
    exempt: list[dict] = []

    for ticket in closed_tickets:
        key = str(ticket.get("key", "")).upper()
        labels = {str(l).lower() for l in (ticket.get("labels") or [])}

        controls = index.get(key)
        if controls:
            covered.append(
                {
                    "key": key,
                    "summary": ticket.get("summary", ""),
                    "controls": [c["id"] for c in controls],
                }
            )
        elif labels & UNPREVENTABLE_LABELS:
            exempt.append(
                {
                    "key": key,
                    "summary": ticket.get("summary", ""),
                    "reason": sorted(labels & UNPREVENTABLE_LABELS),
                }
            )
        else:
            gaps.append({"key": key, "summary": ticket.get("summary", ""), "labels": sorted(labels)})

    total = len(closed_tickets)
    accounted = len(covered) + len(exempt)

    return {
        "total_closed": total,
        "covered": covered,
        "gaps": gaps,
        "exempt": exempt,
        "coverage_pct": round(100.0 * accounted / total, 1) if total else 100.0,
    }


def stale_claims(closed_keys: set[str], open_keys: set[str], registry: dict) -> list[dict]:
    """Controls claiming to prevent a ticket that is still open."""
    index = build_coverage_index(registry)
    out: list[dict] = []
    for key, controls in index.items():
        if key in open_keys and key not in closed_keys:
            out.append({"key": key, "controls": [c["id"] for c in controls]})
    return sorted(out, key=lambda r: r["key"])


# --- self-test (the "test the test" control) -------------------------------


def self_test() -> int:
    registry = {
        "controls": [
            {"id": "CTL-021", "prevents": ["BUGS-70", "BUGS-73", "BUGS-74"]},
            {"id": "CTL-023", "prevents": ["SEC-42", "SEC-43"]},
        ]
    }
    cases: list[tuple[str, bool]] = []

    result = analyse([{"key": "BUGS-74", "summary": "data loss"}], registry)
    cases.append(("a ticket a control claims is COVERED", len(result["covered"]) == 1 and not result["gaps"]))

    result = analyse([{"key": "BUGS-99", "summary": "new thing"}], registry)
    cases.append(("a ticket no control claims is a GAP", len(result["gaps"]) == 1))

    result = analyse([{"key": "bugs-74", "summary": "lowercase key"}], registry)
    cases.append(("ticket keys are matched case-insensitively", len(result["covered"]) == 1))

    result = analyse(
        [{"key": "BUGS-98", "summary": "vendor outage", "labels": ["third-party-outage"]}], registry
    )
    cases.append(("an exempt label is not a gap", len(result["exempt"]) == 1 and not result["gaps"]))

    result = analyse(
        [
            {"key": "BUGS-74", "summary": "covered"},
            {"key": "BUGS-99", "summary": "gap"},
            {"key": "BUGS-98", "summary": "exempt", "labels": ["upstream-bug"]},
        ],
        registry,
    )
    cases.append(("coverage percentage counts covered + exempt", result["coverage_pct"] == 66.7))

    result = analyse([], registry)
    cases.append(("an empty window is 100% and no gaps", result["coverage_pct"] == 100.0 and not result["gaps"]))

    stale = stale_claims(closed_keys={"SEC-42"}, open_keys={"SEC-43"}, registry=registry)
    cases.append(("a control claiming a still-open ticket is reported", len(stale) == 1 and stale[0]["key"] == "SEC-43"))

    failures = 0
    for label, ok in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::defect-control-coverage self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(cases)} case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--closed-tickets", help="JSON file of tickets closed in the window")
    parser.add_argument("--open-tickets", help="optional JSON file of still-open tickets, for stale-claim detection")
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    parser.add_argument("--format", choices=["text", "json"], default="text")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if not args.closed_tickets:
        print("::error::--closed-tickets is required (or use --self-test).")
        return 2

    registry_path = Path(args.registry)
    if not registry_path.exists():
        print(f"::error::registry '{registry_path}' not found.")
        return 2

    try:
        registry = load_registry(registry_path)
        closed = json.loads(Path(args.closed_tickets).read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"::error::could not read input: {exc}")
        return 2

    if not isinstance(closed, list):
        print("::error::--closed-tickets must contain a JSON array of ticket objects.")
        return 2

    result = analyse(closed, registry)

    if args.open_tickets:
        try:
            open_tickets = json.loads(Path(args.open_tickets).read_text(encoding="utf-8"))
            result["stale_claims"] = stale_claims(
                closed_keys={str(t.get("key", "")).upper() for t in closed},
                open_keys={str(t.get("key", "")).upper() for t in open_tickets},
                registry=registry,
            )
        except (json.JSONDecodeError, OSError) as exc:
            print(f"::warning::could not read --open-tickets: {exc}")

    if args.format == "json":
        print(json.dumps(result, indent=2))
        return 1 if result["gaps"] else 0

    print(f"Defect Feedback Loop — {result['total_closed']} closed defect(s) in window")
    print(f"Control coverage: {result['coverage_pct']}%")
    print()

    if result["covered"]:
        print(f"COVERED ({len(result['covered'])}) — a control now catches this class:")
        for row in result["covered"]:
            print(f"  ✓ {row['key']:<10} {', '.join(row['controls'])}  {row['summary'][:70]}")
        print()

    if result["exempt"]:
        print(f"EXEMPT ({len(result['exempt'])}) — agreed unpreventable by a pre-merge gate:")
        for row in result["exempt"]:
            print(f"  – {row['key']:<10} {', '.join(row['reason'])}  {row['summary'][:60]}")
        print()

    for row in result.get("stale_claims", []):
        print(
            f"::warning::{', '.join(row['controls'])} claims to prevent {row['key']}, "
            f"which is still OPEN. Confirm the control matches the shipped fix."
        )

    if result["gaps"]:
        print(f"GAPS ({len(result['gaps'])}) — closed with no control behind them:")
        for row in result["gaps"]:
            print(f"  ✗ {row['key']:<10} {row['summary'][:70]}")
        print()
        print("For each gap, do the prevention analysis (docs/DEFECT_FEEDBACK_LOOP.md §3):")
        print("  a) an existing control SHOULD have caught it → the control is defective;")
        print("     fix it and add a fixture to its self-test so the miss cannot recur")
        print("  b) no control exists → build one and register it in controls/registry.json")
        print("  c) genuinely unpreventable → record the reason and the owner who agreed")
        return 1

    print("Every closed defect in this window is accounted for by a control. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
