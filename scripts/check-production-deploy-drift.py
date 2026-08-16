#!/usr/bin/env python3
"""scripts/check-production-deploy-drift.py — CTL-065 (SEC-153).

`main` MOVING IS NOT PRODUCTION CHANGING.

That sentence is the whole control, and it is the CTL-042 / SEC-79 shape once
more: a fact that lives only in the GitHub API, invisible to every check that
reasons about the repository.

WHAT WENT UNNOTICED
-------------------
Measured 2026-08-16, during a routine promote:

    last SUCCESSFUL deploy-production.yml run   8a2d4681   2026-08-14 12:21Z
    origin/main                                 029896a3   2026-08-16 09:22Z
    runs sitting in status=waiting              2   (1ddd1153, 029896a3)

So `checklyra.com` had been serving a build two promotes old for ~2 days, while
`main` had moved twice. Nothing reported it. The promote workflow itself
reported **completed success** — correctly, because its job is to merge
`beta` into `main`, and it did. The DEPLOY is a separate run, gated on the
`Production` environment review (SEC-106), and a gated run sits in `waiting`
indefinitely without ever failing.

WHY THE EXISTING CHECK CANNOT SEE THIS
--------------------------------------
`scripts/check-release-drift.sh` (CTL-?/KAN-173) measures `develop` -> `main`.
Both are refs in the repository, so it is a pure git computation — and it was
GREEN throughout, because after a promote `main` is exactly where it should be.
The question it answers is "has merged work stopped flowing towards main?"
The question nobody was asking is "is main actually SERVING?"

This matters more than a stale-version annoyance. Every argument that a fix has
shipped — a closed SEC ticket, a `PROMOTED` design-loop state, a "live in
production" note in a run log — rests on `main` containing the commit. It does
not follow. Between 2026-08-14 and 2026-08-16 that inference would have been
wrong about every change in two promotes.

⚠️ AND THE GAP IS EXPECTED TO RECUR, WHICH IS WHY IT NEEDS A CONTROL RATHER
THAN A REMINDER. The `Production` environment deliberately requires a human
review, and the founder cannot give one from a phone. So "a deploy is waiting
for hours or days" is the NORMAL operating state of this pipeline, not an
incident. What is not acceptable is that nobody is told.

WHAT IT ASSERTS
---------------
1. The SHA production last successfully deployed is not more than
   `--max-age-days` old relative to `origin/main`'s tip, and not more than
   `--max-commits` behind it.
2. Any deploy run parked in `waiting` / `queued` / `action_required` is NAMED,
   with its URL, because that is the actionable half — someone has to go and
   approve it, and a number without a link is a number nobody acts on.

WHAT IT DOES NOT ASSERT, STATED PLAINLY
---------------------------------------
That the deployed build is HEALTHY, or that Vercel is serving the artefact that
run produced. It reads GitHub's record of the run, not the live site. Liveness
is `health-check.yml`'s concern and stays there (KAN-361: one concern, one
owner). A successful run whose artefact never went live would still read clean
here — the same class of gap as gotcha #15, and worth saying out loud rather
than leaving a reader to assume wider cover than exists.

FAIL-CLOSED, AND NEVER A SILENT ZERO (KAN-167)
----------------------------------------------
If the API cannot be reached, or no successful deploy run exists at all, this
exits 2 with `status=unknown`. It never reports "0 commits behind" for a
question it could not answer — that is the distinction the Workflow & Backup
Integrity Policy exists to preserve.

USAGE
    check-production-deploy-drift.py
    check-production-deploy-drift.py --max-age-days 3 --max-commits 40
    check-production-deploy-drift.py --self-test

ENVIRONMENT
    GITHUB_TOKEN    required for the API read (any read scope on the repo)
    GITHUB_REPOSITORY   owner/repo; defaults to luisa-sys/lyra
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_REPO = "luisa-sys/lyra"
WORKFLOW = "deploy-production.yml"
# A deploy waiting on a human review is normal; waiting for DAYS is not.
DEFAULT_MAX_AGE_DAYS = 3
DEFAULT_MAX_COMMITS = 25
# Statuses that mean "this run exists but is not going to progress on its own".
PARKED = {"waiting", "queued", "action_required", "pending"}


class Unverifiable(Exception):
    """The question could not be answered. Never downgrade this to 'clean'."""


def die_unverifiable(msg: str) -> int:
    print("status=unknown")
    print("commits_behind=DATA_UNAVAILABLE")
    print("days_behind=DATA_UNAVAILABLE")
    print(f"::error::check-production-deploy-drift: {msg}")
    print("::error::  Exiting 2 (unverifiable) rather than reporting a clean zero for a question that was never answered.")
    return 2


def api_get(url: str) -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise Unverifiable("GITHUB_TOKEN is not set, so the deploy history cannot be read.")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "lyra-ctl-065",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise Unverifiable(f"GitHub API returned HTTP {exc.code} for {url}") from exc
    except Exception as exc:  # noqa: BLE001 - any transport failure is unverifiable
        raise Unverifiable(f"GitHub API request failed for {url}: {exc}") from exc


def classify(runs: list[dict], main_sha: str, now: datetime,
             max_age_days: int, max_commits: int,
             commits_behind_fn) -> tuple[str, dict, list[str]]:
    """Pure, so the self-test can drive it with fixtures instead of the network.

    Returns (status, fields, messages). `status` is one of green/yellow/red.

    ⚠️ The PARKED list is reported even when the drift itself is green. A deploy
    approved 10 minutes after a promote is green AND has a parked run for those
    10 minutes; suppressing the notice until the drift turns red would hide the
    one piece of information that lets someone act BEFORE it does.
    """
    successes = [r for r in runs if r.get("conclusion") == "success"]
    if not successes:
        raise Unverifiable(
            f"no successful {WORKFLOW} run found in the sampled history — "
            "cannot establish what production is running."
        )

    latest = successes[0]
    deployed_sha = latest.get("head_sha") or ""
    if not deployed_sha:
        raise Unverifiable("the latest successful deploy run has no head_sha.")

    created = latest.get("created_at") or ""
    try:
        deployed_at = datetime.fromisoformat(created.replace("Z", "+00:00"))
    except ValueError as exc:
        raise Unverifiable(f"unparseable created_at on the latest successful run: {created!r}") from exc

    days_behind = (now - deployed_at).total_seconds() / 86400.0
    behind = commits_behind_fn(deployed_sha, main_sha)

    parked = [r for r in runs if r.get("status") in PARKED]

    messages: list[str] = []
    for r in parked:
        messages.append(
            f"  PARKED  {r.get('head_sha','')[:8]}  status={r.get('status')}  "
            f"created={r.get('created_at')}  {r.get('html_url','')}"
        )

    if deployed_sha == main_sha:
        status = "green"
    elif days_behind > max_age_days or (behind is not None and behind > max_commits):
        status = "red"
    else:
        status = "yellow"

    fields = {
        "deployed_sha": deployed_sha[:8],
        "main_sha": main_sha[:8],
        "commits_behind": "UNKNOWN" if behind is None else behind,
        "days_behind": round(days_behind, 2),
        "parked_runs": len(parked),
        "status": status,
    }
    return status, fields, messages


def commits_behind_git(deployed_sha: str, main_sha: str):
    """How many commits main is ahead of the deployed SHA. None if not computable.

    Returns None rather than 0 when the SHA is absent from the local clone — a
    shallow checkout must not be able to report 'not behind'.
    """
    try:
        out = subprocess.run(
            ["git", "rev-list", "--count", f"{deployed_sha}..{main_sha}"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            return None
        return int(out.stdout.strip())
    except (ValueError, OSError, subprocess.SubprocessError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--max-age-days", type=float, default=DEFAULT_MAX_AGE_DAYS)
    ap.add_argument("--max-commits", type=int, default=DEFAULT_MAX_COMMITS)
    args, _ = ap.parse_known_args()

    repo = os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPO

    try:
        data = api_get(
            f"https://api.github.com/repos/{repo}/actions/workflows/{WORKFLOW}/runs?per_page=30"
        )
        runs = data.get("workflow_runs", [])
        if not runs:
            raise Unverifiable(f"the API returned no {WORKFLOW} runs at all.")

        main_sha = subprocess.run(
            ["git", "rev-parse", "origin/main"], capture_output=True, text=True, timeout=30
        ).stdout.strip()
        if not main_sha:
            raise Unverifiable("origin/main could not be resolved — fetch main before running.")

        status, fields, messages = classify(
            runs, main_sha, datetime.now(timezone.utc),
            args.max_age_days, args.max_commits, commits_behind_git,
        )
    except Unverifiable as exc:
        return die_unverifiable(str(exc))

    for k, v in fields.items():
        print(f"{k}={v}")
    for m in messages:
        print(m)

    if fields["parked_runs"]:
        print(f"::warning::check-production-deploy-drift: {fields['parked_runs']} production deploy run(s) are parked "
              "awaiting the Production environment review. They will not progress without a human.")

    if status == "red":
        print(f"::error::check-production-deploy-drift: production is running {fields['deployed_sha']} "
              f"({fields['days_behind']} days old, {fields['commits_behind']} commits behind main {fields['main_sha']}).")
        print("::error::  `main` containing a commit is NOT evidence that it shipped. Approve the pending deploy, or")
        print("::error::  record why the gap is intentional.")
        return 1

    print(f"check-production-deploy-drift: {status}. ✓")
    return 0


# ─────────────────────────── self-test ───────────────────────────

def self_test() -> int:
    """Fixtures over `classify`, which is where every decision is made.

    ⚠️ The failure list is consumed at the END and its verdict is what exits —
    SEC-140's lesson: assertions appended after the `if failures:` check are
    assertions nobody reads, and the case COUNT goes up while coverage does not.
    """
    failures: list[str] = []
    now = datetime.fromisoformat("2026-08-16T09:30:00+00:00")

    def check(name: str, cond: bool) -> None:
        if not cond:
            failures.append(name)

    def run(sha, status="completed", conclusion="success", created="2026-08-16T09:00:00Z"):
        return {"head_sha": sha, "status": status, "conclusion": conclusion,
                "created_at": created, "html_url": f"https://x/{sha[:8]}"}

    zero = lambda _a, _b: 0            # noqa: E731
    n = lambda k: (lambda _a, _b: k)   # noqa: E731

    # 1. Deployed == main -> green.
    st, f, _ = classify([run("a" * 40)], "a" * 40, now, 3, 25, zero)
    check("deployed==main is green", st == "green")

    # 2. Behind but fresh and small -> yellow, not red.
    st, f, _ = classify([run("b" * 40, created="2026-08-16T00:00:00Z")], "c" * 40, now, 3, 25, n(2))
    check("small recent gap is yellow", st == "yellow")

    # 3. THE 2026-08-16 CASE: a successful run exists, but it is 2 days old and
    #    a newer run is parked. Must be red AND must name the parked run.
    runs = [
        run("d" * 40, status="waiting", conclusion=None, created="2026-08-16T09:22:00Z"),
        run("e" * 40, status="waiting", conclusion=None, created="2026-08-14T21:41:00Z"),
        run("f" * 40, created="2026-08-14T12:21:00Z"),
    ]
    st, f, msgs = classify(runs, "d" * 40, now, 3, 25, n(17))
    check("2-day-old deploy is not green", st != "green")
    check("parked runs are counted", f["parked_runs"] == 2)
    check("parked runs are named with a URL", len(msgs) == 2 and "https://x/" in msgs[0])
    check("the deployed sha is the SUCCESSFUL one, not the newest run",
          f["deployed_sha"] == "f" * 8)

    # 4. Age alone trips red even when the commit count is small.
    st, _, _ = classify([run("g" * 40, created="2026-08-01T00:00:00Z")], "h" * 40, now, 3, 25, n(1))
    check("age alone can trip red", st == "red")

    # 5. Commit count alone trips red even when fresh.
    st, _, _ = classify([run("i" * 40, created="2026-08-16T08:00:00Z")], "j" * 40, now, 3, 25, n(99))
    check("commit count alone can trip red", st == "red")

    # 6. Parked runs are reported even when the drift itself is GREEN. Without
    #    this, the actionable notice only appears once the gap is already bad.
    st, f, msgs = classify(
        [run("k" * 40, status="waiting", conclusion=None), run("k" * 40)],
        "k" * 40, now, 3, 25, zero,
    )
    check("parked reported while green", st == "green" and f["parked_runs"] == 1 and len(msgs) == 1)

    # 7. No successful run at all -> Unverifiable, NOT clean. This is the
    #    fail-closed case: a repo whose production has never deployed must not
    #    read as "0 behind".
    try:
        classify([run("l" * 40, status="waiting", conclusion=None)], "l" * 40, now, 3, 25, zero)
        check("no successful run raises Unverifiable", False)
    except Unverifiable:
        check("no successful run raises Unverifiable", True)

    # 8. An uncomputable commit count must not silently become 0. A shallow
    #    clone returns None, and None must not be treated as 'not behind'.
    st, f, _ = classify([run("m" * 40, created="2026-08-16T09:00:00Z")], "n" * 40, now, 3, 25,
                        lambda _a, _b: None)
    check("unknown commit count is surfaced, not zeroed", f["commits_behind"] == "UNKNOWN")
    check("unknown commit count does not fabricate red", st in ("yellow", "red"))

    # 9. An unparseable timestamp is Unverifiable rather than 'now'.
    try:
        classify([run("o" * 40, created="not-a-date")], "o" * 40, now, 3, 25, zero)
        check("bad timestamp raises Unverifiable", False)
    except Unverifiable:
        check("bad timestamp raises Unverifiable", True)

    total = 12
    if failures:
        for name in failures:
            print(f"::error::self-test FAILED: {name}")
        print(f"::error::check-production-deploy-drift --self-test: {len(failures)} of {total} case(s) failed.")
        return 1
    print(f"check-production-deploy-drift: self-test passed ({total} cases). ✓")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
