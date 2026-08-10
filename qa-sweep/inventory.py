#!/usr/bin/env python3
"""KAN-467 Phase 1 — the static inventory. The denominator.

WHY THIS EXISTS
---------------
Every coverage number the sweep ever reports is a fraction, and this file
computes the bottom half of it. That makes under-reporting the single most
dangerous bug this module can have: a surface that is missed here does not show
up as a gap, it shows up as *nothing at all*, and the percentage goes UP. A
tool that gets safer-looking the more it fails to see is worse than no tool.

So the bias throughout is toward over-reporting. When an element cannot be
confidently identified from source it is recorded as `low-confidence` — never
dropped. When a file is attributed to a route by walking up the directory tree
rather than by sitting in it, that is recorded too. The report says how much of
itself it is unsure about, because "213 elements" and "213 elements, 40 of them
guesses" are different claims and only one of them is true.

WHY STATIC, AND NOT A CRAWL
---------------------------
A crawler can only find what it can reach, which means auth-gated and
admin-only surfaces — precisely the ones with no coverage — are the ones it
would silently omit. Parsing source finds the 11 /admin pages whether or not
anybody can log in, and it does it without a browser, a network or a database.
Phases 0-2 touch none of the three.

WHAT IT PARSES
--------------
  routes    every page / layout / route handler under src/app, with its URL
            path and an auth model DERIVED FROM src/middleware.ts — not
            hardcoded here, so a middleware change moves this inventory rather
            than quietly invalidating it.
  actions   every exported server action in a file carrying 'use server'.
  elements  button / a / input / select / textarea / form, with the most
            stable identifier available (data-testid > id > name > aria-label
            > href > visible text).
  fields    form fields plus the constraints visible in source: maxLength,
            required, and the allowlists + max-length tables in `*-fields.ts`.

THE JSX SCANNER, AND WHY IT IS NOT A REGEX
------------------------------------------
`<button onClick={() => setOpen(!open)}>` contains a `>` that does not close
the tag. A naive `<button[^>]*>` truncates at the arrow and reads the rest of
the attributes as page text, which loses the `data-testid` sitting after it.
So the tag body is scanned with a depth- and string-aware walker: a `>` ends
the tag only at brace/paren/bracket depth zero and outside any quote. Comments
are stripped first — this repo has already been bitten once by a scan that a
COMMENT satisfied (CTL-039, KAN-440), and an element that exists only inside a
commented-out block is not an element.

SCOPE, NOT OMISSION
-------------------
The 11 `/admin` pages are marked `inventory-only` and are still counted.
Denylisted actions are marked `denylisted` and are still counted. Founder
decision 2026-08-04: admin is coverage-diffed but never exercised. Modelling
that as a FLAG rather than by dropping the rows is the difference between "we
chose not to test this" and "we forgot this exists".

FAIL-CLOSED
-----------
Exit 2 if src/app is missing, if middleware.ts cannot be read, or if the auth
model derives to nothing. An empty authed-prefix list would silently reclassify
every /dashboard page as public — flattering the very numbers this file exists
to keep honest.

USAGE
    python3 qa-sweep/inventory.py                    # writes qa-sweep/qa-inventory.json
    python3 qa-sweep/inventory.py --summary          # counts only, no write
    python3 qa-sweep/inventory.py --self-test        # fixtures
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import config as envelope
except Exception as exc:  # noqa: BLE001
    sys.stderr.write("::error::qa-sweep/config.py could not be imported: {0}\n".format(exc))
    sys.exit(2)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(REPO, "src", "app")
MIDDLEWARE = os.path.join(REPO, "src", "middleware.ts")
OUT_PATH = os.path.join(REPO, "qa-sweep", "qa-inventory.json")

INTERACTIVE_TAGS = ("button", "a", "input", "select", "textarea", "form")
FIELD_TAGS = ("input", "select", "textarea")


# --------------------------------------------------------------------------
# Source hygiene
# --------------------------------------------------------------------------


def strip_comments(text):
    # type: (str) -> str
    """Remove // and /* */ comments while preserving string literals.

    Comment-blind scanning is how you inventory an element that somebody
    deleted six months ago but left in a commented block — and how a coverage
    denominator quietly inflates. `://` is never treated as a comment start, so
    URLs survive intact.
    """
    out = []
    i = 0
    n = len(text)
    quote = None  # type: Optional[str]
    while i < n:
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n:
            nxt = text[i + 1]
            # `://` is a URL, not a comment.
            if nxt == "/" and not (i > 0 and text[i - 1] == ":"):
                while i < n and text[i] != "\n":
                    i += 1
                continue
            if nxt == "*":
                i += 2
                while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                    i += 1
                i += 2
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def scan_tag_body(text, start):
    # type: (str, int) -> Tuple[str, int]
    """Return (tag body, index just past '>') for a JSX tag opening at `start`.

    `start` is the index of the character after `<tagname`. The walker tracks
    {} () [] depth and quote state, so the `>` in `onClick={() => x}` does not
    end the tag. Returns ('', -1) if the tag never closes (truncated file).
    """
    depth = 0
    quote = None  # type: Optional[str]
    i = start
    n = len(text)
    while i < n:
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            continue
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
        elif ch == ">" and depth <= 0:
            return text[start:i], i + 1
        i += 1
    return "", -1


ATTR_RE = re.compile(
    r"""([A-Za-z_:][-A-Za-z0-9_:.]*)      # attribute name
        (?:\s*=\s*
           (?: "([^"]*)"                   # "value"
             | '([^']*)'                   # 'value'
             | \{([^{}]*)\}                # {expr}  (shallow, best effort)
           )
        )?""",
    re.VERBOSE,
)


def parse_attrs(body):
    # type: (str) -> Dict[str, Optional[str]]
    """Attributes of a JSX tag. A value of None means the attribute is bare
    (`required`), which in JSX means true."""
    attrs = {}  # type: Dict[str, Optional[str]]
    for m in ATTR_RE.finditer(body):
        name = m.group(1)
        value = m.group(2)
        if value is None:
            value = m.group(3)
        if value is None:
            value = m.group(4)
            if value is not None:
                value = value.strip()
        attrs[name] = value
    return attrs


def find_elements(text):
    # type: (str) -> List[Dict[str, object]]
    """Every interactive element in a TSX source string."""
    clean = strip_comments(text)
    found = []  # type: List[Dict[str, object]]
    for tag in INTERACTIVE_TAGS:
        # `<a` must not match `<article`; require a non-name char after.
        pattern = re.compile(r"<" + tag + r"(?=[\s/>])")
        for m in pattern.finditer(clean):
            body, end = scan_tag_body(clean, m.end())
            if end == -1:
                found.append(
                    {
                        "tag": tag,
                        "attrs": {},
                        "identifier": None,
                        "identifier_source": None,
                        "text": None,
                        "confidence": "low-confidence",
                        "note": "unterminated tag — could not scan to '>'",
                        "offset": m.start(),
                    }
                )
                continue
            attrs = parse_attrs(body)
            text_content = _element_text(clean, tag, end, body)
            ident, ident_src = _stable_identifier(tag, attrs, text_content)
            found.append(
                {
                    "tag": tag,
                    "attrs": attrs,
                    "identifier": ident,
                    "identifier_source": ident_src,
                    "text": text_content,
                    "confidence": "high" if ident_src in _STRONG_IDENTIFIERS else "low-confidence",
                    "note": None if ident else "no stable identifier in source",
                    "offset": m.start(),
                }
            )
    found.sort(key=lambda e: e["offset"])
    return found


#: Identifier sources a Phase 3 runner could actually select on reliably.
#: `text` and `href` are usable but brittle (copy changes, dynamic routes), so
#: they do not earn "high" — an over-confident identifier is how a runner ends
#: up clicking the wrong control.
_STRONG_IDENTIFIERS = ("data-testid", "id", "name", "aria-label")


def _element_text(clean, tag, end, body):
    # type: (str, str, int, str) -> Optional[str]
    """Visible text of a simple element, or None when it is not plain."""
    if body.rstrip().endswith("/"):
        return None  # self-closing
    close = clean.find("</" + tag, end)
    if close == -1:
        return None
    inner = clean[end:close]
    if len(inner) > 200 or "<" in inner:
        return None
    inner = re.sub(r"\{[^{}]*\}", " ", inner)
    inner = " ".join(inner.split())
    return inner or None


def _stable_identifier(tag, attrs, text_content):
    # type: (str, Dict[str, Optional[str]], Optional[str]) -> Tuple[Optional[str], Optional[str]]
    for key in _STRONG_IDENTIFIERS:
        val = attrs.get(key)
        if val:
            return val, key
    if tag == "a" and attrs.get("href"):
        return attrs.get("href"), "href"
    if attrs.get("formAction"):
        return attrs.get("formAction"), "formAction"
    if attrs.get("action"):
        return attrs.get("action"), "action"
    if text_content:
        return text_content, "text"
    if attrs.get("type"):
        return "{0}[type={1}]".format(tag, attrs.get("type")), "type"
    return None, None


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


def route_path_from_dir(rel_dir):
    # type: (str) -> Optional[str]
    """`(auth)/login` -> `/login`. None if the directory is not routable.

    Route groups `(x)` are erased from the URL; a `_private` segment means the
    directory is not a route at all (Next.js private folders).
    """
    if rel_dir in (".", ""):
        return "/"
    parts = [p for p in rel_dir.split(os.sep) if p]
    kept = []
    for p in parts:
        if p.startswith("_"):
            return None
        if p.startswith("(") and p.endswith(")"):
            continue  # route group — organisational only
        if p.startswith("@"):
            return None  # parallel route slot
        kept.append(p)
    return "/" + "/".join(kept) if kept else "/"


def derive_auth_model(middleware_src):
    # type: (str) -> Dict[str, List[str]]
    """Derive the auth prefixes from middleware source rather than assuming.

    Two rules are extracted:
      * ADMIN  — `pathname.startsWith('/admin')`, the host-isolation branch.
      * AUTHED — the unauthenticated redirect: `!user && ...startsWith('/x')`.

    Derived, not hardcoded, so that moving the dashboard behind a different
    prefix updates this inventory instead of silently marking nine authed
    pages public. The caller treats an empty result as fatal.
    """
    clean = strip_comments(middleware_src)
    admin = sorted(set(re.findall(r"pathname\.startsWith\(\s*'(/admin[^']*)'\s*\)", clean)))
    authed = set()
    for m in re.finditer(r"!\s*user\s*&&([^;{}]{0,400}?)startsWith\(\s*'([^']+)'\s*\)", clean, re.S):
        authed.add(m.group(2))
    return {"admin_prefixes": admin, "authed_prefixes": sorted(authed)}


def auth_model_for(route_path, model):
    # type: (str, Dict[str, List[str]]) -> str
    for prefix in model["admin_prefixes"]:
        if route_path == prefix or route_path.startswith(prefix + "/"):
            return "admin"
    for prefix in model["authed_prefixes"]:
        if route_path == prefix or route_path.startswith(prefix + "/"):
            return "authed"
    return "public"


def scope_for_route(route_path):
    # type: (str) -> Tuple[str, Optional[str]]
    reason = envelope.is_inventory_only(route_path)
    if reason:
        return "inventory-only", reason
    return "exercisable", None


# --------------------------------------------------------------------------
# Server actions
# --------------------------------------------------------------------------

USE_SERVER_RE = re.compile(r"^\s*['\"]use server['\"]\s*;?", re.M)
EXPORT_FN_RE = re.compile(r"^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)

#: Next.js does not care HOW an action is declared, only that its module
#: carries the directive — so `export const x = async () => {}` is as real an
#: action as `export async function x()`. Matching only the `function` form
#: under-reports the denominator, and under-reporting is the one direction
#: that flatters every coverage number downstream. No action is declared this
#: way today; this exists so that the day one is, it is counted rather than
#: silently missed.
EXPORT_ARROW_RE = re.compile(
    r"^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(", re.M
)

#: A directive statement — the only thing allowed to precede real code in a
#: module's directive prologue. `'use client'` is listed so a file carrying both
#: does not terminate the prologue scan early.
_DIRECTIVE_LINE_RE = re.compile(r"""^\s*(['"])use (?:server|client|strict)\1\s*;?\s*$""")

#: A `'use server'` occurrence anywhere — used to find FUNCTION-level directives.
_USE_SERVER_TOKEN_RE = re.compile(r"""['"]use server['"]\s*;?""")

#: The two ways a named function body can open immediately before a directive.
#: Both are right-anchored: the match must END where the body's `{` began, so a
#: nested or already-closed declaration earlier in the window cannot claim it.
_NAMED_FN_HEADER_RE = re.compile(
    r"(?:^|[\s;}\)])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*"
    r"([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*(?::\s*[^{;=]+?)?\s*$"
)
_NAMED_ARROW_HEADER_RE = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=\s*"
    r"(?:async\s*)?\([^()]*\)\s*(?::\s*[^{=]+?)?\s*=>\s*$"
)

#: How far back to look for the declaration that owns a function-level
#: directive. Generous enough for a typed multi-line signature, bounded so a
#: pathological file cannot make this quadratic.
_HEADER_WINDOW = 400


def _has_file_level_use_server(clean):
    # type: (str) -> bool
    """True when `'use server'` is a FILE-level directive.

    A directive prologue is the run of bare string-literal statements at the top
    of a module; the first real statement ends it. A `'use server'` found deeper
    in the file is a FUNCTION-level directive marking one function, and reading
    it as file-level would mark every exported helper in a `page.tsx` as a
    server action.
    """
    for line in clean.split("\n"):
        if not line.strip():
            continue
        if _DIRECTIVE_LINE_RE.match(line):
            if "use server" in line:
                return True
            continue  # another directive; the prologue is still open
        return False  # first real statement — prologue over, no file directive
    return False


def _name_for_directive_owner(header):
    # type: (str) -> Tuple[Optional[str], str]
    """(name, declaration) for the function whose body opens at `header`'s end.

    `header` is the source immediately preceding the body's `{`, right-trimmed.
    Returns (None, 'inline') for an anonymous closure — the `action={async () =>
    { 'use server'; … }}` shape used by inline form actions, which has no name
    to record and must therefore be given a synthetic one by the caller.
    """
    m = _NAMED_ARROW_HEADER_RE.search(header)
    if m:
        return m.group(1), "file-local"
    m = _NAMED_FN_HEADER_RE.search(header)
    if m:
        return m.group(1), "file-local"
    return None, "inline"


def _function_scoped_actions(clean):
    # type: (str) -> List[Dict[str, object]]
    """Functions whose FIRST statement is a `'use server'` directive.

    Walks backwards from each directive: the character before it (whitespace
    skipped) must be the `{` opening a function body, or this is not a directive
    at all — it is the string `'use server'` appearing in ordinary code.
    """
    out = []  # type: List[Dict[str, object]]
    anonymous = 0
    for m in _USE_SERVER_TOKEN_RE.finditer(clean):
        j = m.start() - 1
        while j >= 0 and clean[j] in " \t\r\n":
            j -= 1
        if j < 0 or clean[j] != "{":
            continue
        header = clean[max(0, j - _HEADER_WINDOW) : j].rstrip()
        name, declaration = _name_for_directive_owner(header)
        if name is None:
            anonymous += 1
            # Synthetic, identifier-safe and stable under edits elsewhere in the
            # file: the Nth anonymous inline action in source order. Recorded as
            # low-confidence because the NAME is ours, not the source's.
            name = "inlineAction{0}".format(anonymous)
        out.append(
            {
                "name": name,
                "declaration": declaration,
                "anonymous": declaration == "inline",
                "offset": m.start(),
            }
        )
    return out


def _iter_exported_actions(clean):
    """Every exported action in a directive-prologue module, in source order.

    Both declaration forms count. Yielding them interleaved by offset keeps the
    reported order stable regardless of which form a file uses, so a refactor
    from `function` to `const` does not reshuffle the inventory and read as a
    diff.
    """
    matches = list(EXPORT_FN_RE.finditer(clean)) + list(EXPORT_ARROW_RE.finditer(clean))
    matches.sort(key=lambda m: m.start())
    return matches


def find_server_actions(text):
    # type: (str) -> List[Dict[str, object]]
    """Every server action declared in a module, in source order.

    Next.js has TWO declaration shapes and this used to recognise only one:

      * a FILE-level `'use server'` directive, where every exported function is
        an action; and
      * a FUNCTION-level `'use server'` as the first statement of a body, which
        makes that function an action whether or not it is exported — the shape
        every inline action in a `page.tsx` uses.

    Recognising only the first (and only scanning `.ts`) hid TEN real mutations
    from the denominator: five admin user actions, three report actions and two
    inline OAuth form actions. An action missing from the inventory cannot be
    reported as uncovered AND cannot be denylisted, so the omission both
    flatters the coverage number and removes a safety control. That is the
    under-reporting failure this whole module is written against.
    """
    clean = strip_comments(text)
    out = []  # type: List[Dict[str, object]]
    seen = set()  # type: set
    if _has_file_level_use_server(clean):
        for m in _iter_exported_actions(clean):
            name = m.group(1)
            if name in seen:
                continue
            seen.add(name)
            out.append(
                {
                    "name": name,
                    "declaration": "exported",
                    "anonymous": False,
                    "offset": m.start(),
                }
            )
    for rec in _function_scoped_actions(clean):
        if rec["name"] in seen:
            continue
        seen.add(rec["name"])
        out.append(rec)
    out.sort(key=lambda r: r["offset"])
    return out


# --------------------------------------------------------------------------
# Field constraint tables (`*-fields.ts`)
# --------------------------------------------------------------------------

EXPORT_CONST_RE = re.compile(r"export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+?)?=\s*")

_CLOSERS = {"[": "]", "{": "}"}


def _balanced(text, start):
    # type: (str, int) -> Tuple[str, int]
    """Read a bracketed literal starting at `start`, respecting nesting/quotes."""
    open_ch = text[start]
    close_ch = _CLOSERS[open_ch]
    depth = 0
    quote = None  # type: Optional[str]
    i = start
    n = len(text)
    while i < n:
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start + 1 : i], i + 1
        i += 1
    return "", -1


