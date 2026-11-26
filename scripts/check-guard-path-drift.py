#!/usr/bin/env python3
"""KAN-414 F1 — the guard-path-drift gate (guard #12 in pr-checks.yml).

WHY THIS EXISTS
---------------
Almost every control in this repo classifies files by their PATH: the founder
UI/copy gate matches `src/app/**/*.tsx`, the un-skippable signup gate reads
`.github/signup-surface.paths`, CODEOWNERS anchors review on security-critical
paths, Stryker mutates a literal file list. A path pattern that matches nothing
does not fail — it silently protects nothing, and the gate keeps reporting
green. That is the SEC-79 shape: a control that reports success while not
operating.

The modularisation programme's primary activity is MOVING FILES. So the first
extraction PR is also the most likely event ever to disarm these gates, and it
would do so invisibly. KAN-419 measured the baseline before anyone moved a file
on purpose and found the unguarded doc layer had already rotted to ~18% dead
path literals. This guard closes the machine-checkable half.

THE CONTRACT (KAN-419 §7.1)
---------------------------
  Every path pattern in a registered artefact must match at least one TRACKED
  file, unless explicitly and individually excepted.

WHY `git ls-files` AND NOT THE FILESYSTEM (§7.4)
------------------------------------------------
Tracked files only. This is what makes the subtle case work: a pattern matching
only an untracked or .gitignore'd file FAILS, because CI checks out tracked
content and the pattern would be inert there. Checking the filesystem would pass
it locally and leave the gate dead in CI — the worst of both.

MATCHING IS PER-ARTEFACT, NOT ONE-SIZE-FITS-ALL (§7.3)
-------------------------------------------------------
The registered artefacts genuinely use different syntaxes, and collapsing them
into one "close enough" matcher produces false verdicts in both directions. Two
that must not be got wrong:

  * `bash-case` / `bash-dbl-bracket`: bash's `*` matches ACROSS '/'. Standard
    fnmatch does not. Using fnmatch would report `src/app/*.tsx` as matching 0
    files instead of ~97 — a false DEAD on the largest protected pattern in the
    estate, which would then be "fixed" by weakening the real gate.
  * `bash-case` additionally applies the trailing-`/**`-prefix rule from
    check-signup-surface-gate.sh's matches_glob().

Ported from `docs/modularisation/kan419-scan.py`, the executable reference
implementation of all seven syntaxes, rather than re-derived (§7.3).

FAIL-CLOSED (§7.5) — exit 2
---------------------------
An artefact that is missing, unreadable or unparseable exits 2, never 0. Per the
Workflow & Backup Integrity Policy a guard that cannot read its input must fail
the build, never skip. There is no `if: env.X != ''` and no `continue-on-error`
on this step. `check-guard-path-drift` reporting green because it could not find
its own inputs would be the exact defect it exists to detect.

ESCAPE HATCH (§7.7)
-------------------
    guard-path-ok: <JIRA-KEY> <reason>

as a trailing comment on the pattern's own line, or — where the artefact's
syntax forbids comments entirely (package.json is JSON) — declared in
DECLARED_EXCEPTIONS below, which is reviewable in exactly the same way.

  1. Suppresses EXACTLY one pattern. Never a file, never a directory, never a
     wildcard.
  2. Requires a Jira key. A bare `guard-path-ok` is itself a failure.
  3. Every active exception is PRINTED on every run, passing or failing — the
     `UI-Change-Approved` loudness standard. An escape hatch you cannot
     enumerate is one you cannot audit.
  4. More than MAX_EXCEPTIONS emits a ::warning:: that the register is being
     used to paper over drift.

DELIBERATE DEVIATIONS FROM THE §7 SPEC — stated, not silent
------------------------------------------------------------
  * **Python, not bash.** §7 says "a bash script". The seven matching syntaxes
    are intricate and the spec itself flags two as easy to get wrong; the
    reference implementation it says to port from is Python. Bash 3.2 (what
    macOS ships — gotcha #28) has no associative arrays, so an 18-artefact
    registry with per-entry syntax/severity/extractor would need parallel arrays
    and string-splitting. That is a lot of surface for a control whose whole
    job is to be trustworthy. Python matches the idiom of the repo's other
    recent guards (check-migration-privileges.py, check-partial-write-safety.py,
    check-bash-portability.py) and runs identically on macOS and CI.
  * **§7.8 is NOT implemented here.** The companion "no stale reference to a
    moved path" rule already shipped in KAN-428's
    `scripts/check-extraction-dod.sh` as its `stale-refs` / `doc-manifest` /
    `module-manifest` / `test-estate` checks. Re-implementing it would create
    two controls for one concern (KAN-361). This guard owns the whole-registry
    direction; the DoD gate owns the per-PR-diff direction.
  * Test file is `tests/scripts/check-guard-path-drift.test.js`, not `.cjs` —
    every existing file in `tests/scripts/` is `.js`.

USAGE
-----
    python3 scripts/check-guard-path-drift.py            # the gate
    python3 scripts/check-guard-path-drift.py --list     # every pattern + verdict
    python3 scripts/check-guard-path-drift.py --self-test
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, NamedTuple

REPO = Path(__file__).resolve().parents[1]

MAX_EXCEPTIONS = 5

# Severities (KAN-474). "blocking" and "advisory" are tree assertions that differ
# only in loudness. "external" is a different KIND of registration — see the
# SEVERITY note above resolve().
SEV_BLOCKING = "blocking"
SEV_EXTERNAL = "external"

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_FAIL_CLOSED = 2

# The escape-hatch marker. A Jira key is mandatory — `guard-path-ok` on its own
# is a failure, not a pass (§7.7 rule 2).
HATCH_RE = re.compile(r"guard-path-ok:\s*(?P<key>[A-Z]+-\d+)?\s*(?P<reason>.*)$")


class Unparseable(Exception):
    """An artefact exists but does not have the shape we must read.

    Distinct from a missing file only in the message — both are exit 2. Raised
    rather than returning an empty pattern list, because "no patterns found"
    read as success is precisely the vacuous pass this guard exists to prevent.
    """


class Pattern(NamedTuple):
    pattern: str
    source: str  # repo-relative file the pattern was read from
    line: int  # 1-indexed, for the ::error file=,line=:: annotation
    hatch_key: str | None = None  # Jira key from an inline marker, if any
    hatch_reason: str = ""
    hatch_present: bool = False  # a marker was seen, with or without a valid key


# ---------------------------------------------------------------------------
# Resolution set — tracked files only (§7.4). Read once, reused for every
# pattern; no per-pattern shelling out (§7.10 keeps this well under 1% of the
# existing shell-guard block).
# ---------------------------------------------------------------------------


def tracked_files() -> list[str]:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "ls-files"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise Unparseable(f"could not enumerate tracked files via git ls-files: {exc}")
    files = [ln for ln in out.splitlines() if ln]
    if not files:
        raise Unparseable("git ls-files returned nothing — refusing to pass vacuously")
    return files


# ---------------------------------------------------------------------------
# The seven matching syntaxes (§7.3), ported from kan419-scan.py.
# ---------------------------------------------------------------------------


def _bash_pat_to_re(pattern: str) -> re.Pattern[str]:
    """bash glob -> regex. The load-bearing detail is that '*' becomes '.*',
    i.e. it CROSSES '/', which is bash's behaviour and not fnmatch's."""
    out: list[str] = []
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "*":
            out.append(".*")
        elif c == "?":
            out.append(".")
        elif c == "[":
            j = pattern.find("]", i + 1)
            if j == -1:
                out.append(re.escape(c))
            else:
                out.append(pattern[i : j + 1])
                i = j
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("".join(out))


def m_bash_case(pattern: str, files: list[str]) -> list[str]:
    """`case $f in $g)` as used by check-signup-surface-gate.sh, including its
    extra rule: a trailing `/**` also matches the directory prefix at any depth."""
    rx = _bash_pat_to_re(pattern)
    hits = [f for f in files if rx.fullmatch(f)]
    if pattern.endswith("/**"):
        pref = pattern[: -len("/**")] + "/"
        hits += [f for f in files if f.startswith(pref) and f not in hits]
    return hits


def m_bash_dbl_bracket(pattern: str, files: list[str]) -> list[str]:
    """`[[ $f == pat ]]` — same globbing as m_bash_case, without the /** rule."""
    rx = _bash_pat_to_re(pattern)
    return [f for f in files if rx.fullmatch(f)]


def m_codeowners(pattern: str, files: list[str]) -> list[str]:
    """gitignore-style CODEOWNERS: a leading '/' anchors at the repo root."""
    p = pattern.lstrip("/")
    if p == "*":
        return list(files)
    if p.endswith("/"):
        return [f for f in files if f.startswith(p)]
    return [f for f in files if f == p or f.startswith(p + "/")]


def m_literal(pattern: str, files: list[str]) -> list[str]:
    """An exact repo-relative path, or a directory prefix."""
    return [f for f in files if f == pattern or f.startswith(pattern.rstrip("/") + "/")]


def m_regex(pattern: str, files: list[str]) -> list[str]:
    try:
        rx = re.compile(pattern)
    except re.error as exc:
        raise Unparseable(f"registered pattern is not a valid regex: {pattern!r} ({exc})")
    return [f for f in files if rx.search(f)]


def m_basename_regex(pattern: str, files: list[str]) -> list[str]:
    """Playwright testMatch/testIgnore — pinned to the basename in practice, so
    it survives a directory move. Deliberately the same engine as m_regex; the
    distinction is documentary (it tells a reader why a move does not break it)."""
    return m_regex(pattern, files)


def m_glob(pattern: str, files: list[str]) -> list[str]:
    """eslint / jest / tsconfig style: '**' = any depth, '*' = within a segment."""
    rx = re.compile(
        pattern.replace(".", r"\.")
        .replace("**/", "\x00")
        .replace("**", ".*")
        .replace("*", "[^/]*")
        .replace("\x00", "(?:.*/)?")
        .replace("{ts,tsx}", "(?:ts|tsx)")
    )
    return [f for f in files if rx.fullmatch(f)]


