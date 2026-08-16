#!/usr/bin/env python3
"""scripts/check-required-checks.py — CTL-066 (SEC-106).

A required status check is a STRING. GitHub stores the context name a branch
demands; it does not store, or verify, that anything still produces that name.

Rename `main-chain-guard.yml`'s job from `guard` to `guards` and the outcome is
not an error anywhere. Branch protection keeps requiring `guard`, no run ever
reports it, and the only visible symptom is a PR that waits — which, on a repo
whose promote pushes directly with a PAT and where `enforce_admins` is off, is
resolved by an admin merge and forgotten. The gate is gone and the dashboard
still lists it.

That is the SEC-79 false-green cluster one level up: CTL-026
(check-control-registry.py) proves a control's file exists and something invokes
it, and CTL-042 proves its workflow is not disabled. Neither proves the control
BLOCKS anything, because "the job runs" and "the merge cannot happen without it"
are different facts stored in different places.

TWO ARMS, ANSWERING TWO DIFFERENT QUESTIONS
    --local   Every context in .github/expected-protection.json is still
              produced by some job in .github/workflows/. Needs no credentials,
              is decided entirely by the diff, and therefore belongs in the PR
              gate: the rename it catches arrives IN a pull request.

    --live    The live branch protection matches the committed expectation.
              Needs a token with administration:read, so it runs on a schedule.
              A pull request cannot change branch protection, so putting this in
              the PR gate would buy nothing and would put a third-party API on
              the merge path — the shape that froze the pipeline for ~11 days
              under SEC-88 (gotcha #23).

    (no arg)  --local. The arm that can always run is the default.

EXIT — three-valued, per SEC-106 §4a
    0  what could be measured matches the expectation.
    1  MEASURED, and it has drifted. The annotation names the branch, the
       expected contexts and the live ones.
    2  COULD NOT MEASURE — no token, a token without administration:read, a
       403/404, a network failure, or an unreadable expectation file. Reports
       UNVERIFIED, and says so in wording deliberately distinct from exit 1.

⚠️ Why exit 2 gets its own vocabulary. CTL-059: db-invariants.yml raised every
non-zero exit under a bare `if: failure()`, so an HTTP 403 printed the
divergence story and sent the reader hunting an uncommitted migration on three
separate days. An unmeasured branch must never be described in the language of
a measured divergence.

⚠️ Fail-closed is asserted from the PRECONDITION, never inferred from a status
code (gotcha #30: BSD grep returns 1, not 2, for a missing search path, so a
guard reasoning "exit > 1 means the search failed" reported clean having
searched nothing). Here that means: the branch list must come back non-empty
before any comparison is believed.

WHAT THIS CANNOT COVER, stated rather than hidden. The --live path needs a real
token against real branch protection, which no unit test has; that half is
exercised only by the scheduled run itself. The `production` Environment's
required reviewer (SEC-106 acceptance criterion 2) is a different API surface
and is not asserted here at all.

USAGE
    check-required-checks.py [--local]
    check-required-checks.py --live
    check-required-checks.py --self-test
"""
from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
WF_DIR = ROOT / ".github" / "workflows"
EXPECTATION = ROOT / ".github" / "expected-protection.json"
REPO = os.environ.get("GITHUB_REPOSITORY", "luisa-sys/lyra")

# A context GitHub can never satisfy from this repo, because the producing job
# name is computed at run time. Recorded so the local arm can say "unresolvable"
# instead of "missing" — two different findings.
DYNAMIC_RE = re.compile(r"\$\{\{")


class Unverifiable(Exception):
    """The truth could not be established. Never downgraded to a pass."""


def die_unverifiable(msg: str) -> None:
    print(f"::error::check-required-checks: UNVERIFIED — {msg}")
    print(
        "::error::  Exit 2 means NOTHING WAS MEASURED. This is not a report of "
        "drift: no comparison was made, so do not go looking for a divergence "
        "that was never observed (CTL-059)."
    )
    sys.exit(2)


# ---------------------------------------------------------------------------
# The expectation file
# ---------------------------------------------------------------------------


class Expectation(NamedTuple):
    branch: str
    contexts: list[str]
    enforce_admins: bool | None


