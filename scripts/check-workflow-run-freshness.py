#!/usr/bin/env python3
"""scripts/check-workflow-run-freshness.py — CTL-072 (SEC-106 §3 item 3 / §4c).

A cron in a workflow file is a REQUEST, not a fact. `db-invariants.yml` says it
runs daily; nothing in this repository has ever asserted that it did.

CTL-042 (check-scheduled-workflows-active.py) answers the adjacent question —
"is this workflow `disabled_manually`?" — and it is not the same question. A
workflow can be active and still never fire: GitHub suspends schedules on a
repository with no activity for 60 days, a malformed cron is accepted and never
matches, and a workflow whose `schedule` trigger was never registered on the
default branch is enabled-and-silent. In every one of those states CTL-042 is
correctly green. So the two are complements, not duplicates, and this one is the
half that can see the SEC-79 shape: a control nobody has heard from.

⚠️ THE `needs:`-SKIP TRAP, which is why "a run exists" is the wrong test.
GitHub counts `success`, `skipped` and `neutral` alike as successful check
statuses. A job skipped because a `needs:` dependency failed reports SKIPPED,
which reads as a pass to branch protection and to any freshness check keyed on
the existence of a run. Only `conclusion == "success"` is treated as evidence
here; `skipped`, `cancelled`, `neutral`, `failure`, `timed_out`,
`action_required`, `startup_failure` and an in-flight run (conclusion `null`)
are all NOT fresh, and each is named distinctly in the finding so the reader is
not sent hunting the wrong cause.

EXIT — three-valued, the same contract as check-required-checks.py (SEC-106 §4a)
    0  every configured workflow has a successful run inside its window.
    1  MEASURED, and at least one has not. The annotation names the workflow,
       the window, and what the newest run actually concluded.
    2  COULD NOT MEASURE — no `gh`, no token, a 401/403/404, a network failure,
       an unreadable config. Reports UNVERIFIED, in wording deliberately
       distinct from exit 1.

⚠️ Being unable to list runs is exit 2 — not "stale", and certainly not "fresh"
(§4c). Those are three different states and collapsing any two of them is how a
control starts lying. CTL-059 is the cost of getting this wrong: db-invariants.yml
raised every non-zero exit under a bare `if: failure()`, so an HTTP 403 printed
the divergence story and sent the reader after an uncommitted migration on three
separate days.

⚠️ Fail-closed is asserted from the PRECONDITION, never inferred from a status
code (gotcha #30). The workflow list must come back non-empty before any empty
run-list is believed to mean "this workflow has never run" — otherwise a broken
call reports every workflow as never-run, or worse, a comparison silently
passes over nothing.

TWO-WAY, like every ratchet here. A config entry naming a workflow file that no
longer exists fails as STALE. An entry that can no longer be violated is not a
passing entry; it is an entry nobody has read.

WHAT THIS CANNOT COVER, stated rather than hidden.
  * The live path needs a real token against the real Actions API, which no unit
    test has. That half is exercised only by the scheduled run itself — the same
    stated gap check-required-checks.py carries for its `--live` arm.
  * It asserts a run SUCCEEDED, not that the run did anything useful. A workflow
    whose every step is a no-op still concludes `success`. That is the class
    CTL-062 (run-log freshness) and the workflow-integrity guards address.
  * It measures at RUN granularity, not JOB granularity. A workflow of three
    jobs in which one fails concludes `failure`, so this reports it stale even
    though two jobs did their work. That is the conservative direction and is
    deliberate — the opposite error (a workflow whose one meaningful job fails
    every night while the run is called fresh) is the failure this exists to
    stop. It does mean a finding here says "this workflow is not healthy", not
    "this specific assertion stopped running"; read the run to find out which.
  * `required-checks.yml` is deliberately NOT configured here yet, and the
    reason is in .github/workflow-freshness.json. Adding it today would install a
    permanent red — the state CLAUDE.md's catalogue calls failure mode 7, "a red
    you have learned to expect", which is a switched-off control.

USAGE
    check-workflow-run-freshness.py            # live; needs GH_TOKEN + `gh`
    check-workflow-run-freshness.py --self-test
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent.parent
WF_DIR = ROOT / ".github" / "workflows"
CONFIG = ROOT / ".github" / "workflow-freshness.json"
REPO = os.environ.get("GITHUB_REPOSITORY", "luisa-sys/lyra")

# GitHub's own successful-status set is {success, skipped, neutral}. Only the
# first is evidence that the scheduled work happened, and the gap between those
# two sentences is this control's entire reason for existing.
SUCCESS = "success"

# Named so the finding can say WHY a run did not count. A conclusion absent from
# this map is still not fresh — the default branch of `describe_conclusion`
# handles anything GitHub adds later, rather than treating an unknown value as
# acceptable.
NOT_FRESH_REASON = {
    "skipped": (
        "concluded SKIPPED. GitHub counts skipped as a successful status, which "
        "is the `needs:`-skip trap: a job skipped because a dependency failed "
        "reads as a pass. It is not evidence the scheduled work ran"
    ),
    "cancelled": "was CANCELLED, so the scheduled work did not complete",
    "neutral": (
        "concluded NEUTRAL. GitHub counts neutral as a successful status; it is "
        "not evidence the scheduled work ran"
    ),
    "failure": "FAILED",
    "timed_out": "TIMED OUT",
    "action_required": "is waiting on a required action and has not completed",
    "startup_failure": "failed at startup, so no step ran",
    None: "has not finished yet (no conclusion)",
}


class Unverifiable(Exception):
    """The truth could not be established. Never downgraded to a pass."""


def die_unverifiable(msg: str) -> None:
    print(f"::error::check-workflow-run-freshness: UNVERIFIED — {msg}")
    print(
        "::error::  Exit 2 means NOTHING WAS MEASURED. This is not a report of "
        "staleness: no run list was read, so do not conclude the workflow has "
        "stopped firing (CTL-059)."
    )
    sys.exit(2)


# ---------------------------------------------------------------------------
# The config
# ---------------------------------------------------------------------------


class Watch(NamedTuple):
    workflow: str          # file name, e.g. "db-invariants.yml"
    max_age_hours: float
    reason: str


def load_config(path: Path = CONFIG) -> list[Watch]:
    if not path.is_file():
        raise Unverifiable(f"{path.name} does not exist — there is nothing to check.")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Unverifiable(f"{path.name} is present but unreadable: {exc}")

    watched = raw.get("watched")
    if not isinstance(watched, dict) or not watched:
        raise Unverifiable(
            f"{path.name} watches no workflows. An empty config is vacuously "
            "satisfied by any state of the world, which is worse than no file."
        )

    out: list[Watch] = []
    for wf, meta in watched.items():
        if not isinstance(meta, dict):
            raise Unverifiable(f"'{wf}' is not an object")
        hrs = meta.get("max_age_hours")
        if not isinstance(hrs, (int, float)) or isinstance(hrs, bool) or hrs <= 0:
            raise Unverifiable(
                f"'{wf}' has no usable positive 'max_age_hours'. A window of zero "
                "or less can never be satisfied; a missing one asserts nothing."
            )
        reason = meta.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise Unverifiable(
                f"'{wf}' carries no 'reason'. A watch nobody can justify later is "
                "a watch that gets deleted the first time it goes red."
            )
        out.append(Watch(wf, float(hrs), reason.strip()))
    return out


def stale_entries(watches: list[Watch], present: set[str]) -> list[str]:
    """Config entries naming a workflow file that no longer exists.

    The two-way half. Same shape as env-access-baseline.json (CTL-037) and
    supabase/schema-drift-baseline.json (CTL-036): a rule that can no longer be
    violated has not passed, it has stopped being read.
    """
    return [w.workflow for w in watches if w.workflow not in present]


def workflow_files() -> set[str]:
    if not WF_DIR.is_dir():
        raise Unverifiable(f"{WF_DIR} does not exist — no workflow could be scanned.")
    names = {p.name for p in WF_DIR.glob("*.yml")} | {p.name for p in WF_DIR.glob("*.yaml")}
    if not names:
        raise Unverifiable(
            f"{WF_DIR} contains no workflow files — refusing to report every "
            "watched workflow STALE on the strength of a scan that found nothing."
        )
    return names


# ---------------------------------------------------------------------------
# The judgement — pure, so the self-test can exercise it directly
# ---------------------------------------------------------------------------


def parse_ts(value: object) -> datetime | None:
    """GitHub timestamps are RFC 3339 with a literal Z."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def describe_conclusion(conclusion: object) -> str:
    if conclusion in NOT_FRESH_REASON:
        return NOT_FRESH_REASON[conclusion]  # type: ignore[index]
    return f"concluded '{conclusion}', which is not `success`"