MATCHERS: dict[str, Callable[[str, list[str]], list[str]]] = {
    "bash-case": m_bash_case,
    "bash-dbl-bracket": m_bash_dbl_bracket,
    "codeowners": m_codeowners,
    "literal": m_literal,
    "regex": m_regex,
    "basename-regex": m_basename_regex,
    "glob": m_glob,
}


# ---------------------------------------------------------------------------
# Extractors. Each reads patterns OUT OF the live artefact, so the registry
# cannot drift from what the guards actually enforce. Every extractor returns
# (pattern, source-file, line) so a failure can name a precise location.
# ---------------------------------------------------------------------------


def _read(rel: str) -> str:
    p = REPO / rel
    if not p.is_file():
        raise Unparseable(f"registered artefact is missing: {rel}")
    try:
        return p.read_text(encoding="utf-8")
    except OSError as exc:
        raise Unparseable(f"registered artefact is unreadable: {rel} ({exc})")


def _hatch(line: str) -> tuple[str | None, str, bool]:
    """Parse an inline escape-hatch marker.

    Returns (jira_key, reason, marker_present). A marker with no Jira key comes
    back as (None, ..., True) so the caller can fail it — silently ignoring a
    malformed hatch would let `guard-path-ok` alone suppress a dead pattern.
    """
    if "guard-path-ok" not in line:
        return None, "", False
    m = HATCH_RE.search(line)
    if not m:
        return None, "", True
    return m.group("key"), (m.group("reason") or "").strip(), True


