#!/usr/bin/env python3
"""CTL-076 / KAN-459 §2 — a test-side Supabase mock must record filters PER STATEMENT.

WHY THIS EXISTS
---------------
KAN-447/448 shipped a suite that asserted the owner-scoping of an UPDATE:

    expect(eqCalls['school_affiliations']).toContainEqual(['profile_id', 'profile-1'])

`updateSchoolAffiliation` reads the row before it writes it, and the SELECT's
own `.eq('id', …)` / `.eq('profile_id', …)` landed in the same per-table pool.
So the assertion was satisfied by the READ and said nothing about the WRITE:
deleting either filter from the UPDATE left all 27 tests green while an
attacker could edit another member's affiliation, or bulk-overwrite every
affiliation of their own. That is a tenancy defect hiding behind a green tick.

This is catalogue failure mode 2 turned inside out. There the *comment*
satisfied the assertion; here an *incidental adjacent statement* does. Both
fire constantly and answer a different question from the one asked.

WHAT IT FLAGS — DELIBERATELY NARROW
-----------------------------------
One shape, and only one: inside the body of an `.eq()` recorder in a test file,
a subscript of some container by the TABLE identifier —

    eq: (col, val) => { (pool[table] ??= []).push([col, val]); return b }
                          ^^^^^^^^^^^ keyed by table, so every statement on
                                      that table shares one list

The correct shape records into a structure created per `.from()` call, and is
not flagged:

    const build = (table) => {
      const statement = { table, eq: [] };   // one .from() === one statement
      statements.push(statement);
      return { eq: (col, val) => { statement.eq.push([col, val]); return b } }
    }

`tests/unit/kan447-kan448-inline-edit.test.ts` is the reference implementation
and carries the long-form explanation.

The narrowness is the design, not a shortcut. A broad "your Supabase mock looks
suspicious" heuristic over the ~40 hand-rolled mocks in this estate would
produce standing noise, and standing noise is what teaches reviewers to wave a
gate through — which is how a control is lost without anyone deciding to lose
it. Three conditions must all hold: a tracked file under `tests/`, an `.eq()`
recorder, and a table-keyed subscript INSIDE that recorder's body.

WHY A DETECTOR AND NOT ONLY A SHARED HARNESS
--------------------------------------------
KAN-459 §2 prefers "make it impossible" (a shared per-statement mock in
`tests/support/`) over "detect it". Measured when this landed: exactly ONE file
in the estate uses the pooled shape, and it is non-vacuous today only by luck —
its actions happen not to pre-read the table they write. A shared harness with
no consumer that is not already correct is decorative; a gate covers every mock
written from here on, including the next one hand-rolled in a hurry. The
harness remains the better fix for any file that adopts it, and this control's
failure message points at the reference implementation rather than at a rule.

COMMENTS ARE STRIPPED FIRST, using `check-comment-only-assertions.py`'s own
`strip_comments` rather than a second copy of the rules — two implementations
of one rule set with nothing comparing them is the SEC-152 drift shape, and it
is the exact mistake KAN-459 §3 corrected for `stripComments`. A commented-out
pooled mock is prose, not a defect.

RATCHET
-------
`tests/support/pooled-eq-mock-baseline.json`, keyed per file, TWO-WAY: a new
pooled recorder fails, a baselined file that grows fails, and a baselined file
that shrinks or is fixed fails as STALE. A list you may only add to is a
suppression list, not a ratchet.

The one grandfathered entry (`tests/unit/profile-ownership.test.ts`, the KAN-260
owner-scoping net) is NOT annotated away and is NOT a licence: converting it to
per-statement recording rewrites its existing assertions, which the Test
Integrity Policy requires be signed off first. It is recorded so it cannot get
worse and cannot be forgotten.

Exit codes: 0 clean · 1 findings · 2 the check could not run (fail closed).
"""

from __future__ import annotations

import argparse
import importlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

_ccoa = importlib.import_module("check-comment-only-assertions")
strip_comments = _ccoa.strip_comments

SCANNABLE = (".ts", ".tsx", ".js", ".mjs")

