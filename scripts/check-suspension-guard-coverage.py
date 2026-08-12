#!/usr/bin/env python3
"""SEC-100 / SEC-104 — the suspension-guard coverage class.

THE DEFECT CLASS
----------------
Lyra's second-most recurrent security defect, and the one with the widest
blast radius. A suspension / eligibility predicate is added to ONE call site
and its siblings are left unguarded, so a moderated or taken-down member stays
visible or keeps their write access:

    SEC-44  suspended profiles still served on /[slug] (service-role render)
    SEC-47  admin-MCP self/admin-target guard on suspend only, 7 mutators bare
    SEC-57  no suspension check on API-key generation or OAuth authorization
    SEC-58  busy-time consent gate not enforced in the WEB calendar layer
    SEC-80  search_by_contact_hash omitted is_suspended
    SEC-81  Convene invite-send actions omitted the SEC-57 guard
    SEC-83  MCP auth layer never checked is_suspended under v1
    SEC-84  admin-MCP: 7 mutators could self-escalate or grief peer admins
    SEC-85  stale ownership-guard file list; single-file suspension guards
    BUGS-21 MCP server did not filter is_suspended profiles

Each fix was correct. Each covered the site in front of it. None enumerated
the surface — so the next site was found by the next audit, not by CI.

WHY RLS IS NOT THE BACKSTOP PEOPLE ASSUME
-----------------------------------------
`public.profiles` DOES carry the right policy:

    "Anyone can read published non-suspended profiles"
        USING (is_published = true AND is_suspended = false)

But the SERVICE-ROLE client bypasses RLS entirely. Any page rendered through
`createServiceRoleClient()` gets no policy protection at all, and this codebase
has ~40 modules importing it. That is precisely how SEC-44 happened.

═══════════════════════════════════════════════════════════════════════════
SEC-104 STEP 3 — WHY THE ORIGINAL RULE WAS REPLACED (2026-08-12)
═══════════════════════════════════════════════════════════════════════════

The original invariant was keyed on a COLUMN LITERAL: "any chain filtering
`.eq('is_published', true)` must also filter `is_suspended`". SEC-104 raised
two structural problems with it, and landing SEC-104's own fix created a third
— which is the one that finally forced this rewrite.

  1. A query with NO guard at all was invisible. The rule triggered on the
     PRESENCE of a partial guard, so `.from('profiles').select('slug')` with no
     filters sailed through. Reproduced 2026-07-27.

  2. One guard per predicate. The invariant was hard-coded to `is_suspended`;
     the day visibility gained a third predicate the checker would have held
     the old line silently.

  3. ⚠️ THE MIGRATION MOVED EVERY PUBLIC SURFACE OUT OF SCOPE. SEC-104 moved
     the predicates INTO the `public_profiles` view body, so a correctly
     migrated public read contains no `is_published` literal at all — and a
     checker keyed on that literal cannot see it. Measured across the migration
     commit (62db86b, PR #757):

         62db86b~1   6 chains visible — 4 of them public
                     ([slug]x2, search, sitemap)
         after       2 chains visible — 0 of them public
                     (admin console count, convene dashboard action)

     The control whose stated invariant was about PUBLIC consumption ended up
     scanning an admin page and a dashboard action, and printing a confident
     "Every public-visibility query also filters suspended members. ✓".

That third failure is CLAUDE.md's own lesson in its purest form: **"matches
nothing" is detectable; "matches less than it used to" is not.** The old
vacuous-pass guard was right in spirit and one notch too low — it fired only
when `chains_seen == 0`, and 2 is not 0.

THE INVARIANT NOW
-----------------
Stated on the RELATION and the PATH rather than on a column literal:

    A public-surface file may not read the `profiles` BASE TABLE.
    Public surfaces read `public_profiles`, whose view body carries every
    visibility predicate and therefore applies even to service_role.

This is strictly stronger than the old rule on all three counts. An unguarded
read is now a violation rather than an invisible one (1); adding a visibility
predicate is a one-line view change rather than a checker change (2); and a
correctly-migrated read is exactly what the rule looks for rather than what it
cannot see (3).

DEFAULT-DENY, WHICH IS THE WHOLE POINT
--------------------------------------
Public surfaces are NOT enumerated. Everything under `src/app/` is treated as
public unless it matches an AUTHENTICATED carve-out below. So a brand-new
public route is covered the day it is written, and exempting one is a visible
diff to a short list — the opposite of the CTL-013 signup-manifest failure
mode (gotcha #32), where a manifest of literal paths reported RESULT: CLEAN
after the surface was renamed out from under it.

The old column-keyed rule is RETAINED as a WARNING on non-public paths, per
SEC-104 step 3. It still catches a partial guard in dashboard/admin code, where
the base table is legitimately read.

Allow-list: `// suspension-guard-ok: <JIRA-KEY> <reason>`.

USAGE
    python3 scripts/check-suspension-guard-coverage.py
    python3 scripts/check-suspension-guard-coverage.py --self-test
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# --- the new rule (SEC-104 step 3) -----------------------------------------

# `.from('profiles')` in any quote style. Deliberately literal: the ticket asks
# for a "near-zero-false-positive" rule, and a table name reached through a
# variable is not something a static scan should pretend to resolve.
BASE_TABLE_RE = re.compile(r"\.from\(\s*['\"`]profiles['\"`]\s*\)")
VIEW_RE = re.compile(r"\.from\(\s*['\"`]public_profiles['\"`]\s*\)")

# AUTHENTICATED / INTERNAL carve-outs. Everything else under src/app/ is public.
#
# Each entry is a path PREFIX and must match at least one tracked file that
# actually reads the base table — a carve-out matching nothing is either a
# stale path left behind by a move or over-broad drafting, and both are failures
# (see check_carve_outs_are_live). That is CTL-035's lesson applied inline, and
# it is why this list is short rather than defensive.
AUTHENTICATED_PREFIXES = [
    # The admin console. Reads unpublished and suspended rows BY DESIGN — that
    # is what a moderation queue is for.
    ("src/app/admin/", "admin console — moderation must see suspended rows"),
    # Every authenticated member surface. The dashboard reads the caller's own
    # row, and the editor writes it.
    ("src/app/dashboard/", "authenticated member dashboard — own-row reads/writes"),
    # Authenticated self-reads that sit outside /dashboard because they are
    # pre-dashboard states in the signup funnel.
    ("src/app/verify-age/", "authenticated self-read of own age_status (KAN-407)"),
    ("src/app/waitlist/", "authenticated self-read/write of own user_status"),
    # The only API route that reads the base table, and it authenticates first
    # (auth.getUser() before any query). Note src/app/api/ is NOT carved out as
    # a class: api/recommendations/** is genuinely public and MUST stay in
    # scope, which is exactly the distinction KAN-411's api/ carve-out does not
    # have to make.
    ("src/app/api/reports/", "authenticated report submission — auth.getUser() first"),
]

# PUBLIC-FACING MODULE ROOTS — extracted route code that is still public surface.
#
# KAN-473 / KAN-415 D9. `src/app/` is not the whole public surface any more: the
# modularisation programme moves route-adjacent code into `src/modules/`, and D9
# took five public-profile files out of `src/app/[slug]/`. Measured at the time
# of that move, with this list absent: the public-surface count fell 74 -> 69
# and all five moved files answered `is_public_surface = False`.
#
# That is the SAME failure this control was rewritten for, one commit later and
# on a different axis — a path-anchored rule does not break when the tree moves,
# it quietly covers less. It is named here rather than default-denied because
# most of `src/modules/` is genuinely NOT public surface (platform, access,
# guards) and several of those files read `profiles` legitimately; a blanket
# rule would fire on all of them and a gate that always fires gets waved through.
#
# Each prefix must still match tracked files — see check_public_modules_are_live.
PUBLIC_MODULE_PREFIXES = [
    ("src/modules/public-profile/", "KAN-473 — the extracted public profile + search UI"),
]

ALLOW_MARKER = "suspension-guard-ok"

# --- the retained rule (now a warning off the public surface) ---------------

PUBLISHED_RE = re.compile(r"\.eq\(\s*['\"`]is_published['\"`]\s*,\s*true\s*\)")
SUSPENDED_RE = re.compile(r"is_suspended")

# How far past the `is_published` filter to look for its siblings. A supabase-js
# chain is fluent, so the rest of the query follows immediately; 900 characters
# comfortably covers the longest chain in this repo without spilling into an
# unrelated statement.
CHAIN_WINDOW = 900

# Comments are stripped before matching. This is the CTL-039 / SEC-100 lesson:
# `is_published` occurs TWICE in the old sitemap.ts — once in the query and once
# in the comment explaining why the query needs it — so a source-text scan could
# match the prose after the code was removed. The better a fix is documented,
# the weaker a naive scan of it becomes. The allow-list marker is harvested
# BEFORE stripping, because the marker is itself a comment.
LINE_COMMENT_RE = re.compile(r"//[^\n]*")
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)


def strip_comments(source: str) -> str:
    """Blank out comments, preserving newlines so line numbers stay correct."""
    def blank(match: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", match.group(0))

    return LINE_COMMENT_RE.sub(blank, BLOCK_COMMENT_RE.sub(blank, source))


def is_public_surface(rel_path: str) -> bool:
    """Default-deny under src/app/, plus the named public-facing module roots."""
    if any(rel_path.startswith(prefix) for prefix, _ in PUBLIC_MODULE_PREFIXES):
        return True
    if not rel_path.startswith("src/app/"):
        return False
    return not any(rel_path.startswith(prefix) for prefix, _ in AUTHENTICATED_PREFIXES)


def find_base_table_reads(source: str) -> list[tuple[int, str]]:
    """Return (line_number, excerpt) for each base-table read not allow-listed."""
    if ALLOW_MARKER in source:
        return []

    code = strip_comments(source)
    return [
        (code.count("\n", 0, m.start()) + 1, m.group(0))
        for m in BASE_TABLE_RE.finditer(code)
    ]


def find_violations(source: str, path: str = "") -> list[tuple[int, str]]:
    """The RETAINED column-keyed rule: an is_published chain lacking is_suspended.

    Kept verbatim in behaviour so its six self-test fixtures still mean what they
    meant — SEC-104 step 4 asks for the self-test to survive the rewrite.
    """
    violations: list[tuple[int, str]] = []

    for match in PUBLISHED_RE.finditer(source):
        chain_start = source.rfind("supabase", max(0, match.start() - CHAIN_WINDOW), match.start())
        if chain_start == -1:
            chain_start = max(0, match.start() - CHAIN_WINDOW)
        chain = source[chain_start : match.end() + CHAIN_WINDOW]

        cut = re.search(r";\s*\n\s*\n", chain[match.start() - chain_start :])
        if cut:
            chain = chain[: (match.start() - chain_start) + cut.end()]

        if ALLOW_MARKER in chain:
            continue
        if SUSPENDED_RE.search(chain):
            continue

        line_no = source.count("\n", 0, match.start()) + 1
        violations.append((line_no, source[match.start() : match.end()]))

    return violations


# --- scanning ---------------------------------------------------------------


def tracked_files(root: Path) -> list[str]:
    """Tracked state, not disk state.

    `git mv` leaves the source directory behind EMPTY, so an `os.walk` would
    still report a moved-away tree as present and a ratchet built on it would
    stay green on the exact defect it guards. That is catalogue failure mode 6.
    """
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "src"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [p for p in out.splitlines() if p.endswith((".ts", ".tsx"))]


def check_carve_outs_are_live(root: Path, files: list[str]) -> list[str]:
    """Every carve-out must still cover a real base-table reader.

    A carve-out matching nothing is a stale path from a move, and its silent
    effect is to make the public surface look SMALLER than it is — the exact
    shape of the `^src/lib/` depcruise narrowing in D1, which CTL-035 could not
    see because the pattern was narrow rather than dead.
    """
    problems: list[str] = []
    for prefix, reason in AUTHENTICATED_PREFIXES:
        covered = [
            f
            for f in files
            if f.startswith(prefix)
            and BASE_TABLE_RE.search(strip_comments((root / f).read_text(encoding="utf-8")))
        ]
        if not covered:
            problems.append(
                f"::error::Carve-out '{prefix}' ({reason}) matches no tracked file that reads "
                f"the profiles base table. Either the path moved — in which case the public "
                f"surface has silently GROWN and this list must be rewritten — or the carve-out "
                f"was never needed and should be deleted."
            )
    return problems


def check_public_modules_are_live(root: Path, files: list[str]) -> list[str]:
    """Every named public-module root must still contain tracked files.

    A carve-out that matches nothing makes the surface look SMALLER; so does an
    INCLUSION that matches nothing, and it is quieter — an empty carve-out at
    least leaves the files covered by the default, whereas an empty inclusion
    means the code it named has moved somewhere with no cover at all. This list
    exists because a move did exactly that; it must not survive the next one.
    """
    problems: list[str] = []
    for prefix, reason in PUBLIC_MODULE_PREFIXES:
        if not any(f.startswith(prefix) for f in files):
            problems.append(
                f"::error::Public-module root '{prefix}' ({reason}) matches no tracked file. "
                f"That code has moved or been deleted — and if it moved, the public surface it "
                f"represents is now OUTSIDE this control with nothing reporting the gap. "
                f"Update PUBLIC_MODULE_PREFIXES to the new path, or remove the entry if the "
                f"module is genuinely gone."
            )
    return problems


def scan(root: Path) -> dict:
    files = tracked_files(root)

    public_files = [f for f in files if is_public_surface(f)]
    errors: list[str] = []
    warnings: list[str] = []
    view_reads = 0

    for rel in files:
        try:
            source = (root / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        code = strip_comments(source)

        if is_public_surface(rel):
            view_reads += len(VIEW_RE.findall(code))
            for line_no, excerpt in find_base_table_reads(source):
                errors.append(
                    f"::error file={rel},line={line_no}::Public surface reads the `profiles` "
                    f"BASE TABLE ({excerpt}). Read `public_profiles` instead — its view body "
                    f"carries is_published AND is_suspended, and a predicate in a view body "
                    f"applies to every reader INCLUDING service_role, which bypasses RLS. "
                    f"That bypass is how SEC-44 and SEC-100 happened."
                )
        else:
            # Retained column-keyed rule, advisory off the public surface.
            for line_no, excerpt in find_violations(code, rel):
                warnings.append(
                    f"::warning file={rel},line={line_no}::Query filters is_published but not "
                    f"is_suspended ({excerpt}). Not a public surface, so this is advisory — but "
                    f"check whether this listing should exclude suspended members."
                )

    return {
        "files": files,
        "public_files": public_files,
        "errors": errors,
        "warnings": warnings,
        "view_reads": view_reads,
    }


# --- self-test (the "test the test" control) -------------------------------

_BAD_SITEMAP = """
const { data } = await supabase
  .from('profiles')
  .select('slug, updated_at')
  .eq('is_published', true);
