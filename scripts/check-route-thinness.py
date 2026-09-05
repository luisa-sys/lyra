#!/usr/bin/env python3
"""CTL-056 / KAN-415 criterion 2 — `app-routes-are-thin`, as a ratchet.

WHY THIS EXISTS
---------------
`app-routes-are-thin` is the only one of the nine rules KAN-415 criterion 2
names that was never built, because "thin" was never defined. Measured on
`develop` when this landed:

    99 route-ish files under src/app
    48 of them (48%) make a DIRECT database call
    217 such calls in total (counting storage buckets and dynamic table names)
    LOC: median 102, p90 266, max 1060

WHY NOT "ZERO DIRECT CALLS IN A ROUTE"
--------------------------------------
That is the right end state and the wrong gate. It is a 48-file, 217-call
relocation programme — which is precisely the work criterion 3 concluded was
unnecessary once CTL-055 could assert table ownership *without* moving files. A
rule that goes red on 48 files the day it ships is a rule someone turns off, and
this estate has six documented instances of exactly that ending badly.

So the direction is stated and the movement is enforced: **the count may only
shrink.** A route acquiring a new direct call fails. A route losing one fails as
STALE until the baseline is updated, so the file keeps describing reality.

⚠️ KEYED PER FILE, NOT A TOTAL.
A single aggregate would let one file improve while another regressed and net
out to green — the same blindness CTL-055 had before ESCALATED was added. Per
file, a regression is visible even when the total falls.

WHAT COUNTS AS A ROUTE
----------------------
`page` / `layout` / `route` / `*actions` under `src/app`. Those are the files
Next.js instantiates per request; a helper module beside them is ordinary code
and out of scope. `src/app/api/**/route.ts` IS included: an API route is a
route.

RELATIONSHIP TO CTL-055
-----------------------
Different question, same scan. CTL-055 asks *"does the module own this table"* —
a boundary question about the data graph. This asks *"is data access happening
in a request entry point at all"* — a layering question about where code lives.
A call can satisfy CTL-055 (the module owns the table) and still fail here (it
is in a page, not a data module).

USAGE
    python3 scripts/check-route-thinness.py
    python3 scripts/check-route-thinness.py --self-test
    python3 scripts/check-route-thinness.py --write-baseline

EXIT CODES
    0  no route gained a direct database call
    1  a NEW route call site, or a STALE baseline entry
    2  the check could not run
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE = REPO_ROOT / "supabase" / "route-thinness-baseline.json"

# The request entry points Next.js instantiates. `actions` covers both
# `actions.ts` and prefixed variants such as `files-actions.ts`.
ROUTE_RE = re.compile(r"/(?:page|layout|route|[a-z0-9-]*actions)\.tsx?$")
# ⚠️ NOT the same pattern as CTL-055, deliberately, and getting this wrong
# undercounts silently.
#
# CTL-055 needs the TABLE NAME, so it requires a quoted identifier. That pattern
# is wrong here for two reasons, both measured on this tree:
#
#   * it misses `supabase.storage.from('profile-files')` — 7 real call sites —
#     because bucket names contain hyphens. Storage access from a page is still
#     data access from a request entry point.
#   * it misses `.from(someVariable)` entirely, which would let a route add
#     dynamic data access for free.
#
# So this asks only WHETHER a data call happens, and excludes the JavaScript
# builtins by name — `Array.from(new Set(...))` and `Buffer.from(x, 'base64')`
# appear 8 times in these files and are not database calls. Excluding by
# receiver rather than by argument shape is what lets the pattern stay loose
# enough to catch a variable table name.
CALL_RE = re.compile(
    r"(?<!\bArray)(?<!\bBuffer)(?<!\bObject)(?<!\bString)\.(?:from|rpc)\s*\("
)
COMMENT_RE = re.compile(r"^\s*(//|\*|/\*)")

# Well below the measured 99. A scan that suddenly finds almost no routes has
# broken, not been cleaned up.
MIN_ROUTES = 40

SELF_TEST_CASES = 16


class ThinnessError(RuntimeError):
    """The check could not run. Never collapsed into a clean result."""


def tracked_routes(root: Path) -> list[str]:
    """git ls-files, never a disk walk — `git mv` leaves an empty dir behind."""
    try:
        out = subprocess.run(
            ["git", "ls-files", "src/app"], cwd=root, capture_output=True, text=True, timeout=120
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ThinnessError(f"could not list tracked files: {exc}") from exc
    files = [f for f in out.stdout.split() if f.endswith((".ts", ".tsx"))]
    if not files:
        raise ThinnessError("git ls-files src/app returned no TypeScript files")
    return [f for f in files if ROUTE_RE.search(f)]


def scan(routes: list[str], root: Path) -> dict[str, int]:
    """Direct database call count per route file. Comments do not count."""
    counts: dict[str, int] = {}
    for rel in routes:
        try:
            lines = (root / rel).read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        n = sum(1 for line in lines if not COMMENT_RE.match(line) and CALL_RE.search(line))
        if n:
            counts[rel] = n
    return counts


def evaluate(actual: dict[str, int], baseline: dict) -> list[str]:
    """Shrink-only, per file, both directions."""
    was: dict[str, int] = baseline.get("routes", {})
    failures = []
    for rel in sorted(set(actual) - set(was)):
        failures.append(
            f"NEW    {rel} makes {actual[rel]} direct database call(s).\n"
            f"           A route is a request entry point, not a data layer. Move the query into "
            f"the owning module and call it from here."
        )
    for rel in sorted(set(was) - set(actual)):
        failures.append(
            f"STALE  {rel} is baselined with {was[rel]} call(s) and now has none. "
            f"That is a fix — record it with --write-baseline."
        )
    for rel in sorted(set(was) & set(actual)):
        if actual[rel] > was[rel]:
            failures.append(
                f"WORSE  {rel} went from {was[rel]} to {actual[rel]} direct database call(s).\n"
                f"           The ratchet is one-way: a baselined route may shrink, never grow."
            )
        elif actual[rel] < was[rel]:
            failures.append(
                f"STALE  {rel} improved from {was[rel]} to {actual[rel]} call(s). "
                f"Record it with --write-baseline so the file keeps describing reality."
            )
    return failures


def self_test() -> int:
    import tempfile

    failures: list[str] = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    # --- what counts as a route -------------------------------------------
    for p, want in [
        ("src/app/page.tsx", True),
        ("src/app/dashboard/layout.tsx", True),
        ("src/app/api/health/route.ts", True),
        ("src/app/dashboard/actions.ts", True),
        ("src/app/dashboard/files-actions.ts", True),
        ("src/app/dashboard/helper.ts", False),
        ("src/app/dashboard/Widget.tsx", False),
        ("src/modules/profile/page.tsx", True),  # ROUTE_RE is name-based; the caller scopes to src/app
    ]:
        check(f"route detection: {p}", bool(ROUTE_RE.search(p)), want)

    # --- counting ----------------------------------------------------------
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "src" / "app").mkdir(parents=True)
        (root / "src" / "app" / "page.tsx").write_text(
            "const a = db.from('x').select();\n"
            "// const b = db.from('y').select();  <- a comment is not an access\n"
            "const c = await db.rpc('do_thing');\n"
        )
        counts = scan(["src/app/page.tsx"], root)
        check("counts real calls, ignores commented ones", counts.get("src/app/page.tsx"), 2)

        # The two patterns this control gets wrong if it borrows CTL-055's regex.
        (root / "src" / "app" / "builtins.tsx").write_text(
            "const ids = Array.from(new Set(xs));\n"
            "const s = Buffer.from(b64, 'base64').toString('utf8');\n"
        )
        check(
            "Array.from / Buffer.from are NOT database calls",
            scan(["src/app/builtins.tsx"], root).get("src/app/builtins.tsx"),
            None,
        )
        (root / "src" / "app" / "wide.tsx").write_text(
            "await supabase.storage.from('profile-files').remove([p]);\n"  # hyphen
            "await admin.storage.from(bucketVar).list(uid);\n"             # variable
        )
        check(
            "a hyphenated bucket and a variable table both count",
            scan(["src/app/wide.tsx"], root).get("src/app/wide.tsx"),
            2,
        )

    # --- ratchet -----------------------------------------------------------
    check(
        "a NEW route call site fails",
        any("NEW" in f for f in evaluate({"src/app/page.tsx": 1}, {"routes": {}})),
        True,
    )
    check(
        "a baselined route at the same count passes",
        evaluate({"src/app/page.tsx": 3}, {"routes": {"src/app/page.tsx": 3}}),
        [],
    )
    check(
        "a baselined route that GROWS fails",
        any("WORSE" in f for f in evaluate({"src/app/page.tsx": 4}, {"routes": {"src/app/page.tsx": 3}})),
        True,
    )
    check(
        "a baselined route that SHRINKS fails as stale",
        any("STALE" in f for f in evaluate({"src/app/page.tsx": 2}, {"routes": {"src/app/page.tsx": 3}})),
        True,
    )
    check(
        "a baselined route that is fixed entirely fails as stale",
        any("STALE" in f for f in evaluate({}, {"routes": {"src/app/page.tsx": 3}})),
        True,
    )

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--root", type=Path, default=REPO_ROOT, help=argparse.SUPPRESS)
    ap.add_argument("--baseline", type=Path, default=None, help=argparse.SUPPRESS)
    ap.add_argument("--min-routes", type=int, default=MIN_ROUTES, help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    root: Path = args.root
    baseline_path: Path = args.baseline or (root / "supabase" / "route-thinness-baseline.json")

    try:
        routes = tracked_routes(root)
        actual = scan(routes, root)
    except (ThinnessError, OSError) as exc:
        print(f"::error::check-route-thinness: {exc}")
        print("::error::  Failing closed (exit 2): a check that could not run is not a clean result.")
        return 2

    if len(routes) < args.min_routes:
        print(f"::error::check-route-thinness: only {len(routes)} route file(s) found.")
        print(f"::error::  Expected at least {args.min_routes} — the app has ~99. A scan that")
        print("::error::  suddenly finds almost nothing has broken, not been cleaned up.")
        return 2

    if args.write_baseline:
        payload = {
            "_why": [
                "CTL-056. Direct .from()/.rpc() calls inside request entry points under src/app",
                "(page / layout / route / *actions), per file, as they stood when the control",
                "landed. Grandfathered so it could ship green.",
                "",
                "SHRINK-ONLY, PER FILE, BOTH WAYS. A new route with a call fails; a baselined",
                "route that GROWS fails; a baselined route that shrinks or is fixed fails as",
                "STALE until recorded. Regenerate with --write-baseline in the same commit that",
                "changes one.",
                "",
                "PER FILE, NOT A TOTAL — deliberately. One aggregate would let one file improve",
                "while another regressed and net out to green, which is the blindness CTL-055",
                "had before ESCALATED was added.",
                "",
                "The end state is zero, and this is not a gate that demands it today: that would",
                "be a 48-file relocation, exactly the work KAN-415 criterion 3 concluded was",
                "unnecessary once CTL-055 could assert table ownership without moving files. A",
                "rule that reddens 48 files on day one is a rule someone turns off.",
                "",
                "NOT a duplicate of CTL-055. That asks whether the module owns the table (the",
                "data graph). This asks whether data access is happening in a request entry",
                "point at all (where code lives). A call can pass CTL-055 and fail here.",
            ],
            "ticket": "KAN-415",
            "_totals": {
                "routeFiles": len(routes),
                "filesWithCalls": len(actual),
                "calls": sum(actual.values()),
            },
            "routes": dict(sorted(actual.items())),
        }
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(
            f"Wrote {baseline_path.name}: {len(actual)} of {len(routes)} route file(s) "
            f"make {sum(actual.values())} direct call(s)"
        )
        return 0

    if not baseline_path.exists():
        print(f"::error::check-route-thinness: {baseline_path.name} is missing — refusing to")
        print("::error::  report clean with nothing to compare against.")
        return 2
    try:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"::error::check-route-thinness: {baseline_path.name} is not valid JSON: {exc}")
        return 2

    failures = evaluate(actual, baseline)
    print(
        f"{len(routes)} route file(s) under src/app; {len(actual)} make "
        f"{sum(actual.values())} direct database call(s) "
        f"({len(baseline.get('routes', {}))} baselined)"
    )
    if failures:
        for f in failures:
            print(f"::error::  {f}")
        print(f"::error::check-route-thinness: {len(failures)} problem(s).")
        return 1
    print("No route gained a direct database call. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
