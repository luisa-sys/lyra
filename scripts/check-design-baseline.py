#!/usr/bin/env python3
"""
CTL-040 — a move on a design-bearing surface must carry a recorded re-baseline.

WHY THIS EXISTS
---------------
The Claude Design -> dev build loop (KAN-441) keeps its source in a DIFFERENT,
PRIVATE repo: github.com/luisa-sys/lyra-design-system. This repo's CI cannot
read it. So the extraction DoD (docs/MODULARISATION_EXTRACTION_DOD.md section
2.2) could only ask a human to attest `EXTRACTION-DOD-DESIGN-SYSTEM: done`.

An attestation that is satisfied by typing a word is indistinguishable from no
control. That is the same defect class this programme has been chasing all
along — a comment-satisfied assertion (CTL-039) is a scan the prose satisfies;
a prose-only attestation is a gate the typist satisfies. One layer up, same
shape, same consequence: it passes for a reason unrelated to the thing it
claims to check.

The concrete failure it leaves open is recorded in KAN-419 section 5.1 and
restated in the DoD: `build.py` reads `src/app/globals.css` and reconstructs 21
`@dsCard` previews from page sources. Move one of those files and the
generator's source pointer breaks — loudly, but on the founder's machine, hours
later, with nothing warning the agent that moved it.

WHAT THIS ACTUALLY PROVES — AND WHAT IT DOES NOT
------------------------------------------------
It proves that whoever moved a design-bearing file opened the design repo, took
its head commit, and recorded it in `design/BASELINE.json` in the same PR. The
claim is then backed by a diff instead of a promise.

It does NOT prove the design system was really re-pointed and regenerated. CI
still cannot read that repo, so nothing here can. That limit is deliberate and
stated rather than papered over: this control raises the cost of a false
attestation from "type a word" to "go and look", which is the most any in-repo
check can do across a repo boundary it cannot cross.

Registering this as a control with an honest, narrow claim is the point. A
control whose stated scope exceeds what it verifies is worse than none, because
it is read as coverage.

EXIT CODES
  0  pass (including: no design-bearing move in this range)
  1  a design-bearing file moved and the baseline did not change
  2  cannot verify — fail closed

ENV
  BASE_REF   default origin/develop
  HEAD_REF   default HEAD

ESCAPE HATCH
  A commit trailer in the range:
      Design-Baseline-Ok: <JIRA-KEY> <reason>
  Requires a Jira key and a reason, and every active exception is printed on
  every run — the `UI-Change-Approved` loudness standard.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BASELINE_PATH = "design/BASELINE.json"

# Surfaces the design system is generated FROM. `build.py` reads globals.css for
# tokens and reconstructs page previews; components are the ui-kit. A move of
# anything at or under these breaks a pointer that lives outside this repo.
DESIGN_SURFACES = (
    "src/app/globals.css",
    "src/components/",
)
# Page/layout sources carry `@dsCard` previews. Matched by suffix so a move of
# any rendered route is caught, not just the ones that have a card today —
# a card added later must not silently fall outside the gate.
DESIGN_SUFFIXES = (".tsx",)
DESIGN_PREFIX_FOR_SUFFIX = "src/app/"

HATCH_RE = re.compile(
    r"^Design-Baseline-Ok:\s*([A-Z][A-Z0-9]+-\d+)\s+(\S.*)$",
    re.M,
)


class Unverifiable(Exception):
    """Raised when the check cannot reach a verdict. Always exit 2."""


def die_unverifiable(msg: str) -> None:
    print(f"::error::check-design-baseline: {msg}")
    print(
        "::error::  Failing closed (exit 2): a gate that cannot verify must "
        "never read as a pass."
    )
    sys.exit(2)


def git(*args: str) -> str:
    """Run git; anything but exit 0 is unverifiable, never a silent empty result."""
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), *args],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced as unverifiable, not swallowed
        raise Unverifiable(f"`git {' '.join(args)}` could not run: {exc}") from exc
    if out.returncode != 0:
        raise Unverifiable(
            f"`git {' '.join(args)}` failed (exit {out.returncode}): "
            f"{(out.stderr or out.stdout).strip()}"
        )
    return out.stdout


# --------------------------------------------------------------- pure logic
# Split out so the decision is testable without a git fixture. The guard test
# in tests/scripts/ drives the real git path end to end.


def is_design_bearing(path: str) -> bool:
    """Does a move of `path` invalidate something the design system points at?"""
    if any(
        path == s or path.startswith(s)
        for s in DESIGN_SURFACES
    ):
        return True
    return path.startswith(DESIGN_PREFIX_FOR_SUFFIX) and path.endswith(DESIGN_SUFFIXES)


def moved_design_paths(name_status: str) -> list[str]:
    """Moved-FROM paths (D deleted, R renamed) that are design-bearing.

    A pure edit is not a move and is out of scope: the design system's pointer
    still resolves. It is relocation that breaks it.
    """
    found: list[str] = []
    for line in name_status.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status, old = parts[0], parts[1] if len(parts) > 1 else ""
        if not status or status[0] not in ("D", "R"):
            continue
        if old and is_design_bearing(old):
            found.append(old)
    return found


def read_baseline_ref(blob: str, where: str) -> str:
    """Parse a baseline_ref out of BASELINE.json content, or fail closed."""
    try:
        data = json.loads(blob)
    except json.JSONDecodeError as exc:
        raise Unverifiable(f"{BASELINE_PATH} at {where} is not valid JSON: {exc}") from exc
    ref = data.get("baseline_ref")
    if not isinstance(ref, str) or not ref.strip():
        raise Unverifiable(
            f"{BASELINE_PATH} at {where} has no non-empty string `baseline_ref`."
        )
    return ref.strip()


def hatches(commit_msgs: str) -> list[tuple[str, str]]:
    return [(m.group(1), m.group(2).strip()) for m in HATCH_RE.finditer(commit_msgs)]


# ------------------------------------------------------------------- driver


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    base_ref = os.environ.get("BASE_REF", "origin/develop")
    head_ref = os.environ.get("HEAD_REF", "HEAD")

    try:
        git("rev-parse", "--verify", "--quiet", base_ref)
    except Unverifiable:
        die_unverifiable(
            f"base ref '{base_ref}' not found — cannot compute the change range."
        )

    try:
        merge_base = git("merge-base", base_ref, head_ref).strip()
        if not merge_base:
            raise Unverifiable(f"no merge-base for {base_ref}..{head_ref}.")

        name_status = git("diff", "--name-status", "-M", merge_base, head_ref)
        moved = moved_design_paths(name_status)

        if not moved:
            print(
                "check-design-baseline: no design-bearing file was moved in this "
                "range — not a re-baseline PR. OK."
            )
            return 0

        print(
            f"check-design-baseline: {len(moved)} design-bearing move(s) detected:"
        )
        for p in moved:
            print(f"  moved: {p}")

        # Escape hatch, printed loudly whether or not it is needed.
        msgs = git("log", f"{merge_base}..{head_ref}", "--format=%B")
        active = hatches(msgs)
        if active:
            for key, reason in active:
                print(
                    f"::warning::check-design-baseline: EXCEPTION in force — "
                    f"{key}: {reason}"
                )
            print(
                "check-design-baseline: suppressed by an explicit, attributed "
                "exception. OK."
            )
            return 0

        head_blob = git("show", f"{head_ref}:{BASELINE_PATH}")
        head_ref_val = read_baseline_ref(head_blob, head_ref)

        try:
            base_blob = git("show", f"{merge_base}:{BASELINE_PATH}")
        except Unverifiable:
            # The baseline did not exist at the merge-base: this PR introduces
            # it. That IS a re-baseline, so it satisfies the gate.
            print(
                f"check-design-baseline: {BASELINE_PATH} is introduced by this "
                f"PR (ref {head_ref_val[:12]}). OK."
            )
            return 0

        base_ref_val = read_baseline_ref(base_blob, merge_base[:12])

        if head_ref_val == base_ref_val:
            print(
                f"::error::check-design-baseline: a design-bearing file moved, but "
                f"{BASELINE_PATH} still points at {base_ref_val[:12]}."
            )
            print(
                "::error::  Moving one of these files breaks a pointer held in a "
                "repo this CI cannot read (github.com/luisa-sys/lyra-design-system)."
            )
            print(
                "::error::  Re-point the design system, then record its new head "
                f"as `baseline_ref` in {BASELINE_PATH} in THIS PR."
            )
            print(
                "::error::  If the move genuinely cannot affect the design source, "
                "say so explicitly with a commit trailer:"
            )
            print("::error::      Design-Baseline-Ok: <JIRA-KEY> <reason>")
            return 1

        print(
            f"check-design-baseline: baseline moved {base_ref_val[:12]} -> "
            f"{head_ref_val[:12]}. OK."
        )
        return 0

    except Unverifiable as exc:
        die_unverifiable(str(exc))
        return 2  # unreachable; die_unverifiable exits


# --------------------------------------------------------------- self-test


def self_test() -> int:
    """Pin the decision logic against fixtures, including the cases that would
    make the gate vacuous if they regressed."""
    failures: list[str] = []

    def check(label: str, got, want) -> None:
        if got != want:
            failures.append(f"{label}: got {got!r}, want {want!r}")

    # Surfaces in scope.
    check("globals.css", is_design_bearing("src/app/globals.css"), True)
    check("component", is_design_bearing("src/components/ui/button.tsx"), True)
    check("page tsx", is_design_bearing("src/app/oauth/authorize/page.tsx"), True)
    check("nested page", is_design_bearing("src/app/dashboard/profile/page.tsx"), True)

    # Out of scope — a lib move does not break a design pointer, and treating
    # it as one would make every extraction PR demand a meaningless re-baseline
    # until people reached for the hatch by reflex.
    check("lib ts", is_design_bearing("src/lib/oauth/jwt.ts"), False)
    check("route ts", is_design_bearing("src/app/oauth/token/route.ts"), False)
    check("test", is_design_bearing("tests/unit/foo.test.ts"), False)
    # A prefix that merely *starts* like a surface must not match.
    check("near-miss", is_design_bearing("src/components-legacy/x.tsx"), False)

    # Move detection: only D and R count; a pure edit (M) does not.
    ns = (
        "M\tsrc/app/dashboard/page.tsx\n"
        "R100\tsrc/components/card.tsx\tsrc/ui/card.tsx\n"
        "D\tsrc/app/globals.css\n"
        "A\tsrc/app/new/page.tsx\n"
        "M\tsrc/lib/oauth/jwt.ts\n"
    )
    check(
        "moved set",
        moved_design_paths(ns),
        ["src/components/card.tsx", "src/app/globals.css"],
    )
    # The vacuity case: if this returned [] for a real move set the whole gate
    # would silently pass forever.
    check("moved non-empty", len(moved_design_paths(ns)) > 0, True)

    # Baseline parsing.
    check("ref parse", read_baseline_ref('{"baseline_ref":"abc123"}', "x"), "abc123")
    for bad, why in (
        ('{"baseline_ref":""}', "empty"),
        ('{"baseline_ref":null}', "null"),
        ("{}", "absent"),
        ("not json", "unparseable"),
    ):
        try:
            read_baseline_ref(bad, "x")
            failures.append(f"baseline {why}: should have raised Unverifiable")
        except Unverifiable:
            pass

    # Escape hatch must require BOTH a key and a reason.
    check("hatch ok", hatches("Design-Baseline-Ok: KAN-457 moved a test helper"),
          [("KAN-457", "moved a test helper")])
    check("hatch no reason", hatches("Design-Baseline-Ok: KAN-457"), [])
    check("hatch no key", hatches("Design-Baseline-Ok: because"), [])

    if failures:
        for f in failures:
            print(f"::error::self-test: {f}")
        print(f"check-design-baseline self-test: FAILED ({len(failures)})")
        return 1

    print("check-design-baseline self-test: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
