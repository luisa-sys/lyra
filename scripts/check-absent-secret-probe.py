#!/usr/bin/env python3
"""scripts/check-absent-secret-probe.py — SEC-158 / CTL-068.

Keeps `.github/workflows/absent-secrets-probe.yml` in lockstep with
`.github/absent-secrets.txt`, so the ledger of deliberately-absent secrets
gains the half it has always been missing: something that notices when an
absence stops being true.

WHY THIS EXISTS
---------------
`check-workflow-secret-refs.py` fails when a workflow names a secret listed in
NEITHER `.github/known-secrets.txt` nor `.github/absent-secrets.txt`. That is
one-directional. It never asks the reverse question — *is a recorded absence
still real?* — so an entry saying "this secret does not exist" passes forever
once the secret is provisioned. A list you may only add to is a suppression
list, not a ratchet.

Not hypothetical. `SUPABASE_ACCESS_TOKEN` sat in the absent ledger under ~20
lines asserting that CTL-049's ledger-parity job "fails LOUDLY every day". It
did not, and had not for some time: db-invariants run 31932614624 shows its
bare `[ -z ... ] && exit 1` presence step PASSING and three projects' migration
ledgers being read over the Management API.

The cost was not the one wrong line. The prose was confident, detailed and
false, so a reader triaging a red db-invariants run was pointed at the wrong
job entirely, and a session repeated the stale nag to the founder as an
outstanding action. Every spent entry also dilutes the ones still true.

WHY A GENERATED PROBE, AND NOT THE OBVIOUS ALTERNATIVES
------------------------------------------------------
* `gh secret list` needs `administration:read` — the SAME scope
  `BRANCH_PROTECTION_READ_TOKEN` is blocked on, and that token is itself an
  entry in this ledger. A control that depends on the gap it polices is not a
  control.
* `${{ secrets[NAME] }}` **cannot be indexed dynamically** in workflow YAML, so
  a loop over the ledger is not expressible. Each name must appear as a
  literal.

Hence: generate one `secrets.<NAME> != ''` expression per entry into a
workflow, and have THIS script assert the generated file still matches the
ledger. No new credential — a workflow can always read its own repository's
secrets context. The probe never reads a secret's VALUE, only the boolean.

WHAT EACH HALF CATCHES
----------------------
* **This script (PR time):** the probe and the ledger have drifted — an entry
  was added or removed without regenerating. A probe that silently stops
  covering an entry is the CTL-035 shape.
* **The probe (scheduled):** a secret listed as absent is in fact PRESENT.
  That is a state-of-the-world fact rather than a diff fact, so it cannot be
  checked at PR time — the same reason db-invariants runs on a schedule.

Exit codes:
  0  ledger and probe agree
  1  they have drifted — regenerate with --write
  2  could not decide (a required file is missing) — FAIL CLOSED

Usage:
  check-absent-secret-probe.py            # verify
  check-absent-secret-probe.py --write    # regenerate the probe workflow
  check-absent-secret-probe.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ABSENT_PATH = Path(".github/absent-secrets.txt")
PROBE_PATH = Path(".github/workflows/absent-secrets-probe.yml")

# A secret name GitHub will accept. Anything else must be rejected rather than
# interpolated into YAML — the ledger is a repo-controlled file, but a name
# carrying `}}` or a newline would let an entry rewrite the workflow around it.
# Validate at the boundary, not by hoping the input is well-formed.
SECRET_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")

# The literal each entry contributes to the generated workflow.
PROBE_EXPR = "secrets.{name} != ''"


def load_absent_names(path: Path = ABSENT_PATH) -> list[str]:
    """Ordered, de-duplicated secret names from the absent ledger."""
    names: list[str] = []
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name = stripped.partition("#")[0].strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def validate_names(names: list[str]) -> list[str]:
    return [n for n in names if not SECRET_NAME_RE.match(n)]


def probe_names(text: str) -> list[str]:
    """Secret names the generated probe actually evaluates."""
    return re.findall(r"secrets\.([A-Z][A-Z0-9_]*)\s*!=\s*''", text)


def render(names: list[str]) -> str:
    """The full probe workflow for `names`."""
    steps = []
    for name in names:
        steps.append(
            f"""      - name: {name} must still be absent
        if: ${{{{ {PROBE_EXPR.format(name=name)} }}}}
        run: |
          set -euo pipefail
          echo "::error::{name} is listed in .github/absent-secrets.txt as"
          echo "::error::  deliberately absent, but it EXISTS on this repository."
          echo "::error::"
          echo "::error::  The ledger is stale. Move {name} to"
          echo "::error::  .github/known-secrets.txt and delete its block from"
          echo "::error::  absent-secrets.txt, then regenerate this probe:"
          echo "::error::    python3 scripts/check-absent-secret-probe.py --write"
          echo "::error::"
          echo "::error::  Do NOT silence this by deleting the step -- the step is"
          echo "::error::  regenerated from the ledger and will come straight back."
          exit 1