"""

_BAD_SEARCH = """
const { data } = await supabase
  .from('profiles')
  .select('id, display_name')
  .eq('is_published', true)
  .eq('is_homepage_example', false)
  .order('display_name')
  .limit(30);
"""

_GOOD_AFTER = """
const { data } = await supabase
  .from('profiles')
  .select('slug')
  .eq('is_published', true)
  .eq('is_suspended', false);
"""

_GOOD_BEFORE = """
const { data } = await supabase
  .from('profiles')
  .eq('is_suspended', false)
  .eq('is_published', true);
"""

_ALLOWLISTED = """
const { data } = await supabase
  .from('profiles')
  // suspension-guard-ok: SEC-000 admin moderation queue must SEE suspended rows
  .select('slug')
  .eq('is_published', true);
"""

# A guard belonging to a DIFFERENT query later in the file must not launder an
# unguarded one — the same false-negative shape that made the first cut of
# check-partial-write-safety.py pass the file it most needed to catch.
_TWO_QUERIES = """
const a = await supabase.from('profiles').select('slug').eq('is_published', true);

const b = await supabase.from('profiles').select('id').eq('is_published', true).eq('is_suspended', false);
"""

_CASES = [
    ("sitemap shape: no guard", _BAD_SITEMAP, 1),
    ("search shape: no guard", _BAD_SEARCH, 1),
    ("guard after is_published", _GOOD_AFTER, 0),
    ("guard before is_published", _GOOD_BEFORE, 0),
    ("allow-listed with a reason", _ALLOWLISTED, 0),
    ("a later query's guard does not cover an earlier one", _TWO_QUERIES, 1),
]

# --- SEC-104 step 3 fixtures: the base-table rule ---------------------------

# THE CASE THE OLD RULE COULD NOT SEE. No is_published literal anywhere, so the
# column-keyed rule returned 0. This is the hole SEC-104 reproduced on
# 2026-07-27 and the reason the rule was replaced rather than extended.
_UNGUARDED_NO_FILTER = """
const supabase = createServiceRoleClient();
const { data } = await supabase.from('profiles').select('slug, display_name');
"""

_MIGRATED = """
const { data } = await supabase
  .from('public_profiles')
  .select('slug, display_name');
