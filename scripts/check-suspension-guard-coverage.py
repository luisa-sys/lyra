#!/usr/bin/env python3
"""SEC-100 — the suspension-guard coverage class.

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
has ~40 modules importing it. That is precisely how SEC-44 happened, and how
`src/app/search/page.tsx` and `src/app/sitemap.ts` were still leaking suspended
members to public search and to search-engine crawlers on 2026-07-27 — more
than three weeks after SEC-44 closed.

THE INVARIANT
-------------
Any Supabase query chain that filters `is_published = true` is, by definition,
selecting content for PUBLIC consumption. Every such chain must also filter
`is_suspended = false`.

This is deliberately expressed on the QUERY rather than the file or the client:
it needs no knowledge of which client is in play, it holds whether or not RLS
would have covered it (defence in depth), and it enumerates the surface instead
of sampling it — which is the property every previous fix in this class lacked.

Allow-list: `// suspension-guard-ok: <reason>` inside the chain, plus a Jira key.

USAGE
    python3 scripts/check-suspension-guard-coverage.py
    python3 scripts/check-suspension-guard-coverage.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PUBLISHED_RE = re.compile(r"\.eq\(\s*['\"`]is_published['\"`]\s*,\s*true\s*\)")
SUSPENDED_RE = re.compile(r"is_suspended")
ALLOW_MARKER = "suspension-guard-ok"

# How far past the `is_published` filter to look for its siblings. A supabase-js
# chain is fluent, so the rest of the query follows immediately; 900 characters
# comfortably covers the longest chain in this repo (src/app/[slug]/page.tsx)
# without spilling into an unrelated statement.
CHAIN_WINDOW = 900


def find_violations(source: str, path: str) -> list[tuple[int, str]]:
    """Return (line_number, excerpt) for each is_published chain lacking is_suspended."""
    violations: list[tuple[int, str]] = []

    for match in PUBLISHED_RE.finditer(source):
        # The chain runs from the start of the statement to a window past the
        # is_published filter. Look backwards to the opening of the chain so a
        # guard placed BEFORE .eq('is_published', ...) also counts.
        chain_start = source.rfind("supabase", max(0, match.start() - CHAIN_WINDOW), match.start())
        if chain_start == -1:
            chain_start = max(0, match.start() - CHAIN_WINDOW)
        chain = source[chain_start : match.end() + CHAIN_WINDOW]

        # Stop the window at a blank line followed by a non-chained statement,
        # so we do not borrow a guard from the next query in the same file.
        cut = re.search(r";\s*\n\s*\n", chain[match.start() - chain_start :])
        if cut:
            chain = chain[: (match.start() - chain_start) + cut.end()]

        if ALLOW_MARKER in chain:
            continue
        if SUSPENDED_RE.search(chain):
            continue

        line_no = source.count("\n", 0, match.start()) + 1
        excerpt = source[match.start() : match.end()]
        violations.append((line_no, excerpt))

    return violations


def scan(src_root: Path) -> tuple[list[str], int]:
    problems: list[str] = []
    chains_seen = 0

    for path in sorted(src_root.rglob("*")):
        if not path.is_file() or path.suffix not in {".ts", ".tsx"}:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if "is_published" not in source:
            continue

        chains_seen += len(PUBLISHED_RE.findall(source))

        for line_no, excerpt in find_violations(source, str(path)):
            problems.append(
                f"::error file={path},line={line_no}::Query filters is_published but not is_suspended. "
                f"A suspended (moderated / taken-down) member stays publicly visible here. "
                f"RLS does NOT save you if this reads through the service-role client. "
                f"Add .eq('is_suspended', false). ({excerpt})"
            )

    return problems, chains_seen


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


def self_test() -> int:
    failures = 0
    for label, source, expected in _CASES:
        found = len(find_violations(source, "fixture.ts"))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected}, got {found})")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-suspension-guard-coverage self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(_CASES)} fixture case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default="src")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    src_root = Path(args.src)
    if not src_root.is_dir():
        print(f"::error::source directory '{src_root}' not found.")
        return 1

    problems, chains_seen = scan(src_root)

    # Vacuous-pass guard. This codebase has filtered is_published since the
    # first public-profile release. Finding no chains at all means the pattern
    # has changed and this check would be reporting green on nothing.
    if chains_seen == 0:
        print(f"::error::No `is_published = true` query chains found under '{src_root}'.")
        print("::error::This check has lost its target — it would be passing vacuously.")
        return 1

    print(f"Scanning {chains_seen} public-visibility query chain(s) for suspension coverage…")

    if problems:
        print()
        for problem in problems:
            print(problem)
        print()
        print(f"::error::{len(problems)} public query chain(s) omit the suspension filter.")
        print()
        print("Any query that filters is_published is selecting content for PUBLIC")
        print("consumption and must also filter is_suspended. The RLS policy on")
        print("`profiles` does enforce both — but the SERVICE-ROLE client bypasses RLS,")
        print("and ~40 modules in this repo use it. That is how SEC-44 happened, and how")
        print("search + sitemap were still leaking suspended members on 2026-07-27.")
        print()
        print("Allow-list only with '// suspension-guard-ok: <reason>' plus a SEC key.")
        return 1

    print("Every public-visibility query also filters suspended members. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
