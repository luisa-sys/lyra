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

# WHERE THAT EXPRESSION IS EVALUATED, and why it is not in the step's `if:`
# (SEC-165). The `secrets` context is NOT available in `jobs.<id>.steps[*].if`.
# GitHub's context-availability table lists env, github, inputs, job, matrix,
# needs, runner, steps, strategy and vars there — and not secrets. Written as
# `if: ${{ secrets.X != '' }}` the whole workflow file is INVALID: measured on
# this repository, 43 runs, every one `failure`, zero jobs started, zero
# successes, and not one scheduled run ever executed. CTL-068 could not fire.
#
# `jobs.<id>.env` DOES get the secrets context, so the presence test is
# evaluated there and the step reads the result through `env`, which a step
# `if:` can see. The comparison happens inside the `${{ }}`, so what lands in
# the environment is the literal string "true" or "false" — never the secret's
# VALUE. That invariant is the reason for the shape; do not "simplify" it to
# `HAS_X: ${{ secrets.X }}`, which would put the credential itself into the
# environment of every step in the job.
ENV_PREFIX = "PROBE_HAS_"
ENV_TRUE = "true"

# How the two halves are recognised when reading a generated file back.
ENV_LINE_RE = re.compile(
    r"^\s*" + ENV_PREFIX + r"([A-Z][A-Z0-9_]*):\s*\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*!=\s*''\s*\}\}\s*$",
    re.MULTILINE,
)
STEP_IF_RE = re.compile(
    r"^\s*if:\s*env\." + ENV_PREFIX + r"([A-Z][A-Z0-9_]*)\s*==\s*'" + ENV_TRUE + r"'\s*$",
    re.MULTILINE,
)
# Any step-level `if:` reaching for the secrets context — the SEC-165 defect.
# Kept as a named pattern so the regression is detectable rather than merely
# absent from a lint baseline.
BAD_STEP_IF_RE = re.compile(r"^\s*if:\s*\$\{\{\s*secrets\.", re.MULTILINE)

# The checkout pin the generator writes when it has nothing better to copy.
# ⚠️ IT IS A FALLBACK, NOT THE SOURCE OF TRUTH. `--write` preserves whatever
# pin the committed workflow already carries, because dependabot bumps this
# file directly and `check()` compares only secret NAMES — so without the
# preservation a routine regeneration would silently revert a security update
# with nothing going red. Preserving rather than asserting is deliberate: a
# gate demanding the generator be edited alongside the workflow would be
# unsatisfiable for dependabot, which is gotcha #34 exactly.
DEFAULT_CHECKOUT = "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v6"
CHECKOUT_RE = re.compile(r"uses:\s*(actions/checkout@[0-9a-f]{40}[^\n]*)")


def current_checkout(text: str | None) -> str | None:
    """The `actions/checkout` pin already in a generated probe, if any."""
    if not text:
        return None
    m = CHECKOUT_RE.search(text)
    return m.group(1).strip() if m else None


def simulate(probe_text: str, present: set[str]) -> set[str]:
    """Which steps FIRE, given `present` as the set of secrets that exist.

    Reads the generated text and applies GitHub's documented semantics for the
    two expressions this generator emits — a job-level `env:` value computed
    from the secrets context, and a step-level `if:` comparing that value.

    ⚠️ STATED GAP: this MODELS GitHub's evaluation, it does not execute it.
    What it can prove is that the two halves agree and point the right way —
    that a present secret reaches the failing branch and an absent one does
    not. What it cannot prove is that GitHub accepts the file; only a real run
    does that, and the SEC-165 measurement (43 runs, 0 jobs) is what showed the
    previous shape did not.
    """
    env: dict[str, bool] = {}
    for var, secret in ENV_LINE_RE.findall(probe_text):
        # The name in the env key and the name in the expression must agree, or
        # a step would be gated on a different secret than the one it names.
        if var == secret:
            env[var] = secret in present
    return {var for (var,) in ((m,) for m in STEP_IF_RE.findall(probe_text)) if env.get(var)}


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


