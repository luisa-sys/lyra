#!/usr/bin/env python3
"""scripts/check-soak-classifier-coverage.py — BUGS-103 / CTL-069.

Every place the staging soak can emit FAIL must eventually be an EXTRACTED
classifier with unit tests covering both its PASS and its FAIL path. Inline
verdict logic is grandfathered and the list may only shrink.

WHY THIS EXISTS
---------------
BUGS-103: the soak's `C1-sitemap-fresh` clause asserted `Cache-Control:
no-store|no-cache` on a Next *metadata route*, whose loader hardcodes that
header to `public, max-age=0, must-revalidate`. The header is a CONSTANT — it
is byte-identical whether the route is force-dynamic or prerendered — so the
probe could never return PASS, and could not have detected SEC-100, the very
defect it existed for. It shipped red and stayed red for four days.

Two properties made that possible, and this control targets the second:

  1. The instrument did not vary with the property. No static check can catch
     that; it needed someone to measure real headers.
  2. **The decision was inline `run:`-style bash inside the soak script, so it
     was reachable by no test at all.** Nothing could have observed that its
     PASS branch was unreachable, because nothing executed its branches.

WHAT IS MEASURED, AND WHAT IS NOT
---------------------------------
This counts `record FAIL` sites in `scripts/staging-soak.sh` that are decided
INLINE. It does not — and cannot — judge whether a classifier's logic is
*correct*; BUGS-103's instrument was wrong in a way only measurement against a
real server could reveal. What it does guarantee is that the logic is
REACHABLE BY A TEST, which is the precondition for ever finding out.

Stating that plainly matters: a green run here means "these verdicts can be
tested", not "these verdicts are right".

WHY A RATCHET AND NOT A WALL
----------------------------
Four inline sites exist today. A rule that reddens all four on day one is a
rule someone turns off, and extracting them is real work with no urgency
attached. So: the current sites are baselined, a NEW one fails, and a baselined
site that has been extracted fails as STALE until the baseline is shrunk.

Keyed PER SITE, not as a total. An aggregate lets one clause improve while
another regresses and nets out green — the blindness CTL-055 had before it
learned to key on pairs.

EXTRACTION IS ONLY CREDITED IF IT IS TESTED
-------------------------------------------
A `scripts/classify-*.sh` with no test is not progress; it is the same
untestable decision in a new file. Each classifier must have a test file that
asserts BOTH verdicts, or this fails — otherwise "extract it" becomes a way to
leave the baseline without gaining anything.

Exit codes:
  0  coverage matches the baseline exactly
  1  a new inline site, a stale baseline entry, or an untested classifier
  2  could not decide (a required file is missing) — FAIL CLOSED

Usage:
  check-soak-classifier-coverage.py
  check-soak-classifier-coverage.py --write-baseline
  check-soak-classifier-coverage.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SOAK = Path("scripts/staging-soak.sh")
BASELINE = Path("tests/support/soak-classifier-baseline.json")
CLASSIFIER_GLOB = "classify-*.sh"
SCRIPTS_DIR = Path("scripts")
TESTS_DIR = Path("tests/scripts")

# `record FAIL "<id>"` — the id is either a literal clause name or `$id`, which
# is a shared helper parameterised over whichever clause called it.
RECORD_FAIL_RE = re.compile(r'record\s+FAIL\s+"([^"]+)"')

# A verdict delegated to an extracted classifier looks like
# `record "${verdict%% *}" "<id>" …` — the verdict is COMPUTED elsewhere, so it
# is not an inline decision and is not counted.
DELEGATED_RE = re.compile(r'record\s+"\$\{[^"]+\}"\s+"([^"]+)"')


def strip_comments(text: str) -> str:
    """Drop `#` comments so prose about `record FAIL` is not counted as one.

    This is failure mode 2 from CLAUDE.md's catalogue: the better a thing is
    documented, the more a source-text scan over it over-counts. This file and
    the soak script both DISCUSS `record FAIL` by name.
    """
    out = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        # Trailing comment, naive but adequate: bash strings here do not
        # contain '#', and a false negative would only ever UNDER-count a
        # comment, never miss real code.
        idx = line.find(" #")
        out.append(line[:idx] if idx != -1 else line)
    return "\n".join(out)


def inline_fail_sites(soak_text: str) -> list[str]:
    """Clause ids whose FAIL verdict is decided inline, de-duplicated + sorted."""
    body = strip_comments(soak_text)
    return sorted(set(RECORD_FAIL_RE.findall(body)))


def delegated_sites(soak_text: str) -> list[str]:
    body = strip_comments(soak_text)
    return sorted(set(DELEGATED_RE.findall(body)))


def classifier_test_path(classifier: Path) -> Path:
    """`scripts/classify-x.sh` -> `tests/scripts/classify-x.test.js`."""
    return TESTS_DIR / (classifier.stem + ".test.js")


def untested_classifiers(scripts_dir: Path = SCRIPTS_DIR) -> list[str]:
    """Extracted classifiers whose tests do not assert BOTH verdicts.

    Extraction without tests is the same untestable decision in a new file, so
    it must not be a way to leave the baseline for free.
    """
    problems: list[str] = []
    for c in sorted(scripts_dir.glob(CLASSIFIER_GLOB)):
        t = classifier_test_path(c)
        if not t.exists():
            problems.append(f"{c} has no test at {t}")
            continue
        text = t.read_text(encoding="utf-8")
        # Both verdicts must be asserted. A classifier tested only on its happy
        # path is exactly BUGS-103 — that probe's FAIL branch was the only one
        # reachable, and nobody noticed because nothing exercised either.
        if "PASS" not in text:
            problems.append(f"{t} never asserts a PASS verdict")
        if "FAIL" not in text:
            problems.append(f"{t} never asserts a FAIL verdict")
    return problems


def check(current: list[str], baseline: list[str], classifier_problems: list[str]) -> list[str]:
    problems: list[str] = list(classifier_problems)
    cur, base = set(current), set(baseline)

    for site in sorted(cur - base):
        problems.append(
            f"NEW inline soak verdict for {site!r}. Every `record FAIL` site must "
            "be an extracted, unit-tested classifier — inline logic is reachable "
            "by no test, which is how BUGS-103 stayed red for four days. Extract "
            "it to scripts/classify-<name>.sh with a test asserting both verdicts."
        )
    for site in sorted(base - cur):
        problems.append(
            f"STALE baseline entry {site!r}: it is no longer an inline verdict. "
            "Shrink the baseline: "
            "python3 scripts/check-soak-classifier-coverage.py --write-baseline"
        )
    return problems


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    def case(n: str, ok: bool) -> None:
        cases.append((n, ok))

    sample = """
    #!/usr/bin/env bash
    # This comment mentions record FAIL "C9-decoy" and must NOT be counted.
    record FAIL "C1-gate" "root served 200"
    record PASS "C1-gate" "gated"
    record FAIL "$id" "generic helper"
    record "${v%% *}" "C1-sitemap-fresh" "delegated"
    """
    sites = inline_fail_sites(sample)
    case("an inline record FAIL is detected", "C1-gate" in sites)
    case("a shared helper's $id site is detected", "$id" in sites)
    case("a COMMENT mentioning record FAIL is not counted", "C9-decoy" not in sites)
    case(
        "a delegated verdict is NOT an inline site",
        "C1-sitemap-fresh" not in sites,
    )
    case(
        "…and it is recognised as delegated",
        "C1-sitemap-fresh" in delegated_sites(sample),
    )

    # Ratchet, both directions.
    case("baseline matching current is clean", check(["a", "b"], ["a", "b"], []) == [])
    case("a NEW inline site fails", len(check(["a", "b", "c"], ["a", "b"], [])) == 1)
    case("a STALE baseline entry fails", len(check(["a"], ["a", "b"], [])) == 1)
    case(
        "…and the stale message says to shrink, not to extract",
        "Shrink" in " ".join(check(["a"], ["a", "b"], [])),
    )
    case(
        "a new site and a stale entry are reported separately",
        len(check(["a", "c"], ["a", "b"], [])) == 2,
    )
    case(
        "an untested classifier fails even when the ratchet is clean",
        len(check(["a"], ["a"], ["classify-x.sh has no test"])) == 1,
    )

    # An empty soak would make the ratchet vacuously satisfiable; the real-file
    # case below is what stops that mattering, but assert the corpus anyway.
    case("an empty script yields no sites", inline_fail_sites("") == [])

    if SOAK.exists():
        real = inline_fail_sites(SOAK.read_text(encoding="utf-8"))
        # Assert the corpus is non-empty BEFORE trusting any verdict about it
        # (catalogue failure mode 4). A soak that had stopped emitting FAIL at
        # all would otherwise look like perfect coverage.
        case("the REAL soak script still has FAIL sites to measure", len(real) > 0)

    failures = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}")

    minimum = 12
    if len(cases) < minimum:
        print(f"::error::self-test corpus shrank: {len(cases)} < {minimum}")
        failures.append(f"corpus floor ({len(cases)} < {minimum})")

    print(f"self-test: {len(cases) - len(failures)}/{len(cases)} passed")
    if failures:
        for n in failures:
            print(f"::error::self-test FAILED: {n}")
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if not SOAK.exists():
        print(f"::error::{SOAK} is missing — cannot decide. Failing closed.")
        return 2

    soak_text = SOAK.read_text(encoding="utf-8")
    current = inline_fail_sites(soak_text)

    if args.write_baseline:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps(
                {
                    "$comment": [
                        "BUGS-103 / CTL-069 — soak verdicts still decided by INLINE",
                        "logic, i.e. reachable by no test. Shrink-only, two-way: a new",
                        "site fails, and an entry that has been extracted fails as",
                        "STALE until removed.",
                        "",
                        "Generated by scripts/check-soak-classifier-coverage.py",
                        "--write-baseline. Never hand-edit: a hand-typed number is",
                        "catalogue failure mode 8.",
                        "",
                        "To leave this list, extract the decision to",
                        "scripts/classify-<name>.sh and give it a test asserting BOTH",
                        "verdicts. Extraction without tests is not progress and is",
                        "rejected separately.",
                    ],
                    "inline_fail_sites": current,
                    "count": len(current),
                    "delegated_sites": delegated_sites(soak_text),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {BASELINE}: {len(current)} inline site(s).")
        return 0

    if not BASELINE.exists():
        print(f"::error::{BASELINE} is missing — cannot decide. Failing closed.")
        print("::error::  Generate it with --write-baseline.")
        return 2

    baseline = json.loads(BASELINE.read_text(encoding="utf-8")).get(
        "inline_fail_sites", []
    )
    problems = check(current, baseline, untested_classifiers())

    if problems:
        for p in problems:
            print(f"::error::{p}")
        return 1

    print(
        f"Soak verdict coverage matches the baseline: {len(current)} inline "
        f"site(s) remaining, {len(delegated_sites(soak_text))} extracted and tested. ✓"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