def parse_fields_module(text):
    # type: (str) -> Dict[str, object]
    """Every constraint declared in a `*-fields.ts` module.

    Deliberately NOT keyed on naming conventions. The first version of this
    matched `*_MAX_LENGTH` / `*_MAX_LENGTHS` / `[...] as const` and silently
    missed FOUR real constraint sets — `MAX_ATTENDEES`, `DRAFT_LIMITS`,
    `ANSWER_MAX`, `GATHERING_TYPES` — because they are spelled differently.
    That is the under-reporting failure mode this whole module is written
    against: a missed constraint is a fuzz case nobody ever generates, and the
    coverage report looks BETTER for the omission.

    So the rule is structural instead: in a file whose entire purpose is field
    definitions, every exported string array is an allowlist and every exported
    number (scalar or in a table) is a limit. Object literals with non-numeric
    values are recorded separately as label tables rather than dropped.
    """
    clean = strip_comments(text)
    allowlists = {}  # type: Dict[str, List[str]]
    max_lengths = {}  # type: Dict[str, int]
    label_tables = {}  # type: Dict[str, List[str]]

    for m in EXPORT_CONST_RE.finditer(clean):
        name = m.group(1)
        pos = m.end()
        if pos >= len(clean):
            continue
        ch = clean[pos]

        if ch == "[":
            body, _ = _balanced(clean, pos)
            items = re.findall(r"'([^']*)'|\"([^\"]*)\"", body)
            values = [a or b for a, b in items if (a or b)]
            if values:
                allowlists[name] = values
            continue

        if ch == "{":
            body, _ = _balanced(clean, pos)
            nums = re.findall(r"([A-Za-z_$][\w$]*)\s*:\s*(\d+)\s*[,}\n]", body + "\n")
            if nums:
                for k, v in nums:
                    max_lengths["{0}.{1}".format(name, k)] = int(v)
            else:
                keys = re.findall(r"([A-Za-z_$][\w$]*)\s*:", body)
                if keys:
                    label_tables[name] = keys
            continue

        scalar = re.match(r"(\d+)\s*(?:as\s+const)?\s*;", clean[pos:])
        if scalar:
            max_lengths[name] = int(scalar.group(1))

    return {
        "allowlists": allowlists,
        "max_lengths": max_lengths,
        "label_tables": label_tables,
    }