def classify(watch: Watch, runs: list[dict], now: datetime) -> str | None:
    """None means fresh. A string is the finding.

    `runs` is the raw `workflow_runs` array, newest first, ALREADY restricted to
    the workflow in question by the caller. It is not filtered by conclusion
    here on purpose: the newest run's conclusion is itself the most useful thing
    to report, and silently skipping past a run that FAILED to find an older
    success would describe a broken workflow as healthy.
    """
    if not runs:
        return (
            f"{watch.workflow}: has NEVER run, or its runs have aged out of the "
            f"API. Its cron has produced nothing, so the window of "
            f"{watch.max_age_hours:g}h cannot be satisfied. ({watch.reason})"
        )

    cutoff = now - timedelta(hours=watch.max_age_hours)
    for run in runs:
        if run.get("conclusion") != SUCCESS:
            continue
        ts = parse_ts(run.get("updated_at") or run.get("run_started_at") or run.get("created_at"))
        if ts is None:
            # A run we cannot date is not a run we may count. Falling through to
            # the next one is right: this is an unusable record, not a failure of
            # the API (which would have raised long before here).
            continue
        if ts >= cutoff:
            return None

    newest = runs[0]
    newest_ts = parse_ts(
        newest.get("updated_at") or newest.get("run_started_at") or newest.get("created_at")
    )
    when = newest_ts.strftime("%Y-%m-%dT%H:%M:%SZ") if newest_ts else "an unreadable time"
    age = f"{(now - newest_ts).total_seconds() / 3600:.1f}h ago" if newest_ts else "age unknown"
    verdict = (
        "succeeded" if newest.get("conclusion") == SUCCESS
        else describe_conclusion(newest.get("conclusion"))
    )
    return (
        f"{watch.workflow}: no SUCCESSFUL run inside the last "
        f"{watch.max_age_hours:g}h. The newest of {len(runs)} run(s) {verdict}, at "
        f"{when} ({age}). ({watch.reason})"
    )


