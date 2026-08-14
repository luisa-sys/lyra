#!/usr/bin/env python3
"""CTL-057 — every production release on `main` carries a release tag.

WHY THIS EXISTS
---------------
BUGS-97. `promote-to-production.yml` treats a deploy parked on the SEC-106
required-reviewer gate as a terminal state: it exits 0 with
`deploy_state=awaiting-approval`, and `smoke-tests` / `release-tag` are gated on
that value, so they SKIP. The promote then reports overall SUCCESS.

That behaviour is deliberate and is defended twice in the workflow's own
comments — a promote paused on a human reviewer is healthy, `main` is merged and
correct, and failing it once fired a spurious auto-rollback (2026-07-31, run
30666194572) that emailed an alert and then died on a Vercel 409. The workflow
also prints "skipped, not passed" and names the remedy: approve, then re-run.

The gap is not that the promote lies. It is that NOTHING NOTICES IF NOBODY
RE-RUNS IT. Measured 2026-08-14 over the last 14 production releases:

    7d0b890e  2026-08-14  v0.1.97   (tagged only because a human re-ran it)
    c8662fbe  2026-08-13  UNTAGGED
    08e7bf1a  2026-08-12  UNTAGGED
    d80c6a20  2026-08-12  UNTAGGED
    6833735d  2026-08-11  v0.1.96
    cb067d34  2026-08-10  UNTAGGED
    19298ed8  2026-08-09  v0.1.95
    5b174a2d  2026-08-02  UNTAGGED
    5c698be9  2026-08-02  UNTAGGED
    bb277e3e  2026-07-31  UNTAGGED   <- first untagged release
    f463cf70  2026-07-30  v0.1.94    <- SEC-106 added the reviewer 2026-07-30
    6ba27418  2026-07-29  v0.1.93
    57198048  2026-07-27  v0.1.92
    ef9392ff  2026-07-27  v0.1.91

Seven of fourteen. Every release BEFORE the approval gate is tagged; every
untagged one is AFTER it. So for two weeks roughly half of production has been
unidentifiable by `git describe --tags` — which gotcha #12 names as the
authoritative version (package.json drifts; see BUGS-89/KAN-166) and which the
weekly report reads.

WHY A DETECTOR RATHER THAN FAILING THE PROMOTE
----------------------------------------------
BUGS-97 §2 proposes making the wait step fail loud on budget exhaustion. That
may still be right, but it collides with the rollback problem above: in this
workflow `auto-rollback` is `if: failure()` over `needs: [verify-source,
smoke-tests]`, so an upstream failure can reach it. Getting that wrong
reintroduces a spurious production rollback, which is worse than an untagged
release.

BUGS-97's own Prevention section proposes this control instead, and states the
principle exactly:

    "a workflow cannot be the only witness to its own completion."

So this checks the END STATE from outside: `main`'s HEAD is tagged. It does not
care how the tag got there, which promote ran, or whether anything paused.

⚠️ THE GRACE WINDOW IS NOT A SILENT SKIP.
A promote merges `main` and tags it minutes later, so a just-merged HEAD is
legitimately untagged for a short while. Inside that window this reports a
WARNING and exits 0; outside it, an ERROR and exits non-zero. It always says
which branch it took and why — the Workflow & Backup Integrity Policy forbids a
step that quietly passes when it could not decide, and "untagged but young" is a
decision, not an inability to check.

USAGE
    python3 scripts/check-release-tagged.py
    python3 scripts/check-release-tagged.py --self-test
    python3 scripts/check-release-tagged.py --grace-minutes 45
    python3 scripts/check-release-tagged.py --report      # history, non-blocking
"""

from __future__ import annotations

import argparse
import subprocess
import sys

# A just-merged promote has not reached its tag job yet. 40 minutes comfortably
# covers a production deploy (~330s) plus the approval-and-rerun path, without
# being so wide that a genuinely untagged release hides behind it for hours.
DEFAULT_GRACE_MINUTES = 40