# Floors. A glob that silently stops matching must fail, not report clean —
# "found nothing" and "looked at nothing" are different answers (catalogue #4).
MIN_TEST_FILES = 150
MIN_FILES_WITH_EQ_RECORDER = 10

SELF_TEST_CASE_FLOOR = 20

# Identifiers that hold the table name. The first two patterns derive it from
# the mock itself; CONVENTIONAL_TABLE_IDENTS is the fallback for a builder
# factory reached indirectly (`from: (t) => build(t)`), which is the commonest
# shape here.
FROM_PARAM_RE = re.compile(r"\bfrom\s*:?\s*\(\s*(\w+)\s*[,:)]")
FACTORY_PARAM_RE = re.compile(r"\b(?:const\s+)?\w+\s*=\s*\(\s*(\w+)\s*:\s*string\s*\)\s*(?::[^=;]*)?=>")
CONVENTIONAL_TABLE_IDENTS = {"table", "tableName", "tbl"}

EQ_RECORDER_RE = re.compile(r"\beq\s*(?::\s*)?\(")


class PooledEqError(Exception):
    """The check could not run. Never reported as a clean result."""


def tracked_test_files(root: Path) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "tests/"],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise PooledEqError(f"git ls-files failed: {exc}") from exc
    return [p for p in out.split() if p.endswith(SCANNABLE)]


def _balanced_end(text: str, start: int, opener: str, closer: str) -> int | None:
    """Index just past the `opener` at `start`'s match, or None if unbalanced."""
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return None


def eq_recorder_bodies(src: str) -> list[tuple[int, str]]:
    """Every `.eq(...)` recorder body in `src`, as (offset, body).

    Handles the three forms this estate writes:
        eq: (col, val) => { … }        arrow with a block body
        eq: (col, val) => expr         arrow with an expression body
        eq(col, val) { … }             method shorthand
    """
    bodies: list[tuple[int, str]] = []
    for m in EQ_RECORDER_RE.finditer(src):
        params_open = src.index("(", m.start())
        params_end = _balanced_end(src, params_open, "(", ")")
        if params_end is None:
            continue
        rest = src[params_end:]
        arrow = re.match(r"\s*(?::[^=;{]*)?=>\s*", rest)
        if arrow:
            after = params_end + arrow.end()
            if after < len(src) and src[after] == "{":
                end = _balanced_end(src, after, "{", "}")
                if end is not None:
                    bodies.append((m.start(), src[after:end]))
                continue
            # Expression body: read to the end of this property/statement.
            depth = 0
            i = after
            while i < len(src):
                c = src[i]
                if c in "([{":
                    depth += 1
                elif c in ")]}":
                    if depth == 0:
                        break
                    depth -= 1
                elif c in ",;" and depth == 0:
                    break
                i += 1
            bodies.append((m.start(), src[after:i]))
            continue
        block = re.match(r"\s*\{", rest)
        if block:
            after = params_end + block.end() - 1
            end = _balanced_end(src, after, "{", "}")
            if end is not None:
                bodies.append((m.start(), src[after:end]))
    return bodies


def table_idents(src: str) -> set[str]:
    idents = set(CONVENTIONAL_TABLE_IDENTS)
    for m in FROM_PARAM_RE.finditer(src):
        idents.add(m.group(1))
    for m in FACTORY_PARAM_RE.finditer(src):
        idents.add(m.group(1))
    return idents


def pooled_recorders(src: str, suffix: str) -> list[int]:
    """Line numbers (1-based) of `.eq()` recorders keyed by the table name."""
    stripped = strip_comments(src, suffix)
    if stripped is None:
        return []
    idents = table_idents(stripped)
    subscript = re.compile(r"\w\s*\[\s*(" + "|".join(sorted(map(re.escape, idents))) + r")\s*\]")
    hits: list[int] = []
    for offset, body in eq_recorder_bodies(stripped):
        if subscript.search(body):
            hits.append(stripped.count("\n", 0, offset) + 1)
    return hits