def _strip_comment(line: str, marker: str = "#") -> str:
    return line.split(marker, 1)[0].strip()


def ex_signup_globs() -> list[Pattern]:
    rel = ".github/signup-surface.paths"
    out: list[Pattern] = []
    for n, raw in enumerate(_read(rel).splitlines(), 1):
        key, reason, present = _hatch(raw)
        body = _strip_comment(raw)
        if body:
            out.append(Pattern(body, rel, n, key if present else None, reason, present))
    if not out:
        raise Unparseable(f"{rel} declared no patterns — the signup gate would be inert")
    return out


def ex_codeowners() -> list[Pattern]:
    rel = ".github/CODEOWNERS"
    out: list[Pattern] = []
    for n, raw in enumerate(_read(rel).splitlines(), 1):
        key, reason, present = _hatch(raw)
        body = _strip_comment(raw)
        if not body:
            continue
        out.append(Pattern(body.split()[0], rel, n, key if present else None, reason, present))
    if not out:
        raise Unparseable(f"{rel} declared no owner rules")
    return out


def ex_ui_copy() -> list[Pattern]:
    """The founder UI/copy gate's is_protected() globs (KAN-411).

    Both carve-outs (`return 1`) and protected patterns (`return 0`) are
    registered: a dead carve-out is as much a silent behaviour change as a dead
    protection, it just fails the other way.
    """
    rel = "scripts/check-ui-copy-ownership.sh"
    src = _read(rel)
    if "is_protected() {" not in src:
        raise Unparseable(f"{rel}: is_protected() not found — the gate has been restructured")
    lines = src.splitlines()
    out: list[Pattern] = []
    inside = False
    for n, raw in enumerate(lines, 1):
        if "is_protected() {" in raw:
            inside = True
            continue
        if inside and raw.startswith("}"):
            break
        if not inside:
            continue
        m = re.search(r"\[\[\s*\$f\s*==\s*(\S+?)\s*\]\]\s*&&\s*return\s*[01]", raw)
        if m:
            key, reason, present = _hatch(raw)
            out.append(Pattern(m.group(1), rel, n, key if present else None, reason, present))
    if not out:
        raise Unparseable(f"{rel}: is_protected() matched no glob rules")
    return out


def ex_stryker() -> list[Pattern]:
    rel = "stryker.config.mjs"
    src = _read(rel)
    if "mutate: [" not in src:
        raise Unparseable(f"{rel}: no `mutate: [` array found")
    lines = src.splitlines()
    out: list[Pattern] = []
    inside = False
    for n, raw in enumerate(lines, 1):
        if "mutate: [" in raw:
            inside = True
        if inside:
            for m in re.finditer(r"'([^']+)'", raw):
                key, reason, present = _hatch(raw)
                out.append(Pattern(m.group(1), rel, n, key if present else None, reason, present))
            if "]" in raw.split("mutate: [", 1)[-1]:
                break
    if not out:
        raise Unparseable(f"{rel}: mutate array is empty — nothing would be mutation-tested")
    return out


def ex_routine_ownership() -> list[Pattern]:
    rel = "scripts/check-routine-ownership.sh"
    out: list[Pattern] = []
    for n, raw in enumerate(_read(rel).splitlines(), 1):
        m = re.match(r'^check_marker "([^"]+)"', raw)
        if m:
            key, reason, present = _hatch(raw)
            out.append(Pattern(m.group(1), rel, n, key if present else None, reason, present))
    if not out:
        raise Unparseable(f"{rel}: no check_marker entries found")
    return out


def _bash_array(rel: str, name: str) -> list[Pattern]:
    """Read a literal bash array out of a shell script.

    Terminator is `)` at column 0, matching how check-extraction-dod.sh locates
    its own ROUTINE_COUPLED block — the two must agree on where the array ends
    or they would disagree about which lines are in it.

    Only quoted entries are collected. The arrays this reads are documented as
    LITERAL PATHS ONLY, so an unquoted token would be a shape change, and the
    continuation-comment lines between entries carry no quotes and are skipped.
    """
    return _parse_bash_array(_read(rel), rel, name)