"""
        )
    body = "".join(steps)
    return f"""# GENERATED BY scripts/check-absent-secret-probe.py -- DO NOT EDIT BY HAND.
#
# SEC-158 / CTL-068. One step per entry in .github/absent-secrets.txt, each
# asserting that the secret is STILL absent. Regenerate with:
#
#     python3 scripts/check-absent-secret-probe.py --write
#
# WHY THIS IS GENERATED RATHER THAN A LOOP: `${{{{ secrets[NAME] }}}}` cannot be
# indexed dynamically in workflow YAML, so every name must appear as a literal.
# check-absent-secret-probe.py runs on every PR and fails if this file and the
# ledger have drifted, which is what stops a regenerated-away entry from
# silently losing its cover.
#
# WHY A SCHEDULE RATHER THAN A PR CHECK: "is this secret present?" is a
# state-of-the-world fact, not a property of a diff. Nothing in a pull request
# can change it, and it can become true while no PR is open -- the same reason
# db-invariants.yml runs on a schedule.
#
# No secret VALUE is ever read, logged or compared here: only the boolean
# `!= ''`.

name: Absent-secret ledger freshness

on:
  schedule:
    # Weekly. A stale entry is a documentation defect, not an outage -- daily
    # would be noise for something that changes a few times a year.
    - cron: '0 7 * * 1'
  workflow_dispatch:

permissions:
  contents: read

defaults:
  run:
    shell: bash

jobs:
  probe:
    name: Every deliberately-absent secret is still absent
    runs-on: ubuntu-latest
    steps:
      - name: Check out
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v6

      - name: The probe matches the ledger
        # Belt and braces: if someone edits the ledger without regenerating,
        # the steps below would silently under-cover it. Fail here instead.
        run: |
          set -euo pipefail
          python3 scripts/check-absent-secret-probe.py

{body}      - name: Summary
        if: always()
        run: |
          set -euo pipefail
          {{
            echo "### Absent-secret ledger freshness"
            echo ""
            echo "Checked {len(names)} entr(y/ies) from .github/absent-secrets.txt."
            echo ""
            echo "A green run means every recorded absence is still real."
          }} >> "$GITHUB_STEP_SUMMARY"
