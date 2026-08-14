#!/usr/bin/env python3
"""BUGS-81: the ops-heartbeat ledger must never be pointed at Confluence 33554434.

There are two Control Rooms and they are easy to conflate:

  34275370  "Lyra — Ops Routines Control Room"      <- carries the Heartbeat /
                                                       Run-ledger table that every
                                                       ops routine appends to, and
                                                       that the routine-watchdog
                                                       reads as its input.
  33554434  "Lyra — Backlog Autopilot Control Room" <- unrelated. Has a section
                                                       called "Run ledger" (the
                                                       autopilot's own), which is
                                                       exactly what makes the
                                                       mistake survivable.

`docs/OPS_ROUTINES_CONTROL_ROOM.md` cited 33554434 as the heartbeat source. An
agent following the doc literally lands on the Backlog Autopilot page, finds no
Heartbeat table, and has two bad options: report `-` for every routine (the
watchdog then says UNVERIFIED across the board — honest but useless), or read
the autopilot's "Run ledger" rows as heartbeats, which is a **false PASS**. The
one control that detects a silently-dead routine is degraded either way. That is
the KAN-167 "reports green while doing nothing" failure mode applied to
monitoring, and the doc fix alone does not stop the next instance — hence this
guard.

## The rules

R1 — co-location. Every occurrence of 33554434 must be disambiguated within
     +/- WINDOW characters, EITHER by the words "Backlog Autopilot" or by naming
     34275370 in the same breath. BUGS-81's acceptance criterion says "only ever
     named alongside Backlog Autopilot"; taken literally that flagged eleven
     sentences in docs/DAILY_SECURITY_CHECK.md, all of them correct and several
     written by the very routine this defect degrades ("read from 34275370, NOT
     the 33554434 the prompt names"). Contrasting the two ids IS disambiguation.
     A sentence naming neither remains ambiguous and still fails.

R2 — heartbeat pointer, IN THE POINTER DOC ONLY (see POINTER_DOCS). A strong
     heartbeat-pointer phrase ("heartbeat ledger", "watchdog reads", ...) within
     +/- NEAR_WINDOW of 33554434 is a violation.
     R2 is not redundant with R1: the sentence "the Backlog Autopilot Control
     Room 33554434 carries the heartbeat ledger" satisfies R1 and is precisely
     the defect.

     R2's first cut used the wide WINDOW and spared any match where 34275370
     also appeared in it. Mutation proof killed that version: repointing the
     single line "Heartbeat / Run-ledger table lives on 34275370" to 33554434 —
     the live defect, in one edit — left the guard GREEN, because the
     disambiguation prose two lines above still named 34275370 and bought the
     exemption. So the exemption is gone and the binding is proximity instead:
     at 60 characters a page id sits inside the same clause as the phrase, which
     is what "this ledger is on that page" actually looks like. A docs-ledger row
     narrating this defect keeps ~140 characters between the two and is spared.
     That mutation is pinned as a fixture below.

     One exemption, added after CI found eleven real instances R2 could not
     read: an explicit NEGATION inside the tight window. "still cites 33554434,
     which has no Heartbeat table" is the exact opposite of a pointer, and it is
     the sentence anyone correcting this defect writes. The mutation stays
     caught because "Heartbeat / Run-ledger table lives on 33554434" carries no
     negation.

R3 — positive assertion. `docs/OPS_ROUTINES_CONTROL_ROOM.md` must state 34275370
     within +/- NEAR_WINDOW of a heartbeat-pointer phrase. R1 and R2 only ever fire on
     a WRONG pointer; R3 is the other direction, and fires on an ABSENT one. A
     control that can only detect the bad value, never its removal, is a
     suppression list with extra steps.

## Two deliberate design choices

**The window is measured in characters across the whole file, not in lines.**
A line-scoped rule was written first and false-positived three times on the
current tree — `docs/OPS_ROUTINES_CONTROL_ROOM.md:7` and `:29` and this repo's
own `scripts/check-ui-copy-ownership.sh:9` all wrap, leaving "Backlog Autopilot"
on the preceding line. All three are pinned as self-test fixtures below. The
CLAUDE.md lesson those cases encode: a grep restricted to a line answers a
narrower question than the one being asked, and the gap is invisible in the
result.

**R2's phrase list is deliberately narrow.** It matches "heartbeat ledger", not
bare "heartbeat", because the routine registry legitimately reads "out of scope
for the ops-heartbeat; has its own Control Room 33554434" and a docs-ledger row
legitimately narrates this very defect. Both are pinned as fixtures. False
positives are worse than failures (KAN-167): a guard that fires on correct prose
teaches people to wave it through, and standing noise on the file that documents
the fix is the surest way to get the fix's own explanation deleted.

**Observed cost, recorded honestly.** This guard fired on its OWN registration
prose the first time it ran: the `controls/registry.json` summary and the
`pr-checks.yml` step comment both put the autopilot page id in the same clause
as "the routine-watchdog reads". That is R2 behaving correctly, not a false
positive — the sentence really did read as pointing the heartbeat at the wrong
page. The fix was to reorder the sentences so each id sits next to the thing it
names, NOT to widen the rule or reach for the escape hatch. Worth knowing before
you write about this defect: name the page you mean, next to the id you mean.

Corpus comes from `git ls-files` — TRACKED state, not disk state. An untracked
scratch file is not part of the repo's claims, and `fs.existsSync`-style disk
checks are how a ratchet stays green on the exact defect it guards.

Exit codes:
  0  every reference is consistent
  1  one or more violations
  2  the scan could not run (no git corpus, empty corpus, anchor doc missing)
     — fail closed, never a clean report over a scan that never happened

Escape hatch: `heartbeat-page-id-ok: <JIRA-KEY> <reason>` on the same line as
the offending id.

Usage:
    python3 scripts/check-heartbeat-page-id.py
    python3 scripts/check-heartbeat-page-id.py --self-test
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

AUTOPILOT_PAGE_ID = "33554434"
OPS_ROUTINES_PAGE_ID = "34275370"

ANCHOR_DOC = "docs/OPS_ROUTINES_CONTROL_ROOM.md"

# R1's co-location window: generous, because "Backlog Autopilot" legitimately
# lands a sentence or two away from the id it disambiguates.
WINDOW = 200

# R2's binding window: tight, because "the heartbeat ledger is on page X" puts
# the phrase and the id in one clause. See the docstring for the mutation that
# forced this to be separate from WINDOW.
NEAR_WINDOW = 60

SCANNED_SUFFIXES = (
    ".md",
    ".sh",
    ".py",
    ".js",
    ".ts",
    ".cjs",
    ".mjs",
    ".json",
    ".yml",
    ".yaml",
)

# This file names both ids many times by construction; scanning it would be
# scanning the guard's own fixtures.
SELF_EXCLUDE = (
    "scripts/check-heartbeat-page-id.py",
    "tests/scripts/check-heartbeat-page-id.test.js",
)

# R2 asks a SEMANTIC question — "does this sentence point the heartbeat ledger
# at the wrong page?" — and that question is only meaningful in a doc that tells
# an agent where to read. It is meaningless in a narrative run-log, where the
# correct thing to write is a report OF the defect: "OPS_ROUTINES_CONTROL_ROOM.md
# names <wrong id> as the heartbeat ledger, but that is the Backlog Autopilot
# Control Room". Three separate rounds of CI chased that prose across
# docs/DAILY_SECURITY_CHECK.md, and the Daily Security routine appends another
# such sentence on every run — so R2 applied estate-wide is permanently red or
# permanently annotated, which is the same thing as switched off.
#
# STATED GAP (KAN-167 says record it rather than hide it): if some doc OTHER
# than the one below starts pointing the heartbeat at the wrong page, only R1
# covers it — and R1 is satisfied by merely naming the right page nearby. That
# is accepted. The realistic re-introduction vector is an edit to the pointer
# doc itself (exactly what BUGS-81 was) or to the stored routine prompt, which
# is outside the repo and which no CI check can see.
POINTER_DOCS = (ANCHOR_DOC,)

ESCAPE_HATCH = "heartbeat-page-id-ok:"

# Tokens that turn a nearby heartbeat phrase into a DENIAL rather than a
# pointer. Matched against the normalised tight window only.
NEGATIONS = (
    " no ",
    " not ",
    " never ",
    " instead of ",
    " rather than ",
)

# Strong pointer phrases only — see the module docstring on why bare
# "heartbeat" is not in this list.
HEARTBEAT_PHRASES = (
    "heartbeat ledger",
    "heartbeat table",
    "heartbeat / run-ledger",
    "heartbeat/run-ledger",
    "heartbeat source",
    "watchdog reads",
)


# Line wraps and markdown decoration sit between the words we match on:
# `*Backlog\n> Autopilot*` is the same phrase as `Backlog Autopilot`, and a
# guard that cannot see that reports a violation on correct prose. Applied to
# both the window and the phrase, so the two are compared on equal terms.
_DECORATION = re.compile(r"[\s>#*_`|]+")


def _norm(s: str) -> str:
    return _DECORATION.sub(" ", s.lower())


def _window(text: str, start: int, end: int, span: int = WINDOW) -> str:
    return text[max(0, start - span) : end + span]


def _line_of(text: str, index: int) -> tuple[int, str]:
    line_no = text.count("\n", 0, index) + 1
    line_start = text.rfind("\n", 0, index) + 1
    line_end = text.find("\n", index)
    if line_end == -1:
        line_end = len(text)
    return line_no, text[line_start:line_end]


def find_violations(text: str, path: str) -> list[str]:
    """R1 everywhere; R2 only on the pointer doc. See POINTER_DOCS."""
    problems: list[str] = []

    for match in re.finditer(AUTOPILOT_PAGE_ID, text):
        line_no, line = _line_of(text, match.start())
        if ESCAPE_HATCH in line:
            continue

        window = _norm(_window(text, match.start(), match.end()))

        # Naming the CORRECT id in the same breath is disambiguation too, and
        # this is how real run-log prose actually reads: "still cites <wrong>,
        # which has no Heartbeat table" / "read from <right> ... NOT <wrong>".
        # Requiring the literal words "Backlog Autopilot" flagged eleven such
        # sentences in docs/DAILY_SECURITY_CHECK.md — every one of them correct,
        # several of them written BY the routine this defect degrades. A guard
        # that punishes writing the explanation down is pointed the wrong way.
        # R1 stays meaningful because a sentence naming neither the page nor the
        # correct id is genuinely ambiguous; R2 is the sharp rule regardless.
        disambiguated = "backlog autopilot" in window or OPS_ROUTINES_PAGE_ID in window
        if not disambiguated:
            problems.append(
                f"{path}:{line_no}: R1 — page {AUTOPILOT_PAGE_ID} is named with neither "
                f'"Backlog Autopilot" nor {OPS_ROUTINES_PAGE_ID} within {WINDOW} characters.\n'
                f"      why: {AUTOPILOT_PAGE_ID} is the Backlog Autopilot Control Room. "
                f"The ops-heartbeat ledger lives on {OPS_ROUTINES_PAGE_ID}.\n"
                f"      fix: name the page it actually is, or cite "
                f"{OPS_ROUTINES_PAGE_ID} if you meant the heartbeat ledger."
            )

        if path not in POINTER_DOCS:
            continue

        near = _norm(_window(text, match.start(), match.end(), NEAR_WINDOW))
        hit = next((p for p in HEARTBEAT_PHRASES if _norm(p) in near), None)
        # "<wrong page>, which has NO Heartbeat table" is the exact opposite of
        # a pointer, and it is the sentence anyone correcting this defect writes.
        # Only an explicit negation inside the TIGHT window earns the exemption,
        # so the mutation this rule exists to catch — "Heartbeat / Run-ledger
        # table lives on <wrong page>" — carries no negation and still fails.
        negated = any(n in near for n in NEGATIONS)
        if hit is not None and not negated:
            problems.append(
                f"{path}:{line_no}: R2 — {AUTOPILOT_PAGE_ID} sits within "
                f'{NEAR_WINDOW} characters of "{hit}", i.e. in the same clause.\n'
                f"      why: this reads as pointing the ops-heartbeat ledger at the "
                f"Backlog Autopilot page — the BUGS-81 defect. The watchdog would "
                f"either report UNVERIFIED for every routine or misread the "
                f"autopilot's own Run-ledger rows as heartbeats (a false PASS).\n"
                f"      fix: cite {OPS_ROUTINES_PAGE_ID} as the heartbeat source."
            )

    return problems


def check_anchor_assertion(text: str) -> list[str]:
    """R3: the anchor doc must positively name its own page as the heartbeat home."""
    for match in re.finditer(OPS_ROUTINES_PAGE_ID, text):
        near = _norm(_window(text, match.start(), match.end(), NEAR_WINDOW))
        if any(_norm(p) in near for p in HEARTBEAT_PHRASES):
            return []
    return [
        f"{ANCHOR_DOC}: R3 — the doc never states {OPS_ROUTINES_PAGE_ID} within "
        f"{NEAR_WINDOW} characters of a heartbeat-pointer phrase.\n"
        f"      why: R1/R2 only fire on a WRONG page id. If the correct pointer is "
        f"simply deleted, nothing else in this guard notices — and an agent with no "
        f"page id falls back to guessing, which is how BUGS-81 happened.\n"
        f"      fix: state plainly that the Heartbeat / Run-ledger table lives on "
        f"page {OPS_ROUTINES_PAGE_ID}."
    ]


def tracked_files(root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [
        f
        for f in result.stdout.split("\0")
        if f and f.endswith(SCANNED_SUFFIXES) and f not in SELF_EXCLUDE
    ]


# --- self-test fixtures -----------------------------------------------------
#
# Cases 3-7 are the ones that keep this guard usable: every one of them is real
# text from the current tree that a naive line-scoped or bare-"heartbeat" rule
# reported as a violation. Case 2 is the defect itself and case 8 is the defect
# in the shape R1 alone cannot see.

_CORRECT = (
    "> **page 34275370**, child of *System Documentation* 19922947. The\n"
    "> Heartbeat / Run-ledger table lives on 34275370, and that is the page the\n"
    "> routine-watchdog reads.\n"
)

_THE_DEFECT = (
    "The Ops Routines Control Room — the page carrying the Heartbeat ledger every\n"
    "routine appends to, and the page the routine-watchdog reads its inputs from —\n"
    "is Confluence 33554434.\n"
)

# docs/OPS_ROUTINES_CONTROL_ROOM.md:7 — "Backlog Autopilot" wraps to the next line.
_WRAPPED_DISAMBIGUATION = (
    "> CI/offline mirror.** **Do not confuse 34275370 with 33554434** — the latter is\n"
    "> the unrelated *Backlog Autopilot* Control Room (BUGS-81); this doc's own\n"
    "> Heartbeat / Run-ledger table lives on 34275370.\n"
)

# docs/OPS_ROUTINES_CONTROL_ROOM.md:29 — the phrase precedes the id, across a wrap.
_WRAPPED_MODELLED_ON = (
    "health-check) had no run-log at all. Modelled on the **Backlog Autopilot\n"
    "Control Room** (a *different*, unrelated Confluence page, 33554434 — never\n"
    "this doc's own page, 34275370): Config + Registry + Heartbeat ledger.\n"
)

# scripts/check-ui-copy-ownership.sh:9 — a guard header, id 130 chars after the phrase.
_GUARD_HEADER = (
    "# must be FOUNDER-INITIATED, and the Backlog Autopilot must skip it (see\n"
    '# CLAUDE.md "LOOK AND TEXT", the autopilot House rules 9/10 on Confluence\n'
    "# Control Room 33554434, and the `ui-approval-required` Jira label). Until now\n"
)

# The registry row: "ops-heartbeat" appears, but as an out-of-scope note.
_REGISTRY_ROW = (
    "| Backlog Autopilot | `trig_01HniS6vXfGEFR4gvJaLNTM9` | **backlog execution** "
    "(out of scope for the ops-heartbeat; has its own Control Room 33554434) | "
    "`20 3,9,15,21 * * *` | — | Backlog Autopilot Control Room 33554434 |\n"
)

# A docs ledger row narrating the BUGS-81 fix — correct prose naming both ids.
_LEDGER_PROSE = (
    "**BUGS-81** (partial fix): the doc never stated its own Confluence page ID "
    "(34275370) while repeatedly citing the unrelated Backlog Autopilot's 33554434 "
    "in the same intro section — an agent following the doc literally could misread "
    'the Autopilot\'s "Run ledger" as the ops heartbeat ledger (false-PASS risk).\n'
)

# R1 passes (the phrase is right there); R2 is what catches this.
_PLAUSIBLE_CONFLATION = (
    "The Backlog Autopilot Control Room 33554434 carries the heartbeat ledger that\n"
    "every ops routine appends to at the end of its run.\n"
)

# The mutation that defeated R2's first cut: ONE line of the anchor doc
# repointed, with the disambiguation prose above it left intact. R1 is spared
# ("Backlog Autopilot" is two lines up) and the old R2 was spared too (34275370
# was still in its 200-char window). This fixture is why NEAR_WINDOW exists.
_ONE_LINE_REPOINT = (
    "> **page 34275370**, child of *System Documentation* 19922947. **Do not\n"
    "> confuse 34275370 with 33554434** — the latter is the unrelated *Backlog\n"
    "> Autopilot* Control Room (BUGS-81); this doc's own\n"
    "> Heartbeat / Run-ledger table lives on 33554434, and that is the page the\n"
    "> routine-watchdog reads.\n"
)

# Two REAL sentences from docs/DAILY_SECURITY_CHECK.md that CI flagged and the
# self-test did not. Both are correct prose — written by the Daily Security
# routine while working around this very defect — and each defeats a different
# rule: the first has no "Backlog Autopilot" (R1) and denies a heartbeat table
# rather than pointing at one (R2); the second contrasts the two ids directly.
_RUNLOG_DENIAL = (
    "`routine-watchdog.sh` (fed from the corrected Ops Routines Control Room "
    "page **34275370** per BUGS-81 — the stored routine prompt still cites "
    "33554434, which has no Heartbeat table): **PASS=3 FAIL=3 UNVERIFIED=0**\n"
)

_RUNLOG_CONTRAST = (
    "read the full 38-row Heartbeat table on the Ops Routines Control Room "
    "(Confluence page **34275370**, the correct ID per **BUGS-81** — NOT "
    "33554434) covering 2026-07-23 to 2026-08-12 and found zero rows.\n"
)

_ESCAPED = (
    "A historical quote reproduced verbatim: 33554434  "
    "<!-- heartbeat-page-id-ok: BUGS-81 quoting the original defect -->\n"
)

_BARE = "See Confluence page 33554434 for the ledger format.\n"

_CASES: list[tuple[str, str, int]] = [
    ("the correct pointer passes", _CORRECT, 0),
    ("the BUGS-81 defect itself is caught", _THE_DEFECT, 2),
    ("wrapped disambiguation line (OPS doc :7) is NOT caught", _WRAPPED_DISAMBIGUATION, 0),
    ("wrapped 'modelled on' line (OPS doc :29) is NOT caught", _WRAPPED_MODELLED_ON, 0),
    ("a guard's own header comment is NOT caught", _GUARD_HEADER, 0),
    ("'out of scope for the ops-heartbeat' registry row is NOT caught", _REGISTRY_ROW, 0),
    ("prose narrating the BUGS-81 fix is NOT caught", _LEDGER_PROSE, 0),
    ("R2 catches the conflation R1 cannot see", _PLAUSIBLE_CONFLATION, 1),
    (
        "a ONE-LINE repoint with the disambiguation left intact is caught "
        "(the mutation that defeated R2's first cut)",
        _ONE_LINE_REPOINT,
        1,
    ),
    ("real run-log prose DENYING a heartbeat table is NOT caught", _RUNLOG_DENIAL, 0),
    ("real run-log prose CONTRASTING the two ids is NOT caught", _RUNLOG_CONTRAST, 0),
    ("the escape hatch suppresses exactly its own line", _ESCAPED, 0),
    ("a bare id with no disambiguation is caught", _BARE, 1),
]

_ANCHOR_CASES: list[tuple[str, str, int]] = [
    ("an anchor doc asserting its own page passes R3", _CORRECT, 0),
    (
        "an anchor doc that never names its page fails R3",
        "# Ops Routines Control Room\n\nThe heartbeat ledger lives on the wiki.\n",
        1,
    ),
    (
        "naming the id far from any heartbeat phrase does not satisfy R3",
        "# Ops Routines\n\nPage 34275370.\n\n" + ("filler line\n" * 60) + "The heartbeat ledger is on the wiki.\n",
        1,
    ),
]


# R2 is scoped to the pointer doc, so the scoping itself needs its own cases —
# otherwise "R2 fires" and "R2 fires anywhere" are indistinguishable, and the
# day someone widens POINTER_DOCS nothing would notice.
_SCOPE_CASES: list[tuple[str, str, str, int]] = [
    (
        "R2 fires on the pointer doc",
        _PLAUSIBLE_CONFLATION,
        ANCHOR_DOC,
        1,
    ),
    (
        "the SAME text in a narrative run-log is NOT caught (R2 out of scope)",
        _PLAUSIBLE_CONFLATION,
        "docs/DAILY_SECURITY_CHECK.md",
        0,
    ),
    (
        "a run-log FILING the defect is NOT caught",
        "**New finding -> BUGS-81:** docs/OPS_ROUTINES_CONTROL_ROOM.md names "
        "Confluence **33554434** as the Ops Routines Control Room / heartbeat "
        "ledger, but 33554434 is the *Backlog Autopilot* Control Room; the real "
        "page is **34275370**.\n",
        "docs/DAILY_SECURITY_CHECK.md",
        0,
    ),
    (
        "R1 still applies off the pointer doc — an undisambiguated id is caught",
        _BARE,
        "docs/DAILY_SECURITY_CHECK.md",
        1,
    ),
]


def self_test() -> int:
    # Failure mode #4: a parameterised run over an empty corpus registers zero
    # cases and reports green. Assert the corpus before iterating it.
    if len(_CASES) < 12 or len(_SCOPE_CASES) < 4 or len(_ANCHOR_CASES) < 3:
        print("::error::check-heartbeat-page-id self-test: fixture list is truncated.")
        return 1

    failures = 0

    for label, source, expected in _CASES:
        found = len(find_violations(source, ANCHOR_DOC))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected}, got {found})")
        if not ok:
            failures += 1

    for label, source, path, expected in _SCOPE_CASES:
        found = len(find_violations(source, path))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected}, got {found})")
        if not ok:
            failures += 1

    for label, source, expected in _ANCHOR_CASES:
        found = len(check_anchor_assertion(source))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected}, got {found})")
        if not ok:
            failures += 1

    # Failure mode #9 (SEC-140): the verdict is read HERE, after every case has
    # appended to it. Anything added below this line would never be evaluated.
    if failures:
        print(f"::error::check-heartbeat-page-id self-test: {failures} case(s) failed.")
        return 1

    total = len(_CASES) + len(_SCOPE_CASES) + len(_ANCHOR_CASES)
    print(f"Self-test: all {total} fixture case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="BUGS-81 heartbeat page-id guard")
    parser.add_argument("--root", default=".")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    root = Path(args.root)
    if not root.is_dir():
        print(f"::error::root directory '{root}' not found. Failing closed.")
        return 2

    files = tracked_files(root)
    if not files:
        print(
            "::error::check-heartbeat-page-id: `git ls-files` returned no scannable "
            "files, so the scan never ran. Failing closed (exit 2) rather than "
            "reporting a clean result over an empty corpus."
        )
        return 2

    anchor = root / ANCHOR_DOC
    if not anchor.is_file():
        print(
            f"::error::check-heartbeat-page-id: anchor doc {ANCHOR_DOC} is missing. "
            "It is the file this guard exists to protect; failing closed."
        )
        return 2

    problems: list[str] = []
    for rel in files:
        try:
            text = (root / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        problems.extend(find_violations(text, rel))

    problems.extend(check_anchor_assertion(anchor.read_text(encoding="utf-8")))

    if problems:
        print(
            f"::error::check-heartbeat-page-id: {len(problems)} violation(s). "
            "The ops-heartbeat ledger lives on Confluence "
            f"{OPS_ROUTINES_PAGE_ID}; {AUTOPILOT_PAGE_ID} is the Backlog Autopilot "
            "Control Room (BUGS-81)."
        )
        for p in problems:
            print(f"  {p}")
        return 1

    print(
        f"Heartbeat page-id references are consistent across {len(files)} tracked "
        f"file(s): {AUTOPILOT_PAGE_ID} is always disambiguated, and {ANCHOR_DOC} "
        f"states {OPS_ROUTINES_PAGE_ID} as the heartbeat source. ✓"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
