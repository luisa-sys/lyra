#!/usr/bin/env python3
"""scripts/check-scheduled-workflows-active.py — CTL-042 (SEC-79 family).

A workflow that is DISABLED still has a perfect file on disk.

That sentence is the whole control. Every existing check in this repo reasons
about `.github/workflows/*.yml` as text: check-workflow-integrity.sh greps it,
check-control-registry.py confirms the file exists and something invokes it,
check-guard-path-drift.py confirms its path literals still match. All of them
pass for a workflow that GitHub will never run again, because `state:
disabled_manually` lives in the GitHub API and nowhere in the repository.

Measured on 2026-08-09, 4 of the 20 workflows that declare a cron schedule were
not active, and had not run since mid-June:

    anomaly-detect.yml          */15 * * * *   ~8 weeks dark
    affiliate-link-smoke.yml    17 * * * *     ~8 weeks dark
    mutation-testing.yml        0 4 * * 0      ~8 weeks dark
    auto-promote-to-staging.yml 0 23 * * 0     ~8 weeks dark

Two things made that invisible for two months rather than two days:

  * CLAUDE.md's "Scheduled Workflows" section still documents "Sunday 04:00 —
    Stryker mutation testing" as a live cadence. Documentation describing a
    schedule is indistinguishable from a schedule.
  * Dependabot kept bumping all four files (#474, 2026-07-22), so they kept
    appearing in PR diffs looking actively maintained.

This is SEC-79 exactly — health-check.yml and weekly-report.yml sat disabled
for over a month while everything reported green — and the lesson taken from
SEC-79 (register controls, assert they exist and are invoked) does not cover
it, because existence and invocation were never the thing that broke.

USAGE
    check-scheduled-workflows-active.py            warn (default)
    check-scheduled-workflows-active.py --enforce  block
    check-scheduled-workflows-active.py --self-test

Ships WARN-first on purpose, the same warn->block path as the KAN-413 signup
gate: turning it straight to blocking would fail every unrelated PR until a
founder-only decision is made about four workflows, and a gate that blocks work
nobody can unblock gets switched off. Flip with SCHEDULED_WORKFLOW_GATE_ENFORCE=1
(or --enforce) once the four are re-enabled or consciously excepted.

EXCEPTIONS  .github/scheduled-workflow-exceptions.json
    Each needs a Jira key AND a reason. An entry for a workflow that is actually
    active is itself an error — a stale exception is how a list stops being read.

EXIT
    0  every scheduled workflow is active (or excepted); or findings in warn mode
    1  a scheduled workflow is inactive, in --enforce mode
    2  cannot verify — fail closed
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WF_DIR = ROOT / ".github" / "workflows"
EXCEPTIONS = ROOT / ".github" / "scheduled-workflow-exceptions.json"
REPO = os.environ.get("GITHUB_REPOSITORY", "luisa-sys/lyra")

KEY_RE = re.compile(r"^[A-Z][A-Z0-9]+-[0-9]+$")


class Unverifiable(Exception):
    """Raised when we cannot establish the truth. Never downgraded to a pass."""


def die_unverifiable(msg: str) -> None:
    print(f"::error::check-scheduled-workflows-active: {msg}")
    print(
        "::error::  Failing closed (exit 2): this control exists because "
        "'looks fine' and 'is running' are different things, so 'cannot tell' "
        "must never read as 'fine'."
    )
    sys.exit(2)


def declares_cron(text: str) -> list[str]:
    """Return the cron expressions a workflow actually schedules.

    Comment-stripped first. A commented-out cron is the deliberate pattern used
    by backup-complete.yml — the cadence is documented but not armed until the
    backup is commissioned — and treating that as a live schedule would produce
    a permanent false finding, which is how a gate teaches people to ignore it.
    """
    live = "\n".join(re.sub(r"#.*$", "", ln) for ln in text.splitlines())
    if not re.search(r"^\s*schedule:", live, re.M):
        return []
    return re.findall(r"cron:\s*['\"]([^'\"]+)['\"]", live)


def load_exceptions() -> dict[str, dict]:
    if not EXCEPTIONS.exists():
        return {}
    try:
        raw = json.loads(EXCEPTIONS.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise Unverifiable(f"{EXCEPTIONS.name} is present but unreadable: {exc}")
    out = {}
    for path, meta in (raw.get("exceptions") or {}).items():
        if not isinstance(meta, dict):
            raise Unverifiable(f"exception for '{path}' is not an object")
        key, reason = meta.get("key"), meta.get("reason")
        if not key or not KEY_RE.match(str(key)):
            raise Unverifiable(
                f"exception for '{path}' has no valid Jira key (got {key!r}). "
                "A bare marker is itself a failure."
            )
        if not reason or not str(reason).strip():
            raise Unverifiable(f"exception for '{path}' has a key but no reason")
        out[path] = meta
    return out


def live_states() -> dict[str, str]:
    """workflow path -> state, from the GitHub API. The only source of truth."""
    try:
        res = subprocess.run(
            ["gh", "api", f"/repos/{REPO}/actions/workflows", "--paginate", "-q", ".workflows"],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unverifiable(f"could not call the GitHub API: {exc}")
    if res.returncode != 0:
        raise Unverifiable(f"gh api failed (exit {res.returncode}): {res.stderr.strip()[:300]}")

    entries = []
    for chunk in res.stdout.strip().split("\n"):
        if not chunk.strip():
            continue
        try:
            parsed = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        entries.extend(parsed if isinstance(parsed, list) else [parsed])
    if not entries:
        raise Unverifiable("the GitHub API returned no workflows — refusing to pass vacuously")
    return {w["path"]: w.get("state", "unknown") for w in entries if "path" in w}


def classify(
    scheduled: list[tuple[str, list[str]]],
    states: dict[str, str],
    exceptions: dict[str, dict],
) -> tuple[list[tuple[str, str, list[str]]], list[str], list[tuple[str, dict]]]:
    """Split scheduled workflows into (problems, stale_exceptions, excepted).

    EXTRACTED FROM main() BY BUGS-102 so it can be exercised directly. Before
    that, `--self-test` covered only `declares_cron` parsing and the Jira-key
    regex — the classification decision, which is the whole judgement this
    control makes, had no fixtures at all. That is how the bug below survived:
    every self-test case passed while the branch was unreachable.

    ⚠️ THE `state is None` BRANCH MUST CONSULT `exceptions` (BUGS-102).
    It used to `continue` straight into `problems`, so an unregistered workflow
    could never be excepted. GitHub does not register a workflow's `schedule`
    trigger until the file is on the DEFAULT branch, so a PR ADDING a scheduled
    workflow was unconditionally failed by the very gate its file had to pass to
    reach that branch — a deadlock with no documented way out. The exceptions
    file, the stated escape hatch, was consulted only on the
    registered-but-disabled path.

    The danger of widening an allowlist is that entries outlive their reason.
    That half needs no new code: the `state == "active"` arm below already marks
    an exception STALE, so a "not yet registered" entry becomes a BUILD FAILURE
    the moment its workflow registers and runs. Asserted by a fixture rather
    than assumed — the ticket predicted this would need extending, and reading
    the code showed it did not.
    """
    problems: list[tuple[str, str, list[str]]] = []
    stale: list[str] = []
    excepted: list[tuple[str, dict]] = []

    for path, crons in scheduled:
        state = states.get(path)
        if state is None:
            # On disk with a schedule, absent from the API: unregistered, so it
            # cannot run and cannot be seen to be not running. Excepted only
            # with a ticketed entry — silence is still a failure.
            if path in exceptions:
                excepted.append((path, exceptions[path]))
            else:
                problems.append((path, "NOT-REGISTERED-WITH-GITHUB", crons))
            continue
        if state != "active":
            if path in exceptions:
                excepted.append((path, exceptions[path]))
            else:
                problems.append((path, state, crons))
        elif path in exceptions:
            # Active AND excepted: the reason has expired. This is what stops
            # the widening above from becoming a suppression list.
            stale.append(path)

    return problems, stale, excepted


def main() -> int:
    enforce = "--enforce" in sys.argv or os.environ.get("SCHEDULED_WORKFLOW_GATE_ENFORCE") == "1"

    if not WF_DIR.is_dir():
        die_unverifiable(f"{WF_DIR} does not exist — nothing could be scanned.")

    try:
        exceptions = load_exceptions()
        states = live_states()
    except Unverifiable as exc:
        die_unverifiable(str(exc))
        return 2  # unreachable; keeps type-checkers and readers honest

    scheduled: list[tuple[str, list[str]]] = []
    for f in sorted(list(WF_DIR.glob("*.yml")) + list(WF_DIR.glob("*.yaml"))):
        crons = declares_cron(f.read_text(encoding="utf-8", errors="ignore"))
        if crons:
            scheduled.append((str(f.relative_to(ROOT)), crons))

    if not scheduled:
        die_unverifiable("no workflow declares a cron schedule — that is not credible for this repo; the scan did not work.")

    problems, stale_exceptions, excepted = classify(scheduled, states, exceptions)
    for path, meta in excepted:
        print(f"  excepted  {path}  [{meta['key']}] {meta['reason']}")

    print(f"check-scheduled-workflows-active: {len(scheduled)} workflow(s) declare a cron schedule.")

    for path in stale_exceptions:
        print(f"::error::  STALE exception: {path} is ACTIVE but still listed in {EXCEPTIONS.name}.")
        print("::error::    Remove it. An exception list containing entries that no longer apply is a list nobody reads.")

    for path, state, crons in problems:
        print(f"::{'error' if enforce else 'warning'}::  {path} declares cron '{', '.join(crons)}' but its state is '{state}'.")
        print(f"::{'error' if enforce else 'warning'}::    It will NOT run. The file on disk is not evidence that it does.")

    if not problems and not stale_exceptions:
        print("Every scheduled workflow is active. ✓")
        return 0

    if stale_exceptions:
        return 1  # always blocking: a stale exception is unambiguous

    if enforce:
        print("::error::Re-enable the workflow, or add it to "
              f"{EXCEPTIONS.name} with a Jira key and a reason.")
        return 1

    print(f"::warning::check-scheduled-workflows-active: {len(problems)} inactive scheduled workflow(s). "
          "Warn-only; set SCHEDULED_WORKFLOW_GATE_ENFORCE=1 to block.")
    return 0


def self_test() -> int:
    """Fixtures for the parsing decisions that are easy to get wrong."""
    cases = [
        ("plain cron detected",
         declares_cron("on:\n  schedule:\n    - cron: '0 4 * * 0'\n") == ["0 4 * * 0"]),
        ("double-quoted cron detected",
         declares_cron('on:\n  schedule:\n    - cron: "0 4 * * 0"\n') == ["0 4 * * 0"]),
        # backup-complete.yml ships its cadence commented until commissioning.
        # Reading that as a live schedule would raise a finding that can never
        # be resolved, and an unresolvable finding is how a gate gets ignored.
        ("commented-out cron is NOT a schedule",
         declares_cron("on:\n  schedule:\n    # - cron: '0 1 * * *'\n") == []),
        ("cron mentioned in prose without a schedule block is not one",
         declares_cron("# runs on cron: '0 4 * * 0' historically\non:\n  push:\n") == []),
        ("workflow_dispatch only is not scheduled",
         declares_cron("on:\n  workflow_dispatch:\n") == []),
        ("multiple crons all captured",
         declares_cron("on:\n  schedule:\n    - cron: '0 1 * * *'\n    - cron: '0 5 * * 0'\n")
         == ["0 1 * * *", "0 5 * * 0"]),
        ("jira key shape enforced", bool(KEY_RE.match("SEC-79")) and not KEY_RE.match("SEC-xxx")),
    ]

    # ---------------------------------------------------------------------
    # BUGS-102 — classification fixtures.
    #
    # These are the cases the control actually decides, and until now it had
    # NONE. Everything above tests `declares_cron`; the deadlock lived in
    # main()'s untested body, which is why a green self-test coexisted with a
    # branch nobody could reach.
    # ---------------------------------------------------------------------
    NEW = [("wf/new.yml", ["0 9 * * *"])]
    TICKET = {"key": "BUGS-102", "reason": "new workflow, not yet on the default branch"}

    # THE DEFECT. Unregistered + ticketed exception must PASS. Before the fix
    # this landed in `problems` regardless, so no PR adding a scheduled
    # workflow could ever go green.
    p, s, e = classify(NEW, {}, {"wf/new.yml": TICKET})
    cases.append(("BUGS-102: an UNREGISTERED workflow WITH an exception is excepted",
                  (p, s, [x[0] for x in e]) == ([], [], ["wf/new.yml"])))

    # The control's whole point — must not regress into "unregistered is fine".
    p, s, e = classify(NEW, {}, {})
    cases.append(("BUGS-102: an UNREGISTERED workflow with NO exception still FAILS",
                  len(p) == 1 and p[0][1] == "NOT-REGISTERED-WITH-GITHUB" and not e))

    # The ratchet. Once it registers and runs, the exception has expired — so
    # widening above cannot decay into a permanent allowlist entry.
    p, s, e = classify(NEW, {"wf/new.yml": "active"}, {"wf/new.yml": TICKET})
    cases.append(("BUGS-102: the exception goes STALE once the workflow is ACTIVE",
                  s == ["wf/new.yml"] and not p and not e))

    # Pre-existing behaviour, pinned so this change is proven not to alter it.
    p, s, e = classify(NEW, {"wf/new.yml": "disabled_manually"}, {"wf/new.yml": TICKET})
    cases.append(("BUGS-102: registered-but-DISABLED + exception is still excepted, not stale",
                  [x[0] for x in e] == ["wf/new.yml"] and not p and not s))

    # And a disabled workflow with no exception is still a finding.
    p, s, e = classify(NEW, {"wf/new.yml": "disabled_manually"}, {})
    cases.append(("BUGS-102: registered-but-DISABLED with NO exception still FAILS",
                  len(p) == 1 and p[0][1] == "disabled_manually"))

    # An active workflow with no exception is the healthy steady state — without
    # this the four cases above would also be satisfied by a classifier that
    # flagged everything.
    p, s, e = classify(NEW, {"wf/new.yml": "active"}, {})
    cases.append(("BUGS-102: an ACTIVE workflow with no exception is clean",
                  (p, s, e) == ([], [], [])))
    failed = [n for n, ok in cases if not ok]
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if failed:
        print(f"::error::self-test: {len(failed)} case(s) failed: {', '.join(failed)}")
        return 1
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
