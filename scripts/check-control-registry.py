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
  2. EVERY `wired_in` file exists AND actually invokes the implementation.
     A control nobody invokes is the SEC-79 failure mode.

     SEC-119 changed two things here, and both matter more than they look.

     (a) COMMENTS ARE STRIPPED BEFORE MATCHING. The test used to be a bare
         substring scan over the whole file, so a `#` comment MENTIONING a
         control satisfied "this file invokes it". CTL-001 declared
         `promote-to-production.yml` as a wiring on the strength of two
         explanatory comments; neutering its one real `run:` line in
         pr-checks.yml left this checker green at exit 0. That is CTL-039's
         defect class — "the comment satisfies the assertion" — landing on
         the meta-control that exists to catch exactly this.

     (b) SATISFACTION IS PER-TARGET, NOT ANY-OF. A single flag was raised by
         whichever target happened to match and tested once at the end, so a
         control wired into five files was proven by one. A stale entry could
         never be reported, because a live sibling always covered for it.
         `wired_in` means "the control RUNS here" — that is what the error
         text has always claimed and what the SEC-79 failure mode is about.
         A file that is merely RELEVANT to a control (scanned by it,
         documented alongside it) does not belong in the list.
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
import importlib.util
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

# CTL-039 owns the comment-stripping semantics (per-file-type syntax, string-aware
# line markers, characters blanked rather than deleted so offsets stay stable).
# SEC-119 REUSES it rather than writing a second implementation: two copies of a
# comment parser drift, and the drift is invisible until one of them wrongly
# reports a control as invoked. The module name has hyphens, so it cannot be a
# plain `import` — load it by path.
COMMENT_STRIPPER_PATH = Path(__file__).resolve().parent / "check-comment-only-assertions.py"


