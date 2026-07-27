#!/usr/bin/env python3
"""SEC-101 — the meta-control: keep the control registry honest.

WHY A META-CONTROL
------------------
Controls rot silently. `health-check.yml` and `weekly-report.yml` sat disabled
for over a month before anyone noticed (SEC-79). The Daily Security routine's
own heartbeat stopped and the watchdog ended up flagging itself (SEC-87). The
admin monitoring badges reported green from a presence check rather than live
state (SEC-96, and the UptimeRobot diagnosis it misled). In every case the
control still *existed*; it just was not doing anything.

`controls/registry.json` is the durable memory of the Defect Feedback Loop —
which control stops which defect class, and which tickets it would have caught.
A registry that drifts from reality is worse than none, because it produces
false confidence in exactly the audits that are supposed to catch drift.

WHAT THIS ENFORCES
------------------
  1. Every registered control's `implementation` file EXISTS.
  2. Every control is REFERENCED by at least one file it claims to be wired
     into, and each `wired_in` file exists. A control nobody invokes is the
     SEC-79 failure mode.
  3. Every control names at least one real Jira key in `prevents` — a control
     with no defect behind it is speculative, and speculative gates are the
     ones that get switched off.
  4. Every `scripts/check-*.{sh,py}` in the repo is REGISTERED. A control that
     exists but is not in the registry is invisible to the feedback loop.
  5. Every declared `self_test` command names a file that exists.
  6. Control ids are unique and well-formed.

USAGE
    python3 scripts/check-control-registry.py
    python3 scripts/check-control-registry.py --self-test

Process: docs/DEFECT_FEEDBACK_LOOP.md
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REGISTRY_PATH = Path("controls/registry.json")
CONTROL_SCRIPT_GLOBS = ["scripts/check-*.sh", "scripts/check-*.py"]
JIRA_KEY_RE = re.compile(r"^(KAN|SEC|BUGS)-\d+$")
CONTROL_ID_RE = re.compile(r"^CTL-\d{3}$")

REQUIRED_FIELDS = ("id", "name", "defect_class", "summary", "implementation", "kind", "wired_in", "prevents")
VALID_KINDS = {"ci-gate", "test", "scheduled", "policy"}


def validate(registry: dict, repo_root: Path) -> list[str]:
    problems: list[str] = []
    controls = registry.get("controls")

    if not controls:
        return ["::error::registry has no 'controls' array — the registry is empty or malformed."]

    seen_ids: set[str] = set()
    registered_impls: set[str] = set()

    for control in controls:
        cid = control.get("id", "<no id>")

        for field in REQUIRED_FIELDS:
            if not control.get(field):
                problems.append(f"::error::{cid}: missing required field '{field}'.")

        if not CONTROL_ID_RE.match(str(control.get("id", ""))):
            problems.append(f"::error::{cid}: id must match CTL-NNN.")
        if control.get("id") in seen_ids:
            problems.append(f"::error::{cid}: duplicate control id.")
        seen_ids.add(control.get("id"))

        if control.get("kind") not in VALID_KINDS:
            problems.append(
                f"::error::{cid}: kind '{control.get('kind')}' is not one of {sorted(VALID_KINDS)}."
            )

        # 1. implementation exists
        impl = control.get("implementation")
        if impl:
            registered_impls.add(impl)
            impl_path = repo_root / impl
            if not impl_path.exists():
                problems.append(
                    f"::error::{cid}: implementation '{impl}' does not exist. "
                    f"A registered control that is not in the tree is a phantom control."
                )

        # 2. wired_in files exist AND actually invoke the implementation.
        #
        # "Invoke" means different things by kind, and conflating them produces
        # false failures that get the whole check disabled:
        #   ci-gate / scheduled — the workflow names the script directly
        #   test                — the workflow runs the TEST RUNNER, which
        #                         discovers the file by path convention. Naming
        #                         each test file in a workflow is not how Jest
        #                         works, so require runner invocation + a
        #                         discoverable path instead.
        #   policy              — no executable form; existence is the proof.
        wired_in = control.get("wired_in") or []
        impl_basename = Path(impl).name if impl else None
        kind = control.get("kind")
        referenced_anywhere = kind == "policy"

        for target in wired_in:
            target_path = repo_root / target
            if not target_path.exists():
                problems.append(f"::error::{cid}: wired_in target '{target}' does not exist.")
                continue

            if target == impl:
                # A workflow that IS the control (e.g. main-chain-guard.yml).
                referenced_anywhere = True
                continue

            try:
                content = target_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue

            if kind == "test":
                runs_runner = bool(re.search(r"\b(npm run test:unit|npm test|npx jest|jest)\b", content))
                discoverable = impl and (impl.startswith("tests/") or impl.startswith("src/"))
                if runs_runner and discoverable:
                    referenced_anywhere = True
            elif impl_basename and impl_basename in content:
                referenced_anywhere = True

        if wired_in and not referenced_anywhere:
            detail = (
                f"no wired_in target runs the test suite, or '{impl}' is outside the "
                f"runner's discovery roots (tests/, src/)"
                if kind == "test"
                else f"none of its wired_in targets reference '{impl_basename}'"
            )
            problems.append(
                f"::error::{cid}: {detail}. The control exists but nothing invokes it — "
                f"this is the SEC-79 'silently disabled' failure mode."
            )

        # 3. prevents must cite real Jira keys
        prevents = control.get("prevents") or []
        bad_keys = [k for k in prevents if not JIRA_KEY_RE.match(str(k))]
        if bad_keys:
            problems.append(f"::error::{cid}: 'prevents' contains malformed key(s): {bad_keys}")

        # 5. self_test command must name a file that exists
        self_test = control.get("self_test")
        if self_test:
            named = [tok for tok in self_test.split() if "/" in tok]
            for token in named:
                if not (repo_root / token).exists():
                    problems.append(f"::error::{cid}: self_test references missing file '{token}'.")

    # 4. every control script in the repo must be registered
    for pattern in CONTROL_SCRIPT_GLOBS:
        for path in sorted(repo_root.glob(pattern)):
            rel = str(path.relative_to(repo_root))
            if rel not in registered_impls:
                problems.append(
                    f"::error::'{rel}' is a control script but is not in {REGISTRY_PATH}. "
                    f"Add it, so the Defect Feedback Loop can see it."
                )

    return problems


# --- self-test (the "test the test" control) -------------------------------


def self_test() -> int:
    import tempfile

    cases: list[tuple[str, bool]] = []

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "scripts").mkdir()
        (root / ".github/workflows").mkdir(parents=True)
        (root / "scripts/check-thing.sh").write_text("#!/bin/bash\n")
        (root / ".github/workflows/pr.yml").write_text("run: bash scripts/check-thing.sh\n")

        good = {
            "controls": [
                {
                    "id": "CTL-001",
                    "name": "Thing",
                    "defect_class": "x",
                    "summary": "s",
                    "implementation": "scripts/check-thing.sh",
                    "kind": "ci-gate",
                    "wired_in": [".github/workflows/pr.yml"],
                    "prevents": ["BUGS-1"],
                }
            ]
        }
        cases.append(("well-formed registry passes", validate(good, root) == []))

        missing_impl = json.loads(json.dumps(good))
        missing_impl["controls"][0]["implementation"] = "scripts/check-ghost.sh"
        cases.append(("missing implementation fails", len(validate(missing_impl, root)) >= 1))

        # A control wired into a workflow that does not mention it.
        (root / ".github/workflows/unrelated.yml").write_text("run: echo hi\n")
        unwired = json.loads(json.dumps(good))
        unwired["controls"][0]["wired_in"] = [".github/workflows/unrelated.yml"]
        cases.append(("control nothing invokes fails", len(validate(unwired, root)) >= 1))

        # kind: test — invoked by the runner, not by filename.
        (root / "tests/unit").mkdir(parents=True)
        (root / "tests/unit/guard.test.ts").write_text("test('x', () => {});\n")
        (root / ".github/workflows/tests.yml").write_text("run: npm run test:unit\n")
        test_control = {
            "controls": [
                {
                    "id": "CTL-002",
                    "name": "Guard",
                    "defect_class": "x",
                    "summary": "s",
                    "implementation": "tests/unit/guard.test.ts",
                    "kind": "test",
                    "wired_in": [".github/workflows/tests.yml"],
                    "prevents": ["BUGS-1"],
                },
                good["controls"][0],
            ]
        }
        cases.append(
            ("test discovered by the runner passes", validate(test_control, root) == [])
        )

        # A test file the runner cannot discover must still fail.
        stray = json.loads(json.dumps(test_control))
        stray["controls"][0]["implementation"] = "misc/guard.test.ts"
        cases.append(("test outside the discovery roots fails", len(validate(stray, root)) >= 1))

        # A test wired into a workflow that never runs the runner must fail.
        no_runner = json.loads(json.dumps(test_control))
        no_runner["controls"][0]["wired_in"] = [".github/workflows/unrelated.yml"]
        cases.append(("test whose workflow never runs the runner fails", len(validate(no_runner, root)) >= 1))

        bad_ticket = json.loads(json.dumps(good))
        bad_ticket["controls"][0]["prevents"] = ["JIRA-oops"]
        cases.append(("malformed Jira key fails", len(validate(bad_ticket, root)) >= 1))

        bad_kind = json.loads(json.dumps(good))
        bad_kind["controls"][0]["kind"] = "vibes"
        cases.append(("invalid kind fails", len(validate(bad_kind, root)) >= 1))

        dupe = json.loads(json.dumps(good))
        dupe["controls"].append(json.loads(json.dumps(good["controls"][0])))
        cases.append(("duplicate id fails", len(validate(dupe, root)) >= 1))

        # An unregistered control script in the tree.
        (root / "scripts/check-orphan.py").write_text("# orphan\n")
        cases.append(("unregistered control script fails", len(validate(good, root)) >= 1))
        (root / "scripts/check-orphan.py").unlink()

        cases.append(("empty registry fails", len(validate({"controls": []}, root)) == 1))

    failures = 0
    for label, ok in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-control-registry self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(cases)} case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if not REGISTRY_PATH.exists():
        print(f"::error::{REGISTRY_PATH} is missing. The control registry is the memory of the")
        print("::error::Defect Feedback Loop — without it, nothing links defects to controls.")
        return 1

    try:
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"::error file={REGISTRY_PATH}::not valid JSON: {exc}")
        return 1

    repo_root = Path(".")
    problems = validate(registry, repo_root)

    controls = registry.get("controls", [])
    by_class: dict[str, int] = {}
    for control in controls:
        by_class[control.get("defect_class", "?")] = by_class.get(control.get("defect_class", "?"), 0) + 1

    tickets = {t for c in controls for t in (c.get("prevents") or [])}
    print(f"Control registry — {len(controls)} control(s) covering {len(by_class)} defect class(es), "
          f"{len(tickets)} historical ticket(s) referenced")
    for defect_class, count in sorted(by_class.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {count:2d}  {defect_class}")

    if problems:
        print()
        for problem in problems:
            print(problem)
        print()
        print(f"::error::{len(problems)} control-registry problem(s).")
        print()
        print("A registry that drifts from reality is worse than none — it produces false")
        print("confidence in exactly the audits meant to catch drift. See")
        print("docs/DEFECT_FEEDBACK_LOOP.md.")
        return 1

    print()
    print("Every registered control exists, is invoked, and cites the defects it prevents. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