def load_expectation(path: Path = EXPECTATION) -> list[Expectation]:
    if not path.is_file():
        raise Unverifiable(f"{path.name} does not exist — there is nothing to check against.")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Unverifiable(f"{path.name} is present but unreadable: {exc}")

    branches = raw.get("branches")
    if not isinstance(branches, dict) or not branches:
        raise Unverifiable(
            f"{path.name} declares no branches. An empty expectation is vacuously "
            "satisfied by any configuration, which is worse than no file at all."
        )

    out: list[Expectation] = []
    for branch, meta in branches.items():
        if not isinstance(meta, dict):
            raise Unverifiable(f"branch '{branch}' is not an object")
        contexts = meta.get("contexts")
        if not isinstance(contexts, list) or not contexts or not all(
            isinstance(c, str) and c.strip() for c in contexts
        ):
            raise Unverifiable(
                f"branch '{branch}' has no usable 'contexts' list. A branch listed "
                "with zero required contexts asserts nothing."
            )
        ea = meta.get("enforce_admins")
        if ea is not None and not isinstance(ea, bool):
            raise Unverifiable(f"branch '{branch}' has a non-boolean 'enforce_admins'")
        out.append(Expectation(branch, list(contexts), ea))
    return out


# ---------------------------------------------------------------------------
# The local arm — which contexts can this repository actually produce?
# ---------------------------------------------------------------------------


def job_contexts(text: str) -> list[str]:
    """Check-run names a workflow can report: each job's `name:`, else its id.

    Hand-parsed rather than via PyYAML on purpose: no script in this repo
    imports yaml, so relying on it would make the guard's availability depend on
    a runner-image detail rather than on the repo.

    Only lines AFTER the top-level `jobs:` key are considered — `on:` and `env:`
    also carry two-space keys, and counting those would invent contexts that no
    check ever reports, quietly weakening the two-way comparison.
    """
    lines = text.splitlines()
    try:
        start = next(i for i, ln in enumerate(lines) if re.match(r"^jobs:\s*$", ln))
    except StopIteration:
        return []

    out: list[str] = []
    job_id: str | None = None
    for ln in lines[start + 1:]:
        if ln.strip() and not ln.startswith(" "):
            break  # back to a top-level key: the jobs block has ended
        m = re.match(r"^  ([A-Za-z0-9_.\-]+):\s*$", ln)
        if m:
            job_id = m.group(1)
            out.append(job_id)
            continue
        if job_id is not None:
            n = re.match(r"^    name:\s*(.+?)\s*$", ln)
            if n:
                name = n.group(1).strip().strip("'\"")
                # The job's own name replaces the id it was recorded under.
                if out and out[-1] == job_id:
                    out[-1] = name
                job_id = None
    return out


def producible_contexts() -> dict[str, str]:
    """context -> the workflow file that reports it."""
    if not WF_DIR.is_dir():
        raise Unverifiable(f"{WF_DIR} does not exist — no workflow could be scanned.")
    found: dict[str, str] = {}
    files = sorted(list(WF_DIR.glob("*.yml")) + list(WF_DIR.glob("*.yaml")))
    if not files:
        raise Unverifiable(
            f"{WF_DIR} contains no workflow files — refusing to report every "
            "context missing on the strength of a scan that found nothing."
        )
    for f in files:
        for ctx in job_contexts(f.read_text(encoding="utf-8", errors="ignore")):
            found.setdefault(ctx, str(f.relative_to(ROOT)))
    if not found:
        raise Unverifiable(
            f"{len(files)} workflow file(s) were read and not one job was parsed "
            "out of them. The parser is broken, not the repository."
        )
    return found