def _parse_bash_array(src: str, rel: str, name: str) -> list[Pattern]:
    """The pure half of _bash_array, so the self-test can drive it on a fixture
    rather than on a real file it would then have to keep in sync."""
    lines = src.splitlines()
    start = None
    for n, raw in enumerate(lines, 1):
        if re.match(rf"^{re.escape(name)}=\(", raw):
            start = n
            break
    if start is None:
        raise Unparseable(f"{rel}: array {name} not found — it was renamed or removed")

    out: list[Pattern] = []
    for n in range(start + 1, len(lines) + 1):
        raw = lines[n - 1]
        if raw.startswith(")"):
            break
        key, reason, present = _hatch(raw)
        body = _strip_comment(raw)
        m = re.search(r'"([^"]+)"', body)
        if m:
            out.append(Pattern(m.group(1), rel, n, key if present else None, reason, present))
    else:
        raise Unparseable(f"{rel}: array {name} is unterminated")

    if not out:
        raise Unparseable(
            f"{rel}: array {name} declared no entries — an empty carve-out list read as "
            f"success is the vacuous pass this guard exists to prevent")
    return out


def ex_dod_archive() -> list[Pattern]:
    """check-extraction-dod.sh's archival carve-out (KAN-474).

    ARCHIVE_FILES + ARCHIVE_DIRS name the dated records the KAN-428 stale-refs
    sweep prints rather than enforces. Their correctness condition is the ORDINARY
    one — each must match a tracked file — because a dead entry means the archived
    record was deleted or renamed, and the sweep then silently stops exempting it.
    """
    rel = "scripts/check-extraction-dod.sh"
    return _bash_array(rel, "ARCHIVE_FILES") + _bash_array(rel, "ARCHIVE_DIRS")


def ex_dod_routine() -> list[Pattern]:
    """check-extraction-dod.sh's ROUTINE_COUPLED mirror (KAN-474).

    Registered with severity="external". See the SEVERITIES note above resolve()
    for why a dead entry here is not a finding — and for the honest statement of
    what registration does and does not buy.
    """
    return _bash_array("scripts/check-extraction-dod.sh", "ROUTINE_COUPLED")


def ex_doc_manifest() -> list[Pattern]:
    rel = "docs/DOC_SOURCE_OF_TRUTH.md"
    src = _read(rel)
    start, end = "<!-- doc-mirror-manifest:start -->", "<!-- doc-mirror-manifest:end -->"
    if start not in src or end not in src:
        raise Unparseable(f"{rel}: doc-mirror-manifest block delimiters missing")
    head = src.split(start, 1)[0]
    base = head.count("\n") + 1
    block = src.split(start, 1)[1].split(end, 1)[0]
    out: list[Pattern] = []
    for off, raw in enumerate(block.splitlines()):
        for m in re.finditer(r"`([^`]+)`", raw):
            t = m.group(1)
            if re.match(r"^(docs|scripts|\.github|src|tests)/", t):
                key, reason, present = _hatch(raw)
                out.append(Pattern(t, rel, base + off, key if present else None, reason, present))
    if not out:
        raise Unparseable(f"{rel}: manifest block declared no repo paths")
    return out


def ex_workflow_script_refs() -> list[Pattern]:
    """Every `scripts/...` path a workflow shells out to.

    NOTE the trailing-punctuation strip. The reference scanner's character class
    includes '.', so prose like "see scripts/check-db-invariants.py." captured
    the sentence's full stop and reported a DEAD pattern for a file that plainly
    exists. Two of the six DEAD findings at implementation time were this bug.
    Standing false positives are exactly what teaches a team to wave a gate
    through, so the extractor is fixed here rather than the findings excepted.
    """
    out: list[Pattern] = []
    wf_dir = REPO / ".github/workflows"
    if not wf_dir.is_dir():
        raise Unparseable(".github/workflows/ is missing")
    seen: set[tuple[str, str]] = set()
    for wf in sorted(wf_dir.glob("*.yml")):
        rel = str(wf.relative_to(REPO))
        for n, raw in enumerate(wf.read_text(encoding="utf-8").splitlines(), 1):
            for m in re.finditer(r"scripts/[A-Za-z0-9._/-]+", raw):
                ref = m.group(0).rstrip(".,;:)\"'")
                if (rel, ref) in seen:
                    continue
                seen.add((rel, ref))
                key, reason, present = _hatch(raw)
                out.append(Pattern(ref, rel, n, key if present else None, reason, present))
    if not out:
        raise Unparseable(".github/workflows/*.yml referenced no scripts/ paths")
    return out


def _fixed(rel: str, patterns: list[str]) -> Callable[[], list[Pattern]]:
    """For artefacts whose relevant patterns are structural rather than listed —
    the file must still exist, so a rename is still caught."""

    def _inner() -> list[Pattern]:
        _read(rel)
        return [Pattern(p, rel, 0) for p in patterns]

    return _inner


class Artefact(NamedTuple):
    name: str
    syntax: str
    extract: Callable[[], list[Pattern]]
    note: str
    severity: str = SEV_BLOCKING