def _load_strip_comments():
    """Return CTL-039's `strip_comments`, or raise.

    Deliberately NOT wrapped in a try/except that falls back to a local copy or
    to raw text. Either fallback would silently restore the defect this control
    was fixed for — a comment satisfying the invocation test — and it would do
    so while printing a clean result.
    """
    spec = importlib.util.spec_from_file_location("_ctl039_comments", COMMENT_STRIPPER_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {COMMENT_STRIPPER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.strip_comments


strip_comments = _load_strip_comments()


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

        for target in wired_in:
            target_path = repo_root / target
            if not target_path.exists():
                problems.append(f"::error::{cid}: wired_in target '{target}' does not exist.")
                continue

            if target == impl:
                # A workflow that IS the control (e.g. main-chain-guard.yml).
                continue

            if kind == "policy":
                # No executable form; existence is the proof.
                continue

            try:
                raw = target_path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue

            # SEC-119(a): a MENTION is not an INVOCATION.
            content = strip_comments(raw, target_path.suffix)
            if content is None:
                # Unknown file type: a comment cannot be told from code, so the
                # question "does this file invoke the control?" is undecidable.
                # Say so rather than guessing — guessing raw text is how the
                # comment-satisfies-the-assertion defect returns.
                problems.append(
                    f"::error::{cid}: wired_in target '{target}' has a file type with no known "
                    f"comment syntax, so an invocation cannot be distinguished from a mention "
                    f"of one. Add '{target_path.suffix}' to SYNTAX in "
                    f"scripts/check-comment-only-assertions.py."
                )
                continue

            # SEC-119(b): every target must carry its own proof.
            if kind == "test":
                runs_runner = bool(re.search(r"\b(npm run test:unit|npm test|npx jest|jest)\b", content))
                discoverable = bool(impl and (impl.startswith("tests/") or impl.startswith("src/")))
                if not (runs_runner and discoverable):
                    detail = (
                        f"wired_in target '{target}' does not run the test suite"
                        if not runs_runner
                        else f"'{impl}' is outside the runner's discovery roots (tests/, src/)"
                    )
                    problems.append(
                        f"::error::{cid}: {detail}, so that wiring does not invoke the control — "
                        f"this is the SEC-79 'silently disabled' failure mode. Either fix the "
                        f"wiring or drop the target from wired_in."
                    )
            elif impl_basename and impl_basename not in content:
                problems.append(
                    f"::error::{cid}: wired_in target '{target}' does not reference "
                    f"'{impl_basename}' outside comments, so it does not invoke the control — "
                    f"this is the SEC-79 'silently disabled' failure mode. wired_in means "
                    f"'the control RUNS here'; either wire it in or drop the target."
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

        # --- SEC-119 -------------------------------------------------------
        # (a) A MENTION inside a comment is not an INVOCATION. This is the
        # defect that let CTL-001 claim promote-to-production.yml as a wiring
        # on the strength of two `#` comments, and it is CTL-039's own class
        # landing on the meta-control.
        (root / ".github/workflows/comment-only.yml").write_text(
            "# this workflow used to run scripts/check-thing.sh\n"
            "jobs:\n  x:\n    steps:\n      - run: echo hi\n"
        )
        comment_only = json.loads(json.dumps(good))
        comment_only["controls"][0]["wired_in"] = [".github/workflows/comment-only.yml"]
        problems_co = validate(comment_only, root)
        cases.append(
            ("control named only in a comment fails", len(problems_co) >= 1)
        )
        cases.append(
            (
                "…and the failure names the comment-only target",
                any("comment-only.yml" in p for p in problems_co),
            )
        )

        # Same file, same basename, but on a real `run:` line — must pass. The
        # contrast is what proves the stripping is what did the work, rather
        # than the check having simply become stricter about everything.
        (root / ".github/workflows/comment-plus-run.yml").write_text(
            "# scripts/check-thing.sh is explained here\n"
            "jobs:\n  x:\n    steps:\n      - run: bash scripts/check-thing.sh\n"
        )
        comment_plus_run = json.loads(json.dumps(good))
        comment_plus_run["controls"][0]["wired_in"] = [".github/workflows/comment-plus-run.yml"]
        cases.append(
            ("a real run: line passes even when a comment also names it",
             validate(comment_plus_run, root) == [])
        )

        # (b) Satisfaction is PER-TARGET. A live sibling used to cover for a
        # stale entry, so a wiring that had rotted could never be reported.
        stale_sibling = json.loads(json.dumps(good))
        stale_sibling["controls"][0]["wired_in"] = [
            ".github/workflows/pr.yml",              # genuinely invokes it
            ".github/workflows/unrelated.yml",       # does not
        ]
        problems_ss = validate(stale_sibling, root)
        cases.append(("a stale wired_in target fails despite a live sibling", len(problems_ss) == 1))
        cases.append(
            (
                "…and the stale target is named",
                any("unrelated.yml" in p for p in problems_ss),
            )
        )

        # Per-target for kind: test as well — one workflow runs the runner, one
        # does not, and the one that does not must be reported by name.
        stale_test = json.loads(json.dumps(test_control))
        stale_test["controls"][0]["wired_in"] = [
            ".github/workflows/tests.yml",
            ".github/workflows/unrelated.yml",
        ]
        problems_st = validate(stale_test, root)
        cases.append(("a test wiring that never runs the runner fails per-target", len(problems_st) == 1))
        cases.append(
            ("…and that target is named", any("unrelated.yml" in p for p in problems_st))
        )

        # An undecidable file type is reported, never assumed clean. Guessing
        # raw text is exactly how the comment-satisfies-the-assertion defect
        # comes back.
        (root / ".github/workflows/config.ini").write_text("; scripts/check-thing.sh\n")
        unknown_type = json.loads(json.dumps(good))
        unknown_type["controls"][0]["wired_in"] = [".github/workflows/config.ini"]
        problems_ut = validate(unknown_type, root)
        cases.append(("an undecidable file type fails rather than passing", len(problems_ut) == 1))
        cases.append(
            ("…and says which suffix it could not decide",
             any(".ini" in p for p in problems_ut))
        )

        # `policy` controls have no executable form — existence is the proof —
        # and that exemption must survive the per-target rewrite.
        policy = json.loads(json.dumps(good))
        policy["controls"][0]["kind"] = "policy"
        policy["controls"][0]["wired_in"] = [".github/workflows/unrelated.yml"]
        cases.append(("a policy control needs no invocation", validate(policy, root) == []))

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
