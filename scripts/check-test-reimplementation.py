#!/usr/bin/env python3
"""CTL-038 — detect tests that REIMPLEMENT their subject instead of exercising it.

WHY THIS EXISTS (BUGS-85)
-------------------------
`tests/unit/maintenance-page.test.js` reported **19 passing tests** for the
public maintenance page's email-capture form and asserted nothing whatsoever
about it. It opened by re-declaring the worker's own logic inside the test file:

    // Extract validation logic from Worker for testing
    function isValidEmail(email) { ... }
    function createRateLimiter() { ... }

and then tested those copies. `scripts/lyra-maintenance-worker.js` was never
loaded. Proven 2026-08-01 by mutating the worker and re-running that suite:

    isValidEmail  -> return true    ->  19/19 PASS
    isRateLimited -> return false   ->  19/19 PASS
    escapeHtml    -> identity       ->  19/19 PASS

So input validation, abuse limiting and HTML escaping were all unguarded on a
public unauthenticated endpoint, while CI showed 19 green tests. That is worse
than having no tests: 19 passing tests read as coverage, so nobody looked.

This is the failure CLAUDE.md names directly — *a control that has never been
seen to fail is indistinguishable from no control* — with an extra twist. The
usual version is a control that never fires. This one fires constantly and
reports on a copy.

WHAT IT DETECTS
---------------
A test file is flagged when ALL of these hold:

  1. it names a subject module (via `SRC.<key>`, or a literal `src/…` /
     `scripts/…` path), AND
  2. it defines a function whose name ALSO exists in that subject module, AND
  3. it never IMPORTS the subject and never INVOKES it as a subprocess.

Condition 3 is what separates the two severities, and it is the reason this is
not just a duplicate-name grep:

  vacuous — the subject is never imported and never invoked. Nothing in the file
            can observe the real code. This is BUGS-85's shape.
  partial — the subject IS reached (imported, or run via execFileSync/spawnSync,
            which is the legitimate `tests/scripts/` convention), but the file
            ALSO keeps a private copy of some of its logic. Not a hole; a drift
            hazard, because the copy can diverge silently.

DELIBERATELY NARROW. A test that shares a name with its subject by coincidence
(`setup`, `run`, `main`) and imports it is not reported. Standing noise is what
teaches people to wave a gate through — the same lesson as CTL-031, which keeps
workflow YAML out of scope for exactly this reason.

RATCHET SEMANTICS
-----------------
The baseline is shrink-only and fails in BOTH directions:

  * a NEW finding, or an existing one getting worse (partial -> vacuous), fails;
  * a baselined finding that has been FIXED also fails, until the baseline is
    updated.

A list you may only add to is a suppression list, not a ratchet. The second rule
is what stops the baseline quietly over-stating the problem — the same design as
CTL-036 and CTL-037.

FAIL-CLOSED
-----------
A missing or unreadable baseline exits 2, not 0. SEC-111 is the precedent: a
guard that cannot run must not report success.

USAGE
    python3 scripts/check-test-reimplementation.py
    python3 scripts/check-test-reimplementation.py --write-baseline
    python3 scripts/check-test-reimplementation.py --self-test
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / "tests" / "support" / "test-reimplementation-baseline.json"
MANIFEST = REPO / "tests" / "support" / "source-paths.json"

# `function foo(` / `const foo = (…) =>` / `const foo = function`
DEF = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("
    r"|^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?"
    r"(?:\([^)]*\)\s*=>|function\b)",
    re.M,
)
IMPORT = re.compile(
    r"""(?:from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\))"""
)
# The tests/scripts/ convention: reach the real thing via a child process.
# The trailing `\(` is load-bearing — it restricts this to CALL SITES. Without
# it the pattern also matched the `const { execFileSync } = require(...)`
# destructure at the top of a file, whose argument window then swallowed the
# rest of the file and reported every subject as "reached". Pinned as a
# self-test fixture below.
INVOKE = re.compile(r"\b(?:execFileSync|execSync|spawnSync|spawn|execa)\s*\(")
SRC_KEY = re.compile(r"SRC\.([A-Za-z_$][\w$]*)")
PATH_LIT = re.compile(r"""['"]((?:src|scripts)/[\w./-]+\.(?:ts|tsx|js|mjs))['"]""")