# ---------------------------------------------------------------------------
# The live arm
# ---------------------------------------------------------------------------


def _gh(args: list[str]) -> str:
    try:
        res = subprocess.run(
            ["gh", "api", *args], capture_output=True, text=True, timeout=60
        )
    except FileNotFoundError:
        raise Unverifiable("the `gh` CLI is not installed, so no run list could be read.")
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unverifiable(f"could not call the GitHub API: {exc}")
    if res.returncode != 0:
        err = res.stderr.strip()[:400]
        if "401" in err or "403" in err or "Resource not accessible" in err:
            raise Unverifiable(
                "the GitHub API refused the request. Listing workflow runs needs a "
                f"token with actions:read. ({err})"
            )
        raise Unverifiable(f"gh api failed (exit {res.returncode}): {err}")
    return res.stdout


def api_workflows() -> set[str]:
    """File names GitHub knows about — AND the fail-closed precondition.

    Asserted directly rather than inferred from an exit code: if this comes back
    empty, an empty run list below means "the call did nothing", not "the
    workflow has never run", and every classification would be a fabrication.
    """
    try:
        payload = json.loads(_gh([f"/repos/{REPO}/actions/workflows", "--paginate"]))
    except json.JSONDecodeError as exc:
        raise Unverifiable(f"the workflow list did not parse: {exc}")
    if not isinstance(payload, dict) or "workflows" not in payload:
        raise Unverifiable(
            "the workflow list came back in an unexpected shape, so nothing "
            "below it can be trusted."
        )
    names = {
        Path(str(w.get("path", ""))).name
        for w in payload.get("workflows") or []
        if w.get("path")
    }
    if not names:
        raise Unverifiable(
            "GitHub reported ZERO workflows for this repository. That is not a "
            "state this repo can be in, so the call did not do what it appears "
            "to have done — and every freshness verdict below would have been "
            "invented from an empty list."
        )
    return names