def field_constraints(attrs):
    # type: (Dict[str, Optional[str]]) -> Dict[str, object]
    """Validation constraints visible on a field element."""
    out = {}  # type: Dict[str, object]
    for key in ("maxLength", "minLength", "max", "min", "pattern", "type", "step"):
        if key in attrs and attrs[key] is not None:
            out[key] = attrs[key]
    for key in ("required", "disabled", "readOnly"):
        if key in attrs:
            val = attrs[key]
            out[key] = True if val is None else val
    return out


# --------------------------------------------------------------------------
# Tree walk
# --------------------------------------------------------------------------


def read(path):
    # type: (str) -> Optional[str]
    try:
        with open(path, "r") as fh:
            return fh.read()
    except (IOError, OSError, UnicodeDecodeError):
        return None


def build(repo=REPO):
    # type: (str) -> Dict[str, object]
    app_dir = os.path.join(repo, "src", "app")
    middleware_path = os.path.join(repo, "src", "middleware.ts")

    if not os.path.isdir(app_dir):
        raise SystemExit2("src/app not found at {0} — cannot inventory".format(app_dir))

    mw_src = read(middleware_path)
    if mw_src is None:
        raise SystemExit2(
            "src/middleware.ts unreadable — the auth model cannot be derived, and "
            "guessing it would mark authed pages public"
        )
    # KAN-415 D4: the auth model's literals moved out of src/middleware.ts into
    # named gates. The derivation regexes are unchanged — what changed is where
    # the source lives — so the gate files are concatenated before deriving.
    #
    # This is exactly the failure mode CTL-033 exists for: after D4, deriving
    # from src/middleware.ts alone yields an EMPTY model, and an empty model is
    # fatal by design (see below) because it "would flatter every coverage
    # number downstream". The fatal check is deliberately left exactly as it is;
    # widening the SOURCE is the fix, not weakening the ASSERTION.
    gates_dir = os.path.join(os.path.dirname(middleware_path), "modules", "access", "gates")
    if os.path.isdir(gates_dir):
        for name in sorted(os.listdir(gates_dir)):
            if not name.endswith(".ts"):
                continue
            gate_src = read(os.path.join(gates_dir, name))
            if gate_src is None:
                raise SystemExit2(
                    "access gate {0} unreadable — the auth model would derive from a "
                    "partial corpus, which is worse than not deriving at all".format(name)
                )
            mw_src += "\n" + gate_src
    model = derive_auth_model(mw_src)
    if not model["admin_prefixes"] or not model["authed_prefixes"]:
        raise SystemExit2(
            "auth model derived to nothing from src/middleware.ts "
            "(admin={0}, authed={1}). An empty model reclassifies every gated "
            "page as public and would flatter every coverage number "
            "downstream.".format(model["admin_prefixes"], model["authed_prefixes"])
        )

    routes = []  # type: List[Dict[str, object]]
    tsx_files = []  # type: List[Tuple[str, str]]  # (relpath, route_path or '')
    actions = []  # type: List[Dict[str, object]]
    route_by_path = {}  # type: Dict[str, Dict[str, object]]

    for dirpath, dirnames, filenames in os.walk(app_dir):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        rel_dir = os.path.relpath(dirpath, app_dir)
        rpath = route_path_from_dir(rel_dir)

        for fn in sorted(filenames):
            rel_file = os.path.relpath(os.path.join(dirpath, fn), repo).replace(os.sep, "/")

            if fn in ("page.tsx", "layout.tsx", "route.ts") and rpath is not None:
                kind = {"page.tsx": "page", "layout.tsx": "layout", "route.ts": "route-handler"}[fn]
                auth = auth_model_for(rpath, model)
                scope, scope_reason = scope_for_route(rpath)
                entry = {
                    "type": "route",
                    "path": rpath,
                    "kind": kind,
                    "auth": auth,
                    "file": rel_file,
                    "scope": scope,
                    "scope_reason": scope_reason,
                    "surface": _surface_for(rpath, kind),
                    "confidence": "high",
                }
                routes.append(entry)
                if kind == "page":
                    route_by_path[rpath] = entry

            if fn.endswith(".tsx"):
                tsx_files.append((rel_file, rpath if rpath is not None else ""))

            # `.tsx` is scanned too. It was not until 2026-08-04, and the eight
            # admin moderation actions plus two inline OAuth form actions that
            # live ONLY in a page.tsx were therefore absent from the denominator
            # — and, because the denylist is keyed on inventoried pairs, absent
            # from the safety envelope as well.
            if fn.endswith((".ts", ".tsx")):
                src = read(os.path.join(dirpath, fn))
                if src is None:
                    continue
                records = find_server_actions(src)
                if not records:
                    continue
                glob_kind = _action_glob(fn)
                for rec in records:
                    name = str(rec["name"])
                    denied = envelope.is_denylisted(rel_file, name)
                    inv_reason = envelope.is_inventory_only(rpath or "")
                    if denied:
                        scope, reason = "denylisted", envelope.DESTRUCTIVE_DENYLIST[
                            "{0}::{1}".format(rel_file, name)
                        ]
                    elif inv_reason:
                        scope, reason = "inventory-only", inv_reason
                    else:
                        scope, reason = "exercisable", None
                    actions.append(
                        {
                            "type": "action",
                            "name": name,
                            "file": rel_file,
                            "route": rpath,
                            "glob": glob_kind,
                            "declaration": rec["declaration"],
                            "anonymous": bool(rec["anonymous"]),
                            "scope": scope,
                            "scope_reason": reason,
                            "surface": _surface_for(rpath or "", "action"),
                            # An anonymous closure has no name in source; the one
                            # recorded above is synthesised, so the row is a
                            # weaker claim than a named export and says so.
                            "confidence": "low-confidence" if rec["anonymous"] else "high",
                            "note": (
                                "anonymous inline `action={async () => { 'use server' }}` "
                                "closure — the name is synthesised by position"
                                if rec["anonymous"]
                                else None
                            ),
                        }
                    )

    # --- elements + fields, attributed to routes --------------------------
    elements = []  # type: List[Dict[str, object]]
    fields = []  # type: List[Dict[str, object]]

    for rel_file, rpath in sorted(tsx_files):
        src = read(os.path.join(repo, rel_file))
        if src is None:
            continue
        owner, via = _attribute(rpath, route_by_path)
        auth = auth_model_for(owner, model) if owner else "unknown"
        scope, scope_reason = scope_for_route(owner) if owner else ("exercisable", None)
        for idx, el in enumerate(find_elements(src)):
            # Attribution strength is reported separately, in `attributed_via`;
            # walking up to an ancestor route does not weaken the element's own
            # identifier, so confidence passes through unchanged. (This replaces
            # a branch that assigned 'high' to itself and therefore did nothing.)
            confidence = el["confidence"]
            record = {
                "type": "element",
                "tag": el["tag"],
                "identifier": el["identifier"],
                "identifier_source": el["identifier_source"],
                "text": el["text"],
                "file": rel_file,
                "route": owner,
                "attributed_via": via,
                "auth": auth,
                "scope": scope,
                "scope_reason": scope_reason,
                "surface": _surface_for(owner or "", "element"),
                "confidence": confidence,
                "note": el["note"],
                "index": idx,
            }
            elements.append(record)

            if el["tag"] in FIELD_TAGS:
                attrs = el["attrs"]
                constraints = field_constraints(attrs)
                name = attrs.get("name") or attrs.get("id") or el["identifier"]
                fields.append(
                    {
                        "type": "field",
                        "tag": el["tag"],
                        "name": name,
                        "file": rel_file,
                        "route": owner,
                        "attributed_via": via,
                        "auth": auth,
                        "scope": scope,
                        "scope_reason": scope_reason,
                        "surface": _surface_for(owner or "", "field"),
                        "constraints": constraints,
                        "confidence": "high" if name else "low-confidence",
                        "note": None if name else "field has no name/id in source",
                        "index": idx,
                    }
                )

    # --- declared constraint tables ---------------------------------------
    constraint_modules = {}  # type: Dict[str, object]
    for dirpath, dirnames, filenames in os.walk(os.path.join(repo, "src")):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in sorted(filenames):
            if not fn.endswith("-fields.ts"):
                continue
            rel_file = os.path.relpath(os.path.join(dirpath, fn), repo).replace(os.sep, "/")
            src = read(os.path.join(dirpath, fn))
            if src is None:
                continue
            parsed = parse_fields_module(src)
            if parsed["allowlists"] or parsed["max_lengths"] or parsed["label_tables"]:
                constraint_modules[rel_file] = parsed

    return {
        "_comment": (
            "KAN-467 Phase 1 static inventory. Generated by qa-sweep/inventory.py "
            "from source ONLY — no crawl, no network, no database. Items marked "
            "low-confidence could not be reliably identified from source and are "
            "kept in the denominator on purpose: dropping them would inflate every "
            "coverage figure downstream."
        ),
        "ticket": "KAN-467",
        "auth_model": model,
        "routes": routes,
        "actions": actions,
        "elements": elements,
        "fields": fields,
        "constraint_modules": constraint_modules,
        "counts": counts(routes, actions, elements, fields, constraint_modules),
    }


