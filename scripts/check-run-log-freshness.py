#!/usr/bin/env python3
"""CTL-062 — every routine run-log still carries FRESH evidence.

WHY THIS EXISTS
---------------
SEC-146. The three scheduled routines each end a run by opening a PR that
appends one row to their run-log table in `docs/`. Almost none of those PRs ever
merged: ~24 accumulated between 2026-08-05 and 2026-08-14 and the repo lost ten
days of routine evidence across all three logs.

The mechanical cause was narrow and complete — **every one of those PRs was
opened as a DRAFT.** A draft cannot auto-merge and cannot be merged at all until
a human marks it ready, so the routines were doing exactly what they were told
and what they were told terminated in a state nothing could advance. Not a
discipline failure; a dead end. The 27 orphaned rows were backfilled in PR #800.

WHAT MAKES THIS DIFFERENT FROM EVERY OTHER ROUTINE CONTROL
----------------------------------------------------------
Every existing one asks *"did the routine run?"* — the Confluence heartbeat, the
`routine-watchdog.sh` overdue detector, CTL-042's workflow-liveness check. **Not
one asks "did its output survive?"** Those are different questions, and the
second is the one that matters when someone asks what you knew and when.

Throughout the ten-day gap the watchdog was correct and green: the routines were
running and heartbeating. The evidence simply never reached the repository. So
this control reads the DURABLE ARTEFACT rather than any signal of execution.

⚠️ AND IT LIVES IN THE REPO, NOT INSIDE A ROUTINE. A check a routine performs on
itself dies with that routine — which is the SEC-79 shape one level up, and is
why the Confluence-side heartbeat could not have caught this. The repo run-log
is also the copy that survives a wiki incident (BUGS-100 wiped the Control Room
page on 2026-08-13; the repo mirror should have been the fallback and was ten
days stale).

WHAT IT ASSERTS
---------------
For each routine: the NEWEST dated row in its run-log table is within that
routine's own cadence budget, where the budget is read from the watchdog
registrations already published in `docs/OPS_ROUTINES_CONTROL_ROOM.md` in the
form `<name>|<budget-minutes>|<iso>|<outcome>`. **Budgets are never invented
here.** A routine with no registration is reported as unmeasurable, not guessed.

EXIT CODES (the SEC-109 contract)
---------------------------------
    0  every run-log measured, every one fresh
    1  measured, and at least one is STALE          -> "I checked and it is stale"
    2  at least one could NOT be measured           -> "I could not check"

⚠️ 2 OUTRANKS 1 WHEN BOTH OCCUR, and every finding of both kinds is printed
either way. An incomplete scan reported as a completed one is the exact defect
this control family exists to stop, so the process-level claim degrades to the
weaker of the two. Nothing is lost: the summary states both counts.

⚠️ THE TWO WORDINGS ARE DELIBERATELY DISJOINT. CTL-059's lesson is that a
finding must describe the failure it actually had. "I could not check" and "I
checked and it is stale" are different claims about the world and must not read
alike, so the STALE path never says "not measured" and the fail-closed path
never says "stale". A self-test fixture pins that separation.

HOW FRESHNESS IS MEASURED, AND THE ONE PLACE THIS IS DELIBERATELY GENEROUS
--------------------------------------------------------------------------
Run-log rows carry a DATE, not a timestamp. Two of the three logs have no time
of day at all; the third (`STAGING_SOAK_ROUTINE.md`) carries an `HH:MM` with **no
zone marker** despite its column header saying UTC, so trusting it would mean
trusting an untagged timestamp.

So a row dated D is treated as evidence produced at the **END** of day D
(23:59:59Z) — the most generous instant consistent with the cell. That is a
stated weakening: a daily routine can be roughly a day and a half quiet before
this fires. It is the right trade, because the alternative (start-of-day) invents
findings out of intra-day timing nobody recorded, and the Workflow & Backup
Integrity Policy forbids a false FAIL as firmly as a false PASS. The defect this
exists to catch was TEN DAYS wide.

⚠️ FRESHNESS IS `max(date)`, NOT "the last row". The three logs do not agree on
ordering — DAILY_SECURITY_CHECK and WEEKLY_HEALTH_REGRESSION append at the
bottom, STAGING_SOAK prepends at the top — and DAILY_SECURITY_CHECK's tail is
GENUINELY out of chronological order (2026-07-25, 2026-07-28, 2026-07-27). Those
are dated measurements. Re-sorting them to make a positional parser work would be
editing evidence while claiming to tidy it; an earlier attempt at the backfill
did exactly that and was thrown away. `max` is the only reading of "newest
evidence present" that is independent of position, so the oddity needs no fix and
gets none.

The cost of `max` is that one forward-dated row would mask any amount of
staleness forever, so a row dated after today is itself reported. That is the
only reason the future case exists.

PARSING NOTES — three real shapes this must tolerate
-----------------------------------------------------
1. `WEEKLY_HEALTH_REGRESSION_ROUTINE.md` has a BLANK LINE inside its table
   (line 146 at the time of writing). Per CommonMark that terminates the table,
   so a markdown-AST parser sees the log ending at 2026-08-06 and misses every
   row after it — reporting a fresh log as eight days stale. The scan therefore
   continues past blank lines and stops only at a heading.
2. The run-log is never the FIRST table in its file. DAILY_SECURITY_CHECK.md has
   six tables and the run log is the sixth; the other two both open with an
   identically-shaped "How the run is split" table. Anchoring on the first line
   beginning with a pipe reads the wrong table and reports a document authored in
   June as the newest evidence. Each log is located by its own header text.
3. Several rows contain unescaped `|` inside backticked cells, so splitting a row
   on pipes yields 7 or 9 columns instead of 6. The date is therefore extracted
   by anchoring on the START of the row, which no later cell can disturb.

USAGE
    python3 scripts/check-run-log-freshness.py
    python3 scripts/check-run-log-freshness.py --self-test
    python3 scripts/check-run-log-freshness.py --root /path/to/tree
    python3 scripts/check-run-log-freshness.py --now 2026-08-14T12:00:00Z
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

# The Control Room mirror carries the watchdog registrations this control reads
# its budgets from. It is the file `scripts/routine-watchdog.sh` is invoked from,
# so the two controls cannot drift onto different numbers.
CONTROL_ROOM = "docs/OPS_ROUTINES_CONTROL_ROOM.md"


class Routine:
    """One routine: where its evidence lands, and how to find the table."""

    def __init__(self, watchdog_name: str, run_log: str, header_anchor: str,
                 ordering: str) -> None:
        self.watchdog_name = watchdog_name
        self.run_log = run_log
        self.header_anchor = header_anchor
        self.ordering = ordering


# The subject of the control. Each anchor is the literal opening of that log's
# run-log header row — enough of it to be unique within its own file, and no
# more, so a new trailing column does not silently un-anchor the scan.
#
# `ordering` is recorded for the reader and is deliberately NOT used to pick the
# newest row (see the header): it documents why a positional parser would need
# three different rules and still get DAILY_SECURITY_CHECK.md wrong.
ROUTINES = (
    Routine(
        watchdog_name="daily-security",
        run_log="docs/DAILY_SECURITY_CHECK.md",
        # "\N{LARGE RED CIRCLE}" is the 3rd column's heading. Written as an escape
        # so this file stays ASCII and the anchor survives a copy-paste through a
        # tool that mangles emoji.
        header_anchor="| Date | Runner | \N{LARGE RED CIRCLE}",
        ordering="ascending — appended at the bottom",
    ),
    Routine(
        watchdog_name="staging-soak",
        run_log="docs/STAGING_SOAK_ROUTINE.md",
        header_anchor="| Date (UTC) | Runner | PASS/FAIL",
        ordering="descending — prepended at the top",
    ),
    Routine(
        watchdog_name="weekly-health",
        run_log="docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md",
        header_anchor="| Date | Runner | Suite result",
        ordering="ascending — appended at the bottom, and a '## Self-update log' "
                 "section follows the table",
    ),
)

# A run-log row: a pipe, optional space, an ISO date. Anchored at the start of
# the line so an unescaped pipe later in the row cannot shift the match.
DATE_ROW_RE = re.compile(r"^\|\s*(\d{4}-\d{2}-\d{2})")

# A GFM table separator: pipes, dashes, colons and spaces only.
SEPARATOR_RE = re.compile(r"^\|[\s:|-]+\|$")

# A watchdog registration as published in the Control Room, e.g.
#   'staging-soak|1740|2026-07-27T04:16:00Z|PASS'
# The leading quote is load-bearing: it excludes the format SPECIFICATION line
# (`<name>|<max_age_minutes>|...`), which is prose about the shape rather than an
# instance of it.
REGISTRATION_RE = re.compile(r"'([a-z][a-z0-9-]*)\|(\d+)\|")


def humanise(minutes: int) -> str:
    """1800 -> '30h'. 11520 -> '8d'. For the reader; never parsed back."""
    if minutes % 1440 == 0:
        return f"{minutes // 1440}d"
    if minutes % 60 == 0:
        return f"{minutes // 60}h"
    return f"{minutes}m"


def span(minutes: float) -> str:
    """A duration for a human. Days once it stops being readable in hours.

    Clamped at zero: a row dated TODAY has an end-of-day evidence instant that
    has not arrived yet, so the raw arithmetic is negative. Printing '-6h old'
    invites the reader to distrust the whole line.
    """
    minutes = max(0.0, minutes)
    if minutes >= 2880:
        return f"{minutes / 1440:.1f}d"
    return f"{minutes / 60:.0f}h"


def read_text(path: Path) -> tuple[str | None, str | None]:
    """(text, error). Asserts the precondition DIRECTLY rather than inferring it.

    Gotcha #30: a guard that decides "the file was read" from the absence of an
    exception can report a clean scan having read nothing. `is_file()` and an
    explicit read-permission test are dialect- and platform-independent and are
    checked before anything is parsed.
    """
    if not path.exists():
        return None, f"{path} does not exist"
    if not path.is_file():
        return None, f"{path} exists but is not a regular file"
    if not os.access(path, os.R_OK):
        return None, f"{path} exists but is not readable"
    try:
        return path.read_text(encoding="utf-8"), None
    except (OSError, UnicodeDecodeError) as exc:
        return None, f"{path} could not be decoded as UTF-8 text ({exc})"


def parse_budgets(text: str) -> dict[str, set[int]]:
    """Every watchdog registration in the Control Room, name -> {minutes}.

    A set rather than an int so that two registrations disagreeing about the
    same routine is a visible ambiguity instead of a silent last-one-wins.
    """
    budgets: dict[str, set[int]] = {}
    for name, minutes in REGISTRATION_RE.findall(text):
        budgets.setdefault(name, set()).add(int(minutes))
    return budgets


def parse_run_log(text: str, anchor: str) -> tuple[list[tuple[date, int]], str | None]:
    """(rows, error). Rows are (date, 1-based line number), unordered.

    Everything the scan tolerates is tolerated deliberately; see the module
    header. Everything it refuses, it refuses with a reason.
    """
    lines = text.split("\n")

    header_at = [i for i, line in enumerate(lines) if line.startswith(anchor)]
    if not header_at:
        return [], (f"no run-log table found — no line starts with {anchor!r}. "
                    f"The table was renamed, reordered or removed")
    if len(header_at) > 1:
        at = ", ".join(str(i + 1) for i in header_at)
        return [], (f"{len(header_at)} lines start with {anchor!r} (lines {at}), "
                    f"so the run-log table cannot be identified unambiguously")

    # The separator must be the next non-blank line. Requiring it is what stops
    # a paragraph that merely opens with the same words being read as a table.
    i = header_at[0] + 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or not SEPARATOR_RE.match(lines[i].strip()):
        found = lines[i].strip() if i < len(lines) else "<end of file>"
        return [], (f"the line after the run-log header is not a table separator "
                    f"(found {found[:60]!r})")

    rows: list[tuple[date, int]] = []
    undated = 0
    for k in range(i + 1, len(lines)):
        line = lines[k]
        if line.startswith("#"):
            break                      # a heading ends the table
        if not line.strip():
            continue                   # ⚠️ a blank line does NOT end it — see note 1
        if not line.startswith("|"):
            continue                   # stray prose between rows: tolerated
        match = DATE_ROW_RE.match(line)
        if not match:
            undated += 1
            continue
        try:
            rows.append((date.fromisoformat(match.group(1)), k + 1))
        except ValueError:
            undated += 1               # e.g. 2026-13-45: shaped like a date, isn't one

    if not rows:
        # Catalogue failure mode 4, at the level that matters most here: a table
        # located but empty would otherwise make `max()` raise, or — worse, in a
        # more forgiving implementation — report a clean result over no evidence.
        return [], (f"the run-log table was located but contains NO dated rows "
                    f"({undated} row(s) present with an unreadable first cell)")

    return rows, None


class Finding:
    """One routine's verdict. `kind` drives both the wording and the exit code."""

    def __init__(self, kind: str, lines: list[str]) -> None:
        self.kind = kind               # "fresh" | "stale" | "future" | "unmeasured"
        self.lines = lines