def check_local(expectations: list[Expectation], producible: dict[str, str]) -> list[str]:
    """Return the findings. Empty means every expected context is producible."""
    findings: list[str] = []
    for exp in expectations:
        for ctx in exp.contexts:
            if ctx in producible:
                continue
            if DYNAMIC_RE.search(ctx):
                findings.append(
                    f"{exp.branch}: required context '{ctx}' is computed at run "
                    "time, so it cannot be matched to a job statically."
                )
                continue
            # A near-miss is named because the realistic cause is a rename, and
            # "produced by NO job" alone sends the reader looking for a deleted
            # workflow rather than a changed letter.
            near = difflib.get_close_matches(ctx, list(producible), n=1, cutoff=0.7)
            hint = f" Closest producible name: '{near[0]}'." if near else ""
            findings.append(
                f"{exp.branch}: required context '{ctx}' is produced by NO job in "
                f".github/workflows/. Branch protection will wait for a check that "
                f"nothing reports, so the requirement is unsatisfiable and the gate "
                f"is effectively off.{hint}"
            )
    return findings


# ---------------------------------------------------------------------------
# The live arm
# ---------------------------------------------------------------------------


def _gh(args: list[str]) -> str:
    try:
        res = subprocess.run(
            ["gh", "api", *args], capture_output=True, text=True, timeout=60
        )
    except FileNotFoundError:
        raise Unverifiable("the `gh` CLI is not installed, so live protection could not be read.")
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unverifiable(f"could not call the GitHub API: {exc}")
    if res.returncode != 0:
        err = res.stderr.strip()[:400]
        if "404" in err or "Not Found" in err:
            raise NotFound(err)
        if "403" in err or "401" in err or "Resource not accessible" in err:
            raise Unverifiable(
                "the GitHub API refused the request. Reading branch protection needs a "
                f"token with administration:read; GITHUB_TOKEN does not have it. ({err})"
            )
        raise Unverifiable(f"gh api failed (exit {res.returncode}): {err}")
    return res.stdout


class NotFound(Exception):
    """A 404 — which for this API means EITHER absent OR unprotected."""


def live_branches() -> set[str]:
    try:
        out = _gh([f"/repos/{REPO}/branches", "--paginate", "-q", ".[].name"])
    except NotFound as exc:
        raise Unverifiable(f"the repository '{REPO}' could not be read: {exc}")
    names = {ln.strip() for ln in out.splitlines() if ln.strip()}
    # THE PRECONDITION, asserted directly rather than inferred from an exit code.
    if not names:
        raise Unverifiable(
            "the branch list came back empty. No repository is branchless, so the "
            "call did not do what it appears to have done — and every comparison "
            "below would have vacuously passed."
        )
    return names


def live_protection(branch: str) -> dict | None:
    """Live protection for a branch, or None if the branch has none at all."""
    try:
        return json.loads(_gh([f"/repos/{REPO}/branches/{branch}/protection"]))
    except NotFound:
        return None
    except json.JSONDecodeError as exc:
        raise Unverifiable(f"branch protection for '{branch}' did not parse: {exc}")


def compare(exp: Expectation, protection: dict | None) -> list[str]:
    """Two-way comparison for one branch. Empty means it matches."""
    if protection is None:
        return [
            f"{exp.branch}: has NO branch protection at all, but the expectation "
            f"requires {sorted(exp.contexts)}."
        ]
    live_ctx = set(
        (protection.get("required_status_checks") or {}).get("contexts") or []
    )
    want = set(exp.contexts)
    findings = []
    missing = sorted(want - live_ctx)
    if missing:
        findings.append(
            f"{exp.branch}: required context(s) {missing} are in the expectation "
            f"but NOT enforced live (live: {sorted(live_ctx) or 'none'})."
        )
    extra = sorted(live_ctx - want)
    if extra:
        # Two-way on purpose. A list you may only add to is a suppression list:
        # a check quietly ADDED is as much an undocumented divergence as one
        # removed, and it is how a wedged gate gets explained away later.
        findings.append(
            f"{exp.branch}: context(s) {extra} are enforced live but absent from "
            "the expectation. Add them to .github/expected-protection.json, or "
            "remove them from the branch."
        )
    if exp.enforce_admins is not None:
        live_ea = bool((protection.get("enforce_admins") or {}).get("enabled"))
        if live_ea != exp.enforce_admins:
            findings.append(
                f"{exp.branch}: enforce_admins is {live_ea} live, expected "
                f"{exp.enforce_admins}."
            )
    return findings


