#!/usr/bin/env python3
"""KAN-419 — path-coupling inventory scanner (RESEARCH EVIDENCE, not a CI guard).

This script is the reproduction harness for docs/modularisation/KAN-419-path-coupling.md.
It extracts every path literal / glob out of Lyra's verification + documentation
estate and reports, for each one, whether it matches at least one TRACKED file
today.  A pattern that matches nothing is a control that is not operating.

It is deliberately READ-ONLY and deliberately NOT wired into CI — the CI guard it
specifies (`scripts/check-guard-path-drift.sh`) is implemented by F1 (KAN-428
consumes this register).  Keeping the two separate means this evidence script can
be re-run against any commit without changing build behaviour.

Usage:
    python3 docs/modularisation/kan419-scan.py            # human-readable table
    python3 docs/modularisation/kan419-scan.py --json     # machine-readable
    python3 docs/modularisation/kan419-scan.py --dead     # only DEAD patterns

Exit code is always 0 — this is a report, not a gate.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(REPO), "ls-files"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [ln for ln in out.splitlines() if ln]


FILES = tracked_files()


# ---------------------------------------------------------------------------
# Matching semantics.  Each artefact uses a DIFFERENT syntax; the detector this
# spike specifies must implement all of them, so they are modelled separately
# here rather than collapsed into one "close enough" matcher.
# ---------------------------------------------------------------------------

def m_bash_case(pattern: str) -> list[str]:
    """bash `case $f in $g)` semantics, as used by scripts/check-signup-surface-gate.sh.

    Critically, bash pattern `*` matches ACROSS '/' — so `src/app/*.tsx` matches
    `src/app/a/b/c.tsx`.  Plus the script's extra rule: a trailing `/**` also
    matches the directory prefix at any depth.  Verified empirically against the
    real function (including the `(auth)` route-group parens, which do NOT break
    the case pattern).
    """
    rx = _bash_pat_to_re(pattern)
    hits = [f for f in FILES if rx.fullmatch(f)]
    if pattern.endswith("/**"):
        pref = pattern[: -len("/**")] + "/"
        hits += [f for f in FILES if f.startswith(pref) and f not in hits]
    return hits


def _bash_pat_to_re(pattern: str) -> re.Pattern[str]:
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if c == "*":
            out.append(".*")          # bash: '*' crosses '/'
        elif c == "?":
            out.append(".")
        elif c == "[":
            j = pattern.find("]", i + 1)
            if j == -1:
                out.append(re.escape(c))
            else:
                out.append(pattern[i:j + 1])
                i = j
        else:
            out.append(re.escape(c))
        i += 1
    return re.compile("".join(out))


def m_bash_dbl_bracket(pattern: str) -> list[str]:
    """bash `[[ $f == pat ]]` — same globbing rules as m_bash_case, no /** rule."""
    rx = _bash_pat_to_re(pattern)
    return [f for f in FILES if rx.fullmatch(f)]


def m_codeowners(pattern: str) -> list[str]:
    """gitignore-style CODEOWNERS semantics (leading '/' = repo root anchor)."""
    p = pattern.lstrip("/")
    if p == "*":
        return list(FILES)
    if p.endswith("/"):
        return [f for f in FILES if f.startswith(p)]
    return [f for f in FILES if f == p or f.startswith(p + "/")]


def m_literal(pattern: str) -> list[str]:
    """An exact repo-relative path (or a directory prefix)."""
    return [f for f in FILES if f == pattern or f.startswith(pattern.rstrip("/") + "/")]


def m_regex(pattern: str) -> list[str]:
    rx = re.compile(pattern)
    return [f for f in FILES if rx.search(f)]


def m_basename_regex(pattern: str) -> list[str]:
    """Playwright testMatch/testIgnore — a regex applied to the file path, in
    practice pinned to the BASENAME only, so it survives directory moves."""
    return m_regex(pattern)


def m_glob(pattern: str) -> list[str]:
    """`**` = any depth, `*` = within one segment (eslint / jest / tsconfig style)."""
    rx = re.compile(
        pattern.replace(".", r"\.")
        .replace("**/", "\x00")
        .replace("**", ".*")
        .replace("*", "[^/]*")
        .replace("\x00", "(?:.*/)?")
        .replace("{ts,tsx}", "(?:ts|tsx)")
    )
    return [f for f in FILES if rx.fullmatch(f)]