class SystemExit2(Exception):
    """A fail-closed condition. Carries the operator-facing explanation."""


def _action_glob(filename):
    # type: (str) -> str
    """Which source convention an action module follows. Reported, not filtered
    — `inline in *.tsx` exists as its own bucket so the count of actions that
    live in a page rather than an actions module is visible on the summary."""
    if filename == "actions.ts":
        return "actions.ts"
    if filename.endswith("-actions.ts"):
        return "*-actions.ts"
    if filename.endswith(".tsx"):
        return "inline in *.tsx"
    return "other 'use server' module"


def _surface_for(route_path, kind):
    # type: (str, str) -> str
    """Coarse grouping used for the coverage totals."""
    if kind == "route-handler" or route_path.startswith("/api"):
        return "api"
    if route_path.startswith("/admin"):
        return "admin"
    if route_path.startswith("/dashboard"):
        return "dashboard"
    return "public"


def _attribute(rpath, route_by_path):
    # type: (str, Dict[str, Dict[str, object]]) -> Tuple[Optional[str], str]
    """Attribute a source file to the route that owns it.

    Co-located client components (`contact-form.tsx` beside `page.tsx`) belong
    to their own directory's route. Anything else walks up to the nearest
    ancestor route and says so, because an attribution by inference is a
    weaker claim than an attribution by location.
    """
    if not rpath:
        return None, "unattributed"
    if rpath in route_by_path:
        return rpath, "same-directory"
    parts = [p for p in rpath.split("/") if p]
    while parts:
        parts.pop()
        candidate = "/" + "/".join(parts) if parts else "/"
        if candidate in route_by_path:
            return candidate, "ancestor-directory"
    return None, "unattributed"


