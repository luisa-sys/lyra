#!/usr/bin/env python3
"""CTL-064 / SEC-99 — no repo-committed script may push to a release branch.

WHY THIS EXISTS
---------------
SEC-98 ("Production change control — no chain-bypass hotfixes") says production
may only change via `develop -> staging -> beta -> main`, and that pushing
directly to `main`, `beta` or `staging` is prohibited. That rule lived only in
CLAUDE.md, and the repo shipped two ready-made ways to break it:

    promote-to-production.sh   lines 77, 106, 154   -> main     (106, 154 forced)
    promote-to-staging.sh      lines 81, 112, 155   -> staging  (112, 155 forced)

The commands themselves are deliberately NOT quoted above. The first draft of
this header did quote all six verbatim, and this control then reported six
findings against ITSELF — correctly, by its own rule, since a docstring is not
a `#` comment. That is the CTL-061 shape (a guard firing on its own
registration prose) and it is resolved the way CTL-061 was: by rewriting the
prose, never by widening the rule, excluding this file, or reaching for an
escape hatch. The line numbers carry the same evidence.

Both scripts were deleted by the change that added this file. This control is the half
that stops them coming back: a documented convention with no gate erodes, which
is the lesson `staging-soak.sh` already records for `mapfile` (gotcha #28) and
`deploy-env.ts` records for its six ad-hoc callers.

WHY IT IS NOT AN EXTENSION OF check-workflow-integrity.sh
---------------------------------------------------------
SEC-99 §2 nominates that script, and it cannot be extended in place: it
hard-codes `WORKFLOW_DIR=".github/workflows"` (:37) and every scan loops over
`"$WORKFLOW_DIR"/*.yml`. Its `git push origin main` patterns (:194, :239) can
only ever see workflow YAML.

WHY NO EXTENSION FILTER
-----------------------
SEC-99's own correction note is the reason. §1 claimed the scripts were
unreferenced on the strength of a grep over `*.md`, `*.yml`, `*.json`, `*.sh` —
and missed `docs/lyra-project-reference.jsx`, which presented both scripts to a
human reader as this repo's promote commands. **A grep restricted by extension
answers a narrower question than the one being asked, and the gap is invisible
in the result.** So this scans every *tracked* file under `scripts/`, whatever
it is named.

WHAT IS OUT OF SCOPE, STATED RATHER THAN IMPLIED
------------------------------------------------
`.github/workflows/` is deliberately NOT scanned: `promote-to-staging.yml`,
`promote-staging-to-beta.yml` and `promote-to-production.yml` push to release
branches because that IS the supervised path, and CTL-016
(`check-workflow-integrity.sh`) already governs them. Nothing outside
`scripts/` and those workflows is covered — a push added to, say, a root-level
helper would not be seen here. That is a real gap and it is written down rather
than left for someone to discover.

WHY THERE IS NO ESCAPE HATCH
----------------------------
Most controls in this estate take an `# xxx-ok: <JIRA-KEY>` annotation. This one
does not, because under SEC-98 there is no legitimate direct push to a release
branch from a committed script — the exception process is the two-step human
gate in CLAUDE.md, which by definition is not a thing a script does. An
annotation here would be a suppression list for the one behaviour the control
exists to forbid. If this control ever false-positives, the fix is a narrower
rule in this file, visible in a diff, not a marker on the offending line.

MATCHING IS BY TOKEN EQUALITY, NOT BY SUBSTRING
-----------------------------------------------
A substring match for `git push origin main` would fire on
`check-workflow-integrity.sh:194`, which contains that text inside a *grep
pattern* — a control detecting the defect, misread as the defect. Instead a
line is a violation only when a `git push` is followed by a token that, once
quotes are stripped and a refspec resolved, is exactly `main`, `beta` or
`staging`. So `'git push origin (staging|main|production|develop)'` and
`'git push origin main([^a-zA-Z0-9_-]|$)'` — both real lines in that file today
— are correctly clean, with no annotation and no exclusion.

This also catches the evasions a fixed string misses:
`git push -f origin beta`, `git push origin HEAD:main`,
`git push origin develop:staging`, `git push --force origin "main"`.

USAGE
    python3 scripts/check-release-branch-push.py
    python3 scripts/check-release-branch-push.py --self-test

EXIT CODES  (the two vocabularies are disjoint, per CTL-059)
    0  no committed script pushes to a release branch
    1  a script does  — the finding
    2  the check could not run — fail closed, never a clean report
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile

SCAN_ROOT = "scripts"
RELEASE_BRANCHES = ("main", "beta", "staging")

# The self-test needs fixture lines that ARE violations. Writing them as literal
# text here would make this file violate its own rule — the failure CTL-061 hit,
# where a guard fired on its own registration prose. Assembling them from a
# constant keeps the fixtures honest AND keeps this file genuinely in scope:
# it is scanned like any other, with no exclusion and no annotation. The line
# below is clean because nothing follows `origin` on it.
_PUSH = "git push origin"
_PUSH_F = "git push --force origin"


def strip_comment(line: str) -> str:
    """Drop a shell/python `#` comment, respecting quotes.

    Needed in both directions. Without it, the header of any script *explaining*
    this rule would be a finding — and the better a rule is documented the more
    often that happens (gotcha #29, where `is_published` appearing in the comment
    that justified a filter kept a test green after the filter was deleted).
    With it, an inline trailing comment on a real push still leaves the push
    itself visible, which is correct: it is still a push.
    """
    out = []
    quote = None
    prev = ""
    for ch in line:
        if quote:
            out.append(ch)
            if ch == quote and prev != "\\":
                quote = None
        elif ch in ("'", '"'):
            quote = ch
            out.append(ch)
        elif ch == "#" and (prev == "" or prev.isspace()):
            break
        else:
            out.append(ch)
        prev = ch
    return "".join(out)


def normalise_ref(token: str) -> str:
    """Reduce a push argument to the branch name it would actually update."""
    t = token.strip()
    t = t.strip("'\"")            # "main"  '$X'  -> main  $X
    if t.endswith(";"):
        t = t[:-1].strip("'\"")
    if t.startswith("+"):         # forced refspec  +main
        t = t[1:]
    if ":" in t:                  # HEAD:main  develop:staging  refs/heads/x:main
        t = t.rsplit(":", 1)[1]
    if t.startswith("refs/heads/"):
        t = t[len("refs/heads/"):]
    return t.strip("'\"")


def scan_line(line: str) -> str | None:
    """Return the release branch this line pushes to, or None."""
    code = strip_comment(line)
    tokens = code.split()
    for i in range(len(tokens) - 1):
        if tokens[i] == "git" and tokens[i + 1] == "push":
            for tok in tokens[i + 2:]:
                if tok.startswith("-"):
                    continue      # a flag: --force, -f, -u ...
                ref = normalise_ref(tok)
                if ref in RELEASE_BRANCHES:
                    return ref
    return None


def tracked_files(root: str, cwd: str) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "--", root],
            cwd=cwd, capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise RuntimeError(f"could not list tracked files under {root}/: {exc}")
    return [p for p in out.splitlines() if p.strip()]


def check(cwd: str = ".") -> tuple[int, list[str]]:
    findings: list[str] = []

    # Fail closed on a missing scan root rather than reporting a clean scan that
    # never ran. Asserting the precondition directly is the gotcha #30 lesson:
    # on macOS a missing path with --include exits 1, not 2, so a guard that
    # infers "searched" from an exit code prints a green tick having read
    # nothing.
    root = os.path.join(cwd, SCAN_ROOT)
    if not os.path.isdir(root) or not os.access(root, os.R_OK):
        return 2, [
            f"{SCAN_ROOT}/ is missing or unreadable, so the scan never ran.",
            "Failing closed (exit 2) rather than reporting a clean result.",
        ]

    try:
        files = tracked_files(SCAN_ROOT, cwd)
    except RuntimeError as exc:
        return 2, [str(exc), "Failing closed (exit 2)."]

    if not files:
        # An empty corpus is green for every possible assertion — failure mode
        # #4 in CLAUDE.md's catalogue. Treat it as "could not check".
        return 2, [
            f"no tracked files under {SCAN_ROOT}/ — the corpus is empty, so a "
            "clean result would assert nothing.",
            "Failing closed (exit 2).",
        ]

    for rel in files:
        path = os.path.join(cwd, rel)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                lines = fh.read().splitlines()
        except (OSError, UnicodeError):
            continue              # a binary or unreadable blob has no push line
        for n, line in enumerate(lines, 1):
            branch = scan_line(line)
            if branch:
                findings.append(f"{rel}:{n}: pushes directly to '{branch}' — {line.strip()}")

    if findings:
        return 1, findings
    return 0, []


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()

    rc, messages = check(".")
    if rc == 2:
        for m in messages:
            print(f"::error::check-release-branch-push: {m}")
        return 2
    if rc == 1:
        print("::error::check-release-branch-push: a committed script pushes "
              "directly to a release branch. SEC-98 prohibits this — production "
              "changes only via develop -> staging -> beta -> main, through the "
              "promote-*.yml workflows.")
        for m in messages:
            print(f"::error::  {m}")
        print("::error::  Dispatch the workflow instead: "
              "gh workflow run promote-to-staging.yml -f confirm=promote")
        return 1
    print(f"No committed script under {SCAN_ROOT}/ pushes to "
          f"{', '.join(RELEASE_BRANCHES)}. ✓")
    return 0


# ---------------------------------------------------------------------------
# Self-test. Every case drives check() against a real temporary git repository,
# so tokenising, comment-stripping, file discovery and exit codes are exercised
# together rather than stubbed (CTL-038: a test that reimplements its subject
# reports green whatever the subject does).
# ---------------------------------------------------------------------------

VIOLATIONS = [
    (f"{_PUSH} main", "main"),
    (f"{_PUSH} staging", "staging"),
    (f"{_PUSH} beta", "beta"),
    (f"{_PUSH} main --force", "main"),
    (f"{_PUSH} 'main'", "main"),
    (f'{_PUSH} "beta"', "beta"),
    (f"{_PUSH} main;", "main"),
    (f"{_PUSH} HEAD:main", "main"),
    (f"{_PUSH} develop:staging", "staging"),
    (f"{_PUSH} +main", "main"),
    (f"{_PUSH} refs/heads/beta", "beta"),
    (f"{_PUSH_F} main", "main"),
    (f"git push -f origin beta", "beta"),
    (f"{_PUSH} main  # promote", "main"),
    (f"  {_PUSH} staging", "staging"),
]

CLEAN = [
    "git push origin develop",
    "git push",
    'echo "  git revert HEAD && git push"',
    f"# {_PUSH} main",
    f"   #  {_PUSH} main --force",
    "count_matches \"$f\" -E 'git push origin (staging|main|production|develop)'",
    "grep -qE 'git push origin main([^a-zA-Z0-9_-]|$)' \"$f\"",
    "gh workflow run promote-to-production.yml -f confirm=PRODUCTION",
    'echo "never push to main"',
    "git push origin \"$NEW_TAG\"",
    "git push origin ${BRANCH}",
    'MAIN="main"',
]


def _mkrepo(files: dict[str, str]) -> str:
    d = tempfile.mkdtemp(prefix="ctl063-")
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    for rel, body in files.items():
        full = os.path.join(d, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(body)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    return d


def self_test() -> int:
    failures: list[str] = []

    def check_case(label: str, cond: bool, detail: str = "") -> None:
        if not cond:
            failures.append(f"{label}{(': ' + detail) if detail else ''}")

    # 1. Each violating form is caught, and named with the right branch.
    for line, expected in VIOLATIONS:
        d = _mkrepo({"scripts/x.sh": f"#!/bin/bash\n{line}\n"})
        rc, msgs = check(d)
        check_case(f"violation not caught: {line!r}", rc == 1, f"rc={rc}")
        check_case(f"wrong branch named for {line!r}",
                   rc == 1 and f"'{expected}'" in msgs[0], str(msgs))

    # 2. Each clean form stays clean. These are not hypotheticals: six are real
    #    lines from scripts/check-workflow-integrity.sh and scripts/rollback-vercel.sh,
    #    and a substring matcher fails on them.
    for line in CLEAN:
        d = _mkrepo({"scripts/x.sh": f"#!/bin/bash\n{line}\n"})
        rc, msgs = check(d)
        check_case(f"false positive on clean line: {line!r}", rc == 0, f"rc={rc} {msgs}")

    # 3. No extension filter — the SEC-99 correction-note lesson. The same
    #    violation must be found whatever the file is called.
    for name in ("x.sh", "x.py", "x.jsx", "x.mjs", "deploy", "x.cjs"):
        d = _mkrepo({f"scripts/{name}": f"{_PUSH} main\n"})
        rc, _ = check(d)
        check_case(f"missed violation in scripts/{name} (extension filter?)", rc == 1)

    # 4. Nested directories are scanned.
    d = _mkrepo({"scripts/deep/nested/x.sh": f"{_PUSH} beta\n"})
    rc, _ = check(d)
    check_case("missed violation in a nested directory", rc == 1)

    # 5. UNTRACKED files are out of scope, and that is deliberate — the gate runs
    #    on what a PR actually commits. `git ls-files` cannot see an unstaged
    #    file (Phase-0 trap 1), so this pins the behaviour rather than leaving it
    #    to be rediscovered.
    d = _mkrepo({"scripts/tracked.sh": "echo ok\n"})
    with open(os.path.join(d, "scripts", "untracked.sh"), "w") as fh:
        fh.write(f"{_PUSH} main\n")
    rc, _ = check(d)
    check_case("untracked file changed the verdict", rc == 0, f"rc={rc}")

    # 6. Out of scope by design: a workflow that legitimately pushes.
    d = _mkrepo({
        "scripts/x.sh": "echo ok\n",
        ".github/workflows/promote.yml": f"      run: {_PUSH} main\n",
    })
    rc, _ = check(d)
    check_case("scanned .github/workflows (should be out of scope)", rc == 0)

    # 7. Fail closed, and with the exit-2 vocabulary, not the exit-1 one.
    d = _mkrepo({"README.md": "no scripts dir here\n"})
    rc, msgs = check(d)
    check_case("missing scripts/ did not fail closed", rc == 2, f"rc={rc}")
    check_case("exit-2 message reads like a finding",
               rc == 2 and any("never ran" in m for m in msgs), str(msgs))

    d = _mkrepo({"scripts/.keep": ""})
    os.remove(os.path.join(d, "scripts", ".keep"))
    subprocess.run(["git", "rm", "-q", "--cached", "scripts/.keep"], cwd=d, check=True)
    os.makedirs(os.path.join(d, "scripts"), exist_ok=True)
    rc, msgs = check(d)
    check_case("empty tracked corpus reported clean", rc == 2, f"rc={rc}")

    # 8. Multiple findings are all reported, not just the first.
    d = _mkrepo({
        "scripts/a.sh": f"{_PUSH} main\n{_PUSH} beta\n",
        "scripts/b.sh": f"{_PUSH} staging\n",
    })
    rc, msgs = check(d)
    check_case("did not report every finding", rc == 1 and len(msgs) == 3, str(msgs))

    # 9. This repository's own tree is clean — the assertion the CI step makes.
    #    Guards against the file you are reading becoming a violation itself.
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    rc, msgs = check(repo)
    check_case("the real scripts/ tree is not clean", rc == 0, str(msgs))

    total = (len(VIOLATIONS) * 2) + len(CLEAN) + 6 + 1 + 1 + 1 + 2 + 1 + 1 + 1
    if failures:
        for f in failures:
            print(f"::error::self-test: {f}")
        print(f"Self-test FAILED — {len(failures)} of {total} cases.")
        return 2
    print(f"Self-test passed ({total} cases).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
