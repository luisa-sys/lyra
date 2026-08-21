#!/usr/bin/env python3
"""CTL-077 / KAN-356 §C — source-scanning tests are a two-way ratchet.

WHY
---
KAN-356 finding web-tests-06: the suite "mixes source-grep tests with
behavioural ones without distinction". CTL-038 and CTL-039 attack two specific
vacuous shapes — a test that reimplements its subject, and an assertion a
comment can satisfy — but neither CLASSIFIES a test as grep-vs-behavioural, and
neither bounds how many such tests the estate may hold. That is the half this
control adds.

`scripts/triage-source-text-tests.py` (KAN-414 F4) already does the
classification, and it is deliberately conservative: anything it cannot
confidently call structural stays in the `behavioural` bucket. It is TRIAGE —
it prints a report and nothing invokes it, so nothing stops the number growing.
A measurement nobody is accountable to is a number, not a control.

So this gate IMPORTS that classifier rather than restating it. Two copies of a
bucket regex would drift, and a test that reimplements its subject is exactly
the defect CTL-038 exists for — reproducing it inside the control that polices
it would be its own punchline.

WHAT IT MEASURES
----------------
Per test file, the count of assertion blocks in the `behavioural` bucket: a
block that reads source text with `readFileSync` where a positive, observable
assertion was available instead. Those are the CONVERTIBLE ones — the debt.

Structural buckets (absence, existence, migration, surface, ordering, copy-pin)
are NOT counted. Proving a pattern is absent, that a file exists, or what a
migration says cannot be observed by a running program, so converting them
produces a test that looks more modern and proves less. Counting them would
make the ratchet unpayable and therefore ignorable.

WHY PER FILE, NOT A TOTAL
-------------------------
An aggregate lets one file improve while another regresses and nets out green —
the blindness CTL-055 carried before its ESCALATED case. Keyed per file, a new
source scan in `auth/` cannot hide behind a conversion in `docs/`.

TWO-WAY, WHICH IS THE WHOLE POINT
---------------------------------
A list you may only add to is a suppression list. This fails in BOTH
directions:

  NEW / GROWN   a file not in the baseline, or one whose count rose. You added
                a source-text scan where a behavioural assertion was possible.
  STALE         a baselined count that is now too high, or a baselined file no
                longer in the tree. Someone did the work; the baseline must
                shrink to lock it in, or the next regression is free.

That second half is the one people forget to build, and it is what turned up a
live finding on the run that wrote this: CTL-036's `draft` entry failed as
STALE because production had quietly caught up.

USAGE
    python3 scripts/check-source-scan-inventory.py                  # gate
    python3 scripts/check-source-scan-inventory.py --write-baseline # regenerate
    python3 scripts/check-source-scan-inventory.py --self-test      # fixtures

EXIT CODES
    0  clean
    1  ratchet violated (NEW / GROWN / STALE)
    2  the check could not run — fail closed, never report a clean scan that
       never ran (SEC-109 contract; gotcha #30 is why this is asserted
       directly rather than inferred from an exit code).
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / "tests" / "support" / "source-scan-inventory-baseline.json"
TRIAGE = REPO / "scripts" / "triage-source-text-tests.py"

# The bucket that represents convertible debt. Everything else the triage
# script emits is structural — see the module docstring.
COUNTED_BUCKET = "behavioural"

# An annotation opts one file out, with a ticket, exactly as the sibling
# controls do. It is deliberately per-file and visible in the diff.
ANNOTATION = "source-scan-ok:"


def _load_triage():
    """Import the KAN-414 triage classifier as the single source of truth.

    The filename has hyphens, so it is not importable by name.
    """
    if not TRIAGE.is_file():
        return None
    spec = importlib.util.spec_from_file_location("_triage", TRIAGE)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def inventory(triage) -> dict[str, int]:
    """Per-file count of convertible source-scan blocks, over TRACKED tests."""
    out: dict[str, int] = {}
    for rel in sorted(triage.tracked_tests()):
        path = REPO / rel
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if ANNOTATION in text:
            continue
        counts: Counter = triage.classify(text)
        n = counts.get(COUNTED_BUCKET, 0)
        if n:
            out[rel] = n
    return out


def _read_baseline() -> dict[str, int] | None:
    try:
        data = json.loads(BASELINE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    entries = data.get("files")
    if not isinstance(entries, dict):
        return None
    return {k: int(v) for k, v in entries.items()}


def _write_baseline(current: dict[str, int]) -> None:
    BASELINE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "$schemaNotes": {
            "files": (
                "test file -> count of CONVERTIBLE source-scan assertion blocks "
                "(the triage script's 'behavioural' bucket). Structural scans "
                "-- absence, existence, migration, surface, ordering, copy-pin "
                "-- are not counted: they cannot be observed by a running "
                "program, so converting them proves less, not more."
            ),
            "ratchet": (
                "TWO-WAY and keyed per file. A new file or a risen count FAILS "
                "(you added a source scan where a behavioural assertion was "
                "possible). A count that is now lower than baselined, or a "
                "baselined file no longer in the tree, ALSO FAILS as STALE -- "
                "regenerate so the improvement is locked in. A list that may "
                "only grow is a suppression list."
            ),
            "regenerate": (
                "python3 scripts/check-source-scan-inventory.py "
                "--write-baseline"
            ),
            "control": "CTL-077 (KAN-356 web-tests-06)",
        },
        "_totals": {
            "files": len(current),
            "blocks": sum(current.values()),
        },
        "files": dict(sorted(current.items())),
    }
    BASELINE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def compare(current: dict[str, int], base: dict[str, int]) -> list[str]:
    """Return failure lines. Empty means clean."""
    failures: list[str] = []
    for rel in sorted(current):
        now, was = current[rel], base.get(rel)
        if was is None:
            failures.append(
                f"NEW    {rel}: {now} convertible source-scan block(s). "
                f"Assert what the code DOES, or annotate with "
                f"`{ANNOTATION} <JIRA-KEY> <reason>`."
            )
        elif now > was:
            failures.append(
                f"GROWN  {rel}: {was} -> {now} convertible source-scan block(s)."
            )
    for rel in sorted(base):
        now = current.get(rel)
        if now is None:
            failures.append(
                f"STALE  {rel}: baselined at {base[rel]} but the file now has "
                f"none (moved, deleted, converted or annotated). "
                f"Regenerate the baseline."
            )
        elif now < base[rel]:
            failures.append(
                f"STALE  {rel}: baselined at {base[rel]}, now {now}. "
                f"Regenerate so the improvement is locked in."
            )
    return failures


# --------------------------------------------------------------------------
# Self-test. Fixtures are assembled AT RUNTIME rather than committed, so this
# file stays genuinely in scope of every sibling control with no exclusion and
# no annotation -- the CTL-061 lesson, applied the way CTL-064 and CTL-076 do.
# An excluded file is a file the control has stopped covering.
# --------------------------------------------------------------------------
def self_test() -> int:
    failures: list[str] = []

    def check(name: str, got, want) -> None:
        if got != want:
            failures.append(f"{name}: expected {want!r}, got {got!r}")

    triage = _load_triage()
    if triage is None:
        print("::error::CTL-077 self-test: triage classifier is not importable.")
        return 2

    # -- the classifier itself, on assembled fixtures ----------------------
    read = "readFileSync(p)"
    behavioural = f"\n  test('x', () => {{ const s = {read}; expect(s).toContain('isSuspended'); }});"
    absence = f"\n  test('x', () => {{ const s = {read}; expect(s).not.toContain('foo'); }});"
    existence = "\n  test('x', () => { expect(existsSync(p)).toBe(true); });"
    ordering = f"\n  test('x', () => {{ const s = {read}; expect(s.indexOf('a')).toBeLessThan(s.indexOf('b')); }});"
    migration = f"\n  test('x', () => {{ const sql = {read}; expect(sql).toContain('enable row level security'); }});"

    check("behavioural counted", triage.classify(behavioural).get("behavioural"), 1)
    check("absence not counted", triage.classify(absence).get("behavioural"), None)
    check("existence not counted", triage.classify(existence).get("behavioural"), None)
    check("ordering not counted", triage.classify(ordering).get("behavioural"), None)
    check("migration not counted", triage.classify(migration).get("behavioural"), None)
    # A block with no source read at all is not inventory at any severity.
    check("no read -> nothing", triage.classify("\n  test('x', () => { expect(f()).toBe(1); });"), Counter())

    # -- the ratchet, both directions -------------------------------------
    check("clean", compare({"a": 2}, {"a": 2}), [])

    grown = compare({"a": 3}, {"a": 2})
    check("grown fires once", len(grown), 1)
    check("grown is GROWN", grown and grown[0].startswith("GROWN"), True)

    new = compare({"a": 2, "b": 1}, {"a": 2})
    check("new fires once", len(new), 1)
    check("new is NEW", new and new[0].startswith("NEW"), True)

    shrunk = compare({"a": 1}, {"a": 2})
    check("shrunk fires once", len(shrunk), 1)
    check("shrunk is STALE", shrunk and shrunk[0].startswith("STALE"), True)

    gone = compare({}, {"a": 2})
    check("gone fires once", len(gone), 1)
    check("gone is STALE", gone and gone[0].startswith("STALE"), True)

    # Per-file keying: one file improving must NOT net out another regressing.
    netted = compare({"a": 1, "b": 3}, {"a": 2, "b": 2})
    check("no netting out", len(netted), 2)
    check("netting reports GROWN", any(x.startswith("GROWN") for x in netted), True)
    check("netting reports STALE", any(x.startswith("STALE") for x in netted), True)

    # -- the annotation actually opts out ---------------------------------
    check("annotation token", ANNOTATION, "source-scan-ok:")

    # THE VERDICT IS READ HERE. SEC-140 / catalogue failure mode 9: eight
    # self-test cases were appended to a list nothing consumed, and three
    # mutations all reported "Self-test passed" with the count going UP.
    # Every check() above runs BEFORE this line.
    if failures:
        for f in failures:
            print(f"::error::CTL-077 self-test: {f}")
        print(f"Self-test FAILED ({len(failures)} of 18 cases).")
        return 1
    print("Self-test passed (18 cases).")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()

    # Fail closed on a precondition, asserted directly. Gotcha #30: never infer
    # "the search actually ran" from an exit code -- BSD and GNU grep disagree,
    # and a guard that reports a clean scan it never performed is the SEC-79
    # false green.
    if not (REPO / "tests").is_dir():
        print("::error::CTL-077: tests/ is missing or unreadable, so the scan "
              "did not run. Failing closed (exit 2).")
        return 2

    triage = _load_triage()
    if triage is None:
        print(f"::error::CTL-077: cannot import the classifier at {TRIAGE}. "
              f"Failing closed (exit 2) rather than reporting a clean scan.")
        return 2

    tracked = triage.tracked_tests()
    if not tracked:
        print("::error::CTL-077: `git ls-files tests` returned nothing, so the "
              "corpus is empty and every assertion below would be vacuous. "
              "Failing closed (exit 2).")
        return 2

    current = inventory(triage)

    if "--write-baseline" in argv:
        _write_baseline(current)
        print(
            f"Wrote {BASELINE.relative_to(REPO)}: {len(current)} files, "
            f"{sum(current.values())} convertible source-scan blocks."
        )
        return 0

    base = _read_baseline()
    if base is None:
        print(f"::error::CTL-077: baseline missing or unreadable at "
              f"{BASELINE.relative_to(REPO)}. Failing closed (exit 2) -- an "
              f"absent baseline must never read as a clean scan.")
        return 2

    failures = compare(current, base)
    if failures:
        for f in failures:
            print(f"::error::CTL-077: {f}")
        print(
            f"\nCTL-077 (KAN-356 web-tests-06): {len(failures)} finding(s).\n"
            f"A source-text scan proves a STRING is present. It cannot prove "
            f"the code does anything.\n"
            f"Regenerate after genuine improvement:\n"
            f"  python3 scripts/check-source-scan-inventory.py --write-baseline"
        )
        return 1

    print(
        f"CTL-077: source-scan inventory holds at {len(current)} files / "
        f"{sum(current.values())} convertible blocks. ✓"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