"""

# A correctly-migrated read that ALSO carries the predicates. Belt and braces,
# and must not be flagged.
_MIGRATED_WITH_FILTERS = """
const { data } = await supabase
  .from('public_profiles')
  .select('slug')
  .order('updated_at');
"""

_BASE_TABLE_ALLOWLISTED = """
// suspension-guard-ok: SEC-000 this public page intentionally reads the base table
const { data } = await supabase.from('profiles').select('slug');
"""

# CTL-039: prose describing the defect must not be mistaken for the defect. This
# whole file discusses `.from('profiles')` in its header while explaining the
# hazard, and a guard that punished writing the explanation down would be
# pointed the wrong way.
_ONLY_IN_A_COMMENT = """
// Historical note: this used to be .from('profiles') before SEC-104.
const { data } = await supabase.from('public_profiles').select('slug');
"""

_ONLY_IN_A_BLOCK_COMMENT = """
/* The old shape was:
     await supabase.from('profiles').select('slug')
   which SEC-104 replaced. */
const { data } = await supabase.from('public_profiles').select('slug');
"""

_DOUBLE_QUOTED = """
const { data } = await supabase.from("profiles").select('slug');
"""

_BASE_CASES = [
    ("SEC-104's invisible case: no filters at all", _UNGUARDED_NO_FILTER, 1),
    ("a migrated read is clean", _MIGRATED, 0),
    ("a migrated read with ordering is clean", _MIGRATED_WITH_FILTERS, 0),
    ("allow-listed base-table read", _BASE_TABLE_ALLOWLISTED, 0),
    ("a line comment mentioning it is not a violation", _ONLY_IN_A_COMMENT, 0),
    ("a block comment mentioning it is not a violation", _ONLY_IN_A_BLOCK_COMMENT, 0),
    ("double-quoted table name is still caught", _DOUBLE_QUOTED, 1),
]

_PATH_CASES = [
    ("a public route is in scope", "src/app/[slug]/page.tsx", True),
    ("the sitemap is in scope", "src/app/sitemap.ts", True),
    ("search is in scope", "src/app/search/page.tsx", True),
    ("the PUBLIC recommendations API stays in scope", "src/app/api/recommendations/[slug]/route.ts", True),
    ("the dashboard is carved out", "src/app/dashboard/profile/page.tsx", False),
    ("the admin console is carved out", "src/app/admin/users/page.tsx", False),
    ("the authenticated reports API is carved out", "src/app/api/reports/route.ts", False),
    ("library code is not a route at all", "src/modules/access/gates/suspension.ts", False),
    # KAN-473: the D9-extracted public UI is still public surface even though it
    # no longer lives under src/app/. Without these the move silently narrowed
    # this control from 74 files to 69.
    ("D9-extracted public-profile UI stays in scope", "src/modules/public-profile/report-button.tsx", True),
    ("...including a file D9 has not created yet", "src/modules/public-profile/future-section.tsx", True),
    ("but platform module code is still not public", "src/modules/platform/supabase-service.ts", False),
]


def self_test() -> int:
    failures = 0

    for label, source, expected in _CASES:
        found = len(find_violations(source))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  [retained] {label} (expected {expected}, got {found})")
        failures += not ok

    for label, source, expected in _BASE_CASES:
        found = len(find_base_table_reads(source))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  [base-table] {label} (expected {expected}, got {found})")
        failures += not ok

    for label, path, expected in _PATH_CASES:
        got = is_public_surface(path)
        ok = got == expected
        print(f"  {'PASS' if ok else 'FAIL'}  [surface] {label} (expected {expected}, got {got})")
        failures += not ok

    total = len(_CASES) + len(_BASE_CASES) + len(_PATH_CASES)
    if failures:
        print(f"::error::check-suspension-guard-coverage self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {total} fixture case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    root = Path(args.root)
    app_dir = root / "src" / "app"

    # Assert the precondition directly rather than inferring "the tree was
    # actually scanned" from a downstream count — gotcha #30, where a BSD/GNU
    # grep exit-code divergence let a security guard report green having
    # searched nothing.
    if not app_dir.is_dir():
        print(f"::error::{app_dir} is missing or unreadable, so no public surface can be scanned.")
        print("::error::  Failing closed rather than reporting a clean scan that never ran.")
        return 2

    try:
        result = scan(root)
    except subprocess.CalledProcessError as exc:
        print(f"::error::could not list tracked files: {exc}")
        print("::error::  Failing closed — 'could not look' must never print as 'nothing found'.")
        return 2

    # ── Vacuous-pass guards ────────────────────────────────────────────────
    #
    # THE RE-KEYED ONE. The old guard failed only when the raw chain count hit
    # zero, and the SEC-104 migration took the PUBLIC count from 4 to 0 while
    # the raw count sat at 2 — so it never fired on the very event it existed
    # for. Both numbers that can silently go to zero are now asserted.
    if not result["public_files"]:
        print("::error::No public-surface files found under src/app/.")
        print("::error::  Either every route is carved out, or the tree moved. Either way this")
        print("::error::  check would be passing vacuously — which is how SEC-104's own fix")
        print("::error::  blinded the previous version of this control.")
        return 1

    if result["view_reads"] == 0:
        print("::error::No public surface reads `public_profiles`.")
        print("::error::  SEC-104 migrated six read sites to that view. Finding none means the")
        print("::error::  migration was reverted or those files moved out of src/app/, and this")
        print("::error::  check has lost the surface it is meant to be watching.")
        return 1

    carve_out_problems = check_carve_outs_are_live(root, result["files"])
    carve_out_problems += check_public_modules_are_live(root, result["files"])
    if carve_out_problems:
        print()
        for problem in carve_out_problems:
            print(problem)
        print()
        print("::error::A carve-out that covers nothing makes the public surface look smaller")
        print("::error::than it is. 'Matches nothing' is detectable; 'matches less than it used")
        print("::error::to' is not — which is the whole reason this assertion exists.")
        return 1

    print(
        f"Scanning {len(result['public_files'])} public-surface file(s) under src/app/ "
        f"({result['view_reads']} public_profiles read(s) found)…"
    )

    for warning in result["warnings"]:
        print(warning)

    if result["errors"]:
        print()
        for problem in result["errors"]:
            print(problem)
        print()
        print(f"::error::{len(result['errors'])} public surface(s) read the profiles base table.")
        print()
        print("Public surfaces must read `public_profiles`. A predicate in a VIEW BODY applies")
        print("to every reader including service_role; an RLS policy does not, and ~40 modules")
        print("in this repo use the service-role client. That difference is SEC-44, SEC-100 and")
        print("SEC-104 in one sentence.")
        print()
        print("Allow-list only with '// suspension-guard-ok: <JIRA-KEY> <reason>'.")
        return 1

    print("No public surface reads the profiles base table. ✓")
    if result["warnings"]:
        print(f"({len(result['warnings'])} advisory warning(s) on non-public paths.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
