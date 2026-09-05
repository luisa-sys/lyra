#!/usr/bin/env python3
"""scripts/decide-release-tag.py — BUGS-104.

Decides whether a completed production deploy should create a release tag,
and which tag. Pure decision logic, so it can be tested; the workflow does the
git side.

WHY THIS EXISTS
---------------
BUGS-97 built release-integrity.yml (CTL-057) to DETECT an untagged production
release. It works. It never fixed the CAUSE, and the cause fires on every
single release:

  promote-to-production.yml
    wait-for-deploy  -> deploy is parked on the SEC-106 reviewer gate,
                        reports `waiting`, exits 0 with
                        deploy_state=awaiting-approval
    smoke-tests      -> `if: deploy_state == 'deployed'`  -> SKIPPED
    release-tag      -> `needs: [.., smoke-tests]`        -> SKIPPED

The founder then approves, the deploy succeeds — and nothing comes back to
tag, because the promote run finished long ago. Observed end to end on
2026-08-16: promote run 31965557264 green with both jobs skipped, deploy run
31965575474 green, `main` untagged.

`wait-for-deploy` exiting 0 on `waiting` is CORRECT and deliberate (a 2026-08-09
SEC-106 follow-up: failing it fired a spurious auto-rollback). The bug is that
nothing else picks the work up afterwards.

So the tag is decided HERE, from the deploy's own completion, whenever that
happens — minutes or hours after the promote.

WHY NOT INSIDE deploy-production.yml
------------------------------------
BUGS-97's own header states the principle: "a workflow cannot be the only
witness to its own completion." Keeping the decision in a separate workflow,
triggered by the deploy rather than hosted in it, preserves that.

THE TWO REFUSALS THAT MATTER
----------------------------
* `head_sha != main HEAD` — the deploy is for a superseded commit. Tagging
  today's HEAD off yesterday's deploy would attach a version to code that
  deploy never verified. REFUSE, loudly. This is the case a naive
  "deploy succeeded, tag main" would get wrong and never notice.
* already tagged — a no-op, not an error. Re-runs, the manual dispatch, and
  the overlap with promote-to-production's own release-tag job must all be
  safe. Two witnesses is the design; a duplicate tag attempt is not.

Exit codes:
  0  decision made (TAG or SKIP) — read `action=` from stdout
  1  refused: the inputs are inconsistent and tagging would be wrong
  2  could not decide (bad input) — FAIL CLOSED, never a silent skip

Usage:
  decide-release-tag.py --conclusion <c> --deploy-sha <sha> --main-sha <sha> \
                        --head-tag <tag-or-empty> --last-tag <tag-or-empty>
  decide-release-tag.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys

# A release tag is exactly vMAJOR.MINOR.PATCH. Anything else (v1.2, v1.2.3-rc1,
# a random annotation) is not a release version and must not seed the bump —
# silently mis-parsing one would produce a wrong version number, which is worse
# than refusing, because `git describe` is the authoritative version here.
RELEASE_TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")


def next_tag(last_tag: str) -> str:
    """The next patch version after `last_tag`.

    Mirrors promote-to-production.yml's `release-tag` job exactly, including
    its `v0.0.0` seed when no tag exists, so the two paths can never disagree
    about what the next version is.
    """
    if not last_tag:
        last_tag = "v0.0.0"
    m = RELEASE_TAG_RE.match(last_tag)
    if not m:
        raise ValueError(f"{last_tag!r} is not a vMAJOR.MINOR.PATCH release tag")
    major, minor, patch = (int(g) for g in m.groups())
    return f"v{major}.{minor}.{patch + 1}"


def decide(conclusion: str, deploy_sha: str, main_sha: str, head_tag: str, last_tag: str):
    """Return (exit_code, action, tag, reason)."""
    if not conclusion or not main_sha:
        return 2, "UNVERIFIED", "", (
            "conclusion and main-sha are both required; refusing to decide on "
            "partial input rather than guessing"
        )

    if conclusion != "success":
        return 0, "SKIP", "", (
            f"deploy concluded {conclusion!r}, not 'success' — nothing was "
            "released, so there is nothing to tag"
        )

    # A deploy for a superseded SHA must never tag the current HEAD.
    if not deploy_sha:
        return 2, "UNVERIFIED", "", (
            "the deploy's head_sha is empty, so it cannot be matched against "
            "main; failing closed rather than tagging on an unchecked premise"
        )
    if deploy_sha != main_sha:
        return 1, "REFUSE", "", (
            f"the deploy ran on {deploy_sha[:8]} but main is now {main_sha[:8]}. "
            "Tagging HEAD would attach a version to code this deploy never "
            "verified. Re-run after the newer commit deploys."
        )

    # Idempotent: an already-tagged HEAD is a no-op, not a failure. This is what
    # makes the overlap with promote-to-production's own release-tag job safe.
    if head_tag:
        return 0, "SKIP", head_tag, (
            f"main HEAD is already tagged {head_tag} — nothing to do"
        )

    try:
        tag = next_tag(last_tag)
    except ValueError as exc:
        return 2, "UNVERIFIED", "", (
            f"cannot compute the next version: {exc}. Refusing to invent one — "
            "git describe --tags is the authoritative version in this repo."
        )
    return 0, "TAG", tag, f"main HEAD {main_sha[:8]} is untagged; next release is {tag}"


def self_test() -> int:
    SHA_A = "cc1c8f3c00000000000000000000000000000000"
    SHA_B = "029896a300000000000000000000000000000000"

    cases = [
        # (name, conclusion, deploy_sha, main_sha, head_tag, last_tag,
        #  want_code, want_action, want_tag)
        (
            "the BUGS-104 shape: approved deploy, untagged HEAD",
            "success", SHA_A, SHA_A, "", "v0.1.100", 0, "TAG", "v0.1.101",
        ),
        (
            "already tagged is a no-op, not an error",
            "success", SHA_A, SHA_A, "v0.1.101", "v0.1.101", 0, "SKIP", "v0.1.101",
        ),
        (
            "a deploy for a superseded SHA is REFUSED",
            "success", SHA_B, SHA_A, "", "v0.1.100", 1, "REFUSE", "",
        ),
        (
            "a failed deploy does not tag",
            "failure", SHA_A, SHA_A, "", "v0.1.100", 0, "SKIP", "",
        ),
        (
            "a cancelled deploy does not tag",
            "cancelled", SHA_A, SHA_A, "", "v0.1.100", 0, "SKIP", "",
        ),
        (
            "no tags yet seeds from v0.0.0, matching the promote job",
            "success", SHA_A, SHA_A, "", "", 0, "TAG", "v0.0.1",
        ),
        (
            "minor rollover is left alone — patch bumps only",
            "success", SHA_A, SHA_A, "", "v1.9.9", 0, "TAG", "v1.9.10",
        ),
        (
            "an empty deploy sha is UNVERIFIED, never a tag",
            "success", "", SHA_A, "", "v0.1.100", 2, "UNVERIFIED", "",
        ),
        (
            "an empty conclusion is UNVERIFIED, never a skip",
            "", SHA_A, SHA_A, "", "v0.1.100", 2, "UNVERIFIED", "",
        ),
        (
            "a non-release last tag is UNVERIFIED, not a guessed version",
            "success", SHA_A, SHA_A, "", "v0.1.100-rc1", 2, "UNVERIFIED", "",
        ),
        (
            "a two-part tag is not a release tag",
            "success", SHA_A, SHA_A, "", "v2.3", 2, "UNVERIFIED", "",
        ),
    ]

    failures = []
    for name, concl, dsha, msha, htag, ltag, wcode, waction, wtag in cases:
        code, action, tag, _reason = decide(concl, dsha, msha, htag, ltag)
        ok = (code, action, tag) == (wcode, waction, wtag)
        if not ok:
            failures.append(name)
        print(
            f"  {'ok  ' if ok else 'FAIL'} {name} "
            f"(want {wcode}/{waction}/{wtag or '-'}, got {code}/{action}/{tag or '-'})"
        )

    # A floor, not a tally: "N/N passed" stays reassuring when N silently drops
    # (catalogue failure mode 8).
    minimum = 11
    if len(cases) < minimum:
        print(f"::error::self-test corpus shrank: {len(cases)} < {minimum}")
        failures.append(f"corpus floor ({len(cases)} < {minimum})")

    print(f"self-test: {len(cases) - len(failures)}/{len(cases)} passed")
    if failures:
        for name in failures:
            print(f"::error::self-test FAILED: {name}")
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--conclusion", default="")
    ap.add_argument("--deploy-sha", default="")
    ap.add_argument("--main-sha", default="")
    ap.add_argument("--head-tag", default="")
    ap.add_argument("--last-tag", default="")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    code, action, tag, reason = decide(
        args.conclusion, args.deploy_sha, args.main_sha, args.head_tag, args.last_tag
    )
    print(f"action={action}")
    print(f"tag={tag}")
    print(f"reason={reason}")
    if code == 1:
        print(f"::error::release tag REFUSED: {reason}")
    elif code == 2:
        print(f"::error::release tag UNVERIFIED: {reason}")
    return code


if __name__ == "__main__":
    sys.exit(main())
