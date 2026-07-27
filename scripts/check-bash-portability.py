#!/usr/bin/env python3
"""BUGS-76: fail any shell script using a bash-4-only construct.

macOS ships **bash 3.2.57** — the last GPLv2 release, frozen in 2007 — while CI
runs Ubuntu with bash 5.x. Every bash-4+ builtin therefore works in CI and dies
on the founder's own machine with `command not found` and **exit 127**: a
failure that reads like a broken harness rather than a broken control.

This is not hypothetical, and it is not a one-off:

  * `scripts/staging-soak.sh:16` has carried the comment "Portability: no
    `mapfile`/`readarray` (absent in macOS bash 3.2)" since it was written.
  * Two other scripts shipped with `mapfile` anyway —
    `check-fix-only-promote.sh` (the SEC-77 auto-promote gate) and
    `backup-database-api.sh` (a backup script). Fixed in #594.
  * The visible damage: `npm run test:unit` could not pass on macOS. All seven
    cases of `tests/scripts/check-fix-only-promote.test.js` failed locally
    while passing on ubuntu-latest, training the reader to ignore a red suite.

A documented convention with no gate is the exact pattern SEC-101 exists to
stop, so this is the gate. Per the defect-feedback loop this is outcome (b) —
no control existed, so one is built and registered.

Comments are stripped before matching, deliberately: the scripts fixed in #594
now *explain* the mapfile hazard in prose, and a guard that tripped on its own
fix's documentation would be worse than useless. That case is pinned in the
self-test.

Allow-list a genuinely CI-only line with `# bash-portability-ok: <reason>`
plus a Jira key.

Scope: `scripts/**/*.sh` only — see target_files() for why workflow YAML is
deliberately excluded.

Usage:
    python3 scripts/check-bash-portability.py [--root .]
    python3 scripts/check-bash-portability.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ESCAPE_HATCH = "bash-portability-ok:"

# Each entry: (label, compiled pattern, why it breaks, the 3.2-safe alternative).
#
# Only constructs genuinely ABSENT from bash 3.2 belong here. Anything that
# merely behaves differently is out of scope — a false positive in a blocking
# gate costs more than the bug it would catch.
CONSTRUCTS: list[tuple[str, re.Pattern[str], str, str]] = [
    (
        "mapfile/readarray",
        # Command position only: start of line, or after a pipe/;/&&/||/(/`.
        re.compile(r"(?:^|[|;&(`]|\|\||&&)\s*(?:mapfile|readarray)\b"),
        "bash-4 builtin; bash 3.2 exits 127 'command not found'",
        'ARR=(); while IFS= read -r line; do ARR+=("$line"); done < <(cmd)',
    ),
    (
        "associative array (declare -A)",
        re.compile(r"\b(?:declare|local|typeset)\s+(?:-[A-Za-z]*\s+)*-[A-Za-z]*A[A-Za-z]*\b"),
        "associative arrays are bash 4; bash 3.2 rejects -A",
        "parallel indexed arrays, or a temp file / python3 helper",
    ),
    (
        "case-modification expansion (${v^^} / ${v,,})",
        re.compile(r"\$\{[#!]?[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?(?:\^\^?|,,?)[^}]*\}"),
        "${v^^} / ${v,,} are bash 4; bash 3.2 leaves them unexpanded",
        "tr '[:lower:]' '[:upper:]' (already used in check-fix-only-promote.sh)",
    ),
    (
        "append-redirect both streams (&>>)",
        re.compile(r"&>>"),
        "&>> is bash 4; bash 3.2 parses it as & then >>, backgrounding the command",
        ">>file 2>&1",
    ),
    (
        "coproc",
        re.compile(r"(?:^|[|;&(`])\s*coproc\b"),
        "coproc is bash 4",
        "a named pipe, or restructure to avoid co-processes",
    ),
    (
        "shopt -s globstar",
        re.compile(r"\bshopt\s+-s\s+globstar\b"),
        "globstar (**) is bash 4; in bash 3.2 ** behaves as a single *",
        "find … -name … , or git ls-files",
    ),
]


def strip_comment(line: str) -> str:
    """Remove a full-line comment.

    Deliberately conservative: only lines whose first non-blank character is
    `#` are treated as comments. Trailing-comment stripping is NOT attempted,
    because `#` appears inside legitimate shell strings (`${v#prefix}`,
    `"a#b"`), and mis-stripping would silently blind the scanner — the failure
    mode this whole control exists to prevent.
    """
    return "" if line.lstrip().startswith("#") else line


def find_violations(source: str, path: str) -> list[tuple[int, str, str, str]]:
    """Return (line_no, label, why, alternative) for each violation in *source*."""
    out: list[tuple[int, str, str, str]] = []
    for lineno, raw in enumerate(source.splitlines(), start=1):
        if ESCAPE_HATCH in raw:
            continue
        line = strip_comment(raw)
        if not line.strip():
            continue
        for label, pattern, why, alternative in CONSTRUCTS:
            if pattern.search(line):
                out.append((lineno, label, why, alternative))
    return out


def target_files(root: Path, self_path: Path) -> list[Path]:
    """Shell scripts under scripts/, excluding this guard's own source.

    Workflow YAML is deliberately OUT OF SCOPE. An inline `run:` block executes
    only on the CI runner (ubuntu-latest, bash 5) and never on a developer's
    machine, so a bash-4 construct there is legitimate — not a latent 127.
    Scanning workflows would produce findings whose only correct disposition is
    a permanent allow-list entry, and a gate carrying standing noise is a gate
    people learn to wave through. Precision is what keeps this one alive.

    Concretely, at the time of writing `.github/workflows/backup-complete.yml`
    uses `shopt -s globstar` twice (lines 305, 334). That is correct code: it
    runs only in CI. It is recorded in BUGS-76 so it is a known exclusion
    rather than a silent miss.

    Scripts under scripts/ are the opposite case — they are invoked both by
    workflows and by hand, which is exactly how the SEC-77 promote gate came to
    be unrunnable on the machine where releases are prepared.
    """
    resolved_self = self_path.resolve()
    return sorted(
        p for p in root.glob("scripts/**/*.sh")
        if p.is_file() and p.resolve() != resolved_self
    )


def scan(root: Path, self_path: Path) -> tuple[list[str], int]:
    problems: list[str] = []
    files = target_files(root, self_path)
    for path in files:
        try:
            source = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:  # unreadable file is a FAIL, never a silent skip
            problems.append(f"  {path}: cannot read ({exc}) — failing closed")
            continue
        for lineno, label, why, alternative in find_violations(source, str(path)):
            problems.append(
                f"  {path}:{lineno}  {label}\n"
                f"      why: {why}\n"
                f"      use: {alternative}"
            )
    return problems, len(files)


# --- self-test fixtures -----------------------------------------------------
#
# The first two cases are the ones that matter. Case 2 is the regression that
# would make this guard actively harmful: #594 fixed the mapfile bug and left
# prose explaining it, so a guard matching inside comments would fail the very
# commit that fixed the defect.

_REAL_MAPFILE = 'mapfile -t COMMITS < <(git rev-list --no-merges "$RANGE")\n'

_COMMENT_ABOUT_MAPFILE = (
    "# Written for bash 3.2 as well as 5.x: `mapfile` is a bash-4 builtin, and\n"
    "# macOS ships bash 3.2, so it aborted with \"mapfile: command not found\".\n"
    "COMMITS=()\n"
    'while IFS= read -r _sha; do\n'
    '  [ -n "$_sha" ] && COMMITS+=("$_sha")\n'
    'done < <(git rev-list --no-merges "$RANGE")\n'
)

_PIPED_READARRAY = 'git rev-list HEAD | readarray -t ARR\n'
_ASSOC = "declare -A SEEN\nSEEN[foo]=1\n"
_ASSOC_LOCAL = "local -A counts\n"
_UPPER = 'echo "${name^^}"\n'
_LOWER = 'TYPE="${TYPE,,}"\n'
_APPEND_BOTH = "run-thing &>> /tmp/log\n"
_COPROC = "coproc READER { cat; }\n"
_GLOBSTAR = "shopt -s globstar\n"
_ESCAPED = 'mapfile -t X < <(cmd)  # bash-portability-ok: CI-only (BUGS-76)\n'
_INDEXED_ARRAY_OK = 'declare -a items\nitems+=("x")\n'
_SUBSTRING_OK = 'echo "${path#prefix}" "${name%suffix}"\n'
_TR_UPPER_OK = "type=$(printf '%s' \"$t\" | tr '[:upper:]' '[:lower:]')\n"
_REDIRECT_OK = "run-thing >> /tmp/log 2>&1\n"

_CASES: list[tuple[str, str, int]] = [
    ("a real mapfile call is caught", _REAL_MAPFILE, 1),
    ("prose EXPLAINING mapfile is NOT caught (the #594 fix's own comments)", _COMMENT_ABOUT_MAPFILE, 0),
    ("readarray after a pipe is caught", _PIPED_READARRAY, 1),
    ("declare -A is caught", _ASSOC, 1),
    ("local -A is caught", _ASSOC_LOCAL, 1),
    ("${v^^} is caught", _UPPER, 1),
    ("${v,,} is caught", _LOWER, 1),
    ("&>> is caught", _APPEND_BOTH, 1),
    ("coproc is caught", _COPROC, 1),
    ("shopt -s globstar is caught", _GLOBSTAR, 1),
    ("the escape hatch suppresses exactly its own line", _ESCAPED, 0),
    ("declare -a (indexed, bash 3.2-safe) is NOT caught", _INDEXED_ARRAY_OK, 0),
    ("${v#prefix} / ${v%suffix} are NOT caught", _SUBSTRING_OK, 0),
    ("the tr-based lowercase idiom is NOT caught", _TR_UPPER_OK, 0),
    (">>file 2>&1 is NOT caught", _REDIRECT_OK, 0),
]


def self_test() -> int:
    failures = 0
    for label, source, expected in _CASES:
        found = len(find_violations(source, "fixture.sh"))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected}, got {found})")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-bash-portability self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(_CASES)} fixture case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    root = Path(args.root)
    if not root.is_dir():
        print(f"::error::root directory '{root}' not found.")
        return 1

    problems, file_count = scan(root, Path(__file__))

    # Vacuous-pass guard. This repo has dozens of scripts under scripts/.
    # Finding none means a glob or a layout changed and this control would be
    # reporting green on nothing — the SEC-79 failure mode.
    if file_count == 0:
        print(f"::error::No shell scripts found under '{root}/scripts'.")
        print("::error::This check has lost its target — it would be passing vacuously.")
        return 1

    print(f"Scanning {file_count} shell script(s) under scripts/ for bash-4-only constructs…")

    if problems:
        print()
        for problem in problems:
            print(problem)
        print()
        print(f"::error::{len(problems)} bash-4-only construct(s) found.")
        print()
        print("macOS ships bash 3.2, CI ships bash 5. These lines work in CI and")
        print("exit 127 on the machine where releases are prepared — a gate that")
        print("cannot run locally is a weakened gate (BUGS-76, #594).")
        print()
        print(f"Allow-list a genuinely CI-only line with '# {ESCAPE_HATCH} <reason>' plus a Jira key.")
        return 1

    print("Every shell script under scripts/ is bash 3.2-compatible. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
