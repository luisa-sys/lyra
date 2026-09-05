#!/usr/bin/env python3
"""KAN-475 / CTL-070 — the SRC manifest's key IDENTITY is a two-way ratchet.

WHY THIS EXISTS
---------------
`scripts/gen-test-paths.mjs` derives each `SRC` key from its path by "starting
from the last segment and widening leftwards until unique". A key's NAME
therefore depends on which OTHER paths it collides with, not on the file itself
— so moving one file can rename, or silently REPOINT, a key belonging to a file
that did not move.

Observed during the KAN-415 tail. Two files ended in `pipeline.ts`:

    src/modules/access/pipeline.ts
    src/lib/recommender/v2/pipeline.ts

Moving only the second produced:

    SRC.accessPipeline   src/modules/access/pipeline.ts   ->  gone
    SRC.pipeline         the recommender pipeline         ->  the ACCESS pipeline

WHY THIS IS WORSE THAN THE VANISHED-KEY CASE (gotcha #31)
---------------------------------------------------------
A vanished key makes `SRC.gone` `undefined`, which tends to throw — or, at
worst, makes a negative assertion vacuous. Loud, or at least catalogued.

A REPOINTED key is quiet. It still resolves to a real, tracked, existing file
— just the wrong one. `tests/unit/kan342-gift-visibility.test.ts` read
`SRC.pipeline` and went on asserting against a file it was never written for.
Nothing about that is detectable from the test's own shape: no `undefined`, no
throw, no dangling path, and `source-path-manifest-integrity` is satisfied
because every key still points at a TRACKED file. It failed only because the
assertion happened to look for a specific symbol. Phrased more loosely —
`toContain('export')`, or any `not.toContain(...)` — it would have passed
against the wrong subject and reported green forever.

That is catalogue failure mode 5 (inputs that cannot reach the code under test)
arriving by a route nothing watched. Several guard tests reach their subject
through `SRC` — the CTL-013 signup-surface fixtures, CTL-028's suspension
coverage, the KAN-411 ownership test — so a repointed key there would make a
SECURITY guard assert against the wrong file while reporting green.

WHAT THIS CONTROL DOES
----------------------
Pins key -> path in a committed lock (`tests/support/source-path-identity.json`)
and fails when the manifest and the lock disagree. Three verdicts:

  REPOINTED  a key exists in both and its VALUE changed. This is the finding.
             It can only be cleared by naming the key explicitly:
                 --write --accept-repoint=<key>[,<key>...]
  ADDED      a key the lock has never seen (a new literal in a test).
  REMOVED    a key the lock still carries that the manifest has dropped.

ADDED and REMOVED are STALENESS, not danger — no surviving key changed meaning.
They still fail, because a lock that may only be appended to is a suppression
list, not a ratchet, and a lock allowed to drift stops being evidence of
anything. They are cleared by a plain `--write`, which REFUSES to absorb a
REPOINTED key, so the dangerous case cannot ride out on the routine one.

WHY NOT JUST REGENERATE THE LOCK FROM THE MANIFEST
--------------------------------------------------
Because that is the manifest, again. The lock is only worth having if writing it
is a SEPARATE, deliberate act — the same reason `gen-test-paths.mjs` keeps
`--write-baseline` off its normal path. `npm run gen:test-paths` must never
touch this file.

USAGE
    python3 scripts/check-source-path-identity.py                # verify
    python3 scripts/check-source-path-identity.py --write        # re-declare
    python3 scripts/check-source-path-identity.py --write --accept-repoint=pipeline
    python3 scripts/check-source-path-identity.py --self-test

EXIT CODES
    0  manifest and lock agree
    1  a finding (repointed / added / removed), or a refused write
    2  the check could not run (missing or unreadable input) — fail closed
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

# Annotations are suppressed while the self-test drives the reporting path over
# fixtures. A `::error::` line lands in the GitHub run summary whatever the exit
# code, so a PASSING self-test that printed twelve of them would put twelve
# false alarms in front of whoever reads the run — and standing noise on a gate
# is how people learn to wave one through.
ANNOTATE = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "tests/support/source-paths.json")
LOCK = os.path.join(ROOT, "tests/support/source-path-identity.json")

LOCK_COMMENT = (
    "KAN-475 / CTL-070 — the IDENTITY lock for tests/support/source-paths.json. "
    "Each entry pins what an SRC key MEANS, not merely that it resolves. The "
    "generator names keys by widening leftwards until unique, so a key's name "
    "depends on the other paths present: moving one file can repoint a key "
    "belonging to a file that did not move, and the repointed key still resolves "
    "to a real tracked file, so nothing else in the estate can see it. Written "
    "ONLY by `python3 scripts/check-source-path-identity.py --write`, never by "
    "`npm run gen:test-paths` — a lock the generator maintains is the manifest "
    "again. A changed VALUE is refused by --write unless the key is named in "
    "--accept-repoint, which is what makes re-declaration explicit."
)


def err(message: str) -> None:
    """Emit a failure line, as a CI annotation only when running for real."""
    print(f"::error::{message}" if ANNOTATE else f"  [fixture] {message}")


def load_json(path: str, what: str) -> dict:
    """Read a JSON file, failing CLOSED on anything that stops the check running.

    Deliberately not `if os.path.exists(...)` — that is a time-of-check race, and
    more importantly it invites a branch that treats "absent" as "clean". An
    input this control cannot read means it did not run, which must never be
    reported as agreement.
    """
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        err(f"{what} not found at {os.path.relpath(path, ROOT)}.")
        err(f"  Failing closed (exit 2) rather than reporting agreement.")
        sys.exit(2)
    except (OSError, json.JSONDecodeError) as exc:
        err(f"{what} is unreadable ({exc}).")
        err(f"  Failing closed (exit 2) rather than reporting agreement.")
        sys.exit(2)


def read_manifest(path: str = MANIFEST) -> dict:
    doc = load_json(path, "The SRC manifest")
    src = doc.get("SRC")
    if not isinstance(src, dict) or not src:
        err(f"The SRC manifest is empty or malformed.")
        err(f"  An empty manifest would make every comparison vacuous.")
        sys.exit(2)
    return src


def read_lock(path: str = LOCK) -> dict:
    doc = load_json(path, "The SRC identity lock")
    keys = doc.get("keys")
    if not isinstance(keys, dict) or not keys:
        err(f"The SRC identity lock is empty or malformed.")
        err(f"  A lock with no entries can never disagree with anything.")
        sys.exit(2)
    return keys


def diff_identity(manifest: dict, lock: dict) -> dict:
    """Classify manifest-vs-lock disagreement.

    `repointed` is the finding this control exists for; `added` and `removed`
    are staleness. Kept as three separate lists rather than one count so the
    caller can treat them differently — a total would let a repoint hide inside
    an otherwise-routine regeneration.
    """
    repointed = [
        {"key": k, "was": lock[k], "now": manifest[k]}
        for k in sorted(set(manifest) & set(lock))
        if manifest[k] != lock[k]
    ]
    return {
        "repointed": repointed,
        "added": sorted(set(manifest) - set(lock)),
        "removed": sorted(set(lock) - set(manifest)),
    }


def report(diff: dict) -> int:
    """Print findings and return the exit code. Returns 0 only on full agreement."""
    if diff["repointed"]:
        err(f"An SRC key changed MEANING without being re-declared "
            f"({len(diff['repointed'])} key(s)):"
        )
        for entry in diff["repointed"]:
            err(f"  SRC.{entry['key']}")
            err(f"      was: {entry['was']}")
            err(f"      now: {entry['now']}")
        err(f"  Every test reading one of these keys is now asserting "
            "against a DIFFERENT file than it was written for, and will stay "
            "green while doing so."
        )
        err(f"  If the file genuinely moved, re-declare it explicitly: "
            "python3 scripts/check-source-path-identity.py --write "
            "--accept-repoint=" + ",".join(e["key"] for e in diff["repointed"])
        )

    if diff["added"] or diff["removed"]:
        err(f"The SRC identity lock is STALE — it no longer lists the "
            "same keys as the manifest:"
        )
        for key in diff["added"]:
            err(f"  + SRC.{key} is in the manifest but not the lock")
        for key in diff["removed"]:
            err(f"  - SRC.{key} is in the lock but not the manifest")
        err(f"  Refresh it with: python3 "
            "scripts/check-source-path-identity.py --write"
        )

    if diff["repointed"] or diff["added"] or diff["removed"]:
        return 1

    return 0


def write_lock(manifest: dict, lock: dict, accepted: set, path: str = LOCK) -> int:
    """Re-declare the lock, refusing to absorb an unaccepted repoint."""
    diff = diff_identity(manifest, lock)
    refused = [e for e in diff["repointed"] if e["key"] not in accepted]
    if refused:
        err(f"Refusing to absorb a REPOINTED key into the lock "
            f"({len(refused)} key(s)):"
        )
        for entry in refused:
            err(f"  SRC.{entry['key']}: {entry['was']} -> {entry['now']}"
            )
        err(f"  A silent repoint is exactly what this lock exists to "
            "catch, so absorbing one by regeneration would disarm it. Name the "
            "key if the move is intended: --accept-repoint="
            + ",".join(e["key"] for e in refused)
        )
        return 1

    doc = {
        "$comment": LOCK_COMMENT,
        "ticket": "KAN-475",
        "control": "CTL-070",
        "count": len(manifest),
        "keys": {k: manifest[k] for k in sorted(manifest)},
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")

    accepted_here = [e for e in diff["repointed"] if e["key"] in accepted]
    for entry in accepted_here:
        print(
            f"Re-declared SRC.{entry['key']}: {entry['was']} -> {entry['now']}"
        )
    print(
        f"Wrote {len(manifest)} keys to "
        f"{os.path.relpath(path, ROOT)} "
        f"(+{len(diff['added'])} added, -{len(diff['removed'])} removed, "
        f"{len(accepted_here)} re-declared)"
    )
    return 0


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------

def self_test() -> int:
    """Fixture cases.

    The verdict list is read AFTER every case has been appended (catalogue
    failure mode 9 — SEC-140 added eight cases below a `if failures:` check, so
    they executed and were never evaluated, and the reported count went UP).
    The corpus is asserted as a FLOOR rather than printed as an N-of-N tally,
    for the same reason: a tally cannot tell you a case stopped registering.
    """
    global ANNOTATE
    ANNOTATE = False
    failures: list[str] = []
    executed: list[str] = []

    def check(name: str, actual, expected) -> None:
        # The corpus is COUNTED here rather than typed as a constant below.
        # A hand-maintained tally is catalogue failure mode 8: it cannot tell
        # you a case stopped registering, which is the only thing a floor is
        # for.
        executed.append(name)
        if actual != expected:
            failures.append(f"{name}: expected {expected!r}, got {actual!r}")

    # --- the finding: a surviving key whose value changed -----------------
    # This is the KAN-475 scenario exactly. `pipeline` still resolves to a real
    # file; only its MEANING moved.
    before = {"accessPipeline": "src/modules/access/pipeline.ts",
              "pipeline": "src/lib/recommender/v2/pipeline.ts"}
    after = {"pipeline": "src/modules/access/pipeline.ts"}
    d = diff_identity(after, before)
    check("repoint detected", [e["key"] for e in d["repointed"]], ["pipeline"])
    check("repoint records old value",
          d["repointed"][0]["was"], "src/lib/recommender/v2/pipeline.ts")
    check("repoint records new value",
          d["repointed"][0]["now"], "src/modules/access/pipeline.ts")
    check("the vanished key is reported too", d["removed"], ["accessPipeline"])
    check("repoint is a finding", report(d), 1)

    # --- an unchanged tree stays green ------------------------------------
    # A gate that always fires is one people learn to wave through, so this
    # case matters as much as the positive one.
    same = {"a": "src/a.ts", "b": "src/b.ts"}
    d = diff_identity(dict(same), dict(same))
    check("identical inputs: no repoint", d["repointed"], [])
    check("identical inputs: no additions", d["added"], [])
    check("identical inputs: no removals", d["removed"], [])
    check("identical inputs are green", report(d), 0)

    # --- staleness in both directions -------------------------------------
    d = diff_identity({"a": "src/a.ts", "c": "src/c.ts"}, {"a": "src/a.ts"})
    check("a new key is ADDED", d["added"], ["c"])
    check("a new key is not a repoint", d["repointed"], [])
    check("a new key still fails", report(d), 1)

    d = diff_identity({"a": "src/a.ts"}, {"a": "src/a.ts", "z": "src/z.ts"})
    check("a dropped key is REMOVED", d["removed"], ["z"])
    check("a dropped key still fails", report(d), 1)

    # --- ordering independence --------------------------------------------
    # dict order is insertion order in Python; a diff that depended on it would
    # pass or fail according to how the generator happened to emit the file.
    d = diff_identity({"b": "src/b.ts", "a": "src/a.ts"},
                      {"a": "src/a.ts", "b": "src/b.ts"})
    check("key order does not matter", report(d), 0)

    # --- --write refuses an unaccepted repoint ----------------------------
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "lock.json")
        rc = write_lock(after, before, set(), path=target)
        check("write refuses an unaccepted repoint", rc, 1)
        check("write left no file behind", os.path.exists(target), False)

        rc = write_lock(after, before, {"pipeline"}, path=target)
        check("write accepts a NAMED repoint", rc, 0)
        with open(target, encoding="utf-8") as fh:
            written = json.load(fh)
        check("written lock carries the new value",
              written["keys"]["pipeline"], "src/modules/access/pipeline.ts")
        check("written lock drops the vanished key",
              "accessPipeline" in written["keys"], False)
        check("written lock records its count", written["count"], 1)

        # Accepting the WRONG key must not clear the finding — otherwise
        # --accept-repoint degrades into a blanket --force.
        rc = write_lock(after, before, {"somethingElse"}, path=target)
        check("accepting an unrelated key does not absorb the repoint", rc, 1)

        # A plain --write over a purely stale lock is the routine path and
        # must succeed, or people will reach for --accept-repoint by reflex.
        rc = write_lock({"a": "src/a.ts", "c": "src/c.ts"},
                        {"a": "src/a.ts"}, set(), path=target)
        check("write absorbs plain staleness", rc, 0)

    # --- the REAL artefacts agree -----------------------------------------
    # Without this the whole suite could pass over fixtures while the committed
    # lock had drifted (catalogue failure mode 4: a corpus that proves nothing
    # about the tree it guards).
    real = diff_identity(read_manifest(), read_lock())
    check("the committed manifest and lock agree",
          (real["repointed"], real["added"], real["removed"]), ([], [], []))

    CORPUS_FLOOR = 20
    if len(executed) < CORPUS_FLOOR:
        failures.append(
            f"self-test corpus shrank to {len(executed)}, below the floor "
            f"{CORPUS_FLOOR} — a case stopped registering"
        )
    if len(set(executed)) != len(executed):
        failures.append("two self-test cases share a name; one is shadowing the other")

    # Read the verdict here, after EVERY case above has been appended.
    # Read the verdict HERE, after every case above has been appended.
    ANNOTATE = True
    if failures:
        err("check-source-path-identity self-test FAILED:")
        for f in failures:
            err(f"  {f}")
        return 1

    print(f"Self-test passed ({len(executed)} cases, floor {CORPUS_FLOOR}).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true",
                    help="re-declare the lock from the current manifest")
    ap.add_argument("--accept-repoint", default="",
                    help="comma-separated keys whose VALUE change is intended")
    ap.add_argument("--self-test", action="store_true")
    # Path overrides exist so the verdict logic is reachable END TO END by a
    # test, not only through the in-process self-test. CTL-069's whole finding
    # was a decision no test could observe; a checker that can only be run
    # against the one real pair of files has the same shape.
    ap.add_argument("--manifest", default=MANIFEST)
    ap.add_argument("--lock", default=LOCK)
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    manifest = read_manifest(args.manifest)

    if args.write:
        accepted = {k.strip() for k in args.accept_repoint.split(",") if k.strip()}
        # Bootstrapping: with no lock yet, everything is an addition and nothing
        # can have been repointed, so there is nothing to refuse. Note this
        # branch is available ONLY under --write — the verifying path below
        # still fails closed on a missing lock, because "absent because nobody
        # wrote it" and "absent because someone deleted it" are the same file
        # state and only one of them is safe to call clean.
        lock = read_lock(args.lock) if os.path.exists(args.lock) else {}
        return write_lock(manifest, lock, accepted, path=args.lock)

    if args.accept_repoint:
        err(f"--accept-repoint has no meaning without --write.")
        return 2

    rc = report(diff_identity(manifest, read_lock(args.lock)))
    if rc == 0:
        print(f"SRC key identity is intact ({len(manifest)} keys).")
    return rc


if __name__ == "__main__":
    sys.exit(main())