# Names too generic to mean anything. A collision on these is noise, and noise
# is what gets a gate waved through.
GENERIC = {
    "setup", "teardown", "run", "main", "init", "make", "build", "get", "set",
    "create", "reset", "start", "stop", "next", "post", "handler", "fetch",
    "load", "parse", "format", "noop", "wait", "sleep", "chain", "mock",
}

ALLOW = re.compile(r"#\s*test-reimplementation-ok:|//\s*test-reimplementation-ok:")


def sh(*args: str) -> str:
    return subprocess.run(
        list(args), capture_output=True, text=True, cwd=str(REPO)
    ).stdout


def read(p: Path | str) -> str | None:
    """Read a file, returning None only when it genuinely does not exist.

    `existsSync`-then-read is a TOCTOU race (CodeQL js/file-system-race, hit
    during CTL-035); catch the ENOENT instead of asking first.
    """
    try:
        return Path(p).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        return None


def defined_names(text: str) -> set[str]:
    return {m.group(1) or m.group(2) for m in DEF.finditer(text)} - {None}


def subjects_of(text: str, manifest: dict) -> dict[str, set[str]]:
    """Map each subject module to the TOKENS this file used to refer to it.

    Keeping the tokens matters. A test may name its subject as the literal
    `scripts/gen-test-paths.mjs` or as `SRC.genTestPaths`, and the reach check
    below has to look for whichever form the file actually uses — searching for
    the path stem alone reported a file as `vacuous` that in fact drives the
    real generator through `execFileSync(SRC.genTestPaths, …)`.
    """
    out: dict[str, set[str]] = {}
    for key in SRC_KEY.findall(text):
        p = manifest.get(key)
        if p and p.endswith((".ts", ".tsx", ".js", ".mjs")):
            out.setdefault(p, set()).add(f"SRC.{key}")
    for p in PATH_LIT.findall(text):
        out.setdefault(p, set()).add(p)
    for p in list(out):
        out[p].add(Path(p).stem)
    return out


# How much text after an invocation counts as its argument list. Generous
# enough for a multi-line execFileSync, tight enough not to swallow the file.
INVOKE_WINDOW = 240


def reaches_subject(text: str, subject: str, tokens: set[str]) -> bool:
    """Does the test actually get at the real module — by import or subprocess?"""
    stem = Path(subject).stem
    for a, b in IMPORT.findall(text):
        spec = a or b
        if stem in spec or subject in spec:
            return True

    # A subprocess invocation counts — that is how `tests/scripts/` legitimately
    # drives an ES module that jest cannot transform. But the module must appear
    # in the CALL's arguments; merely importing `child_process` somewhere in a
    # file that also happens to mention the subject proves nothing.
    for m in INVOKE.finditer(text):
        window = text[m.start() : m.start() + INVOKE_WINDOW]
        if any(tok in window for tok in tokens):
            return True
    return False


def scan(root: Path, files: list[str], manifest: dict) -> list[dict]:
    findings = []
    for rel in files:
        text = read(root / rel)
        if text is None or ALLOW.search(text):
            continue
        tnames = defined_names(text) - GENERIC
        if not tnames:
            continue
        subs = subjects_of(text, manifest)
        for subject in sorted(subs):
            stext = read(root / subject)
            if stext is None:
                continue
            shared = sorted(tnames & (defined_names(stext) - GENERIC))
            if not shared:
                continue
            reached = reaches_subject(text, subject, subs[subject])
            severity = "partial" if reached else "vacuous"
            findings.append(
                {
                    "test": rel,
                    "subject": subject,
                    "shared": shared,
                    "severity": severity,
                }
            )
    return sorted(findings, key=lambda f: (f["test"], f["subject"]))


def key(f: dict) -> str:
    return f"{f['test']}::{f['subject']}"


RANK = {"partial": 1, "vacuous": 2}