def render(names: list[str], checkout: str | None = None) -> str:
    """The full probe workflow for `names`.

    `checkout` carries the existing `actions/checkout` pin forward; see
    DEFAULT_CHECKOUT for why it is preserved rather than asserted.
    """
    checkout = checkout or DEFAULT_CHECKOUT
    # An EMPTY ledger is the correct steady state, so it must render a valid
    # workflow. A bare `env:` with no mapping under it is null, which actionlint
    # rejects — so the block is omitted entirely rather than left dangling.
    env_lines = "".join(
        f"      {ENV_PREFIX}{name}: ${{{{ {PROBE_EXPR.format(name=name)} }}}}\n"
        for name in names
    )
    env_block = f"    env:\n{env_lines}" if names else ""
    steps = []
    for name in names:
        steps.append(
            f"""      - name: {name} must still be absent
        if: env.{ENV_PREFIX}{name} == '{ENV_TRUE}'
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
# WHY THE PRESENCE TEST IS AT JOB LEVEL AND NOT IN THE STEP'S `if:` (SEC-165):
# the `secrets` context is NOT available in a step-level `if:`. Written that
# way this file is INVALID and GitHub refuses to run it at all -- measured on
# this repository as 43 runs, every one `failure`, zero jobs started and not a
# single scheduled run. `jobs.<id>.env` does get the secrets context, so the
# comparison happens there and each step reads the RESULT through `env`.
#
# No secret VALUE is ever read, logged or compared here: only the boolean
# `!= ''`. The comparison is inside the `${{{{ }}}}`, so what reaches the
# environment is the string "true" or "false", never the credential.

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
{env_block}    steps:
      - name: Check out
        uses: {checkout}

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

    # ---- SEC-165: the presence test must be evaluated where GitHub provides
    # the context, and the step must FIRE on presence. The previous shape put
    # `secrets.X` in the step's own `if:`, which made the whole file invalid —
    # 43 runs, 0 jobs, 0 successes, and the control never once executed.
    # ⚠️ These two expected values are written out as LITERALS, deliberately.
    # Building them from ENV_PREFIX/ENV_TRUE would derive the oracle from the
    # subject (catalogue failure mode 10): flipping ENV_TRUE to "false" changes
    # the generated file AND the expectation together, and the case stays
    # green. Measured — that mutation reddened the jest suite, which uses
    # literals, and not this self-test, which did not.
    case(
        "the presence test is evaluated at JOB level, where secrets exists",
        "      PROBE_HAS_ALPHA_TOKEN: ${{ secrets.ALPHA_TOKEN != '' }}" in txt,
    )
    case(
        "the step reads that result through env, which a step `if:` CAN see",
        "if: env.PROBE_HAS_ALPHA_TOKEN == 'true'" in txt,
    )
    case(
        "NO step-level `if:` reaches for the secrets context (the defect)",
        BAD_STEP_IF_RE.search(txt) is None,
    )

    # The firing branch, driven in both directions. This is the half that was
    # missing and is how a control invalid since the day it was written went
    # unnoticed: nothing had ever asked what happens when a secret IS present.
    case(
        "a PRESENT secret reaches the failing step",
        simulate(txt, {"ALPHA_TOKEN"}) == {"ALPHA_TOKEN"},
    )
    case(
        "an ABSENT secret does not — a clean ledger stays green",
        simulate(txt, set()) == set(),
    )
    case(
        "every entry can fire, not just the first",
        simulate(txt, {"ALPHA_TOKEN", "BETA_TOKEN"}) == {"ALPHA_TOKEN", "BETA_TOKEN"},
    )
    case(
        "…and only the present one fires when they differ",
        simulate(txt, {"BETA_TOKEN"}) == {"BETA_TOKEN"},
    )

    # The checkout pin is CARRIED FORWARD, not re-asserted from this file.
    # Without this, a dependabot bump of the generated workflow is silently
    # reverted by the next --write and nothing goes red (check() compares only
    # secret names). Asserting equality instead would make the gate
    # unsatisfiable for dependabot — gotcha #34.
    bumped = txt.replace(
        DEFAULT_CHECKOUT, "actions/checkout@" + "b" * 40 + " # v7"
    )
    case("a bumped checkout pin is detected", current_checkout(bumped) is not None)
    case(
        "…and regenerating PRESERVES it rather than reverting the bump",
        current_checkout(render(led, current_checkout(bumped)))
        == current_checkout(bumped),
    )
    case(
        "with no prior file, the default pin is used",
        current_checkout(render(led, current_checkout(None))) == DEFAULT_CHECKOUT,
    )

    # An empty ledger renders a valid workflow and agrees with itself. The
    # correct steady state for this file is EMPTY, so it must not be a special
    # case that crashes.
    empty = render([])
    case("an empty ledger is valid, not an error", check([], empty) == [])
    case("an empty probe checks nothing", probe_names(empty) == [])
    case(
        "an empty ledger emits NO dangling `env:` key (null, which is invalid)",
        "\n    env:\n" not in empty,
    )
    case("an empty probe fires nothing whatever exists", simulate(empty, {"X"}) == set())

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
    # 25 cases today; the floor is 24 because the last one is conditional on
    # the real ledger + probe existing in the working directory. SEC-165 took
    # this from 13 to 24 — eleven of the additions drive the FIRING branch and
    # the shape it now depends on.
    minimum = 24
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
    ap.add_argument(
        "--simulate",
        metavar="NAMES",
        help="comma-separated secrets to treat as PRESENT; prints which steps "
        "of the committed probe would fire. Read-only; for tests and for "
        "answering 'would this actually catch it?' without waiting a week "
        "for the schedule.",
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if args.simulate is not None:
        if not PROBE_PATH.exists():
            print(f"::error::{PROBE_PATH} is missing — cannot decide. Failing closed.")
            return 2
        present = {n.strip() for n in args.simulate.split(",") if n.strip()}
        firing = simulate(PROBE_PATH.read_text(encoding="utf-8"), present)
        for name in sorted(firing):
            print(f"FIRES {name}")
        print(f"simulate: {len(firing)} step(s) would fail")
        return 0

    if not ABSENT_PATH.exists():
        print(f"::error::{ABSENT_PATH} is missing — cannot decide. Failing closed.")
        return 2

    ledger = load_absent_names()

    if args.write:
        PROBE_PATH.parent.mkdir(parents=True, exist_ok=True)
        existing = PROBE_PATH.read_text(encoding="utf-8") if PROBE_PATH.exists() else None
        PROBE_PATH.write_text(
            render(ledger, current_checkout(existing)), encoding="utf-8"
        )
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