def api_runs(workflow: str, limit: int = 20) -> list[dict]:
    try:
        payload = json.loads(
            _gh([f"/repos/{REPO}/actions/workflows/{workflow}/runs?per_page={limit}"])
        )
    except json.JSONDecodeError as exc:
        raise Unverifiable(f"the run list for '{workflow}' did not parse: {exc}")
    if not isinstance(payload, dict) or "workflow_runs" not in payload:
        raise Unverifiable(
            f"the run list for '{workflow}' came back without a 'workflow_runs' "
            "key. An absent key is not an empty list — one means the request "
            "failed, the other means the workflow never ran."
        )
    runs = payload.get("workflow_runs") or []
    if not isinstance(runs, list):
        raise Unverifiable(f"'workflow_runs' for '{workflow}' is not a list")
    return runs


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    try:
        watches = load_config()
        present = workflow_files()
    except Unverifiable as exc:
        die_unverifiable(str(exc))
        return 2

    findings = [
        f"{name}: STALE — .github/workflow-freshness.json watches this workflow "
        "but the file no longer exists. Remove the entry, or restore the workflow."
        for name in stale_entries(watches, present)
    ]

    try:
        known = api_workflows()
        now = datetime.now(timezone.utc)
        for w in watches:
            if w.workflow not in present:
                continue  # already reported STALE above
            if w.workflow not in known:
                findings.append(
                    f"{w.workflow}: exists in the repository but GitHub has no "
                    "workflow registered for it, so no schedule of its can ever "
                    "fire. (A `schedule` trigger is registered only once the file "
                    "is on the default branch.)"
                )
                continue
            finding = classify(w, api_runs(w.workflow), now)
            if finding:
                findings.append(finding)
    except Unverifiable as exc:
        die_unverifiable(str(exc))
        return 2

    print(
        f"check-workflow-run-freshness: {len(watches)} watched workflow(s) on {REPO}."
    )
    for f in findings:
        print(f"::error::  {f}")
    if findings:
        print(
            "::error::A cron is a request, not a fact. These workflows are "
            "configured to run and have not successfully done so inside their "
            "window — this was measured, not guessed."
        )
        return 1
    print("Every watched workflow has succeeded inside its window. ✓")
    return 0