def assess(routine: Routine, root: Path, budgets: dict[str, set[int]],
           now: datetime) -> Finding:
    def unmeasured(reason: str) -> Finding:
        # ⚠️ This vocabulary is reserved. It must never overlap the stale path's:
        # "I could not check" and "I checked and it is stale" are different claims.
        return Finding("unmeasured", [
            f"::error::check-run-log-freshness: NOT MEASURED for "
            f"{routine.watchdog_name} — {reason}.",
            f"::error::  No freshness claim is made about {routine.run_log}, in "
            f"either direction. Failing closed rather than reporting a result "
            f"for a file that was never read.",
        ])

    declared = budgets.get(routine.watchdog_name)
    if not declared:
        return unmeasured(
            f"no watchdog registration for '{routine.watchdog_name}' in "
            f"{CONTROL_ROOM}, so its cadence budget is unknown and this control "
            f"will not invent one"
        )
    if len(declared) > 1:
        listed = ", ".join(str(m) for m in sorted(declared))
        return unmeasured(
            f"{CONTROL_ROOM} registers '{routine.watchdog_name}' with conflicting "
            f"budgets ({listed} minutes), so which one applies is undecided"
        )
    budget = next(iter(declared))

    text, error = read_text(root / routine.run_log)
    if error is not None:
        return unmeasured(error)

    rows, error = parse_run_log(text, routine.header_anchor)
    if error is not None:
        return unmeasured(f"{routine.run_log}: {error}")

    newest, line_no = max(rows)
    today = now.date()

    if newest > today:
        # Not staleness, but it defeats the staleness measurement, so it is a
        # finding rather than a warning: one forward-dated row would hold this
        # control green for as long as it sat there.
        return Finding("future", [
            f"::error::{routine.watchdog_name} run-log's newest row is dated "
            f"{newest.isoformat()}, which is AHEAD of today ({today.isoformat()}).",
            f"::error::  {routine.run_log}:{line_no}. Freshness is read as the "
            f"newest dated row, so a forward-dated row would report this log fresh "
            f"for as long as it remains — it cannot be measured past.",
        ])

    # A date, not a timestamp: treat the row as evidence produced at the END of
    # its day. The most generous instant the cell can support (see header).
    produced = datetime.combine(newest, time(23, 59, 59), tzinfo=timezone.utc)
    age_minutes = (now - produced).total_seconds() / 60.0

    if age_minutes > budget:
        over = age_minutes - budget
        return Finding("stale", [
            f"::error::{routine.watchdog_name} run-log is STALE. Newest row in "
            f"{routine.run_log} is dated {newest.isoformat()} (line {line_no}), "
            f"{(today - newest).days} day(s) ago.",
            f"::error::  That evidence is {span(age_minutes)} old against a "
            f"{budget}m ({humanise(budget)}) cadence budget — {span(over)} past it.",
            f"::error::  The routine may well be running: this control reads the "
            f"OUTPUT, not the run. SEC-146 is the case where it ran daily for ten "
            f"days and none of the evidence reached the repository, because every "
            f"run-log PR was opened as a DRAFT and a draft cannot merge.",
            f"::error::  Fix: land the outstanding run-log rows on develop, oldest "
            f"first, preserving each row's original date and content verbatim.",
        ])

    return Finding("fresh", [
        f"{routine.watchdog_name}: {routine.run_log} newest row "
        f"{newest.isoformat()} (line {line_no}), {(today - newest).days} day(s) "
        f"ago; budget {budget}m ({humanise(budget)}), "
        f"{span(budget - age_minutes)} of margin left. FRESH"
    ])