REGISTRY: list[Artefact] = [
    # --- the CI policy gates: a dead pattern here is a disarmed control ------
    Artefact(".github/signup-surface.paths", "bash-case", ex_signup_globs,
             "un-skippable signup E2E gate (KAN-413)"),
    Artefact(".github/CODEOWNERS", "codeowners", ex_codeowners,
             "review requirement on security-critical paths (SEC-3)"),
    Artefact("scripts/check-ui-copy-ownership.sh", "bash-dbl-bracket", ex_ui_copy,
             "founder UI/copy approval gate (KAN-411)"),
    Artefact("scripts/check-service-role-client.sh", "literal",
             _fixed("scripts/check-service-role-client.sh",
                    ["src/", "src/modules/platform/supabase-service.ts"]),
             "RLS-bypass containment (KAN-352)"),
    Artefact("stryker.config.mjs", "literal", ex_stryker,
             "mutation coverage of security modules"),
    Artefact("scripts/check-routine-ownership.sh", "literal", ex_routine_ownership,
             "KAN-361 one-concern-one-owner markers"),
    Artefact("scripts/check-server-action-exports.sh", "literal",
             _fixed("scripts/check-server-action-exports.sh", ["src/"]),
             "BUGS-12 'use server' export guard"),
    Artefact("scripts/check-codeowners-single.sh", "literal",
             _fixed("scripts/check-codeowners-single.sh",
                    [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]),
             "SEC-3; 2 of the 3 candidates are EXPECTED absent — the guard's job is "
             "to prove there is exactly one CODEOWNERS, so those two are excepted"),
    Artefact("scripts/check-extraction-dod.sh (ARCHIVE_FILES)", "literal", ex_dod_archive,
             "KAN-428 DoD archival carve-out — a dead entry means the dated record it "
             "exempts was deleted or renamed (KAN-474)"),
    Artefact("scripts/check-extraction-dod.sh (ROUTINE_COUPLED)", "literal", ex_dod_routine,
             "mirror of out-of-repo claude.ai routine prompts (KAN-474)",
             severity=SEV_EXTERNAL),
    Artefact("docs/DOC_SOURCE_OF_TRUTH.md", "literal", ex_doc_manifest,
             "doc mirror manifest (KAN-363)"),
    Artefact(".github/workflows/*.yml", "literal", ex_workflow_script_refs,
             "a workflow shelling out to a moved script fails loudly"),
    Artefact(".github/workflows/lyra-maintenance-deploy.yml", "glob",
             _fixed(".github/workflows/lyra-maintenance-deploy.yml",
                    ["scripts/lyra-maintenance-worker.js", "wrangler.toml",
                     ".github/workflows/lyra-maintenance-deploy.yml"]),
             "silent-skip on drift: a moved worker file means the deploy never runs"),
    Artefact(".github/workflows/pr-checks.yml", "regex",
             _fixed(".github/workflows/pr-checks.yml",
                    [r"^(src/app/|src/middleware|src/modules/|supabase/migrations/|\.github/workflows/"
                     r"|public/\.well-known/|scripts/)"]),
             "architecture-doc freshness check"),
    # --- build / test tooling ------------------------------------------------
    Artefact("tsconfig.json", "glob", _fixed("tsconfig.json", ["src/**"]),
             "@/* -> ./src/* — every '@/' import in the repo"),
    Artefact("jest.config.js", "glob", _fixed("jest.config.js", ["src/**/*.{ts,tsx}"]),
             "collectCoverageFrom"),
    Artefact("eslint.config.mjs", "glob",
             _fixed("eslint.config.mjs",
                    ["tests/**/*.js", "tests/**/*.ts", "scripts/**/*.js"]), ""),
    Artefact("playwright.config.ts", "literal",
             _fixed("playwright.config.ts", ["tests/e2e"]), "testDir"),
    Artefact("playwright.config.ts", "basename-regex",
             _fixed("playwright.config.ts",
                    [r"journey\.authed\.spec\.ts", r"journey\.soak\.spec\.ts",
                     r"signup\.e2e\.spec\.ts"]),
             "AUTHED_MATCH / SOAK_MATCH / SIGNUP_MATCH — resilient to directory moves"),
    Artefact("package.json", "regex",
             _fixed("package.json", [r"tests/(unit|scripts)", r"tests/integration",
                                     r"tests/scripts"]),
             "test:unit is the gate that enforces the test floor"),
]


# ---------------------------------------------------------------------------
# Exceptions declared here rather than inline, for artefacts whose syntax
# forbids comments outright (JSON). Same review surface, same loudness: every
# entry is printed on every run.
# ---------------------------------------------------------------------------

DECLARED_EXCEPTIONS: dict[tuple[str, str], tuple[str, str]] = {
    ("scripts/check-ui-copy-ownership.sh", "tailwind.config.*"): (
        "KAN-419", "Tailwind v4 is CSS-first; defensive stub for a config that may return"),
    ("scripts/check-codeowners-single.sh", "CODEOWNERS"): (
        "KAN-419", "asserted-absent by design — the guard proves there is only one"),
    ("scripts/check-codeowners-single.sh", "docs/CODEOWNERS"): (
        "KAN-419", "asserted-absent by design — the guard proves there is only one"),
    ("package.json", "tests/integration"): (
        "KAN-417", "dead dir, but `npm run test:integration` is called by "
                   "weekly-health-regression.sh:51 — removal is KAN-417's call, not F1's"),
}