def counts(routes, actions, elements, fields, constraint_modules):
    # type: (List, List, List, List, Dict) -> Dict[str, object]
    def tally(items, key):
        out = {}  # type: Dict[str, int]
        for it in items:
            out[str(it.get(key))] = out.get(str(it.get(key)), 0) + 1
        return dict(sorted(out.items()))

    pages = [r for r in routes if r["kind"] == "page"]
    handlers = [r for r in routes if r["kind"] == "route-handler"]
    return {
        "routes_total": len(routes),
        "pages": len(pages),
        "layouts": len([r for r in routes if r["kind"] == "layout"]),
        "route_handlers": len(handlers),
        "api_route_handlers": len([r for r in handlers if r["path"].startswith("/api")]),
        "pages_by_auth": tally(pages, "auth"),
        "pages_by_surface": tally(pages, "surface"),
        "routes_by_scope": tally(routes, "scope"),
        "actions_total": len(actions),
        "actions_by_scope": tally(actions, "scope"),
        "actions_by_glob": tally(actions, "glob"),
        "actions_by_surface": tally(actions, "surface"),
        "actions_by_declaration": tally(actions, "declaration"),
        "actions_by_confidence": tally(actions, "confidence"),
        "elements_total": len(elements),
        "elements_by_tag": tally(elements, "tag"),
        "elements_by_scope": tally(elements, "scope"),
        "elements_by_surface": tally(elements, "surface"),
        "elements_by_confidence": tally(elements, "confidence"),
        "elements_by_attribution": tally(elements, "attributed_via"),
        "fields_total": len(fields),
        "fields_by_confidence": tally(fields, "confidence"),
        "fields_with_maxlength": len([f for f in fields if "maxLength" in f["constraints"]]),
        "fields_required": len([f for f in fields if "required" in f["constraints"]]),
        "constraint_modules": len(constraint_modules),
        "declared_allowlists": sum(
            len(m["allowlists"]) for m in constraint_modules.values()  # type: ignore[index]
        ),
        "declared_max_lengths": sum(
            len(m["max_lengths"]) for m in constraint_modules.values()  # type: ignore[index]
        ),
    }


