#!/usr/bin/env python3
"""scripts/check-workflow-lint.py — CTL-073 (SEC-106 §3 item 2).

Wires two third-party workflow linters — actionlint and zizmor — into the PR
gate as a TWO-WAY RATCHET, so that a workflow change cannot introduce a new
finding and a fixed finding cannot sit in the baseline forever.

WHY A RATCHET AND NOT "ZERO FINDINGS"
-------------------------------------
Measured on develop @ 7d5fd94, across 43 workflows:

    actionlint  1.7.12     7 findings, all one rule in one file
    zizmor      1.29.0   109 findings (57 artipacked, 15 template-injection,
                              7 dangerous-triggers, 6 excessive-permissions,
                              6 adhoc-packages, 3 github-env, 1 unsound-ternary)

A gate that reddens dozens of files on day one is a gate someone turns off, and
"fix 109 findings" is not a bounded slice. So the past is grandfathered per
(tool, rule, file) with a COUNT, and the ratchet may only shrink. It fails in
BOTH directions — a NEW key, or MORE of an existing one, is a regression; a key
that has been fixed but is still listed is STALE and fails too. A list you may
only add to is a suppression list, not a ratchet.

⚠️ THE FINDING THIS TURNED UP ON DAY ONE. All 7 actionlint findings are in
.github/workflows/absent-secrets-probe.yml, and they are the same defect seven
times: a STEP-level `if: ${{ secrets.X != '' }}`. The `secrets` context is not
available in `jobs.<id>.steps.if`, so that condition cannot evaluate the way it
reads. That workflow IS the SEC-158 / CTL-068 control asserting every
deliberately-absent secret is still absent — i.e. the control cannot be trusted
to fire, which is the SEC-79 false-green shape inside a control built to detect
false greens. Raised separately rather than fixed here; the finding is
grandfathered in the baseline with that ticket named, NOT waved through.

WHAT THESE TWO TOOLS DO AND DO NOT COVER
----------------------------------------
SEC-106 §1 lists the false-green primitives. Measured, not assumed:

    primitive                                   covered by
    ------------------------------------------- -------------------------
    `if:` guard referencing secrets.*           actionlint (expression)
    continue-on-error: true on a real step      NOTHING
    `|| true`                                   NOTHING
    `set +e`                                    NOTHING
    multi-line run: with no set -euo pipefail   NOTHING
    missing defaults.run.shell: bash            NOTHING
    GITHUB_TOKEN used to push a deploy branch   check-workflow-integrity.sh
    `gh run list --limit 1` deploy verification check-workflow-integrity.sh
    401-accepting health check without a SHA    check-workflow-integrity.sh

So this control closes one of §1's six primitives and adds a large amount of
supply-chain and expression auditing that nothing else in the estate does. The
other five are stated here as an open gap rather than implied to be covered —
recording a gap is a finding, hiding it is a regression.

WHY THE TOOL VERSIONS ARE PINNED
--------------------------------
SEC-105: the npm-audit gate was the only control in the estate keyed on a
third-party feed, and it went red overnight on an unchanged repo, freezing the
pipeline for ~11 days. A linter is the same shape — a new release ships new
rules. Both versions are pinned in the workflow AND recorded in the baseline;
running a different version is UNVERIFIED (exit 2), never a silent comparison
of one tool's findings against another tool's baseline. Bumping a version is
then a deliberate act with a regenerated baseline in the same commit.

USAGE
    check-workflow-lint.py                    check against the baseline
    check-workflow-lint.py --write-baseline   regenerate (review the diff!)
    check-workflow-lint.py --self-test        fixtures, no repo state
    check-workflow-lint.py --findings-json F  replay a collected findings dump
                                              instead of invoking the tools

ENVIRONMENT
    ACTIONLINT_BIN   path to the actionlint binary   (default: PATH lookup)
    ZIZMOR_CMD       command to run zizmor, may have (default: PATH lookup)
                     arguments, e.g. "uvx zizmor@1.29.0"

EXIT
    0  findings match the baseline exactly
    1  MEASURED and drifted: a new finding, more of an existing one, a stale
       baseline entry, or an inline suppression with no Jira key
    2  COULD NOT MEASURE (UNVERIFIED): a linter is missing, crashed, printed
       output that would not parse, or is a different version from the one the
       baseline was measured with. This is NOT a drift report — do not go
       looking for a finding that was never observed (CTL-059).
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = ROOT / ".github" / "workflows"
# WORKFLOW_LINT_BASELINE exists so the test suite can drive this script
# against a fixture baseline in a temp directory. It is NOT a production
# escape hatch: unset, it is the committed file, and CI never sets it.
BASELINE = Path(os.environ.get("WORKFLOW_LINT_BASELINE") or (ROOT / ".github" / "workflow-lint-baseline.json"))

# Any key matching this satisfies the "cite a ticket" requirement. Digits are
# required on purpose: a literal placeholder like SEC-xxx must NOT pass.
KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-[0-9]+\b")

# zizmor's own inline suppression. It silences a finding with no ticket and no
# review, which is precisely the escape hatch SEC-106 §4d says must cite a Jira
# key. actionlint's equivalent is a `# actionlint-ok:` marker (this repo's
# convention, matching every other guard here).
SUPPRESSION_RE = re.compile(r"#\s*(zizmor:\s*ignore\[[^\]]*\]|actionlint-ok:)")

EXIT_OK, EXIT_DRIFT, EXIT_UNVERIFIED = 0, 1, 2


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------
class Unverified(Exception):
    """Raised whenever the measurement itself could not be made."""


def _run(argv: list[str], ok_codes: set[int], what: str) -> subprocess.CompletedProcess:
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, cwd=ROOT)
    except (OSError, ValueError) as exc:  # not installed, not executable, ...
        raise Unverified(f"{what}: could not be executed ({exc})") from exc
    if proc.returncode not in ok_codes:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
        raise Unverified(
            f"{what}: exited {proc.returncode}, which is not a findings result. " + " / ".join(tail)
        )
    return proc


def _tool_version(argv: list[str], what: str) -> str:
    """First whitespace-delimited version-looking token of `--version` output."""
    proc = _run(argv, {0}, f"{what} --version")
    for token in (proc.stdout or "").split():
        if re.fullmatch(r"v?\d+\.\d+(\.\d+)?", token):
            return token.lstrip("v")
    raise Unverified(f"{what}: could not read a version from {(proc.stdout or '').strip()[:80]!r}")


def _rel(path: str) -> str:
    """Repo-relative, always. A baseline keyed on absolute paths would match on
    one machine and read as 67 NEW findings on every other one — including CI,
    whose checkout lives somewhere else entirely."""
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except (ValueError, OSError):
        return path


def actionlint_cmd() -> list[str]:
    return [os.environ.get("ACTIONLINT_BIN") or "actionlint"]


def zizmor_cmd() -> list[str]:
    return shlex.split(os.environ.get("ZIZMOR_CMD") or "zizmor")


def collect_actionlint(target: Path) -> tuple[list[dict], str]:
    """actionlint exits 0 with no findings and 1 with findings; anything else
    (127 not-found, 3 usage error) means we did not measure."""
    base = actionlint_cmd()
    version = _tool_version(base + ["-version"], "actionlint")
    # actionlint takes files, not a directory: handed one it exits 3, which is
    # "usage error" and NOT a findings result — so it lands in the UNVERIFIED
    # branch rather than reading as a clean scan of nothing.
    if target.is_dir():
        targets = sorted(str(p) for p in list(target.glob("*.yml")) + list(target.glob("*.yaml")))
        if not targets:
            raise Unverified(f"actionlint: {target} contains no workflow files")
    else:
        targets = [str(target)]
    # -shellcheck= -pyflakes= disable actionlint's external checkers. Left on,
    # actionlint runs whichever shellcheck happens to be installed on the
    # machine over every `run:` block — so the finding set (and therefore the
    # baseline) would differ between a laptop with no shellcheck, a CI runner
    # that ships one, and a runner that ships a different version. A control
    # whose answer depends on what is installed where it happens to run is not
    # a control. Stated gap: shell-body linting of `run:` blocks is therefore
    # NOT covered here.
    proc = _run(
        base + ["-format", "{{json .}}", "-no-color", "-shellcheck=", "-pyflakes="] + targets,
        {0, 1},
        "actionlint",
    )
    try:
        raw = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise Unverified(f"actionlint: output would not parse as JSON ({exc})") from exc
    out = []
    for f in raw:
        out.append({"tool": "actionlint", "rule": f.get("kind", "?"), "path": _rel(f.get("filepath", "?"))})
    return out, version


def collect_zizmor(target: Path) -> tuple[list[dict], str]:
    """zizmor exits 0 with no findings and 10..14 encoding the highest severity
    found. 1 is an internal error, 127 is not-installed — neither is a result.

    --offline on purpose: an audit that reaches the network is a different
    measurement on every run, and a gate whose answer depends on GitHub being
    reachable is a gate that goes red for reasons the PR did not cause."""
    base = zizmor_cmd()
    version = _tool_version(base + ["--version"], "zizmor")
    proc = _run(
        base + ["--no-progress", "--format", "json", "--offline", str(target)],
        {0, 10, 11, 12, 13, 14},
        "zizmor",
    )
    try:
        raw = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise Unverified(f"zizmor: output would not parse as JSON ({exc})") from exc
    out = []
    for f in raw:
        if f.get("ignored"):
            continue
        path = "?"
        for loc in f.get("locations", []):
            key = ((loc.get("symbolic") or {}).get("key") or {}).get("Local") or {}
            if key.get("verbatim_path"):
                path = _rel(key["verbatim_path"])
                break
        out.append({"tool": "zizmor", "rule": f.get("ident", "?"), "path": path})
    return out, version


def tally(findings: list[dict]) -> dict[str, int]:
    """(tool, rule, file) -> count. Deliberately NOT keyed on line number:
    line numbers churn on every unrelated edit, so a line-keyed baseline would
    go stale constantly and teach everyone to regenerate it without reading."""
    counts: dict[str, int] = {}
    for f in findings:
        counts[f"{f['tool']}:{f['rule']}:{f['path']}"] = counts.get(f"{f['tool']}:{f['rule']}:{f['path']}", 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Classification — pure, so it is directly testable
# ---------------------------------------------------------------------------
def version_problem(recorded: dict, running: dict) -> str | None:
    """A linter version bump changes the RULE SET, so findings measured with
    one version are not comparable with a baseline measured under another.
    Returns a message when they disagree, None when they are comparable.
    An unrecorded tool is not a mismatch — it is a baseline written before that
    tool was part of the control, and the first --write-baseline records it."""
    for tool, version in sorted(running.items()):
        if recorded.get(tool) and recorded[tool] != version:
            return (
                f"{tool} {version} is running, but the baseline was measured with "
                f"{tool} {recorded[tool]}. A linter version bump changes the rule set, so the "
                "two are not comparable. Pin the version back, or bump it deliberately and "
                "regenerate the baseline in the same commit."
            )
    return None


def classify(current: dict[str, int], baseline: dict[str, int]):
    """Returns (new, worse, stale).

    new   — key not in the baseline at all
    worse — key in the baseline, but MORE findings than it records
    stale — key in the baseline with fewer/no findings now (the ratchet has
            moved and the baseline must move with it)
    """
    new, worse, stale = [], [], []
    for key, count in sorted(current.items()):
        if key not in baseline:
            new.append((key, count))
        elif count > baseline[key]:
            worse.append((key, baseline[key], count))
    for key, count in sorted(baseline.items()):
        if current.get(key, 0) < count:
            stale.append((key, count, current.get(key, 0)))
    return new, worse, stale


def suppression_problems(files: list[Path]) -> list[str]:
    """SEC-106 §4d: an allow-listed line is honoured only when it cites a key."""
    problems = []
    for path in sorted(files):
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            raise Unverified(f"could not read {path} ({exc})")
        for n, line in enumerate(lines, 1):
            if SUPPRESSION_RE.search(line) and not KEY_RE.search(line):
                rel = path.relative_to(ROOT) if path.is_absolute() and ROOT in path.parents else path
                problems.append(f"{rel}:{n}: inline linter suppression with no Jira key")
    return problems


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def load_baseline() -> dict:
    if not BASELINE.exists():
        raise Unverified(
            f"{_rel(str(BASELINE))} is missing — regenerate it with --write-baseline. "
            "Failing closed rather than reporting a clean scan with nothing to compare against."
        )
    try:
        return json.loads(BASELINE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Unverified(f"{BASELINE.name} could not be read ({exc})")


def collect_all() -> tuple[dict[str, int], dict[str, str]]:
    if not WORKFLOW_DIR.is_dir():
        raise Unverified(f"{WORKFLOW_DIR} is missing or unreadable — nothing was scanned.")
    a_findings, a_version = collect_actionlint(WORKFLOW_DIR)
    z_findings, z_version = collect_zizmor(WORKFLOW_DIR)
    # Assert the precondition directly rather than inferring it from an exit
    # code (gotcha #30): a scan of 43 workflows that returns literally nothing
    # from BOTH tools is far more likely to be a broken invocation than a
    # spotless estate, and reporting that as clean is the defect this control
    # exists to prevent.
    if not list(WORKFLOW_DIR.glob("*.yml")) + list(WORKFLOW_DIR.glob("*.yaml")):
        raise Unverified(f"{WORKFLOW_DIR} contains no workflow files — the scan had no subject.")
    return tally(a_findings + z_findings), {"actionlint": a_version, "zizmor": z_version}


def write_baseline() -> int:
    counts, versions = collect_all()
    by_tool: dict[str, int] = {}
    for key, n in counts.items():
        by_tool[key.split(":", 1)[0]] = by_tool.get(key.split(":", 1)[0], 0) + n
    payload = {
        "$schemaNotes": {
            "purpose": "CTL-073 two-way ratchet over actionlint + zizmor findings (SEC-106 §3 item 2).",
            "key": "<tool>:<rule>:<path> -> number of findings. Not keyed on line number: line numbers churn.",
            "direction": "SHRINK-ONLY. A new key or a higher count fails; a key that is fixed but still listed fails as STALE.",
            "tool_versions": "Recorded because the subject is a third-party tool. A different version is UNVERIFIED (exit 2), never a silent comparison (SEC-105).",
            "regenerate": "python3 scripts/check-workflow-lint.py --write-baseline",
        },
        "grandfathered": "SEC-106",
        "tool_versions": versions,
        "totals": {"findings": sum(counts.values()), "keys": len(counts), "by_tool": by_tool},
        "notes": {
            "actionlint:expression:.github/workflows/absent-secrets-probe.yml":
                "SEC-165 — step-level `if: ${{ secrets.X != '' }}`; the secrets context is not "
                "available in jobs.<id>.steps.if, so the CTL-068 absent-secret probe cannot be "
                "trusted to fire. Grandfathered so this control can land; NOT accepted.",
        },
        "entries": dict(sorted(counts.items())),
    }
    BASELINE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {_rel(str(BASELINE))}: {len(counts)} keys, {sum(counts.values())} findings")
    return EXIT_OK


def main(argv: list[str]) -> int:
    replay = None
    if "--findings-json" in argv:
        replay = Path(argv[argv.index("--findings-json") + 1])

    try:
        baseline_doc = load_baseline()
        if replay is not None:
            counts = json.loads(replay.read_text(encoding="utf-8"))
            versions = baseline_doc.get("tool_versions", {})
        else:
            counts, versions = collect_all()
        problem = version_problem(baseline_doc.get("tool_versions", {}), versions)
        if problem:
            raise Unverified(problem)
        problems = suppression_problems(
            sorted(WORKFLOW_DIR.glob("*.yml")) + sorted(WORKFLOW_DIR.glob("*.yaml"))
        )
    except Unverified as exc:
        print("::error::check-workflow-lint: UNVERIFIED — the measurement could not be made.")
        print(f"::error::  {exc}")
        print("::error::  This is NOT a drift report. Nothing was compared, so do not go looking")
        print("::error::  for a finding that was never observed. Exit 2.")
        return EXIT_UNVERIFIED

    new, worse, stale = classify(counts, baseline_doc.get("entries", {}))

    for key, n in new:
        print(f"::error::check-workflow-lint: NEW finding — {key} ({n})")
    for key, was, now in worse:
        print(f"::error::check-workflow-lint: WORSE — {key} was {was}, now {now}")
    for key, was, now in stale:
        print(f"::error::check-workflow-lint: STALE baseline entry — {key} recorded {was}, now {now}")
        print("::error::  This is good news: it was fixed. Regenerate the baseline so the ratchet holds.")
    for problem in problems:
        print(f"::error::check-workflow-lint: {problem}")

    if new or worse or stale or problems:
        print("::error::  Regenerate with: python3 scripts/check-workflow-lint.py --write-baseline")
        return EXIT_DRIFT

    print(
        f"check-workflow-lint: {sum(counts.values())} findings across {len(counts)} keys, "
        f"all matching the baseline exactly. ✓"
    )
    return EXIT_OK


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
FIXTURE_DIRTY = """\
name: Dirty fixture
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: only runs when a secret exists
        if: ${{ secrets.SOME_TOKEN != '' }}
        run: echo hello
