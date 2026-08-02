#!/usr/bin/env python3
"""CTL-039 — a source-text assertion must not be satisfied only by a COMMENT.

WHY THIS EXISTS (KAN-440)
-------------------------
A scan like `expect(src).toContain('is_published')` passes if the string exists
anywhere in the file — including inside a comment. Delete the code it was
guarding, leave the comment, and the scan stays green.

THREE VERIFIED INSTANCES (mutation-proven 2026-08-01):

  1. src/app/sitemap.ts — `is_published` occurs in the query AND in the comment
     explaining why the query needs it. Deleting `.eq('is_published', true)`
     leaves `toContain('is_published')` green. SEC-100 ran live while that
     assertion was green.

  2. src/app/dashboard/profile/page.tsx:27 — the worst case, because it is not
     accidental. The comment reads "also matches `conversation_starter_prompts`
     / `profile_conversation_starters` regression guard in
     tests/unit/conversation-starters.test.ts". THE COMMENT WAS WRITTEN TO
     SATISFY THE SCAN. Deleting all three real data-fetch lines (71, 76, 77)
     leaves 11/11 green.

  3. src/lib/rate-limit.ts — a variant of the same root, not comment-based:
     `toContain('limit: 10')` survives raising the auth preset to 1000, because
     the string still appears in the other presets. Out of scope for this
     control, recorded so nobody expects it to be caught here. (SEC-113.)

**It gates the modularisation.** KAN-415 moves files. A scan whose assertion
lives in a comment follows the prose and silently detaches from the code it was
guarding — during a migration that is precisely the wrong failure mode.

THE TWO THINGS THAT MAKE THIS HARD
----------------------------------
A throwaway prototype flagged 41 assertions. Triaging them showed the naive
approach has **two independent** sources of false positives, and the second is
the bigger one:

  (1) COMMENT SYNTAX IS PER FILE TYPE. A single stripper is wrong. CSS has no
      `#` comments, so `#4a7359` is a colour, not a comment — that alone
      produced nine false hits against globals.css. `.txt` has no comments at
      all, so `# Lyra` in llms.txt is content.

  (2) SUBJECT ATTRIBUTION MUST BE SCOPED. A test file commonly reads a
      DIFFERENT subject in each `describe` block — photo-upload.test.js has six,
      reassigning `content` each time. Pairing every asserted literal with every
      subject named anywhere in the file manufactures findings wholesale: it
      reported the server action's `image/jpeg` assertions against the
      migration, which does not contain that assertion at all.

Both are fixed here, and both are pinned as `--self-test` fixtures.

RATCHET SEMANTICS
-----------------
Shrink-only, failing in BOTH directions: a new finding fails, and a baselined
finding that no longer reproduces ALSO fails until the baseline is updated. A
list you may only add to is a suppression list, not a ratchet.

FAIL-CLOSED
-----------
Missing or unreadable baseline exits 2 (SEC-111 precedent). A guard that cannot
run must not report success.

USAGE
    python3 scripts/check-comment-only-assertions.py
    python3 scripts/check-comment-only-assertions.py --write-baseline
    python3 scripts/check-comment-only-assertions.py --self-test
    python3 scripts/check-comment-only-assertions.py --explain <test-file>
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / "tests" / "support" / "comment-assertion-baseline.json"
MANIFEST = REPO / "tests" / "support" / "source-paths.json"

# Deliberately loose about the comment prefix. Requiring `//` or `#` missed the
# marker when it was written inside a `/** … */` header, where the line reads
# ` * comment-assertion-ok:` — an escape hatch that silently does not apply is
# worse than none, because the author believes they have opted out.
ALLOW = re.compile(r"comment-assertion-ok:\s*[A-Z]+-\d+")

# ---------------------------------------------------------------------------
# (1) Comment syntax, per file type.
# ---------------------------------------------------------------------------
# `line` markers are only treated as comments when they start a comment OUTSIDE
# a string literal; `block` pairs are stripped wholesale. An empty spec means
# the format has no comments at all, which is the correct answer for .txt/.md
# and the reason `# Lyra` in llms.txt must never be treated as one.
SYNTAX: dict[str, dict] = {
    ".ts":   {"line": ["//"], "block": [("/*", "*/")]},
    ".tsx":  {"line": ["//"], "block": [("/*", "*/")]},
    ".js":   {"line": ["//"], "block": [("/*", "*/")]},
    ".mjs":  {"line": ["//"], "block": [("/*", "*/")]},
    ".css":  {"line": [],     "block": [("/*", "*/")]},   # NO // and NO #
    ".scss": {"line": ["//"], "block": [("/*", "*/")]},
    ".sql":  {"line": ["--"], "block": [("/*", "*/")]},
    ".yml":  {"line": ["#"],  "block": []},
    ".yaml": {"line": ["#"],  "block": []},
    ".sh":   {"line": ["#"],  "block": []},
    ".bash": {"line": ["#"],  "block": []},
    ".py":   {"line": ["#"],  "block": []},
    ".toml": {"line": ["#"],  "block": []},
    # No comment syntax. Everything is content.
    ".txt":  {"line": [], "block": []},
    ".md":   {"line": [], "block": []},
    ".json": {"line": [], "block": []},
}


def strip_comments(text: str, suffix: str) -> str | None:
    """Return `text` with comments blanked, or None if the type is unknown.

    Unknown types return None and the caller SKIPS them. Guessing a comment
    syntax is how false positives get manufactured, and a gate that cries wolf
    is one people wave through.

    Comment characters are replaced with spaces rather than deleted, so byte
    offsets and line numbers stay stable and a literal cannot be accidentally
    formed by joining two sides of a removed comment.
    """
    spec = SYNTAX.get(suffix)
    if spec is None:
        return None

    out = list(text)

    for open_tok, close_tok in spec["block"]:
        i = 0
        while True:
            start = text.find(open_tok, i)
            if start == -1:
                break
            end = text.find(close_tok, start + len(open_tok))
            end = len(text) if end == -1 else end + len(close_tok)
            for k in range(start, end):
                if out[k] != "\n":
                    out[k] = " "
            i = end

    if spec["line"]:
        text2 = "".join(out)
        pos = 0
        for line in text2.split("\n"):
            _blank_line_comment(out, pos, line, spec["line"])
            pos += len(line) + 1

    return "".join(out)


def _blank_line_comment(out: list[str], base: int, line: str, markers: list[str]) -> None:
    """Blank from the first line-comment marker that is OUTSIDE a string."""
    quote: str | None = None
    i = 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        else:
            for m in markers:
                if line.startswith(m, i):
                    # `#!` on line 1 is a shebang; harmless to blank either way,
                    # but a URL fragment like `https://x#y` is NOT a comment —
                    # guarded by the quote tracking above, since URLs in these
                    # files live inside strings.
                    for k in range(base + i, base + len(line)):
                        if out[k] != "\n":
                            out[k] = " "
                    return
        i += 1


# ---------------------------------------------------------------------------
# (2) Scoped subject attribution.
# ---------------------------------------------------------------------------
READ = re.compile(r"readFileSync\s*\(([^;]*?)(?:,\s*['\"]utf-?8['\"])?\s*\)")
SRC_KEY = re.compile(r"SRC\.([A-Za-z_$][\w$]*)")
PATH_LIT = re.compile(
    r"""['"](?:\.{1,2}/)*((?:src|scripts|supabase|public|controls)/[\w./\-()\[\]]+)['"]"""
)
# The assertion must be made ON THE FILE CONTENTS, so the receiver has to be
# the variable the read was assigned to. Matching any `toContain` in a block
# that happens to read a file reported `expect(ctl.prevents).toContain('SEC-100')`
# — an assertion about a parsed JSON array — against a workflow file. A guard
# whose own first run produces false positives teaches people to ignore it.
RECEIVER = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*?readFileSync"
)