def compare(found: list[dict], baseline: list[dict]) -> tuple[list[str], list[str]]:
    """Returns (failures, notices). Fails on new/worse AND on stale."""
    base = {key(b): b for b in baseline}
    seen = {key(f): f for f in found}
    failures: list[str] = []

    for k, f in sorted(seen.items()):
        b = base.get(k)
        if b is None:
            failures.append(
                f"NEW: {f['test']} reimplements {', '.join(f['shared'])} "
                f"from {f['subject']} ({f['severity']}) — the test can pass "
                f"while the real module is broken."
            )
        elif RANK[f["severity"]] > RANK[b["severity"]]:
            failures.append(
                f"WORSE: {f['test']} vs {f['subject']} went "
                f"{b['severity']} -> {f['severity']}."
            )
        else:
            extra = sorted(set(f["shared"]) - set(b.get("shared", [])))
            if extra:
                failures.append(
                    f"WORSE: {f['test']} vs {f['subject']} now also "
                    f"duplicates {', '.join(extra)}."
                )

    for k, b in sorted(base.items()):
        if k not in seen:
            failures.append(
                f"STALE: {b['test']} vs {b['subject']} is baselined but no "
                f"longer reproduces. Remove it — a list you may only add to "
                f"is a suppression list, not a ratchet."
            )
    return failures, []


# --------------------------------------------------------------------------
# self-test — the blind spot must be reproducible, per SEC-101
# --------------------------------------------------------------------------

BUGS85_TEST = """
const { SRC } = require('../support/source-paths.json');
// Extract validation logic from Worker for testing
function isValidEmail(email) {
  return /^[^\\s@]+@[^\\s@]+$/.test(email);
}
test('accepts valid', () => {
  const src = require('fs').readFileSync(SRC.worker, 'utf8');
  expect(isValidEmail('a@b.c')).toBe(true);
});
"""

WORKER = """
function isValidEmail(email) {
  if (!email) return false;
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}
export default { async fetch() {} };
"""

GOOD_TEST = """
const worker = require('../../scripts/w.js');
function isValidEmail() { throw new Error('unused'); }
test('real', () => {
  const src = require('fs').readFileSync('scripts/w.js', 'utf8');
  expect(worker).toBeDefined();
});
"""

SUBPROCESS_TEST = """
const { execFileSync } = require('node:child_process');
function isValidEmail() { return true; }
test('drives the real thing', () => {
  const src = require('fs').readFileSync('scripts/w.js', 'utf8');
  execFileSync('node', ['scripts/w.js', '--check']);
});
"""

# The blind spot this control shipped with, pinned so it cannot recur (SEC-101).
# The subject is named only as `SRC.worker`, never by path, so a reach check
# that searched for the path stem reported this as `vacuous` — wrong, and
# wrong in the direction that manufactures a false alarm.
SUBPROCESS_VIA_SRC_KEY = """
const { execFileSync } = require('node:child_process');
const { SRC } = require('../support/source-paths.json');
function isValidEmail() { return true; }
test('drives the real thing through the manifest', () => {
  require('fs').readFileSync(SRC.worker, 'utf8');
  execFileSync('node', [SRC.worker, '--check'], { encoding: 'utf-8' });
});
"""

# The converse: importing child_process somewhere in a file that merely mentions
# the subject must NOT count as reaching it. Without this, the fix above would
# have made almost everything `partial`.
INVOKE_UNRELATED = """
const { execFileSync } = require('node:child_process');
const { SRC } = require('../support/source-paths.json');
function isValidEmail() { return true; }
test('reads but never runs the subject', () => {
  require('fs').readFileSync(SRC.worker, 'utf8');
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' });
});
"""