# ---------------------------------------------------------------------------
# The register.  (artefact, syntax, matcher, patterns, note)
# Patterns are read FROM the live files wherever possible so this script cannot
# drift from the artefacts it audits.
# ---------------------------------------------------------------------------

def read(rel: str) -> str:
    return (REPO / rel).read_text(encoding="utf-8")


def signup_globs() -> list[str]:
    globs = []
    for line in read(".github/signup-surface.paths").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            globs.append(line)
    return globs


def codeowners_patterns() -> list[str]:
    pats = []
    for line in read(".github/CODEOWNERS").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        pats.append(line.split()[0])
    return pats


def ui_copy_patterns() -> list[tuple[str, str]]:
    """(pattern, verdict) pairs out of is_protected() in check-ui-copy-ownership.sh."""
    src = read("scripts/check-ui-copy-ownership.sh")
    body = src.split("is_protected() {", 1)[1].split("\n}", 1)[0]
    out = []
    for m in re.finditer(r'\[\[\s*\$f\s*==\s*(\S+?)\s*\]\]\s*&&\s*return\s*([01])', body):
        out.append((m.group(1), "carve-out" if m.group(2) == "1" else "protected"))
    return out


def stryker_mutate() -> list[str]:
    src = read("stryker.config.mjs")
    block = src.split("mutate: [", 1)[1].split("]", 1)[0]
    return re.findall(r"'([^']+)'", block)


def routine_ownership_files() -> list[str]:
    src = read("scripts/check-routine-ownership.sh")
    return re.findall(r'^check_marker "([^"]+)"', src, re.M)


def doc_manifest_paths() -> list[str]:
    src = read("docs/DOC_SOURCE_OF_TRUTH.md")
    block = src.split("<!-- doc-mirror-manifest:start -->", 1)[1] \
               .split("<!-- doc-mirror-manifest:end -->", 1)[0]
    return [t for t in re.findall(r"`([^`]+)`", block)
            if re.match(r"^(docs|scripts|\.github|src|tests)/", t)]


def workflow_script_refs() -> list[str]:
    """Every scripts/* path a workflow shells out to."""
    refs = set()
    for wf in sorted((REPO / ".github/workflows").glob("*.yml")):
        for m in re.finditer(r"scripts/[A-Za-z0-9._/-]+", wf.read_text(encoding="utf-8")):
            refs.add(m.group(0))
    return sorted(refs)


REGISTER: list[dict] = []


def add(artefact, syntax, matcher, patterns, note=""):
    for p in patterns:
        verdict = ""
        if isinstance(p, tuple):
            p, verdict = p
        hits = matcher(p)
        REGISTER.append({
            "artefact": artefact,
            "syntax": syntax,
            "pattern": p,
            "role": verdict,
            "matches": len(hits),
            "status": "LIVE" if hits else "DEAD",
            "sample": sorted(hits)[:3],
            "note": note,
        })