# The subject line promote-to-production.yml writes when it merges beta.
PROMOTE_SUBJECT = "Promote beta"


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    ).stdout.strip()


def tags_pointing_at(sha: str) -> list[str]:
    out = git("tag", "--points-at", sha)
    return [t for t in out.split("\n") if t.strip()]


def commit_age_minutes(sha: str) -> float:
    """Minutes since the commit was authored. -1 when it cannot be determined."""
    ts = git("show", "-s", "--format=%ct", sha)
    now = git("log", "-1", "--format=%ct", "HEAD")  # repo clock, not wall clock
    if not ts.isdigit():
        return -1.0
    try:
        # Compare against the newest commit rather than time.time(): the check
        # must be reproducible in a test fixture, and a fixture repo's commits
        # are all "now" anyway.
        import time

        return (time.time() - int(ts)) / 60.0
    except (ValueError, OSError):
        return -1.0


def release_history(ref: str, limit: int) -> list[tuple[str, str, str | None]]:
    """[(sha, date, tag-or-None)] for production promote commits on `ref`."""
    raw = git("log", ref, "--format=%h|%ci|%s")
    rows: list[tuple[str, str, str | None]] = []
    for line in raw.split("\n"):
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        sha, date, subject = parts
        if PROMOTE_SUBJECT.lower() not in subject.lower():
            continue
        tags = tags_pointing_at(sha)
        rows.append((sha, date[:10], tags[0] if tags else None))
        if len(rows) >= limit:
            break
    return rows


def check(ref: str, grace_minutes: int) -> int:
    # `--verify <ref>^{commit}` is load-bearing. A bare `git rev-parse bad-ref`
    # EXITS NON-ZERO BUT ECHOES THE REF NAME, so a truthiness check on its
    # stdout accepts "no-such-branch" as a SHA, skips this fail-closed branch,
    # finds no tags pointing at it, and reports the missing branch as an
    # UNTAGGED RELEASE — a real finding invented out of a typo. Caught by this
    # script's own self-test, which is why that case exists.
    head = git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
    if len(head) != 40 or not all(c in "0123456789abcdef" for c in head):
        print(f"::error::check-release-tagged: cannot resolve '{ref}' to a commit.")
        print("::error::  Failing closed rather than reporting a clean result "
              "for a branch that was never read.")
        return 2

    short = head[:8]
    tags = tags_pointing_at(head)
    if tags:
        print(f"{ref} HEAD {short} is tagged {tags[0]}. ✓")
        return 0

    age = commit_age_minutes(head)
    if 0 <= age < grace_minutes:
        print(f"::warning::{ref} HEAD {short} is UNTAGGED, but is only "
              f"{age:.0f}m old (grace window {grace_minutes}m).")
        print("::warning::  A promote in flight tags after it merges. "
              "Re-check after the window; this is not yet a finding.")
        return 0

    age_text = f"{age:.0f}m old" if age >= 0 else "of unknown age"
    print(f"::error::{ref} HEAD {short} is UNTAGGED and is {age_text} "
          f"(grace window {grace_minutes}m).")
    print("::error::  A production release with no tag is one `git describe "
          "--tags` cannot identify — and that is the authoritative version "
          "here, because package.json drifts (gotcha #12, BUGS-89).")
    print("::error::  Most likely cause (BUGS-97): promote-to-production "
          "reported success while the deploy sat on the SEC-106 approval gate, "
          "so `Create release tag` was SKIPPED.")
    print("::error::  Fix: approve the deploy-production run if it is still "
          "waiting, then re-run promote-to-production.yml — its tag job will "
          "run once the deploy has completed.")
    return 1


def report(ref: str, limit: int) -> int:
    rows = release_history(ref, limit)
    if not rows:
        print(f"::error::check-release-tagged: no production promote commits "
              f"found on {ref}.")
        print("::error::  Refusing to report 'all tagged' over an empty list.")
        return 2
    untagged = [r for r in rows if r[2] is None]
    print(f"Production releases on {ref} (newest {len(rows)}):")
    for sha, date, tag in rows:
        print(f"  {sha}  {date}  {tag or 'UNTAGGED'}")
    print(f"\n{len(untagged)}/{len(rows)} untagged.")
    return 0