def self_test() -> int:
    cases = [
        ("BUGS-85 shape is detected as vacuous", BUGS85_TEST, "vacuous"),
        ("importing the subject downgrades to partial", GOOD_TEST, "partial"),
        ("subprocess invocation counts as reaching it", SUBPROCESS_TEST, "partial"),
        (
            "subject named only via SRC.<key> still counts (shipped blind spot)",
            SUBPROCESS_VIA_SRC_KEY,
            "partial",
        ),
        (
            "an UNRELATED subprocess call does not count as reaching it",
            INVOKE_UNRELATED,
            "vacuous",
        ),
    ]
    failures = 0
    for name, body, expected in cases:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tests" / "unit").mkdir(parents=True)
            (root / "tests" / "support").mkdir(parents=True, exist_ok=True)
            (root / "scripts").mkdir(parents=True)
            (root / "scripts" / "w.js").write_text(WORKER)
            (root / "tests" / "unit" / "t.test.js").write_text(body)
            got = scan(root, ["tests/unit/t.test.js"], {"worker": "scripts/w.js"})
            sev = got[0]["severity"] if got else "none"
            ok = sev == expected
            print(f"  {'PASS' if ok else 'FAIL'}  {name} (got {sev})")
            failures += 0 if ok else 1

    # A generic-name collision must NOT be reported.
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "tests" / "unit").mkdir(parents=True)
        (root / "scripts").mkdir(parents=True)
        (root / "scripts" / "w.js").write_text("function setup(){}\nfunction run(){}\n")
        (root / "tests" / "unit" / "t.test.js").write_text(
            "function setup(){}\nfunction run(){}\n"
            "test('x',()=>{require('fs').readFileSync('scripts/w.js');});"
        )
        got = scan(root, ["tests/unit/t.test.js"], {})
        ok = not got
        print(f"  {'PASS' if ok else 'FAIL'}  generic names are not reported")
        failures += 0 if ok else 1

    print("self-test:", "OK" if failures == 0 else f"{failures} FAILED")
    return 1 if failures else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    manifest_raw = read(MANIFEST)
    if manifest_raw is None:
        print(f"::error::{MANIFEST} is missing — cannot resolve SRC keys.")
        print("Run `npm run gen:test-paths` first. Failing closed (exit 2).")
        return 2
    try:
        manifest = json.loads(manifest_raw)["SRC"]
    except (ValueError, KeyError) as exc:
        print(f"::error::{MANIFEST} is unreadable ({exc}). Failing closed.")
        return 2

    files = [
        f
        for f in sh("git", "ls-files", "tests").split()
        if f.endswith((".ts", ".tsx", ".js")) and not f.startswith("tests/support/")
    ]
    if not files:
        print("::error::`git ls-files tests` returned nothing — a guard that")
        print("cannot see its inputs must not report success. Failing closed.")
        return 2

    found = scan(REPO, files, manifest)

    if "--write-baseline" in sys.argv:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps(
                {
                    "_comment": (
                        "CTL-038 shrink-only ratchet. Generated by "
                        "scripts/check-test-reimplementation.py --write-baseline. "
                        "Entries may be REMOVED as tests are fixed; adding one "
                        "requires a Jira key in the reason. A stale entry fails "
                        "the build, so this cannot become a suppression list."
                    ),
                    "ticket": "BUGS-85",
                    "findings": found,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"Wrote {BASELINE.relative_to(REPO)} with {len(found)} finding(s).")
        for f in found:
            print(f"  {f['severity']:8} {f['test']} -> {f['subject']}")
        return 0

    raw = read(BASELINE)
    if raw is None:
        print(f"::error::{BASELINE} is missing. A ratchet with no baseline")
        print("cannot distinguish 'clean' from 'not measured'. Failing closed.")
        print("Generate it with: --write-baseline")
        return 2
    try:
        baseline = json.loads(raw)["findings"]
    except (ValueError, KeyError) as exc:
        print(f"::error::{BASELINE} is unreadable ({exc}). Failing closed.")
        return 2

    failures, _ = compare(found, baseline)
    if failures:
        for line in failures:
            print(f"::error::{line}")
        print()
        print("A test that reimplements its subject reports green regardless of")
        print("what the subject does — see BUGS-85, where 19 passing tests")
        print("survived stubbing out the worker's validation, its rate limiting")
        print("and its HTML escaping.")
        print()
        print("Fix the test to exercise the real module, or (if the duplication")
        print("is genuinely justified) add `// test-reimplementation-ok: <KEY>`.")
        return 1

    print(f"CTL-038 OK — {len(found)} known finding(s), none new, none stale.")
    for f in found:
        print(f"  {f['severity']:8} {f['test']} -> {f['subject']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