def _assert_str(var: str) -> re.Pattern:
    return re.compile(
        rf"""expect\(\s*{re.escape(var)}\s*\)\s*\.\s*to(?:Contain|Match)"""
        rf"""\(\s*['"]((?:[^'"\\]|\\.){{4,}}?)['"]\s*\)"""
    )


def _assert_re(var: str) -> re.Pattern:
    return re.compile(
        rf"expect\(\s*{re.escape(var)}\s*\)\s*\.\s*toMatch"
        rf"\(\s*/((?:[^/\\\n]|\\.)+)/([gimsuy]*)\s*\)"
    )

# THE SCOPE IS THE `test`/`it` BLOCK, NOT THE `describe`.
# A first cut split on `describe(` and found ZERO of the three known instances:
# seo.test.js and conversation-starters.test.ts each have ONE describe holding
# many test blocks, and every test reads a DIFFERENT subject. At describe
# granularity every scope names 4-5 subjects, so the "exactly one subject"
# rule discarded all of them. Splitting per test block is what makes the
# attribution both correct and usable.
SCOPE = re.compile(r"\n\s*(?:test|it)\s*\(")


def resolve_subject(expr: str, manifest: dict) -> str | None:
    m = SRC_KEY.search(expr)
    if m:
        return manifest.get(m.group(1))
    m = PATH_LIT.search(expr)
    return m.group(1) if m else None