def resolve(files: list[str]) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Returns (dead, excepted, live, external). Raises Unparseable -> exit 2.

    SEVERITY `external` — WHY A FOURTH BUCKET, AND WHAT IT DOES NOT BUY (KAN-474)
    ----------------------------------------------------------------------------
    Every other registered pattern makes a claim ABOUT THE TREE, so "matches
    nothing" decides it. check-extraction-dod.sh's ROUTINE_COUPLED does not: its
    entries mirror paths as claude.ai routine PROMPTS spell them, and a prompt
    lives outside every repository CI can read. After a move and before Luisa
    edits the prompt, the correct value there is the OLD path — the mismatch IS
    the signal. Before the move, the same entry legitimately matches. So the tree
    cannot decide this list in either direction, and both available verdicts are
    wrong some of the time:

      * blocking  -> reddens the build for the deliberate act of NOT rewriting the
                     mirror, which is the failure #771 fixed;
      * advisory  -> emits a ::warning:: in the normal steady state, and a warning
                     that fires when nothing is wrong is one people learn to skip.

    Hence a third class. It is enumerated and printed on every run, and it is
    never a failure in either direction.

    ⚠️ STATE THE GAP. Registration here buys exactly two things, and it is worth
    being precise because "registered with CTL-035" reads like more than it is:

      1. The block cannot silently VANISH. The extractor parses the array out of
         the live script, so renaming, deleting or emptying ROUTINE_COUPLED raises
         Unparseable -> exit 2. That is the half that was genuinely missing: the
         defect #771 fixed was a blanket path rewrite quietly disabling the
         attestation, and nothing was watching this file at all.
      2. Every entry is printed with its current tree state on every run, so the
         mirror is auditable rather than invisible.

    It does NOT verify that an entry matches what any prompt actually says. No
    control in this repo can — that is a human check, and it is what the
    `routine-prompts` attestation exists to demand.
    """
    dead: list[dict] = []
    excepted: list[dict] = []
    live: list[dict] = []
    external: list[dict] = []

    for art in REGISTRY:
        matcher = MATCHERS[art.syntax]
        for pat in art.extract():
            hits = matcher(pat.pattern, files)
            row = {
                "artefact": art.name,
                "syntax": art.syntax,
                "severity": art.severity,
                "pattern": pat.pattern,
                "source": pat.source,
                "line": pat.line,
                "matches": len(hits),
                "note": art.note,
            }

            if art.severity == SEV_EXTERNAL:
                # Neither verdict is a failure — but which one it is today is
                # recorded, because that is the only auditable thing here.
                external.append(row)
                continue

            if hits:
                live.append(row)
                continue

            # Dead. Is it excepted?
            declared = DECLARED_EXCEPTIONS.get((art.name, pat.pattern))
            if pat.hatch_key:
                row["key"], row["reason"] = pat.hatch_key, pat.hatch_reason
                excepted.append(row)
            elif declared:
                row["key"], row["reason"] = declared
                excepted.append(row)
            elif pat.hatch_present:
                # A marker was present but carried no Jira key (§7.7 rule 2).
                # This is a failure, not a pass: an unattributable exception is
                # how a permanent suppression gets in without anyone owning it.
                row["reason"] = "escape-hatch marker present but carries no Jira key"
                dead.append(row)
            else:
                dead.append(row)

    return dead, excepted, live, external


def stale_exceptions(excepted: list[dict]) -> list[tuple[str, str]]:
    """Declared exceptions that no longer suppress anything.

    An exception outliving the pattern it excused is drift in its own right —
    it makes the register look busier than it is and hides that the underlying
    problem was fixed. Reported as a warning, never a failure: a stale entry is
    untidy, not unsafe.
    """
    used = {(r["artefact"], r["pattern"]) for r in excepted}
    return [k for k in DECLARED_EXCEPTIONS if k not in used]


def report(dead: list[dict], excepted: list[dict], live: list[dict],
           external: list[dict]) -> int:
    by_artefact: dict[str, list[dict]] = {}
    for row in live + excepted + dead + external:
        by_artefact.setdefault(row["artefact"], []).append(row)

    for name in [a.name for a in REGISTRY]:
        rows = by_artefact.get(name)
        if rows is None:
            continue
        n_live = sum(1 for r in rows if r["matches"])
        if rows[0]["severity"] == SEV_EXTERNAL:
            # NOT "n live out of m" — that phrasing would read the absent ones as
            # a shortfall, and here they are the expected state after a move.
            print(f"NOTE {name} — {len(rows)} mirrored patterns "
                  f"({n_live} currently match the tree, {len(rows) - n_live} do not; "
                  f"neither is a failure)")
        else:
            print(f"OK  {name} — {n_live}/{len(rows)} live")
        by_artefact.pop(name, None)

    # Every external entry, every run — the same loudness standard as §7.7 rule 3,
    # and the only auditable output this class produces.
    if external:
        absent = [r for r in external if not r["matches"]]
        print(f"\nExternal (out-of-repo referent) patterns ({len(external)}):")
        for r in external:
            state = "matches tree" if r["matches"] else "absent from tree (expected)"
            print(f"  - {r['artefact']}: {r['pattern']}  [{state}]")
        if absent:
            print(f"  {len(absent)} of these name a path that no longer exists. That is not "
                  f"drift: it is the mirror holding the spelling an out-of-repo routine "
                  f"prompt still uses, which is what the attestation exists to raise.")

    # §7.7 rule 3 — every active exception, every run.
    if excepted:
        print(f"\nActive guard-path-ok exceptions ({len(excepted)}):")
        for r in excepted:
            print(f"  - {r['artefact']}: {r['pattern']}  [{r.get('key')}] {r.get('reason','')}")
        if len(excepted) > MAX_EXCEPTIONS:
            print(f"::warning::{len(excepted)} guard-path-ok exceptions active "
                  f"(threshold {MAX_EXCEPTIONS}) — the register is being used to "
                  f"paper over drift rather than fix it.")

    for artefact, pattern in stale_exceptions(excepted):
        print(f"::warning::stale guard-path-ok exception — '{pattern}' in {artefact} "
              f"is excepted but is no longer dead (or no longer registered). Remove it: "
              f"an exception that outlives its cause makes the register unreadable.")

    blocking = [r for r in dead if r["severity"] == "blocking"]
    advisory = [r for r in dead if r["severity"] != "blocking"]

    def loc(r: dict) -> str:
        # line 0 means "structural, not read from a specific line" — GitHub
        # rejects line=0, so emit a file-scoped annotation instead of a bad one.
        return f"file={r['source']},line={r['line']}" if r["line"] else f"file={r['source']}"

    for r in advisory:
        print(f"::warning {loc(r)}::guard-path-drift: "
              f"pattern matches no tracked file — '{r['pattern']}' (advisory)")

    for r in blocking:
        extra = f" [{r['reason']}]" if r.get("reason") else ""
        print(f"::error {loc(r)}::guard-path-drift: pattern "
              f"matches no tracked file — '{r['pattern']}'. This control is not "
              f"operating.{extra} If the path moved, update it here in the SAME PR as "
              f"the move. If it is deliberately forward-looking, add: "
              f"# guard-path-ok: <JIRA-KEY> <reason>")

    total = len(live) + len(excepted) + len(dead)
    print(f"\n{total} registered patterns — {len(live)} live, "
          f"{len(excepted)} excepted, {len(dead)} dead.")
    if external:
        print(f"{len(external)} further patterns registered as external — enumerated above, "
              f"never failed in either direction.")

    if blocking:
        print(f"::error::{len(blocking)} path pattern(s) match nothing. Each one is a "
              f"control that reports green while protecting nothing (KAN-414 F1).")
        return EXIT_DRIFT
    return EXIT_OK


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--list", action="store_true", help="print every pattern and its verdict")
    ap.add_argument("--self-test", action="store_true", help="run the built-in matcher fixtures")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        files = tracked_files()
        dead, excepted, live, external = resolve(files)
    except Unparseable as exc:
        # §7.5 — fail closed. Never 0, never 1.
        print(f"::error::guard-path-drift cannot verify the estate: {exc}")
        print("::error::Failing closed: a guard that cannot read its own inputs must "
              "not report green (Workflow & Backup Integrity Policy).")
        return EXIT_FAIL_CLOSED

    if args.list:
        rows = live + excepted + dead + external
        for r in sorted(rows, key=lambda x: (x["artefact"], x["pattern"])):
            if r["severity"] == SEV_EXTERNAL:
                state = "EXTERNAL"
            else:
                state = "LIVE" if r["matches"] else ("EXCEPT" if r.get("key") else "DEAD")
            print(f"{state:8} {r['matches']:5}  {r['artefact']}  ->  {r['pattern']}")
        return EXIT_OK

    return report(dead, excepted, live, external)


def self_test() -> int:
    """Fixtures for the matcher semantics §7.3 says must not be got wrong.

    ⚠️ THESE PATHS ARE SYNTHETIC AND MUST NOT BE UPDATED WHEN REAL FILES MOVE.
    They are a hand-built corpus for exercising the seven matchers, not a
    description of the repo. Several cases depend on the *shape* of this list
    (e.g. "literal dir prefix" asserts that exactly two entries sit under one
    prefix), so rewriting a path here silently changes what is asserted.

    KAN-415 D1: a blanket `src/lib/* -> src/modules/platform/*` rewrite did
    exactly that, dropping the prefix from two matches to one and turning
    "literal dir prefix" red. The self-test caught it unaided.

    So the corpus now lives under `src/__fixture__/`, a directory that does not
    exist and never will. That is not cosmetic — it makes the instruction above
    enforce itself instead of relying on being read. A find-and-replace for a
    real path cannot touch these, they cannot be mistaken for a description of
    the tree, and they no longer trip the extraction DoD guard's stale-reference
    scan, which correctly reads a real-looking old path in a tracked file as
    drift. A fixture that looks like production code will keep being maintained
    as though it were.
    """
    files = [
        "src/__fixture__/app/page.tsx", "src/__fixture__/app/a/b/c.tsx",
        "src/__fixture__/lib/age/record.ts", "src/__fixture__/lib/env.ts",
        "src/__fixture__/other/env.ts", "tests/__fixture__/unit/a.ts",
        "tests/__fixture__/unit/deep/b.ts",
        "tests/__fixture__/e2e/authed/journey.authed.spec.ts",
    ]
    cases: list[tuple[str, bool]] = []

    # bash '*' crosses '/' — the false-DEAD trap.
    cases.append(("bash-case * crosses /",
                  len(m_bash_case("src/__fixture__/app/*.tsx", files)) == 2))
    # trailing /** prefix rule.
    cases.append(("bash-case trailing /** prefix",
                  m_bash_case("src/__fixture__/lib/age/**", files)
                  == ["src/__fixture__/lib/age/record.ts"]))
    # fnmatch would match only the top-level file — prove we are not fnmatch.
    cases.append(("bash-dbl-bracket * crosses /",
                  len(m_bash_dbl_bracket("src/__fixture__/app/*.tsx", files)) == 2))
    # CODEOWNERS leading-'/' anchoring: the rooted path is ONE file, not any nested env.ts.
    cases.append(("codeowners root anchoring",
                  m_codeowners("/src/__fixture__/lib/env.ts", files)
                  == ["src/__fixture__/lib/env.ts"]))
    # glob '**' vs '*' depth. The contrast is the point: `**` reaches every
    # nested .ts under tests/ (3 of them, including the 3-deep e2e spec), while
    # `*` stays inside one segment and therefore reaches none, since no .ts sits
    # directly in tests/__fixture__/.
    cases.append(("glob ** spans depth", len(m_glob("tests/__fixture__/**/*.ts", files)) == 3))
    cases.append(("glob * is one segment", len(m_glob("tests/__fixture__/*.ts", files)) == 0))
    # basename regex survives a directory move.
    cases.append(("basename-regex survives move",
                  len(m_basename_regex(r"journey\.authed\.spec\.ts", files)) == 1))
    # literal directory prefix.
    cases.append(("literal dir prefix", len(m_literal("src/__fixture__/lib", files)) == 2))
    # hatch parsing: key required.
    cases.append(("hatch with key", _hatch("foo # guard-path-ok: KAN-419 because")[0] == "KAN-419"))
    cases.append(("hatch without key rejected", _hatch("foo # guard-path-ok: because")[0] is None))
    cases.append(("no hatch", _hatch("plain line")[2] is False))
    # the trailing-punctuation strip that fixed two false DEADs.
    cases.append(("trailing dot stripped", "scripts/x.py." .rstrip(".,;:)\"'") == "scripts/x.py"))

    # --- KAN-474: the bash-array extractor behind check-extraction-dod.sh ----
    # Synthetic, for the same reason as the corpus above: this asserts the
    # PARSER's shape, not the contents of any real list.
    fixture = "\n".join([
        'PRELUDE=(',
        '  "src/__fixture__/never/a.ts"',
        ')',
        'ARCHIVE_FILES=(',
        '  "src/__fixture__/one.ts"     # a trailing comment',
        '                               # a continuation comment, no entry here',
        '  "src/__fixture__/two.ts"   # guard-path-ok: KAN-474 fixture',
        ')',
        'AFTERWARDS=(',
        '  "src/__fixture__/never/b.ts"',
        ')',
    ])
    got = _parse_bash_array(fixture, "fixture.sh", "ARCHIVE_FILES")
    # Terminating at `)` in column 0 is what keeps a later array out. Without it
    # the extractor would silently adopt entries nobody registered.
    cases.append(("bash-array stops at its own terminator",
                  [p.pattern for p in got]
                  == ["src/__fixture__/one.ts", "src/__fixture__/two.ts"]))
    cases.append(("bash-array reports real line numbers", [p.line for p in got] == [5, 7]))
    cases.append(("bash-array reads an inline hatch", got[1].hatch_key == "KAN-474"))

    def _raises(src: str, name: str) -> bool:
        try:
            _parse_bash_array(src, "fixture.sh", name)
        except Unparseable:
            return True
        return False

    # A renamed or deleted array must fail closed, never return []. This is the
    # half of the KAN-474 registration that is genuine enforcement: it is what
    # stops the ROUTINE_COUPLED block from silently vanishing.
    cases.append(("bash-array missing array is unparseable", _raises(fixture, "NO_SUCH_LIST")))
    cases.append(("bash-array empty array is unparseable",
                  _raises('ARCHIVE_FILES=(\n  # everything commented out\n)\n', "ARCHIVE_FILES")))
    cases.append(("bash-array unterminated array is unparseable",
                  _raises('ARCHIVE_FILES=(\n  "src/__fixture__/one.ts"\n', "ARCHIVE_FILES")))

    # An external-severity artefact never contributes to the failing set, in
    # EITHER direction — the property the whole fourth bucket exists to hold.
    ext_art = Artefact("fixture (mirror)", "literal",
                       lambda: [Pattern("src/__fixture__/gone.ts", "fixture.sh", 1),
                                Pattern("src/__fixture__/lib/env.ts", "fixture.sh", 2)],
                       "", severity=SEV_EXTERNAL)
    saved = REGISTRY[:]
    try:
        REGISTRY[:] = [ext_art]
        d, e, lv, ext = resolve(files)
    finally:
        REGISTRY[:] = saved
    cases.append(("external severity never fails, absent or present",
                  (d, e, lv) == ([], [], []) and len(ext) == 2
                  and [r["matches"] for r in ext] == [0, 1]))

    failed = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}")
    if failed:
        print(f"::error::self-test: {len(failed)} case(s) failed: {', '.join(failed)}")
        return EXIT_DRIFT
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