def print_summary(inv, stream=sys.stdout):
    # type: (Dict[str, object], object) -> None
    c = inv["counts"]
    stream.write("KAN-467 Phase 1 — static inventory\n")
    stream.write("=" * 66 + "\n")
    stream.write("auth model derived from src/middleware.ts:\n")
    stream.write("  admin prefixes  : {0}\n".format(", ".join(inv["auth_model"]["admin_prefixes"])))
    stream.write("  authed prefixes : {0}\n".format(", ".join(inv["auth_model"]["authed_prefixes"])))
    stream.write("\nROUTES\n")
    stream.write("  pages ............... {0}\n".format(c["pages"]))
    for k, v in c["pages_by_surface"].items():
        stream.write("      {0:<12} {1}\n".format(k, v))
    stream.write("  layouts ............. {0}\n".format(c["layouts"]))
    stream.write("  route handlers ...... {0}  (of which /api: {1})\n".format(
        c["route_handlers"], c["api_route_handlers"]))
    stream.write("  by auth model ....... {0}\n".format(c["pages_by_auth"]))
    stream.write("  by scope ............ {0}\n".format(c["routes_by_scope"]))
    stream.write("\nSERVER ACTIONS\n")
    stream.write("  total ............... {0}\n".format(c["actions_total"]))
    stream.write("  by scope ............ {0}\n".format(c["actions_by_scope"]))
    stream.write("  by source glob ...... {0}\n".format(c["actions_by_glob"]))
    stream.write("  by declaration ...... {0}\n".format(c["actions_by_declaration"]))
    stream.write("\nINTERACTIVE ELEMENTS\n")
    stream.write("  total ............... {0}\n".format(c["elements_total"]))
    stream.write("  by tag .............. {0}\n".format(c["elements_by_tag"]))
    stream.write("  by surface .......... {0}\n".format(c["elements_by_surface"]))
    stream.write("  by confidence ....... {0}\n".format(c["elements_by_confidence"]))
    stream.write("  by attribution ...... {0}\n".format(c["elements_by_attribution"]))
    stream.write("\nFORM FIELDS\n")
    stream.write("  total ............... {0}\n".format(c["fields_total"]))
    stream.write("  with maxLength ...... {0}\n".format(c["fields_with_maxlength"]))
    stream.write("  required ............ {0}\n".format(c["fields_required"]))
    stream.write("  by confidence ....... {0}\n".format(c["fields_by_confidence"]))
    stream.write("  constraint modules .. {0} ({1} allowlists, {2} max-lengths)\n".format(
        c["constraint_modules"], c["declared_allowlists"], c["declared_max_lengths"]))
    low = (
        c["elements_by_confidence"].get("low-confidence", 0)
        + c["fields_by_confidence"].get("low-confidence", 0)
        + c["actions_by_confidence"].get("low-confidence", 0)
    )
    if low:
        stream.write(
            "\n{0} item(s) are LOW-CONFIDENCE — kept in the denominator on purpose.\n".format(low)
        )


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------

_FIXTURE_TSX = """
import { signIn } from './actions';
// <button data-testid="ghost-in-a-comment">never rendered</button>
/* <input name="also-a-comment" /> */
export default function Page() {
  const url = 'https://example.com//not-a-comment';
  return (
    <form action={signIn}>
      <input name="email" type="email" required maxLength={200} />
      <textarea name="bio" maxLength={500} />
      <select name="country"><option>UK</option></select>
      <button onClick={() => setOpen(!open)} data-testid="save-btn">Save</button>
      <button className="x">Cancel</button>
      <a href="/terms">Terms</a>
      <article>not interactive</article>
    </form>
  );
}
"""