def scopes_of(text: str) -> tuple[str, list[str]]:
    """Split into (preamble, test-blocks).

    The preamble is everything before the first `test`/`it`, which is where a
    `beforeAll`/describe-level `readFileSync` lives — photo-upload.test.js uses
    that shape. A block with no read of its own inherits it.
    """
    marks = [m.start() for m in SCOPE.finditer(text)]
    if not marks:
        return text, []
    return text[: marks[0]], [
        text[a:b] for a, b in zip(marks, marks[1:] + [len(text)])
    ]


def comment_text(original: str, stripped: str) -> str:
    """The comment characters only — everything `strip_comments` blanked.

    TWO SEVERITIES, and the second is the one the motivating cases are:

      comment-only     the literal appears ONLY in comments. The guard proves
                       nothing today.
      comment-shadowed the literal appears in the code AND in a comment. The
                       guard passes today for the right reason, but would keep
                       passing if the code were deleted, because the comment
                       alone satisfies it.

    `sitemap.ts` is the second kind: `is_published` is in the query and in the
    comment explaining the query. Checking only for "satisfied solely by a
    comment" would report it clean — which is true right now and useless, since
    the whole point is that the guard is not load-bearing. A guard that cannot
    tell code from prose is not a guard, whichever half currently satisfies it.
    """
    # Positional, not concatenated. Joining only the comment characters would
    # splice separate comments together — `// foo` and `// bar` becoming
    # "foobar", which then matches a literal "oob" that exists nowhere. Keep
    # every offset and blank the code instead.
    return "".join(
        o if (s == " " and o not in " \n") else ("\n" if o == "\n" else " ")
        for o, s in zip(original, stripped)
    )


def _js_regex_matches(pattern: str, flags: str, text: str) -> bool | None:
    """Evaluate a JS regex literal against `text`; None if untranslatable."""
    py = 0
    if "i" in flags:
        py |= re.I
    if "s" in flags:
        py |= re.S
    if "m" in flags:
        py |= re.M
    try:
        return re.search(pattern, text, py) is not None
    except re.error:
        return None  # not portable to Python — skip rather than guess


def analyse(root: Path, rel: str, manifest: dict) -> list[dict]:
    text = (root / rel).read_text(encoding="utf-8")
    if "readFileSync" not in text or ALLOW.search(text):
        return []

    preamble, blocks = scopes_of(text)

    def subjects_in(chunk: str) -> list[str]:
        return sorted(
            {
                x
                for x in (
                    resolve_subject(m.group(1), manifest) for m in READ.finditer(chunk)
                )
                if x
            }
        )

    findings = []
    # Carry the most recently-read subject forward. A `describe` that is not the
    # FIRST in the file does its `readFileSync` in its own body, which lands at
    # the tail of the PREVIOUS test block's chunk — so a file-level preamble
    # alone misses it. That blind spot hid src/lib/auth/post-login-redirect.ts,
    # where `/confirm-age` sits in both a comment and the code, and it is the
    # commonest shape in this repo. Pinned as a self-test fixture.
    current = subjects_in(preamble)
    current_vars = RECEIVER.findall(preamble)
    for block in blocks:
        own = subjects_in(block)
        if own:
            # The receiver travels with the read — `const chokepoint = ...` sits
            # in the same chunk as its readFileSync, not in the block that
            # asserts on it.
            current_vars = RECEIVER.findall(block) or current_vars
            # A block's own read wins, and becomes the running subject for any
            # following block that does not read for itself.
            current = own
        uniq = current
        # Exactly one subject is attributable. More and we cannot tell which
        # assertion belongs to which — skip rather than guess. Guessing is how
        # the prototype reported the server action's `image/jpeg` assertions
        # against a migration that never contained them.
        if len(uniq) != 1:
            continue
        subject = uniq[0]
        sp = root / subject
        try:
            stext = sp.read_text(encoding="utf-8")
        except OSError:
            continue
        bare = strip_comments(stext, sp.suffix)
        if bare is None:
            continue  # unknown comment syntax — never guess

        comments = comment_text(stext, bare)

        # Which variable holds this file's contents in this block?
        vars_ = RECEIVER.findall(block) or current_vars
        if not vars_:
            continue

        for var in set(vars_):
            for m in _assert_str(var).finditer(block):
                lit = m.group(1).replace("\\'", "'").replace('\\"', '"')
                if lit not in stext or lit not in comments:
                    continue
                findings.append({
                    "test": rel, "subject": subject, "assertion": lit,
                    "severity": "comment-only" if lit not in bare else "comment-shadowed",
                })

            for m in _assert_re(var).finditer(block):
                pat, flags = m.group(1), m.group(2)
                if not _js_regex_matches(pat, flags, stext):
                    continue
                if not _js_regex_matches(pat, flags, comments):
                    continue
                in_code = _js_regex_matches(pat, flags, bare)
                findings.append({
                    "test": rel, "subject": subject, "assertion": f"/{pat}/",
                    "severity": "comment-only" if in_code is False else "comment-shadowed",
                })

    return findings