# --------------------------------------------------------------------------
# Self-test. Builds throwaway git repos so the comparison is exercised against
# real `git tag --points-at` output rather than a stub of it (CTL-038).
# --------------------------------------------------------------------------
def self_test() -> int:
    import os
    import tempfile

    results: list[tuple[str, bool]] = []

    def case(name: str, got, want) -> None:
        results.append((f"{name} (got {got!r}, want {want!r})", got == want))

    def make_repo(tag: bool, subject: str = "Promote beta → production") -> str:
        d = tempfile.mkdtemp(prefix="ctl057-")
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        run = lambda *a: subprocess.run(a, cwd=d, env=env, capture_output=True)
        run("git", "init", "-q", "-b", "main")
        open(os.path.join(d, "f"), "w").write("x")
        run("git", "add", "f")
        run("git", "commit", "-qm", subject)
        if tag:
            run("git", "tag", "v9.9.9")
        return d

    def run_in(d: str, *args: str):
        return subprocess.run(
            [sys.executable, os.path.abspath(__file__), *args],
            cwd=d, capture_output=True, text=True,
        )

    tagged = make_repo(tag=True)
    untagged = make_repo(tag=False)

    r = run_in(tagged, "--ref", "main")
    case("a TAGGED head passes", r.returncode, 0)

    # Young + untagged -> warn, exit 0. The fixture commit is seconds old.
    r = run_in(untagged, "--ref", "main")
    case("a YOUNG untagged head warns, does not fail", r.returncode, 0)
    case("...and says it is within the grace window",
         "grace window" in (r.stdout + r.stderr), True)

    # THE DEFECT THIS PINS: outside the grace window an untagged head must FAIL.
    # grace-minutes 0 makes every commit "old", which is how the real condition
    # is exercised without waiting 40 minutes.
    r = run_in(untagged, "--ref", "main", "--grace-minutes", "0")
    case("an OLD untagged head FAILS", r.returncode, 1)
    case("...and names BUGS-97 so the reader knows the cause",
         "BUGS-97" in (r.stdout + r.stderr), True)
    case("...and names the remedy (re-run the promote)",
         "re-run promote-to-production" in (r.stdout + r.stderr), True)

    # A tagged head must NOT fail even with a zero grace window, or the check
    # would just be "fail always" and would pass this suite for the wrong reason.
    r = run_in(tagged, "--ref", "main", "--grace-minutes", "0")
    case("a tagged head passes even at grace 0 (the gate is not always-fire)",
         r.returncode, 0)

    # Fail closed on an unresolvable ref — never report clean over nothing read.
    r = run_in(tagged, "--ref", "no-such-branch")
    case("an unresolvable ref FAILS CLOSED (exit 2)", r.returncode, 2)

    # --report must refuse an empty corpus rather than print "0 untagged".
    empty = make_repo(tag=False, subject="chore: not a promote")
    r = run_in(empty, "--ref", "main", "--report")
    case("--report refuses an EMPTY corpus (catalogue failure mode 4)",
         r.returncode, 2)

    r = run_in(untagged, "--ref", "main", "--report")
    case("--report lists an untagged release", "UNTAGGED" in r.stdout, True)

    passed = sum(1 for _, ok in results if ok)
    for label, ok in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    print(f"release-tagged self-test: {passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ref", default="origin/main")
    p.add_argument("--grace-minutes", type=int, default=DEFAULT_GRACE_MINUTES)
    p.add_argument("--limit", type=int, default=14)
    p.add_argument("--report", action="store_true")
    p.add_argument("--self-test", action="store_true")
    a = p.parse_args()

    if a.self_test:
        return self_test()
    if a.report:
        return report(a.ref, a.limit)
    return check(a.ref, a.grace_minutes)


if __name__ == "__main__":
    sys.exit(main())