def scan(files: list[str], root: Path) -> tuple[dict[str, list[int]], int]:
    """(findings per file, number of files that contain any `.eq()` recorder)."""
    findings: dict[str, list[int]] = {}
    with_recorder = 0
    for rel in files:
        try:
            src = (root / rel).read_text(encoding="utf-8")
        except OSError as exc:
            raise PooledEqError(f"could not read {rel}: {exc}") from exc
        suffix = Path(rel).suffix
        stripped = strip_comments(src, suffix)
        if stripped is None:
            continue
        if eq_recorder_bodies(stripped):
            with_recorder += 1
        lines = pooled_recorders(src, suffix)
        if lines:
            findings[rel] = lines
    return findings, with_recorder


def evaluate(actual: dict[str, list[int]], baseline: dict) -> list[str]:
    """Two-way ratchet. NEW / WORSE fail; STALE fails too."""
    recorded: dict[str, int] = {k: int(v) for k, v in baseline.get("files", {}).items()}
    failures: list[str] = []
    for rel, lines in sorted(actual.items()):
        if rel not in recorded:
            failures.append(
                f"NEW: {rel} records .eq() calls keyed by table (line(s) "
                f"{', '.join(map(str, lines))}). One .from() call is one statement — "
                f"record per statement, as tests/unit/kan447-kan448-inline-edit.test.ts does."
            )
        elif len(lines) > recorded[rel]:
            failures.append(
                f"WORSE: {rel} now has {len(lines)} table-keyed .eq() recorder(s), "
                f"baselined at {recorded[rel]}."
            )
    for rel, count in sorted(recorded.items()):
        if rel not in actual:
            failures.append(
                f"STALE: {rel} is baselined with {count} table-keyed .eq() recorder(s) "
                f"and now has none. Remove it from the baseline in the same commit."
            )
        elif len(actual[rel]) < count:
            failures.append(
                f"STALE: {rel} is baselined at {count} table-keyed .eq() recorder(s) "
                f"and now has {len(actual[rel])}. Update the baseline."
            )
    return failures