def build() -> None:
    # --- A. the five CI policy gates ---------------------------------------
    add(".github/signup-surface.paths", "bash case-glob (** = any depth)",
        m_bash_case, signup_globs(),
        "un-skippable signup E2E gate; supabase/migrations/** is content-filtered")

    add(".github/CODEOWNERS", "gitignore-style, '/' root-anchored",
        m_codeowners, codeowners_patterns(),
        "review requirement on security-critical paths (SEC-3)")

    add("scripts/check-ui-copy-ownership.sh", "bash [[ == ]] glob ('*' crosses '/')",
        m_bash_dbl_bracket, ui_copy_patterns(),
        "founder UI/copy approval gate (KAN-411)")

    add("scripts/check-service-role-client.sh", "grep -r root + literal factory path",
        m_literal, ["src/", "src/lib/supabase-service.ts"],
        "RLS-bypass containment (KAN-352)")

    add("stryker.config.mjs", "exact repo-relative path (JS array)",
        m_literal, stryker_mutate(),
        "mutation coverage of security modules")

    # --- other path-classifying guards found by the step-4 sweep -----------
    add("scripts/check-routine-ownership.sh", "exact repo-relative path (bash literal)",
        m_literal, routine_ownership_files(),
        "KAN-361 one-concern-one-owner markers; file literal AND content needle")

    add("scripts/check-server-action-exports.sh", "grep -r root",
        m_literal, ["src/"], "BUGS-12 'use server' export guard")

    add("scripts/check-codeowners-single.sh", "exact candidate paths",
        m_literal, [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"],
        "SEC-3; 2 of 3 candidates are EXPECTED to be absent — see artefact notes")

    add("docs/DOC_SOURCE_OF_TRUTH.md", "backtick-quoted repo path inside manifest block",
        m_literal, doc_manifest_paths(),
        "already self-validating via scripts/check-doc-mirror-manifest.sh")

    add(".github/workflows/*.yml", "shell literal (bash scripts/X)",
        m_literal, workflow_script_refs(),
        "a workflow step that shells out to a moved/renamed script fails loudly")

    add(".github/workflows/lyra-maintenance-deploy.yml", "GitHub Actions paths: filter",
        m_glob, ["scripts/lyra-maintenance-worker.js", "wrangler.toml",
                 ".github/workflows/lyra-maintenance-deploy.yml"],
        "silent-skip on drift: a moved worker file means the deploy never runs")

    add(".github/workflows/pr-checks.yml", "grep -E anchored regex on changed paths",
        m_regex, [r"^(src/app/|src/middleware|supabase/migrations/|\.github/workflows/|public/\.well-known/|scripts/)"],
        "architecture-doc freshness check")

    # --- build / test tooling ---------------------------------------------
    add("tsconfig.json", "TS path mapping",
        m_glob, ["src/**"], "@/* -> ./src/* — every '@/' import in the repo")

    add("jest.config.js", "jest glob",
        m_glob, ["src/**/*.{ts,tsx}"], "collectCoverageFrom")

    add("package.json", "jest --testPathPatterns regex",
        m_regex, [r"tests/(unit|scripts)", r"tests/integration", r"tests/scripts"],
        "test:unit is the gate that enforces the 2118-test floor")

    add("eslint.config.mjs", "eslint flat-config glob",
        m_glob, ["tests/**/*.js", "tests/**/*.ts", "scripts/**/*.js"], "")

    add("playwright.config.ts", "testDir literal + basename regex",
        m_literal, ["tests/e2e"], "testDir — the one path literal in the config")

    add("playwright.config.ts", "testMatch/testIgnore regex (basename-pinned)",
        m_basename_regex, [r"journey\.authed\.spec\.ts", r"journey\.soak\.spec\.ts",
                           r"signup\.e2e\.spec\.ts"],
        "AUTHED_MATCH / SOAK_MATCH / SIGNUP_MATCH — resilient to directory moves")


def main() -> int:
    build()
    args = set(sys.argv[1:])
    rows = REGISTER
    if "--dead" in args:
        rows = [r for r in rows if r["status"] == "DEAD"]
    if "--json" in args:
        print(json.dumps(rows, indent=2))
        return 0
    print(f"KAN-419 path-coupling scan — {len(FILES)} tracked files\n")
    cur = None
    for r in rows:
        if r["artefact"] != cur:
            cur = r["artefact"]
            print(f"\n## {cur}   [{r['syntax']}]")
        role = f" ({r['role']})" if r["role"] else ""
        print(f"  {r['status']:4}  {r['matches']:>4}  {r['pattern']}{role}")
    dead = [r for r in REGISTER if r["status"] == "DEAD"]
    print(f"\n\nTOTAL patterns: {len(REGISTER)}   LIVE: {len(REGISTER)-len(dead)}   DEAD: {len(dead)}")
    for r in dead:
        print(f"  DEAD  {r['artefact']}  ->  {r['pattern']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