_FIXTURE_ACTIONS = """
'use server';
export async function updateThing(formData: FormData) {}
export function helperNotAsync() {}
async function notExported() {}
// export async function commentedOut() {}
"""

_FIXTURE_NO_DIRECTIVE = """
export async function notAnAction() {}
"""

#: `'use client'` is a directive too, so it must not end the prologue scan —
#: but it must not be mistaken for `'use server'` either.
_FIXTURE_USE_CLIENT = """
'use client';
export async function notAServerAction() {}
"""

#: The shape that was invisible until 2026-08-04: a `page.tsx` with NO
#: file-level directive, whose actions each carry their own function-scoped
#: `'use server'`. Eight real admin moderation actions and two inline OAuth form
#: actions are declared exactly like this, and none of them was in the
#: denominator — so none of them could be denylisted either.
_FIXTURE_INLINE_TSX = """
import { redirect } from 'next/navigation';

async function actionSuspend(formData: FormData) {
  'use server';
  await setSuspendState(formData, true);
}

async function setSuspendState(formData: FormData, suspend: boolean) {
  await db.update(suspend);
}

// async function actionCommentedOut(formData: FormData) {
//   'use server';
// }

const DOC = "a body opens with the directive 'use server' as its first statement";

export default async function Page() {
  return (
    <form
      action={async (formData: FormData) => {
        'use server';
        await actionSuspend(formData);
      }}
    >
      <button type="submit">Suspend</button>
    </form>
  );
}
"""

_FIXTURE_MIDDLEWARE = """
export async function middleware(request) {
  if (pathname.startsWith('/admin')) { return redirect(); }
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(url);
  }
}
"""

#: Every shape below is taken from a REAL `*-fields.ts` in this repo. The first
#: three are the conventional ones; the last four are the ones a
#: naming-convention parser silently dropped (organise-fields.ts and
#: conversation-starters-fields.ts), which is why they are pinned here.
_FIXTURE_FIELDS = """
export const ALLOWED_PROFILE_FIELDS = ['display_name', 'headline'] as const;
export const GIFT_VOUCHER_HINT_MAX_LENGTH = 200;
export const MANUAL_OF_ME_MAX_LENGTHS: Record<F, number> = { how_i_work: 1000, energy: 500 };
export const GATHERING_TYPES: GatheringType[] = ['dinner', 'walk'];
export const MAX_ATTENDEES = 30;
export const ANSWER_MAX = 500;
export const DRAFT_LIMITS = { title: 200, description: 2000 } as const;
export const GATHERING_TYPE_LABELS: Record<GatheringType, string> = { dinner: 'Dinner' };
"""