"""


def check(ledger: list[str], probe_text: str) -> list[str]:
    """Return the list of problems; empty means the two agree."""
    problems: list[str] = []

    bad = validate_names(ledger)
    for name in bad:
        problems.append(
            f"{ABSENT_PATH}: {name!r} is not a valid secret name "
            "([A-Z][A-Z0-9_]*). Refusing to interpolate it into workflow YAML."
        )
    if bad:
        return problems

    covered = probe_names(probe_text)

    missing = [n for n in ledger if n not in covered]
    extra = [n for n in covered if n not in ledger]

    for name in missing:
        problems.append(
            f"{name} is in {ABSENT_PATH} but the probe does not check it. "
            "Regenerate: python3 scripts/check-absent-secret-probe.py --write"
        )
    for name in extra:
        problems.append(
            f"{name} is checked by the probe but is no longer in {ABSENT_PATH}. "
            "That entry was resolved; regenerate to drop the step."
        )

    # Duplicate coverage would make the count lie without changing the sets.
    if len(covered) != len(set(covered)):
        dupes = sorted({n for n in covered if covered.count(n) > 1})
        problems.append(f"the probe checks these more than once: {', '.join(dupes)}")

    return problems


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    def case(name: str, ok: bool) -> None:
        cases.append((name, ok))

    # A rendered probe agrees with the ledger it came from.
    led = ["ALPHA_TOKEN", "BETA_TOKEN"]
    txt = render(led)
    case("a freshly rendered probe agrees with its ledger", check(led, txt) == [])

    # An entry ADDED to the ledger without regenerating is caught.
    case(
        "a ledger entry the probe does not cover fails",
        len(check(led + ["GAMMA_TOKEN"], txt)) == 1,
    )

    # An entry REMOVED from the ledger without regenerating is caught. This is
    # the STALE half — without it the probe keeps checking a resolved entry.
    case(
        "a probe step whose ledger entry is gone fails",
        len(check(["ALPHA_TOKEN"], txt)) == 1,
    )
    case(
        "…and it says the entry was resolved, not that it is missing",
        "no longer in" in " ".join(check(["ALPHA_TOKEN"], txt)),
    )

    # The generated step must actually reference the secret, or the whole
    # mechanism is decorative.
    case("the rendered probe evaluates each name", set(probe_names(txt)) == set(led))
    case(
        "the rendered step is conditional on the secret being PRESENT",
        "if: ${{ secrets.ALPHA_TOKEN != '' }}" in txt,
    )

    # An empty ledger renders a valid workflow and agrees with itself. The
    # correct steady state for this file is EMPTY, so it must not be a special
    # case that crashes.
    empty = render([])
    case("an empty ledger is valid, not an error", check([], empty) == [])
    case("an empty probe checks nothing", probe_names(empty) == [])

    # Injection: a name that is not a plain identifier must be REFUSED, never
    # interpolated. The ledger is repo-controlled, but a name carrying `}}`
    # would let an entry rewrite the workflow around it.
    for bad in ["A B", "lower_case", "X}}${{ secrets.Y", "1LEADING", ""]:
        if not bad:
            continue
        case(
            f"an invalid secret name is refused: {bad!r}",
            len(check([bad], render([]))) >= 1,
        )

    # Duplicate coverage.
    case(
        "a probe checking the same name twice is a problem",
        len(check(["ALPHA_TOKEN"], render(["ALPHA_TOKEN", "ALPHA_TOKEN"]))) >= 1,
    )

    # The real files, if present, must agree — this is the case that would have
    # caught SEC-158 itself.
    if ABSENT_PATH.exists() and PROBE_PATH.exists():
        real = check(load_absent_names(), PROBE_PATH.read_text(encoding="utf-8"))
        case("the REAL ledger and probe agree", real == [])

    failures = [n for n, ok in cases if not ok]
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")

    # A floor, not a tally: "N/N passed" stays reassuring when N silently drops
    # (catalogue failure mode 8).
    minimum = 13
    if len(cases) < minimum:
        print(f"::error::self-test corpus shrank: {len(cases)} < {minimum}")
        failures.append(f"corpus floor ({len(cases)} < {minimum})")

    # Read the verdict AFTER every case has been appended (catalogue failure
    # mode 9 — SEC-140 added cases after the `if failures:` and they were never
    # evaluated).
    print(f"self-test: {len(cases) - len(failures)}/{len(cases)} passed")
    if failures:
        for name in failures:
            print(f"::error::self-test FAILED: {name}")
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write", action="store_true", help="regenerate the probe")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if not ABSENT_PATH.exists():
        print(f"::error::{ABSENT_PATH} is missing — cannot decide. Failing closed.")
        return 2

    ledger = load_absent_names()

    if args.write:
        PROBE_PATH.parent.mkdir(parents=True, exist_ok=True)
        PROBE_PATH.write_text(render(ledger), encoding="utf-8")
        print(f"Wrote {PROBE_PATH} covering {len(ledger)} entr(y/ies).")
        return 0

    if not PROBE_PATH.exists():
        print(f"::error::{PROBE_PATH} is missing — cannot decide. Failing closed.")
        print("::error::  Generate it: python3 scripts/check-absent-secret-probe.py --write")
        return 2

    problems = check(ledger, PROBE_PATH.read_text(encoding="utf-8"))
    if problems:
        for p in problems:
            print(f"::error::{p}")
        return 1

    print(
        f"The absent-secret probe covers all {len(ledger)} ledger entr(y/ies), "
        "and nothing more. ✓"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