def self_test() -> int:
    failures: list[str] = []
    cases = 0

    def check(label, got, want):
        nonlocal cases
        cases += 1
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    POOLED = """
      const mockEqCalls = {};
      jest.mock('@/modules/platform/supabase-server', () => {
        const build = (table: string): Builder => {
          const b = {
            select: () => b,
            eq: (col, val) => {
              (mockEqCalls[table] = mockEqCalls[table] ?? []).push([col, val]);
              return b;
            },
          };
          return b;
        };
        return { createClient: async () => ({ from: (t: string) => build(t) }) };
      });
    """

    PER_STATEMENT = """
      const mockStatements = [];
      jest.mock('@/modules/platform/supabase-server', () => {
        const build = (table: string): Builder => {
          const statement = { table, kind: 'unknown', eq: [] };
          mockStatements.push(statement);
          const b = {
            select: () => { statement.kind = 'select'; return b; },
            eq: (col, val) => { statement.eq.push([col, val]); return b; },
          };
          return b;
        };
        return { createClient: async () => ({ from: (t: string) => build(t) }) };
      });
    """

    # --- the shape it exists for ------------------------------------------
    check("pooled-per-table recorder is flagged", len(pooled_recorders(POOLED, ".ts")), 1)
    check("per-statement recorder is NOT flagged", pooled_recorders(PER_STATEMENT, ".ts"), [])
    check(
        "the reported line is the recorder, not the file",
        pooled_recorders(POOLED, ".ts")[0],
        POOLED[: POOLED.index("eq: (col, val)")].count("\n") + 1,
    )

    # --- comment handling. The whole point of reusing strip_comments -------
    check(
        "a COMMENTED-OUT pooled recorder is prose, not a defect",
        pooled_recorders("// eq: (col, val) => { pool[table].push([col, val]) }\n", ".ts"),
        [],
    )
    check(
        "a pooled recorder inside a block comment is not a defect",
        pooled_recorders("/*\n eq: (c, v) => { pool[table].push([c, v]) }\n*/\n", ".ts"),
        [],
    )
    check(
        "a JSX comment does not hide a REAL recorder elsewhere in the file",
        len(pooled_recorders("{/* pooling is wrong */}\n" + POOLED, ".tsx")),
        1,
    )

    # --- the three recorder syntaxes this estate writes --------------------
    check(
        "method shorthand `eq(col, val) { … }` is seen",
        len(pooled_recorders("const o = { eq(col, val) { pool[table].push([col, val]); } };", ".ts")),
        1,
    )
    check(
        "expression-bodied arrow is seen",
        len(pooled_recorders("const o = { eq: (c, v) => (pool[table] ??= []).push([c, v]), x: 1 };", ".ts")),
        1,
    )
    check(
        "typed arrow params are seen",
        len(pooled_recorders("const o = { eq: (c: string, v: unknown) => { pool[table].push([c, v]); } };", ".ts")),
        1,
    )

    # --- narrowness. Each of these WOULD fire under a looser rule ----------
    check(
        "a table-keyed subscript OUTSIDE any eq recorder is not a finding",
        pooled_recorders("const rows = fixtures[table];\nconst o = { eq: (c, v) => b };", ".ts"),
        [],
    )
    check(
        "an eq recorder with no subscript at all is not a finding",
        pooled_recorders("const o = { eq: (c, v) => { seen.push([c, v]); return b; } };", ".ts"),
        [],
    )
    check(
        "a subscript by something that is NOT the table identifier is not a finding",
        pooled_recorders("const o = { eq: (c, v) => { seen[col].push(v); return b; } };", ".ts"),
        [],
    )
    check(
        "a real `.eq('id', x)` CALL is not a recorder definition",
        pooled_recorders("await supabase.from('t').update(u).eq('id', x).eq('profile_id', p);", ".ts"),
        [],
    )

    # --- table identifier derivation ---------------------------------------
    check("`table` is a conventional table identifier", "table" in table_idents(""), True)
    check("a `from:` parameter name is picked up", "zz" in table_idents("from: (zz: string) => build(zz)"), True)
    check("a builder factory parameter is picked up", "qq" in table_idents("const build = (qq: string): B => {"), True)
    check(
        "a bespoke identifier from `from:` makes its own pooling visible",
        len(pooled_recorders("from: (zz: string) => ({ eq: (c, v) => { pool[zz].push([c, v]); } })", ".ts")),
        1,
    )

    # --- unknown file types are SKIPPED, never guessed ---------------------
    check("an unknown suffix is skipped rather than guessed", pooled_recorders(POOLED, ".cjs"), [])

    # --- ratchet, both directions ------------------------------------------
    check(
        "a NEW pooled recorder fails",
        any("NEW" in f for f in evaluate({"tests/a.test.ts": [3]}, {"files": {}})),
        True,
    )
    check(
        "a baselined file at the same count passes",
        evaluate({"tests/a.test.ts": [3]}, {"files": {"tests/a.test.ts": 1}}),
        [],
    )
    check(
        "a baselined file that GROWS fails",
        any("WORSE" in f for f in evaluate({"tests/a.test.ts": [3, 9]}, {"files": {"tests/a.test.ts": 1}})),
        True,
    )
    check(
        "a baselined file that is FIXED fails as stale",
        any("STALE" in f for f in evaluate({}, {"files": {"tests/a.test.ts": 1}})),
        True,
    )
    check(
        "a baselined file that partly shrinks fails as stale",
        any("STALE" in f for f in evaluate({"tests/a.test.ts": [3]}, {"files": {"tests/a.test.ts": 2}})),
        True,
    )

    # The verdict is read AFTER every case has run. SEC-140: eight self-test
    # cases were appended to a list nothing consumed, and the reported count
    # went UP while three real mutations all reported "passed".
    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    if cases < SELF_TEST_CASE_FLOOR:
        print(f"SELF-TEST FAILED: only {cases} case(s) ran, floor is {SELF_TEST_CASE_FLOOR}.")
        print("  A self-test that shrank is a self-test someone deleted a case from.")
        return 1
    print(f"Self-test passed ({cases} cases, floor {SELF_TEST_CASE_FLOOR}).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="CTL-076 — per-statement Supabase mock recording.")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--root", type=Path, default=REPO_ROOT, help=argparse.SUPPRESS)
    ap.add_argument("--baseline", type=Path, default=None, help=argparse.SUPPRESS)
    ap.add_argument("--min-files", type=int, default=MIN_TEST_FILES, help=argparse.SUPPRESS)
    ap.add_argument("--min-recorders", type=int, default=MIN_FILES_WITH_EQ_RECORDER, help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    root: Path = args.root
    baseline_path: Path = args.baseline or (root / "tests" / "support" / "pooled-eq-mock-baseline.json")

    try:
        files = tracked_test_files(root)
        actual, with_recorder = scan(files, root)
    except (PooledEqError, OSError) as exc:
        print(f"::error::check-pooled-eq-mock: {exc}")
        print("::error::  Failing closed (exit 2): a check that could not run is not a clean result.")
        return 2

    if len(files) < args.min_files:
        print(f"::error::check-pooled-eq-mock: only {len(files)} tracked test file(s) found.")
        print(f"::error::  Expected at least {args.min_files}. A scan that suddenly finds almost")
        print("::error::  nothing has broken, not been cleaned up.")
        return 2
    if with_recorder < args.min_recorders:
        print(f"::error::check-pooled-eq-mock: only {with_recorder} file(s) contain an .eq() recorder.")
        print(f"::error::  Expected at least {args.min_recorders}. The recorder parser has stopped")
        print("::error::  matching, so 'no findings' would mean 'nothing was inspected'.")
        return 2

    if args.write_baseline:
        payload = {
            "_why": [
                "CTL-076 / KAN-459 §2. Test-side Supabase mocks whose .eq() recorder is keyed",
                "by TABLE rather than per .from() statement, as they stood when the control",
                "landed. Grandfathered so it could ship green.",
                "",
                "TWO-WAY. A new pooled recorder fails; a baselined file that grows fails; a",
                "baselined file that shrinks or is fixed fails as STALE until recorded. A list",
                "you may only add to is a suppression list, not a ratchet.",
                "",
                "The single entry is tests/unit/profile-ownership.test.ts, the KAN-260",
                "owner-scoping net. It is NOT vacuous today — mutation-checked: deleting",
                ".eq('profile_id', profile.id) from removeProfileItem turns it RED — but only",
                "because those actions happen not to pre-read the table they write. The day one",
                "of them does, the assertion goes vacuous with no diff to the test.",
                "",
                "It is baselined rather than converted because converting it rewrites its",
                "existing assertions, and the Test Integrity Policy requires sign-off for that.",
                "Recorded so it cannot get worse and cannot be forgotten.",
            ],
            "ticket": "KAN-459",
            "_totals": {"testFiles": len(files), "filesWithEqRecorder": with_recorder},
            "files": {rel: len(lines) for rel, lines in sorted(actual.items())},
        }
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {baseline_path.name}: {len(actual)} file(s) with a table-keyed .eq() recorder")
        return 0

    if not baseline_path.exists():
        print(f"::error::check-pooled-eq-mock: {baseline_path.name} is missing — refusing to")
        print("::error::  report clean with nothing to compare against.")
        return 2
    try:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"::error::check-pooled-eq-mock: {baseline_path.name} is not valid JSON: {exc}")
        return 2

    problems = evaluate(actual, baseline)
    if problems:
        for p in problems:
            print(f"::error::check-pooled-eq-mock: {p}")
        print("::error::  One .from() call is ONE statement. Pooling filters per table lets a")
        print("::error::  pre-read satisfy an assertion that was meant to be about the write —")
        print("::error::  KAN-447/448, where both owner filters were deletable and 27 tests")
        print("::error::  stayed green. Reference shape: tests/unit/kan447-kan448-inline-edit.test.ts")
        return 1

    print(
        f"No new table-keyed .eq() recorders. "
        f"{len(files)} test file(s) scanned, {with_recorder} with an .eq() recorder, "
        f"{len(actual)} baselined. ✓"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