def self_test():
    # type: () -> int
    checks = []  # type: List[Tuple[str, bool, str]]

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    els = find_elements(_FIXTURE_TSX)
    tags = [e["tag"] for e in els]
    idents = dict((e["identifier"], e["identifier_source"]) for e in els)

    # The arrow function in onClick contains a '>' — a naive regex truncates
    # there and loses the data-testid that follows it.
    check(
        "an arrow function in an attribute does not truncate the tag",
        idents.get("save-btn") == "data-testid",
        str(idents),
    )
    # CTL-039's lesson, applied to a scanner: a comment is not an element.
    check("commented-out elements are not inventoried", "ghost-in-a-comment" not in idents)
    check("commented-out fields are not inventoried", "also-a-comment" not in idents)
    # A '//' inside a URL must not eat the rest of the line.
    check("a URL is not mistaken for a comment", "/terms" in idents)
    check("<a> matches but <article> does not", tags.count("a") == 1, str(tags))
    check("all field tags found", tags.count("input") == 1 and tags.count("textarea") == 1
          and tags.count("select") == 1, str(tags))
    check("form found", tags.count("form") == 1)
    check("two buttons found", tags.count("button") == 2, str(tags))

    save = [e for e in els if e["identifier"] == "save-btn"][0]
    check("a strongly identified element is high confidence", save["confidence"] == "high")
    cancel = [e for e in els if e["tag"] == "button" and e["identifier"] != "save-btn"][0]
    check(
        "a text-only button is low-confidence, not dropped",
        cancel["confidence"] == "low-confidence" and cancel["identifier"] == "Cancel",
        str(cancel),
    )

    email = [e for e in els if e["attrs"].get("name") == "email"][0]
    cons = field_constraints(email["attrs"])
    check("maxLength is captured", cons.get("maxLength") == "200", str(cons))
    check("bare `required` is captured as True", cons.get("required") is True, str(cons))
    check("type is captured", cons.get("type") == "email", str(cons))

    # Server actions — FILE-level directive
    records = find_server_actions(_FIXTURE_ACTIONS)
    names = [r["name"] for r in records]
    check("exported async action found", "updateThing" in names, str(names))
    check("exported sync export found", "helperNotAsync" in names, str(names))
    check("non-exported function excluded", "notExported" not in names, str(names))
    check("commented-out export excluded", "commentedOut" not in names, str(names))
    check(
        "an action from a file-level directive is declared 'exported'",
        [r["declaration"] for r in records if r["name"] == "updateThing"] == ["exported"],
        str(records),
    )
    check(
        "a module without 'use server' yields no actions",
        find_server_actions(_FIXTURE_NO_DIRECTIVE) == [],
    )
    check(
        "a 'use client' module yields no SERVER actions",
        find_server_actions(_FIXTURE_USE_CLIENT) == [],
        str(find_server_actions(_FIXTURE_USE_CLIENT)),
    )

    # Server actions — FUNCTION-level directive, the .tsx shape.
    inline = find_server_actions(_FIXTURE_INLINE_TSX)
    inline_names = [r["name"] for r in inline]
    check(
        "a file-local function carrying its own 'use server' IS an action",
        "actionSuspend" in inline_names,
        str(inline_names),
    )
    check(
        "it is recorded as file-local, not as an export it never was",
        [r["declaration"] for r in inline if r["name"] == "actionSuspend"] == ["file-local"],
        str(inline),
    )
    check(
        "a plain helper beside it is NOT an action",
        "setSuspendState" not in inline_names,
        str(inline_names),
    )
    check(
        "the default-exported page component is NOT an action",
        "Page" not in inline_names,
        str(inline_names),
    )
    check(
        "a commented-out inline action is not inventoried",
        "actionCommentedOut" not in inline_names,
        str(inline_names),
    )
    check(
        "an anonymous inline form action is counted under a synthetic name",
        "inlineAction1" in inline_names,
        str(inline_names),
    )
    check(
        "the anonymous one is flagged anonymous, so its name reads as ours",
        [r["anonymous"] for r in inline if r["name"] == "inlineAction1"] == [True],
        str(inline),
    )
    # The directive is a STATEMENT. The same characters inside a string literal
    # are prose, and counting them would invent actions that do not exist.
    check(
        "a 'use server' string literal is not a directive",
        len(inline) == 2,
        str(inline_names),
    )
    check(
        "a page.tsx carries no FILE-level 'use server'",
        not _has_file_level_use_server(strip_comments(_FIXTURE_INLINE_TSX)),
    )
    check(
        "an actions.ts DOES carry a FILE-level 'use server'",
        _has_file_level_use_server(strip_comments(_FIXTURE_ACTIONS)),
    )
    check(
        "'use client' alone is not a file-level server directive",
        not _has_file_level_use_server(strip_comments(_FIXTURE_USE_CLIENT)),
    )
    check(
        "an inline .tsx action is bucketed separately from an actions module",
        _action_glob("page.tsx") == "inline in *.tsx"
        and _action_glob("actions.ts") == "actions.ts"
        and _action_glob("city-actions.ts") == "*-actions.ts",
    )

    # Auth model derivation
    model = derive_auth_model(_FIXTURE_MIDDLEWARE)
    check("admin prefix derived", model["admin_prefixes"] == ["/admin"], str(model))
    check("authed prefix derived", model["authed_prefixes"] == ["/dashboard"], str(model))
    check("admin route classified", auth_model_for("/admin/users", model) == "admin")
    check("dashboard route classified", auth_model_for("/dashboard/profile", model) == "authed")
    check("public route classified", auth_model_for("/about", model) == "public")
    check("a prefix lookalike is not gated", auth_model_for("/administrator", model) == "public")

    # Route path derivation
    check("route group is erased", route_path_from_dir("(auth){0}login".format(os.sep)) == "/login")
    check("root is /", route_path_from_dir(".") == "/")
    check(
        "dynamic segment preserved",
        route_path_from_dir("admin{0}users{0}[slug]".format(os.sep)) == "/admin/users/[slug]",
    )
    check("private folder is not a route", route_path_from_dir("_marketing") is None)

    # Scope
    check("admin route is inventory-only", scope_for_route("/admin/users")[0] == "inventory-only")
    check("dashboard route is exercisable", scope_for_route("/dashboard")[0] == "exercisable")

    # Denylist integration — the property the whole envelope rests on.
    check(
        "a denylisted action is never exercisable",
        envelope.is_denylisted("src/app/dashboard/settings/actions.ts", "deleteAccount"),
    )

    # Field constraint tables
    parsed = parse_fields_module(_FIXTURE_FIELDS)
    check(
        "allowlist parsed",
        parsed["allowlists"].get("ALLOWED_PROFILE_FIELDS") == ["display_name", "headline"],
        str(parsed),
    )
    check(
        "scalar max-length parsed",
        parsed["max_lengths"].get("GIFT_VOUCHER_HINT_MAX_LENGTH") == 200,
        str(parsed),
    )
    check(
        "max-length table parsed",
        parsed["max_lengths"].get("MANUAL_OF_ME_MAX_LENGTHS.how_i_work") == 1000,
        str(parsed),
    )
    # The four shapes a naming-convention parser dropped. Each was a real,
    # enforced constraint that would have been invisible to Phase 3.
    check(
        "an array allowlist WITHOUT `as const` is parsed",
        parsed["allowlists"].get("GATHERING_TYPES") == ["dinner", "walk"],
        str(parsed),
    )
    check(
        "a cap not named *_MAX_LENGTH is parsed",
        parsed["max_lengths"].get("MAX_ATTENDEES") == 30,
        str(parsed),
    )
    check(
        "a cap named *_MAX is parsed",
        parsed["max_lengths"].get("ANSWER_MAX") == 500,
        str(parsed),
    )
    check(
        "a limits table not named *_MAX_LENGTHS is parsed",
        parsed["max_lengths"].get("DRAFT_LIMITS.title") == 200,
        str(parsed),
    )
    check(
        "a string label table is recorded, not counted as a limit",
        parsed["label_tables"].get("GATHERING_TYPE_LABELS") == ["dinner"]
        and not any(k.startswith("GATHERING_TYPE_LABELS") for k in parsed["max_lengths"]),
        str(parsed),
    )

    # Attribution
    routes = {"/contact": {}, "/": {}}
    check("co-located file attributed to its own route",
          _attribute("/contact", routes) == ("/contact", "same-directory"))
    check("orphan file walks up to an ancestor",
          _attribute("/contact/widgets", routes) == ("/contact", "ancestor-directory"))

    passed = sum(1 for _, ok, _ in checks if ok)
    for name, ok, detail in checks:
        if not ok:
            print("  FAIL  {0}{1}".format(name, (" -> " + detail) if detail else ""))
    print("inventory self-test: {0}/{1} passed".format(passed, len(checks)))
    return 0 if passed == len(checks) else 1


def main():
    # type: () -> int
    parser = argparse.ArgumentParser(description="KAN-467 Phase 1 static inventory.")
    parser.add_argument("--summary", action="store_true", help="print counts, do not write JSON")
    parser.add_argument("--out", default=OUT_PATH, help="output path for the inventory JSON")
    parser.add_argument("--self-test", action="store_true", help="run the fixtures")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    try:
        inv = build()
    except SystemExit2 as exc:
        print("::error::inventory FAILED CLOSED — {0}".format(exc))
        return 2

    print_summary(inv)
    if not args.summary:
        with open(args.out, "w") as fh:
            fh.write(json.dumps(inv, indent=2, sort_keys=True) + "\n")
        print("\nWrote {0}".format(os.path.relpath(args.out, REPO)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