def check(root: Path, now: datetime) -> int:
    # Assert the corpus BEFORE iterating it. An empty tuple here would register
    # zero checks and print a clean summary (catalogue failure mode 4) — the
    # exact shape this control was built to detect in someone else's code.
    if not ROUTINES:
        print("::error::check-run-log-freshness: the routine list is EMPTY, so "
              "nothing was checked.")
        print("::error::  Refusing to report a clean result over an empty corpus.")
        return 2

    room_text, error = read_text(root / CONTROL_ROOM)
    if error is not None:
        print(f"::error::check-run-log-freshness: NOT MEASURED for any routine — "
              f"{error}.")
        print(f"::error::  {CONTROL_ROOM} is where every cadence budget is "
              f"declared. Without it no budget is known, and this control will "
              f"not substitute a default for a number the estate publishes.")
        return 2

    budgets = parse_budgets(room_text)
    if not budgets:
        print(f"::error::check-run-log-freshness: NOT MEASURED for any routine — "
              f"{CONTROL_ROOM} contains no watchdog registrations at all.")
        print(f"::error::  Expected at least one entry shaped "
              f"'<name>|<minutes>|<iso>|<outcome>'. Either the file changed shape "
              f"or this control's reader has drifted from it; both are findings, "
              f"and neither is a clean result.")
        return 2

    findings = [assess(r, root, budgets, now) for r in ROUTINES]

    for finding in findings:
        for line in finding.lines:
            print(line)

    stale = [f for f in findings if f.kind in ("stale", "future")]
    unmeasured = [f for f in findings if f.kind == "unmeasured"]
    total = len(findings)

    print("")
    if unmeasured:
        print(f"::error::SCAN INCOMPLETE: {len(unmeasured)} of {total} run-logs "
              f"could not be measured ({len(stale)} of the rest are stale).")
        print("::error::  Exiting 2 rather than 1: an incomplete scan reported as "
              "a completed one is the failure this control family exists to stop, "
              "so the weaker claim wins even when a real finding is also present.")
        return 2
    if stale:
        print(f"Checked {total} run-logs against the cadence budgets published in "
              f"{CONTROL_ROOM}: {len(stale)} stale.")
        print("::error::A routine whose evidence stops reaching the repository is "
              "a routine whose results are being discarded — materially worse than "
              "not running it, because the Control Room still reports PASS.")
        return 1

    print(f"All {total} routine run-logs carry evidence within their cadence "
          f"budgets. Checked against {CONTROL_ROOM}.")
    return 0