def stale_branches(expectations: list[Expectation], existing: set[str]) -> list[str]:
    """Expectations naming a branch that no longer exists.

    The same two-way shape as env-access-baseline.json (CTL-037) and
    schema-drift-baseline.json (CTL-036): an entry that can no longer be
    violated is not a passing entry, it is an entry nobody has read.
    """
    return [e.branch for e in expectations if e.branch not in existing]


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    live = "--live" in argv

    try:
        expectations = load_expectation()
    except Unverifiable as exc:
        die_unverifiable(str(exc))
        return 2  # unreachable; keeps readers and type-checkers honest

    if not live:
        try:
            producible = producible_contexts()
        except Unverifiable as exc:
            die_unverifiable(str(exc))
            return 2
        findings = check_local(expectations, producible)
        total = sum(len(e.contexts) for e in expectations)
        print(
            f"check-required-checks --local: {total} required context(s) across "
            f"{len(expectations)} branch(es); {len(producible)} producible by this repo."
        )
        for f in findings:
            print(f"::error::  {f}")
        if findings:
            print(
                "::error::A required check nothing reports is not a gate. Either "
                "restore the job name, or change .github/expected-protection.json "
                "AND the live branch protection together."
            )
            return 1
        print("Every required context is still produced by a job in this repo. ✓")
        return 0

    try:
        existing = live_branches()
    except Unverifiable as exc:
        die_unverifiable(str(exc))
        return 2

    findings: list[str] = []
    for branch in stale_branches(expectations, existing):
        findings.append(
            f"{branch}: STALE — the expectation names this branch but it does not "
            "exist. Remove the entry, or restore the branch."
        )
    for exp in expectations:
        if exp.branch not in existing:
            continue
        try:
            findings.extend(compare(exp, live_protection(exp.branch)))
        except Unverifiable as exc:
            # One unreadable branch must not be reported as "everything matched".
            die_unverifiable(str(exc))
            return 2

    print(f"check-required-checks --live: measured {len(expectations)} branch(es) on {REPO}.")
    for f in findings:
        print(f"::error::  {f}")
    if findings:
        print(
            "::error::Live branch protection has DRIFTED from "
            ".github/expected-protection.json. This was measured, not guessed."
        )
        return 1
    print("Live branch protection matches the committed expectation. ✓")
    return 0


