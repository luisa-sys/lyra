#!/usr/bin/env python3
"""
check-docs-updated.py — CTL-047, the Documentation Definition-of-Done gate.

WHY THIS EXISTS
---------------
CLAUDE.md has said "Docs are part of 'done', not a follow-up ticket" since
KAN-359, and `docs/RUNBOOK.md` carries the same checklist. Nothing enforced it.
A 60-agent audit on 2026-08-10 compared every architecture/runbook/plan doc
against the actual tree and confirmed dozens of statements that had quietly
become false — including three that would have made a fresh session do the
WRONG THING:

  * the modularisation plan still read "the extraction programme D1-D15 is
    DEFERRED ... No file moves into src/modules/", four days after that ruling
    was reversed and with 44 files already moved on main;
  * CLAUDE.md and RUNBOOK.md both described `no-module-to-app` as covering
    `src/lib/**` only, months after the anchor was widened because 28 files had
    silently left a BLOCKING rule's scope;
  * RUNBOOK.md described the dependency gate as non-blocking, ~two weeks after
    it was flipped to `error`.

Every one of those was written by someone who had just done the work and knew
the truth. Documentation does not drift because people are careless; it drifts
because nothing is watching, and the person who would notice is the person who
already knows. **A convention with no gate erodes** — the same lesson as
`mapfile` (gotcha #28) and `deploy-env.ts`.

WHAT IT DOES *NOT* DO
---------------------
It cannot read a doc and tell whether it is true. Nothing can. It answers a much
narrower question that is nonetheless the one that matters in practice:

    You changed something whose meaning is written down somewhere.
    Did you go and look at what is written down?

DESIGN: FIRE RARELY, AND MEAN IT
--------------------------------
A gate that fires on every PR is a gate people learn to wave through, and
standing noise is worse than no gate at all — it teaches the reflex that
defeats every OTHER gate too. So the trigger set is deliberately narrow: only
changes whose doc implication is *structural* and therefore provable from the
diff alone. Editing the body of an existing function is not in it. Adding a
module, a workflow, a control or a migration is.

Satisfied by touching any doc, or by an explicit trailer. The trailer is not a
loophole to be minimised — recording "no doc change needed, because X" IS the
review step. The gate wants five seconds of thought, not a doc edit for its own
sake.

Exit codes:
  0  satisfied (or nothing in the trigger set changed)
  1  triggered and unsatisfied — the actionable failure
  2  could not verify (bad diff base, missing git) — FAIL CLOSED, never a pass

Usage:
  scripts/check-docs-updated.py <base-ref> <head-ref>
  scripts/check-docs-updated.py --files <path>   # newline-delimited, for tests
  scripts/check-docs-updated.py --self-test
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

# ── What counts as a doc ─────────────────────────────────────────────────────
# CLAUDE.md is included because it is the file a fresh session actually reads;
# a change documented only in docs/ that contradicts CLAUDE.md is still drift.
DOC_PREFIXES = ("docs/",)
DOC_FILES = ("CLAUDE.md", "README.md", "modules.json", "controls/registry.json")

# ── The trigger set ──────────────────────────────────────────────────────────
# Each rule is (id, human description, predicate over a changed path). Kept as
# data so the failure message can name WHICH rule fired and WHICH doc to look
# at — "update the docs" is not an actionable instruction, and a gate nobody can
# act on quickly is a gate that gets an escape hatch on reflex.
TRIGGERS = [
    (
        "module-structure",
        "a file was added to or removed from src/modules/",
        "docs/ARCHITECTURE.md (the Code layout section) and modules.json",
        lambda p: p.startswith("src/modules/"),
    ),
    (
        "workflow",
        "a GitHub Actions workflow was added, removed, or changed beyond an "
        "action-version pin",
        "docs/RUNBOOK.md (Scheduled Workflows) and CLAUDE.md",
        lambda p: p.startswith(".github/workflows/") and p.endswith((".yml", ".yaml")),
    ),
    (
        "control",
        "a control script was added or removed",
        "controls/registry.json and the gate table in CLAUDE.md",
        lambda p: p.startswith("scripts/check-") or p == "controls/registry.json",
    ),
    (
        "migration",
        "a database migration was added",
        "docs/ARCHITECTURE.md (Database Schema)",
        lambda p: p.startswith("supabase/migrations/") and p.endswith(".sql"),
    ),
    (
        "path-manifest",
        "a path-keyed guard manifest changed",
        "docs/MODULARISATION_EXTRACTION_DOD.md and docs/RUNBOOK.md",
        lambda p: p in (".github/signup-surface.paths", ".dependency-cruiser.cjs"),
    ),
]

TRAILER_RE = re.compile(
    r"^\s*Docs-(Updated|N/A):\s*([A-Z][A-Z0-9]+-[0-9]+)\s+(\S.*)$", re.M
)

# ── The action-version-pin exemption (SEC-155) ───────────────────────────────
# A workflow file that is MODIFIED and whose every changed line is a `uses:`
# action pin changes nothing any doc in this repo records — no doc here states
# an action version. Such a change is excluded from the `workflow` trigger.
#
# WHY THIS EXEMPTION EXISTS, and why it is not just convenience: dependabot's
# github-actions group PR is *structurally incapable* of satisfying this gate.
# It cannot write a `Docs-N/A:` trailer, and there is no doc for it to touch.
# PR #661 sat red for 15 days carrying seven action bumps, three of them
# CodeQL — a DOCUMENTATION control holding a SUPPLY-CHAIN control shut, with no
# path out for the only author who hits it every single time.
#
# WHY IT IS STRICT: the exemption is per FILE and requires EVERY changed line in
# that file to be a pin. One `cron:`, one `run:`, one `if:` moving alongside the
# pins and the file fires as before. That is what stops a substantive workflow
# change being smuggled through by co-locating it with a bump — the exemption
# must not become a way to edit a schedule unobserved.
#
# Added / removed / renamed workflow files are NEVER exempt, whatever they
# contain: their existence is the documented fact, not their contents.
USES_PIN_RE = re.compile(r"^\s*-?\s*uses:\s*\S+@\S+\s*(#.*)?$")


def pin_only_workflow_paths(base: str, head: str, paths: list[str]) -> set[str]:
    """Of `paths`, those whose diff consists ONLY of `uses:` pin lines.

    Raises on any git failure so the caller can fail CLOSED — an undecidable
    file must never be silently treated as exempt.
    """
    exempt: set[str] = set()
    for path in paths:
        out = subprocess.run(
            ["git", "diff", "--unified=0", f"{base}...{head}", "--", path],
            capture_output=True,
            text=True,
        )
        if out.returncode != 0:
            raise RuntimeError(out.stderr.strip() or f"git diff for {path} failed")
        body = [
            line
            for line in out.stdout.splitlines()
            if (line.startswith("+") or line.startswith("-"))
            and not line.startswith(("+++", "---"))
        ]
        # An empty body means nothing textual changed (a mode bit, say). That is
        # not evidence of a pin bump, so it is NOT exempt — conservative.
        if body and all(USES_PIN_RE.match(line[1:]) for line in body):
            exempt.add(path)
    return exempt


def modified_workflows(base: str, head: str) -> list[str]:
    """Workflow files whose change is a plain MODIFICATION (not A/D/R/C)."""
    out = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=M", f"{base}...{head}"],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or f"git diff -M {base}...{head} failed")
    return [
        line
        for line in out.stdout.splitlines()
        if line.startswith(".github/workflows/") and line.endswith((".yml", ".yaml"))
    ]


def err(msg: str) -> None:
    print(f"::error::check-docs-updated: {msg}")


def note(msg: str) -> None:
    print(f"check-docs-updated: {msg}")


def is_doc(path: str) -> bool:
    return path.startswith(DOC_PREFIXES) or path in DOC_FILES


def changed_from_git(base: str, head: str) -> list[str]:
    """Changed paths, or raise so the caller can fail CLOSED."""
    # ADRM only: a pure mode change or a rename's source side is not a content
    # change anyone needs to document twice.
    out = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ADRM", f"{base}...{head}"],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or f"git diff {base}...{head} failed")
    return [line for line in out.stdout.splitlines() if line.strip()]


def commit_messages(base: str, head: str) -> str:
    out = subprocess.run(
        ["git", "log", "--format=%B", f"{base}..{head}"], capture_output=True, text=True
    )
    return out.stdout if out.returncode == 0 else ""


def evaluate(
    changed: list[str], messages: str, pin_only: "set[str] | None" = None
) -> int:
    # SEC-155: paths the caller proved are pure action-version pin bumps. Only
    # the `workflow` trigger honours it — a pin bump is doc-neutral for that
    # trigger and for no other, so the exemption is not applied globally.
    exempt = pin_only or set()
    fired = []
    for tid, desc, where, pred in TRIGGERS:
        hits = [p for p in changed if pred(p)]
        if tid == "workflow" and exempt:
            skipped = [p for p in hits if p in exempt]
            hits = [p for p in hits if p not in exempt]
            if skipped:
                note(
                    f"{len(skipped)} workflow file(s) changed only action-version "
                    "pins — doc-neutral, not counted (SEC-155):"
                )
                for p in skipped[:8]:
                    print(f"    {p}")
                if len(skipped) > 8:
                    print(f"    … and {len(skipped) - 8} more")
        if hits:
            fired.append((tid, desc, where, hits))

    if not fired:
        note("no structural change in the trigger set — docs not implicated. ✓")
        return 0

    docs_touched = [p for p in changed if is_doc(p)]
    trailer = TRAILER_RE.search(messages or "")

    print()
    print("check-docs-updated: this PR makes a change whose meaning is written down:")
    for tid, desc, where, hits in fired:
        print(f"  [{tid}] {desc}")
        for h in hits[:6]:
            print(f"        {h}")
        if len(hits) > 6:
            print(f"        … and {len(hits) - 6} more")
        print(f"        -> look at: {where}")
    print()

    if docs_touched:
        note(f"documentation was updated in the same PR ({len(docs_touched)} file(s)):")
        for d in docs_touched[:8]:
            print(f"    {d}")
        note("satisfied. ✓")
        return 0

    if trailer:
        kind, key, reason = trailer.group(1), trailer.group(2), trailer.group(3).strip()
        note(f"declared: Docs-{kind}: [{key}] {reason}")
        note("satisfied by an explicit declaration. ✓")
        return 0

    err("no documentation was updated and no declaration was made.")
    err("")
    err("  Docs are part of 'done' (KAN-359). This gate exists because a 2026-08-10")
    err("  audit found the modularisation plan still saying 'No file moves into")
    err("  src/modules/' with 44 files already moved — a fresh session reading it")
    err("  would have stopped work that was already approved and in production.")
    err("")
    err("  Either update the doc named above, or record the decision on a commit")
    err("  in this PR:")
    err("")
    err("      Docs-Updated: <JIRA-KEY> <what you changed and where>")
    err("      Docs-N/A:     <JIRA-KEY> <why no doc says anything about this>")
    err("")
    err("  'Docs-N/A' is a legitimate answer and is not a loophole — recording that")
    err("  you checked IS the review step. What must not happen is nobody looking.")
    return 1


def self_test() -> int:
    cases = [
        ("nothing in the trigger set", ["src/app/page.tsx"], "", 0),
        ("module added, no docs, no trailer", ["src/modules/age/x.ts"], "feat: x", 1),
        (
            "module added, docs updated",
            ["src/modules/age/x.ts", "docs/ARCHITECTURE.md"],
            "feat: x",
            0,
        ),
        (
            "module added, CLAUDE.md updated",
            ["src/modules/age/x.ts", "CLAUDE.md"],
            "feat: x",
            0,
        ),
        (
            "module added, Docs-Updated trailer",
            ["src/modules/age/x.ts"],
            "feat: x\n\nDocs-Updated: KAN-415 added the module to ARCHITECTURE.md",
            0,
        ),
        (
            "module added, Docs-N/A trailer",
            ["src/modules/age/x.ts"],
            "feat: x\n\nDocs-N/A: KAN-415 internal helper, no doc describes it",
            0,
        ),
        (
            "trailer without a Jira key does NOT satisfy",
            ["src/modules/age/x.ts"],
            "feat: x\n\nDocs-N/A: because I said so",
            1,
        ),
        (
            "trailer with a key but no reason does NOT satisfy",
            ["src/modules/age/x.ts"],
            "feat: x\n\nDocs-N/A: KAN-415",
            1,
        ),
        ("new workflow triggers", [".github/workflows/new.yml"], "ci: add", 1),
        ("new control triggers", ["scripts/check-thing.py"], "feat: guard", 1),
        (
            "registry change triggers but is itself a doc",
            ["controls/registry.json"],
            "feat: guard",
            0,
        ),
        ("migration triggers", ["supabase/migrations/2026_x.sql"], "feat: db", 1),
        (
            "signup manifest triggers",
            [".github/signup-surface.paths"],
            "chore: paths",
            1,
        ),
        # The exact D6 shape: a move touches src/modules AND updates docs.
        (
            "a real extraction with its doc rework",
            [
                "src/modules/age/self-declaration.ts",
                ".github/signup-surface.paths",
                "modules.json",
                "docs/ARCHITECTURE.md",
            ],
            "refactor: D6",
            0,
        ),
        # ── SEC-155: the action-version-pin exemption ───────────────────────
        # A 5th element is the pin_only set the caller would have computed
        # from the diff. Absent, it defaults to empty — which is exactly the
        # pre-SEC-155 behaviour, so every case above still asserts what it did.
        (
            "one workflow, pin-only change → doc-neutral",
            [".github/workflows/codeql.yml"],
            "ci: bump codeql-action",
            0,
            {".github/workflows/codeql.yml"},
        ),
        (
            "the PR #661 shape: many workflows, all pin-only",
            [
                ".github/workflows/codeql.yml",
                ".github/workflows/pr-checks.yml",
                ".github/workflows/backup-database.yml",
            ],
            "ci: bump the github-actions group across 1 directory with 7 updates",
            0,
            {
                ".github/workflows/codeql.yml",
                ".github/workflows/pr-checks.yml",
                ".github/workflows/backup-database.yml",
            },
        ),
        # The load-bearing negative: a schedule change is NOT a pin bump, so the
        # classifier never puts it in the exempt set and the trigger still fires.
        (
            "a workflow whose cron changed is NOT exempt",
            [".github/workflows/weekly-report.yml"],
            "ci: move the weekly report",
            1,
            set(),
        ),
        # The smuggling case: one file is a genuine pin bump, another is not.
        # The non-exempt file must still fire — the exemption is per file, and
        # a substantive change must not ride along with a bump.
        (
            "mixed PR: pin-only file excused, substantive file still fires",
            [
                ".github/workflows/codeql.yml",
                ".github/workflows/health-check.yml",
            ],
            "ci: bump + retune",
            1,
            {".github/workflows/codeql.yml"},
        ),
        # An exempt workflow alongside a DIFFERENT trigger must not excuse that
        # other trigger — the exemption is scoped to the `workflow` trigger only.
        (
            "the exemption does not leak to another trigger",
            [".github/workflows/codeql.yml", "supabase/migrations/2026_x.sql"],
            "ci: bump + a migration",
            1,
            {".github/workflows/codeql.yml"},
        ),
    ]

    # ── Classifier-level cases: what counts as an action-version pin line ────
    # These test USES_PIN_RE directly, because the evaluate() cases above take
    # the pin_only set as a GIVEN and so cannot tell whether the classifier
    # that produces it is right.
    pin_line_cases = [
        ("a pinned step", "      - uses: actions/checkout@v7.0.1", True),
        ("a pinned SHA", "  - uses: actions/cache@a1b2c3d4", True),
        ("a trailing comment", "  - uses: actions/cache@v6.1.0 # v6", True),
        ("uses without a list dash", "    uses: ./.github/actions/setup", False),
        ("a cron line", "    - cron: '0 7 * * 1'", False),
        ("a run line", "        run: npm ci", False),
        ("an if condition", "    if: github.event_name == 'push'", False),
        ("a job name", "  name: PR Quality Gate", False),
        ("a bare uses with no ref", "  - uses: actions/checkout", False),
        ("an env assignment", "      FOO: bar", False),
    ]

    failures = []
    passed = 0
    for case in cases:
        name, changed, msg, want = case[0], case[1], case[2], case[3]
        pin_only = case[4] if len(case) > 4 else set()
        # Suppress the informational output of each case.
        stdout, sys.stdout = sys.stdout, open(os.devnull, "w")
        try:
            got = evaluate(changed, msg, pin_only)
        finally:
            sys.stdout.close()
            sys.stdout = stdout
        ok = got == want
        passed += ok
        if not ok:
            failures.append(name)
        print(f"  {'ok  ' if ok else 'FAIL'} {name} (want {want}, got {got})")

    for name, line, want in pin_line_cases:
        got = bool(USES_PIN_RE.match(line))
        ok = got == want
        passed += ok
        if not ok:
            failures.append(name)
        print(f"  {'ok  ' if ok else 'FAIL'} pin-line: {name} (want {want}, got {got})")

    total = len(cases) + len(pin_line_cases)
    # A floor, not a tally: an "N/N passed" line stays reassuring when N drops
    # (catalogue failure mode 8). If a case is deleted this goes red.
    minimum = 26
    if total < minimum:
        print(f"::error::self-test corpus shrank: {total} cases, expected >= {minimum}")
        failures.append(f"corpus floor ({total} < {minimum})")

    print(f"self-test: {passed}/{total} passed")
    if failures:
        for name in failures:
            print(f"::error::self-test FAILED: {name}")
        return 1
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--self-test":
        return self_test()

    if args and args[0] == "--files":
        if len(args) < 2 or not os.path.isfile(args[1]):
            err(f"cannot read --files list {args[1] if len(args) > 1 else '<missing>'}")
            return 2
        with open(args[1]) as fh:
            changed = [l for l in fh.read().splitlines() if l.strip()]
        return evaluate(changed, os.environ.get("DOCS_GATE_MESSAGES", ""))

    if len(args) < 2:
        err("usage: check-docs-updated.py <base-ref> <head-ref> | --files <path> | --self-test")
        return 2

    base, head = args[0], args[1]
    try:
        changed = changed_from_git(base, head)
        # SEC-155: only files that are plain MODIFICATIONS can be pin-exempt.
        # An added/removed/renamed workflow is never exempt, so it is not even
        # offered to the classifier.
        pin_only = pin_only_workflow_paths(base, head, modified_workflows(base, head))
    except Exception as exc:  # noqa: BLE001 — any failure here must fail closed
        err(f"could not compute the changed set ({exc}).")
        err("  Failing closed (exit 2) rather than reporting a clean pass that never ran.")
        err("  A shallow CI checkout is the usual cause — fetch enough history for")
        err(f"  '{base}...{head}' to resolve.")
        return 2

    return evaluate(changed, commit_messages(base, head), pin_only)


if __name__ == "__main__":
    sys.exit(main())