# --------------------------------------------------------------------------
# Self-test. Every case drives the REAL script as a subprocess against a
# synthetic tree (CTL-038: never a reimplementation of the subject), so the
# parsing, the budget lookup, the wording and the exit codes are all exercised
# together rather than a stub of any of them.
# --------------------------------------------------------------------------
FIXTURE_ROOM = """# Control Room fixture

```bash
bash scripts/routine-watchdog.sh \\
  'daily-security|1800|2026-08-14T01:00:00Z|PASS' \\
  'staging-soak|1740|2026-08-14T04:12:00Z|PASS' \\
  'weekly-health|11520|2026-08-10T06:30:00Z|PASS'
```
"""


def _fixture_log(routine: Routine, rows: list[str], *, decoy: bool = True,
                 trailer: bool = True) -> str:
    """A synthetic run-log with the same hazards as the real ones."""
    parts = []
    if decoy:
        # Every real log opens with a different table. A parser that takes the
        # first one reads a document authored in June as the newest evidence.
        parts += ["# fixture", "", "## How the run is split", "",
                  "| Layer | Driven by | Covers |", "|---|---|---|",
                  "| 2026-01-01 | decoy | this row must never be read |", ""]
    parts += ["## Run log", "", routine.header_anchor + " | x | y | z |",
              "|---|---|---|---|---|---|"] + rows
    if trailer:
        # WEEKLY_HEALTH_REGRESSION_ROUTINE.md's shape: a heading and a bullet
        # list after the table, whose dates must not be counted as run rows.
        parts += ["", "## Self-update log", "",
                  "- **2027-01-01** — a bullet, not a row; never counted"]
    return "\n".join(parts) + "\n"