def sh(*args: str) -> str:
    return subprocess.run(
        list(args), capture_output=True, text=True, cwd=str(REPO)
    ).stdout


def read(p: Path) -> str | None:
    try:
        return p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        return None


def scan(root: Path, files: list[str], manifest: dict) -> list[dict]:
    out: list[dict] = []
    for rel in files:
        try:
            out.extend(analyse(root, rel, manifest))
        except OSError:
            continue
    seen, uniq = set(), []
    for f in out:
        k = (f["test"], f["subject"], f["assertion"])
        if k not in seen:
            seen.add(k)
            uniq.append(f)
    return sorted(uniq, key=lambda f: (f["test"], f["subject"], f["assertion"]))


def key(f: dict) -> str:
    return f"{f['test']}::{f['subject']}::{f['assertion']}"


def compare(found: list[dict], baseline: list[dict]) -> list[str]:
    base = {key(b) for b in baseline}
    seen = {key(f): f for f in found}
    fails = []
    for k, f in sorted(seen.items()):
        if k not in base:
            # The message must match the severity. A single hardcoded string
            # said "appears ONLY in a comment" for both kinds, which is false
            # for the commoner one and would send a reader looking for code
            # that is in fact still there — a control that reports the wrong
            # thing erodes trust in the ones that report correctly.
            why = (
                "that string appears ONLY in a comment, so the assertion "
                "proves nothing about the code"
                if f.get("severity") == "comment-only"
                else "that string appears in the code AND in a comment, so "
                "deleting the code would leave this assertion green"
            )
            fails.append(
                f"NEW [{f.get('severity', 'unknown')}]: {f['test']} asserts "
                f"{f['assertion']!r} against {f['subject']} — {why}."
            )
    for b in sorted(base - set(seen)):
        fails.append(
            f"STALE: {b} is baselined but no longer reproduces. Remove it — "
            f"a list you may only add to is a suppression list, not a ratchet."
        )
    return fails


# ---------------------------------------------------------------------------
# self-test — every false-positive source reproduced, per SEC-101 §3a
# ---------------------------------------------------------------------------

def _case(root: Path, subject_name: str, subject_body: str, test_body: str) -> list[dict]:
    (root / "tests" / "unit").mkdir(parents=True, exist_ok=True)
    (root / subject_name).parent.mkdir(parents=True, exist_ok=True)
    (root / subject_name).write_text(subject_body)
    (root / "tests" / "unit" / "t.test.js").write_text(test_body)
    return scan(root, ["tests/unit/t.test.js"], {})