"""

FIXTURE_CLEAN = """\
name: Clean fixture
on:
  pull_request:
    branches: [develop]
permissions:
  contents: read
defaults:
  run:
    shell: bash
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: say hello
        run: |
          set -euo pipefail
          echo hello
"""


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    # --- the ratchet's three verdicts, and its clean state -------------------
    cases.append(("a key absent from the baseline is NEW",
                  classify({"zizmor:artipacked:a.yml": 1}, {}) == ([("zizmor:artipacked:a.yml", 1)], [], [])))
    cases.append(("more findings under an existing key is WORSE",
                  classify({"k": 3}, {"k": 2})[1] == [("k", 2, 3)]))
    cases.append(("fewer findings under an existing key is STALE",
                  classify({"k": 1}, {"k": 2})[2] == [("k", 2, 1)]))
    cases.append(("a fixed key that is still listed is STALE",
                  classify({}, {"k": 2})[2] == [("k", 2, 0)]))
    # Without this, every case above is also satisfied by a classifier that
    # flags everything (catalogue failure mode: an always-red rule).
    cases.append(("an exact match is clean",
                  classify({"k": 2}, {"k": 2}) == ([], [], [])))

    # --- keying --------------------------------------------------------------
    cases.append(("findings are tallied per (tool, rule, file)",
                  tally([{"tool": "zizmor", "rule": "r", "path": "a.yml"},
                         {"tool": "zizmor", "rule": "r", "path": "a.yml"},
                         {"tool": "zizmor", "rule": "r", "path": "b.yml"}])
                  == {"zizmor:r:a.yml": 2, "zizmor:r:b.yml": 1}))
    cases.append(("the same rule from two tools does not collide",
                  len(tally([{"tool": "zizmor", "rule": "r", "path": "a.yml"},
                             {"tool": "actionlint", "rule": "r", "path": "a.yml"}])) == 2))

    # --- the allow-list contract (SEC-106 §4d) -------------------------------
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        (d / "no-key.yml").write_text("      - run: x  # zizmor: ignore[artipacked]\n")
        (d / "with-key.yml").write_text("      - run: x  # zizmor: ignore[artipacked] SEC-106 known\n")
        (d / "placeholder.yml").write_text("      - run: x  # zizmor: ignore[artipacked] SEC-xxx\n")
        (d / "actionlint.yml").write_text("      # actionlint-ok: shell is checked elsewhere\n")
        (d / "prose.yml").write_text("      # we could add a zizmor ignore here but do not\n")
        found = suppression_problems(sorted(d.glob("*.yml")))
        names = sorted(Path(p.split(":")[0]).name for p in found)
        cases.append(("an inline suppression with no Jira key FAILS", "no-key.yml" in names))
        cases.append(("an inline suppression WITH a Jira key passes", "with-key.yml" not in names))
        cases.append(("a placeholder key (SEC-xxx, no digits) does NOT satisfy it",
                      "placeholder.yml" in names))
        cases.append(("the actionlint-ok marker is held to the same rule",
                      "actionlint.yml" in names))
        cases.append(("prose mentioning a suppression is not one", "prose.yml" not in names))

    cases.append(("KEY_RE requires digits", bool(KEY_RE.search("SEC-106")) and not KEY_RE.search("SEC-xxx")))

    # --- the third-party-feed guard (SEC-105's lesson) -----------------------
    cases.append(("matching tool versions are comparable",
                  version_problem({"zizmor": "1.29.0"}, {"zizmor": "1.29.0"}) is None))
    cases.append(("a DIFFERENT tool version is UNVERIFIED, not a comparison",
                  "not comparable" in (version_problem({"zizmor": "1.29.0"}, {"zizmor": "1.30.0"}) or "")))
    cases.append(("a tool the baseline never recorded is not a mismatch",
                  version_problem({}, {"zizmor": "1.29.0"}) is None))

    # --- the tools themselves, driven against real fixtures ------------------
    # §4d wants BOTH directions: the dirty fixture rejected AND the clean one
    # passed, so the rule is not simply always-red. If a linter is absent this
    # arm reports UNVERIFIED rather than skipping — a skipped security case
    # that prints "passed" is the exact defect this control exists to catch.
    tool_cases: list[tuple[str, bool]] = []
    unverified: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        dirty, clean = Path(td) / "dirty.yml", Path(td) / "clean.yml"
        dirty.write_text(FIXTURE_DIRTY)
        clean.write_text(FIXTURE_CLEAN)
        for name, collector in (("actionlint", collect_actionlint), ("zizmor", collect_zizmor)):
            try:
                dirty_findings, _ = collector(dirty)
                clean_findings, _ = collector(clean)
            except Unverified as exc:
                unverified.append(f"{name}: {exc}")
                continue
            if name == "actionlint":
                tool_cases.append((
                    "actionlint rejects a step-level `if: secrets.*` (the §1 primitive it covers)",
                    any(f["rule"] == "expression" for f in dirty_findings)))
                tool_cases.append((
                    "actionlint passes a CLEAN fixture, so the rule is not always-red",
                    clean_findings == []))
            else:
                tool_cases.append((
                    "zizmor rejects a dangerous fixture (push:main + unpinned checkout-less job)",
                    len(dirty_findings) > 0))
                tool_cases.append((
                    "zizmor finds strictly fewer findings on the CLEAN fixture",
                    len(clean_findings) < len(dirty_findings)))

    cases.extend(tool_cases)

    # SEC-140: the verdict is read AFTER every case loop has appended to it.
    # Eight self-test cases in check-npm-audit-gate.py were added after the
    # `if failures:` line, so three separate mutations all printed "passed" and
    # the case count went UP. Nothing below this line may append a case.
    failed = [n for n, ok in cases if not ok]
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if unverified:
        for message in unverified:
            print(f"::error::self-test: UNVERIFIED — {message}")
        print("::error::self-test: a linter is unavailable, so its fixture arm proved nothing.")
        return EXIT_UNVERIFIED
    if failed:
        print(f"::error::self-test: {len(failed)} case(s) failed: {', '.join(failed)}")
        return EXIT_DRIFT
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return EXIT_OK


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    if "--write-baseline" in sys.argv:
        try:
            sys.exit(write_baseline())
        except Unverified as exc:
            print(f"::error::check-workflow-lint: UNVERIFIED — {exc}")
            sys.exit(EXIT_UNVERIFIED)
    sys.exit(main(sys.argv[1:]))