# ---------------------------------------------------------------------------
# self-test
# ---------------------------------------------------------------------------


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    def check(name: str, ok: bool) -> None:
        cases.append((name, bool(ok)))

    NOW = datetime(2026, 8, 18, 12, 0, 0, tzinfo=timezone.utc)
    W = Watch("db-invariants.yml", 36, "the daily DB invariant sweep")

    def run(hours_ago: float, conclusion: str | None = SUCCESS) -> dict:
        ts = (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
        return {"conclusion": conclusion, "updated_at": ts}

    # --- freshness proper ---------------------------------------------------
    check("a successful run inside the window is fresh",
          classify(W, [run(2)], NOW) is None)
    check("a successful run OLDER than the window is stale",
          (classify(W, [run(40)], NOW) or "").startswith("db-invariants.yml: no SUCCESSFUL run"))
    check("the boundary is inclusive — a success exactly at the window is fresh",
          classify(W, [run(36)], NOW) is None)
    check("an older success is found behind a newer failure",
          classify(W, [run(1, "failure"), run(5)], NOW) is None)
    check("no runs at all is a finding, and says so distinctly",
          "has NEVER run" in (classify(W, [], NOW) or ""))

    # --- THE `needs:`-SKIP TRAP, §4c ---------------------------------------
    # GitHub's successful-status set is {success, skipped, neutral}. A freshness
    # check keyed on "a run exists" is satisfied by every one of these.
    for concl in ("skipped", "cancelled", "neutral"):
        f = classify(W, [run(1, concl)], NOW)
        check(f"a run concluding {concl.upper()} inside the window is NOT fresh", f is not None)
    check("the SKIPPED finding names the needs:-skip trap rather than just 'not success'",
          "needs:" in (classify(W, [run(1, "skipped")], NOW) or ""))
    check("a run still in flight (conclusion null) is NOT fresh",
          classify(W, [run(1, None)], NOW) is not None)
    check("a conclusion GitHub has not invented yet is NOT fresh",
          classify(W, [run(1, "some_future_status")], NOW) is not None)
    check("the finding reports what the newest run actually concluded",
          "FAILED" in (classify(W, [run(1, "failure")], NOW) or ""))
    # A success that cannot be dated must not be counted. Falling back to "now"
    # here would make every unparseable record read as fresh.
    check("a successful run with an unreadable timestamp is not counted as fresh",
          classify(W, [{"conclusion": SUCCESS, "updated_at": "not-a-date"}], NOW) is not None)
    check("run_started_at is used when updated_at is absent",
          classify(W, [{"conclusion": SUCCESS,
                        "run_started_at": (NOW - timedelta(hours=1)).strftime(
                            "%Y-%m-%dT%H:%M:%SZ")}], NOW) is None)

    # --- the two-way ratchet ------------------------------------------------
    check("a watch naming a workflow that no longer exists is STALE",
          stale_entries([W], {"other.yml"}) == ["db-invariants.yml"])
    check("a watch whose workflow exists is not stale",
          stale_entries([W], {"db-invariants.yml"}) == [])

    # --- the config ---------------------------------------------------------
    def load_raises(payload: str) -> bool:
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            fh.write(payload)
            p = Path(fh.name)
        try:
            load_config(p)
            return False
        except Unverifiable:
            return True
        finally:
            p.unlink(missing_ok=True)

    check("an EMPTY watched map is rejected, not vacuously passed",
          load_raises('{"watched": {}}'))
    check("a watch with no max_age_hours is rejected",
          load_raises('{"watched": {"a.yml": {"reason": "r"}}}'))
    check("a watch with max_age_hours <= 0 is rejected",
          load_raises('{"watched": {"a.yml": {"max_age_hours": 0, "reason": "r"}}}'))
    check("a boolean max_age_hours is rejected (True would otherwise read as 1h)",
          load_raises('{"watched": {"a.yml": {"max_age_hours": true, "reason": "r"}}}'))
    check("a watch with no reason is rejected",
          load_raises('{"watched": {"a.yml": {"max_age_hours": 36}}}'))
    check("unparseable JSON is rejected", load_raises("{not json"))
    check("a missing config file is UNVERIFIED, not clean", _raises_missing())
    check("a well-formed config loads", not load_raises(
        '{"watched": {"a.yml": {"max_age_hours": 36, "reason": "r"}}}'))

    # --- timestamp parsing --------------------------------------------------
    check("an RFC 3339 Z timestamp parses",
          parse_ts("2026-08-18T12:00:00Z") == NOW)
    check("an empty timestamp yields None, not an exception", parse_ts("") is None)
    check("a non-string timestamp yields None", parse_ts(None) is None)

    # ⚠️ THE VERDICT IS READ HERE. SEC-140: eight self-test cases in
    # check-npm-audit-gate.py were appended AFTER its `if failures:` check, so
    # three separate mutations all printed "Self-test passed" and the case COUNT
    # went UP. Nothing below this comment may append to `cases`.
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
        load_config(ROOT / "definitely-not-here.json")
        return False
    except Unverifiable:
        return True


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