# ---------------------------------------------------------------------------
# self-test
# ---------------------------------------------------------------------------


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    def check(name: str, ok: bool) -> None:
        cases.append((name, bool(ok)))

    # --- job-name parsing: the whole local arm rests on this ---------------
    check("a job with no `name:` contributes its ID (the `guard` case)",
          job_contexts("name: Main Chain Guard\non:\n  push:\njobs:\n  guard:\n    runs-on: x\n")
          == ["guard"])
    check("a job WITH `name:` contributes the name, not the id",
          job_contexts("jobs:\n  checks:\n    name: PR Quality Gate\n    runs-on: x\n")
          == ["PR Quality Gate"])
    check("a quoted job name is unquoted",
          job_contexts("jobs:\n  a:\n    name: 'CodeQL Analysis'\n") == ["CodeQL Analysis"])
    check("multiple jobs are all captured",
          job_contexts("jobs:\n  a:\n    name: A\n  b:\n    runs-on: x\n") == ["A", "b"])
    # `on:` and `env:` carry two-space keys too. Counting them would invent
    # contexts and silently weaken the missing-context comparison below.
    check("keys before `jobs:` are not mistaken for jobs",
          job_contexts("on:\n  push:\n  pull_request:\nenv:\n  FOO: 1\njobs:\n  only:\n")
          == ["only"])
    check("a top-level key AFTER the jobs block ends the scan",
          job_contexts("jobs:\n  a:\n    runs-on: x\nconcurrency:\n  group: g\n") == ["a"])
    check("a workflow with no jobs block yields nothing",
          job_contexts("name: x\non:\n  push:\n") == [])
    # A `name:` nested deeper than the job body (a step name) must not be taken
    # for the job's name — a step called "Install" would otherwise register as a
    # producible context and could satisfy an expectation by accident.
    check("a STEP name is not a job name",
          job_contexts("jobs:\n  build:\n    steps:\n      - name: Install\n") == ["build"])

    # --- the local comparison ---------------------------------------------
    EXP = [Expectation("main", ["PR Quality Gate", "guard"], False)]
    check("all contexts producible -> clean",
          check_local(EXP, {"PR Quality Gate": "a.yml", "guard": "b.yml"}) == [])
    # THE DEFECT IN THIS TICKET'S TITLE.
    renamed = check_local(EXP, {"PR Quality Gate": "a.yml", "guards": "b.yml"})
    check("a one-character job rename is FOUND", len(renamed) == 1 and "'guard'" in renamed[0])
    check("the rename finding names the near-miss so it is actionable",
          "guards" in renamed[0])
    check("a case-only rename is also found",
          len(check_local(EXP, {"PR Quality Gate": "a.yml", "Guard": "b.yml"})) == 1)
    check("a run-time-computed context is reported as unresolvable, not missing",
          "computed at run time" in check_local(
              [Expectation("main", ["${{ matrix.os }}"], None)], {"x": "a.yml"})[0])

    # --- the expectation file ---------------------------------------------
    def load_raises(payload: str) -> bool:
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            fh.write(payload)
            p = Path(fh.name)
        try:
            load_expectation(p)
            return False
        except Unverifiable:
            return True
        finally:
            p.unlink(missing_ok=True)

    check("an EMPTY branches map is rejected, not vacuously passed",
          load_raises('{"branches": {}}'))
    check("a branch with an empty contexts list is rejected",
          load_raises('{"branches": {"main": {"contexts": []}}}'))
    check("unparseable JSON is rejected", load_raises("{not json"))
    check("a missing file is UNVERIFIED, not clean", _raises_missing())

    # --- the live comparison ----------------------------------------------
    LIVE_OK = {"required_status_checks": {"contexts": ["PR Quality Gate", "guard"]},
               "enforce_admins": {"enabled": False}}
    check("live matching the expectation is clean", compare(EXP[0], LIVE_OK) == [])
    check("a MISSING live context is drift",
          len(compare(EXP[0], {"required_status_checks": {"contexts": ["guard"]},
                               "enforce_admins": {"enabled": False}})) == 1)
    # Two-way. Without this the file is an allowlist that may only grow.
    check("an EXTRA live context is drift too",
          any("absent from" in f for f in compare(
              EXP[0], {"required_status_checks": {"contexts": ["PR Quality Gate", "guard", "Extra"]},
                       "enforce_admins": {"enabled": False}})))
    check("no protection at all is drift, not an absence of evidence",
          len(compare(EXP[0], None)) == 1)
    check("enforce_admins turned ON against the expectation is drift",
          any("enforce_admins" in f for f in compare(
              EXP[0], {"required_status_checks": {"contexts": ["PR Quality Gate", "guard"]},
                       "enforce_admins": {"enabled": True}})))
    check("enforce_admins is not compared when the expectation omits it",
          compare(Expectation("main", ["guard"], None),
                  {"required_status_checks": {"contexts": ["guard"]},
                   "enforce_admins": {"enabled": True}}) == [])
    check("an expectation for a branch that no longer exists is STALE",
          stale_branches([Expectation("gone", ["x"], None)], {"main"}) == ["gone"])
    check("a branch that still exists is not stale",
          stale_branches([Expectation("main", ["x"], None)], {"main"}) == [])

    # ⚠️ THE VERDICT IS READ HERE, AND THIS IS THE LINE THAT MATTERS.
    # SEC-140: eight self-test cases in check-npm-audit-gate.py were appended
    # AFTER its `if failures:` check, so three separate mutations all printed
    # "Self-test passed" and the case COUNT went UP. Nothing below this comment
    # may append to `cases`.
    failed = [n for n, ok in cases if not ok]
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if failed:
        print(f"::error::self-test: {len(failed)} case(s) failed: {', '.join(failed)}")
        return 1
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return 0


def _raises_missing() -> bool:
    try:
        load_expectation(ROOT / "definitely-not-here.json")
        return False
    except Unverifiable:
        return True


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main(sys.argv[1:]))