def self_test() -> int:
    import subprocess
    import tempfile

    results: list[tuple[str, bool]] = []

    def case(name: str, got, want) -> None:
        results.append((f"{name} (got {got!r}, want {want!r})", got == want))

    def row(d: str, extra: str = "") -> str:
        return f"| {d} | runner | PASS | ok | none | notes{extra} |"

    def make_tree(logs: dict[str, list[str] | None] | None = None,
                  room: str | None = FIXTURE_ROOM, **kwargs) -> str:
        """A tree with all three logs fresh at 2026-08-14 unless overridden.

        A log mapped to None is omitted entirely; mapping it to a list replaces
        its rows.
        """
        logs = logs or {}
        d = tempfile.mkdtemp(prefix="ctl062-")
        (Path(d) / "docs").mkdir()
        if room is not None:
            (Path(d) / CONTROL_ROOM).write_text(room, encoding="utf-8")
        for routine in ROUTINES:
            rows = logs.get(routine.watchdog_name, [row("2026-08-14")])
            if rows is None:
                continue
            (Path(d) / routine.run_log).write_text(
                _fixture_log(routine, rows, **kwargs), encoding="utf-8")
        return d

    def run(root: str, *args: str):
        return subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--root", root,
             "--now", "2026-08-14T12:00:00Z", *args],
            capture_output=True, text=True,
        )

    def out(r) -> str:
        return r.stdout + r.stderr

    # 1. The happy path. Without this, "stale fails" would also be satisfied by
    #    a checker that fails unconditionally, and the suite would prove nothing.
    r = run(make_tree())
    case("a fresh corpus PASSES", r.returncode, 0)

    # 2-3. THE DEFECT THIS PINS. daily-security's budget is 1800m (30h); a row
    #      dated 2026-08-12 is ~36h old at the pinned clock.
    r = run(make_tree({"daily-security": [row("2026-08-12")]}))
    case("an AGED newest row FAILS", r.returncode, 1)
    case("...and the finding says STALE", "is STALE" in out(r), True)
    case("...and names SEC-146's cause so the reader knows where to look",
         "DRAFT" in out(r), True)

    # 4. The gate is not always-fire in the other direction either: one day
    #    older than the fresh case must still pass inside a 30h budget.
    r = run(make_tree({"daily-security": [row("2026-08-13")]}))
    case("a row one day old still passes inside a 30h budget", r.returncode, 0)

    # 5-7. Fail-closed, and the wording separation CTL-059 asks for.
    r = run(make_tree({"staging-soak": None}))
    case("a MISSING run-log exits 2", r.returncode, 2)
    case("...and says NOT MEASURED", "NOT MEASURED" in out(r), True)
    case("...and does NOT borrow the stale wording",
         "is STALE" in out(r), False)

    # 8. Unreadable rather than absent. A directory where a file belongs is
    #    deterministic on every platform and as root, which `chmod 000` is not.
    d = make_tree({"weekly-health": None})
    (Path(d) / ROUTINES[2].run_log).mkdir()
    r = run(d)
    case("a run-log that is not a regular file exits 2", r.returncode, 2)

    # 9. Conversely the stale path must not borrow the fail-closed wording.
    r = run(make_tree({"weekly-health": [row("2026-01-01")]}))
    case("a stale finding does NOT say NOT MEASURED",
         "NOT MEASURED" in out(r), False)

    # 10-11. The budget source. A routine with no registration is reported, never
    #        guessed — the whole reason budgets are read rather than hard-coded.
    room_missing_soak = FIXTURE_ROOM.replace(
        "  'staging-soak|1740|2026-08-14T04:12:00Z|PASS' \\\n", "")
    r = run(make_tree(room=room_missing_soak))
    case("an UNREGISTERED routine exits 2 rather than assuming a budget",
         r.returncode, 2)
    case("...and says the budget is unknown",
         "cadence budget is unknown" in out(r), True)

    # 12. Two registrations disagreeing is an ambiguity, not a last-one-wins.
    r = run(make_tree(room=FIXTURE_ROOM + "\n'staging-soak|60|-|PASS'\n"))
    case("CONFLICTING budgets for one routine exit 2", r.returncode, 2)

    # 13. No Control Room at all.
    r = run(make_tree(room=None))
    case("a missing Control Room exits 2", r.returncode, 2)

    # 14. A Control Room present but carrying no registrations — the shape-drift
    #     case. Reading zero budgets must not read as three clean results.
    r = run(make_tree(room="# no registrations here\n"))
    case("a Control Room with NO registrations exits 2", r.returncode, 2)

    # 15. ⚠️ THE WEEKLY_HEALTH SHAPE. A blank line inside the table terminates it
    #     for CommonMark, so an AST parser sees only the rows above it and calls a
    #     fresh log stale. The newest row here is BELOW the blank line.
    r = run(make_tree({"weekly-health": [row("2026-08-01"), "",
                                         row("2026-08-14")]}))
    case("a BLANK LINE inside the table does not truncate the scan",
         r.returncode, 0)

    # 16. ⚠️ DAILY_SECURITY_CHECK's genuinely out-of-order tail. The newest date
    #     is not the last row. Re-sorting the real file is forbidden, so the
    #     control must not need it sorted.
    r = run(make_tree({"daily-security": [row("2026-08-14"), row("2026-07-28"),
                                          row("2026-07-27")]}))
    case("an OUT-OF-ORDER tail is read by max(date), not by position",
         r.returncode, 0)

    # 17. The descending log, whose newest row is the FIRST one.
    r = run(make_tree({"staging-soak": [row("2026-08-14 04:18"),
                                        row("2026-08-13 04:14")]}))
    case("a DESCENDING log reads its newest row correctly", r.returncode, 0)

    # 18. The decoy table above the run log carries a 2026-01-01 row. Reading it
    #     would report every log as years stale.
    r = run(make_tree())
    case("the DECOY first table is not mistaken for the run log",
         "2026-01-01" in out(r), False)

    # 19. The bullet list after '## Self-update log' is dated 2027 and is not a
    #     table row. Counting it would report a stale log as fresh AND as future.
    r = run(make_tree({"daily-security": [row("2026-08-12")]}))
    case("rows after the trailing heading are not counted", r.returncode, 1)

    # 20. Empty table: located, but no dated rows. Must not report clean.
    r = run(make_tree({"staging-soak": []}))
    case("a run-log table with NO dated rows exits 2", r.returncode, 2)

    # 21. Header renamed out from under the anchor.
    d = make_tree()
    p = Path(d) / ROUTINES[1].run_log
    p.write_text(p.read_text(encoding="utf-8").replace(
        ROUTINES[1].header_anchor, "| When | Who | Verdict"), encoding="utf-8")
    r = run(d)
    case("a RENAMED run-log header exits 2 rather than passing vacuously",
         r.returncode, 2)

    # 22. Precedence. Both kinds present at once: every finding is printed, and
    #     the process claims the weaker of the two.
    d = make_tree({"staging-soak": None, "daily-security": [row("2026-06-01")]})
    r = run(d)
    case("stale + unmeasured together exit 2, not 1", r.returncode, 2)
    case("...and the STALE finding is still reported", "is STALE" in out(r), True)
    case("...and the summary says the scan was INCOMPLETE",
         "SCAN INCOMPLETE" in out(r), True)

    # 23. A forward-dated row would hold this control green indefinitely.
    r = run(make_tree({"weekly-health": [row("2027-01-01")]}))
    case("a FUTURE-dated newest row is reported", r.returncode, 1)
    case("...and says it is ahead of today", "AHEAD of today" in out(r), True)

    # 24. Unescaped pipes inside a later cell (three real rows have these). The
    #     date must still be extracted.
    r = run(make_tree({"daily-security": [
        row("2026-08-14", extra=" registered `staging-soak|1740|<iso>|<outcome>`")]}))
    case("an unescaped pipe later in the row does not break date extraction",
         r.returncode, 0)

    passed = sum(1 for _, ok in results if ok)
    for label, ok in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    print(f"run-log-freshness self-test: {passed}/{len(results)} passed")
    # The verdict is CONSUMED here. SEC-140: eight cases were once appended to a
    # list nothing read, and three separate mutations all reported "Self-test
    # passed" with the count going UP.
    return 0 if passed == len(results) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".",
                        help="tree to read the docs from (default: cwd)")
    parser.add_argument("--now", default=None,
                        help="UTC instant to measure against, ISO-8601 "
                             "(default: now). Mirrors WATCHDOG_NOW.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.now:
        try:
            now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))
        except ValueError:
            print(f"::error::check-run-log-freshness: --now {args.now!r} is not "
                  f"ISO-8601, so no measurement was taken.")
            return 2
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
    else:
        now = datetime.now(timezone.utc)

    return check(Path(args.root), now)


if __name__ == "__main__":
    sys.exit(main())