def self_test() -> int:
    fails = 0

    def check(name: str, got: int, want: int) -> None:
        nonlocal fails
        ok = got == want
        print(f"  {'PASS' if ok else 'FAIL'}  {name} (found {got}, want {want})")
        fails += 0 if ok else 1

    def T(path: str, body: str) -> str:
        # Realistic shape: a describe with the test on its own line. A first
        # cut used a single-line `describe(...{test(...)})` fixture, which the
        # scope splitter (anchored on a newline before `test(`) never matched —
        # so the fixtures passed while the real files found nothing.
        return (
            "describe('s', () => {\n"
            f"  test('a', () => {{\n"
            f"    const c = require('fs').readFileSync('{path}', 'utf8');\n"
            f"    {body}\n"
            "  });\n"
            "});\n"
        )

    # --- the two verified shapes --------------------------------------------
    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "src/sitemap.ts",
                    "// SEC-100: filters on `is_published` and is_suspended\n"
                    "const q = db.from('p').eq('is_suspended', false);\n",
                    T("src/sitemap.ts", "expect(c).toContain('is_published');"))
        check("comment-ONLY literal is reported", len(got), 1)
        if got:
            check("  ...as severity comment-only",
                  1 if got[0]["severity"] == "comment-only" else 0, 1)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        # sitemap.ts as it really is: the literal in BOTH the query and the
        # comment. The guard passes today for the right reason, but would keep
        # passing if the filter were deleted. That is the finding.
        got = _case(r, "src/sitemap.ts",
                    "// SEC-100: bypasses RLS - the `is_published = true` policy\n"
                    "const q = db.eq('is_published', true);\n",
                    T("src/sitemap.ts", "expect(c).toContain('is_published');"))
        check("comment-SHADOWED literal is reported", len(got), 1)
        if got:
            check("  ...as severity comment-shadowed",
                  1 if got[0]["severity"] == "comment-shadowed" else 0, 1)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "src/page.tsx",
                    "/**\n"
                    " * also matches `conversation_starter_prompts` guard\n"
                    " */\n"
                    "const rows = db.from('other_table');\n",
                    T("src/page.tsx",
                      "expect(c).toMatch(/conversation_starter_prompts/);"))
        check("regex literal toMatch(/.../) is evaluated", len(got), 1)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "src/clean.ts",
                    "const q = db.eq('is_published', true);\n",
                    T("src/clean.ts", "expect(c).toContain('is_published');"))
        check("literal nowhere near a comment is NOT reported", len(got), 0)

    # --- (1) per-file-type comment syntax ------------------------------------
    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "src/globals.css",
                    ":root { --color-sage: #4a7359; }\n",
                    T("src/globals.css",
                      "expect(c).toContain('--color-sage: #4a7359');"))
        check("CSS: '#' is a colour, not a comment (9 prototype FPs)", len(got), 0)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "public/llms.txt", "# Lyra\nSome content.\n",
                    T("public/llms.txt", "expect(c).toContain('# Lyra');"))
        check(".txt has NO comment syntax at all", len(got), 0)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "src/a.ts",
                    "const url = 'https://x.test'; // see https://y.test\n",
                    T("src/a.ts", "expect(c).toContain('https://x.test');"))
        check("a '//' inside a string is not a comment start", len(got), 0)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        got = _case(r, "supabase/m.sql",
                    "-- allowed: image/jpeg\nCREATE TABLE t (id int);\n",
                    T("supabase/m.sql", "expect(c).toContain('image/jpeg');"))
        check("SQL: '--' line comment IS stripped", len(got), 1)

    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        # Separate comments must not be spliced: "// foo" + "// bar" must not
        # form "foobar" and match a literal that exists nowhere.
        got = _case(r, "src/b.ts", "// foo\nconst x = 1;\n// bar\n",
                    T("src/b.ts", "expect(c).toContain('foobar');"))
        check("separate comments are not concatenated", len(got), 0)

    # --- carry-forward: a describe-level read in a NON-FIRST describe --------
    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        (r / "src").mkdir(parents=True)
        (r / "src" / "a.ts").write_text("const x = 1;\n")
        (r / "src" / "chokepoint.ts").write_text(
            "// diverted to /confirm-age first\n"
            "return `${origin}/confirm-age?next=x`;\n"
        )
        (r / "tests" / "unit").mkdir(parents=True)
        (r / "tests" / "unit" / "t.test.js").write_text(
            "describe('first', () => {\n"
            "  const a = require('fs').readFileSync('src/a.ts', 'utf8');\n"
            "  test('one', () => { expect(a).toContain('const x'); });\n"
            "});\n"
            "describe('second', () => {\n"
            "  const chokepoint = require('fs').readFileSync('src/chokepoint.ts', 'utf8');\n"
            "  test('two', () => { expect(chokepoint).toContain('/confirm-age'); });\n"
            "});\n"
        )
        got = scan(r, ["tests/unit/t.test.js"], {})
        # The read sits in the SECOND describe's body, which lands at the tail
        # of the first test block's chunk. A file-level preamble alone missed
        # this and reported post-login-redirect.ts clean.
        check("describe-level read in a NON-FIRST describe is seen", len(got), 1)
        if got:
            check("  ...and is comment-shadowed, not comment-only",
                  1 if got[0]["severity"] == "comment-shadowed" else 0, 1)

    # --- (2) scoped subject attribution --------------------------------------
    with tempfile.TemporaryDirectory() as td:
        r = Path(td)
        (r / "src").mkdir(parents=True); (r / "supabase").mkdir(parents=True)
        (r / "src" / "actions.ts").write_text("const ALLOWED = ['image/jpeg'];\n")
        (r / "supabase" / "m.sql").write_text(
            "-- ARRAY['image/jpeg']\nALTER TABLE t ADD c text;\n")
        (r / "tests" / "unit").mkdir(parents=True)
        (r / "tests" / "unit" / "t.test.js").write_text(
            "describe('photo', () => {\n"
            "  test('action', () => {\n"
            "    const c = require('fs').readFileSync('src/actions.ts', 'utf8');\n"
            "    expect(c).toContain('image/jpeg');\n"
            "  });\n"
            "  test('migration', () => {\n"
            "    const c = require('fs').readFileSync('supabase/m.sql', 'utf8');\n"
            "    expect(c).toContain('ALTER TABLE');\n"
            "  });\n"
            "});\n"
        )
        got = scan(r, ["tests/unit/t.test.js"], {})
        # The prototype paired the action's 'image/jpeg' with the migration and
        # reported a finding against a file that never contained that assertion.
        check("assertions are scoped to their own test block", len(got), 0)

    print("self-test:", "OK" if fails == 0 else f"{fails} FAILED")
    return 1 if fails else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    raw = read(MANIFEST)
    if raw is None:
        print(f"::error::{MANIFEST} missing — run `npm run gen:test-paths`.")
        return 2
    try:
        manifest = json.loads(raw)["SRC"]
    except (ValueError, KeyError) as exc:
        print(f"::error::{MANIFEST} unreadable ({exc}). Failing closed.")
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

    if "--explain" in sys.argv:
        want = sys.argv[sys.argv.index("--explain") + 1]
        for f in found:
            if want in f["test"]:
                print(f"{f['test']}\n  subject: {f['subject']}\n  only-in-comment: {f['assertion']!r}")
        return 0

    if "--write-baseline" in sys.argv:
        BASELINE.parent.mkdir(parents=True, exist_ok=True)
        BASELINE.write_text(
            json.dumps(
                {
                    "_comment": (
                        "CTL-039 (KAN-440) shrink-only ratchet. Each entry is an "
                        "assertion whose literal exists in the subject ONLY inside "
                        "a comment, so deleting the guarded code leaves the test "
                        "green. Entries may be REMOVED as tests are fixed; a stale "
                        "entry fails the build, so this cannot become a suppression "
                        "list. Regenerate with --write-baseline AFTER staging."
                    ),
                    "ticket": "KAN-440",
                    "findings": found,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"Wrote {BASELINE.relative_to(REPO)} with {len(found)} finding(s).")
        for f in found:
            print(f"  {f['test']} -> {f['subject']}: {f['assertion']!r}")
        return 0

    raw_b = read(BASELINE)
    if raw_b is None:
        print(f"::error::{BASELINE} is missing. A ratchet with no baseline")
        print("cannot distinguish 'clean' from 'not measured'. Failing closed.")
        print("Generate it with: --write-baseline")
        return 2
    try:
        baseline = json.loads(raw_b)["findings"]
    except (ValueError, KeyError) as exc:
        print(f"::error::{BASELINE} unreadable ({exc}). Failing closed.")
        return 2

    fails = compare(found, baseline)
    if fails:
        for line in fails:
            print(f"::error::{line}")
        print()
        print("A source-text assertion satisfied only by a comment follows the")
        print("prose, not the code. SEC-100 ran live while such an assertion was")
        print("green, and in one case the comment was written to satisfy the scan.")
        print()
        print("Fix by asserting something the CODE must contain, or convert the")
        print("scan to a behavioural test. If the comment genuinely is the")
        print("subject, add `// comment-assertion-ok: <JIRA-KEY> <reason>`.")
        return 1

    print(f"CTL-039 OK — {len(found)} known finding(s), none new, none stale.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
