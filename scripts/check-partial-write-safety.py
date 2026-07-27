#!/usr/bin/env python3
"""BUGS-74 (generalised) — the "partial read, whole-row write" data-loss class.

THE DEFECT CLASS
----------------
A server action accepts a user-supplied *partial* field record, filters it
through an allowlist, and writes the resulting object to the database. If the
filter loop copies a key whose value is ``undefined`` -- or coerces it with
``?? null`` / ``|| null`` -- then every field the caller merely OMITTED is
written as NULL. Any editor that loads a SUBSET of the field set and then
autosaves the whole draft silently destroys the columns it never loaded.

That is exactly BUGS-74: the profile editor selected 4 of the 6
``profile_manual_of_me`` columns, so ``good_to_know`` and ``boundaries`` came
through as ``undefined``, were coerced to null, and were wiped from real
members' profiles on develop, staging, beta AND production. BUGS-70 and
BUGS-73 are the same family (an edit that does not persist / does not appear).

THE INVARIANT
-------------
Any function that builds a DB payload by iterating a caller-supplied record
must distinguish "not provided" from "explicitly cleared"::

    undefined     -> OMIT the key from the payload  (leave the stored value alone)
    null  /  ''   -> write NULL                     (an explicit clear)

Getting this right at the WRITE path is what makes the class impossible. A
loader that misses a column then becomes a mere display bug, not data loss.

WHY THIS IS FUNCTION-SCOPED
---------------------------
The first cut of this check was file-scoped and passed ``actions.ts`` because
an unrelated function (``updateProfileItem``) contained ``!== undefined``,
while the actually-dangerous ``updateProfileFields`` had no guard at all. A
file-scoped check is a vacuous pass on exactly the file it most needs to catch.
Scope is therefore the individual function body.

SCOPE PREDICATE
---------------
A function body is in scope when it does all three of:
  1. references an allowlist   (``*_FIELDS`` / ``isAllowed*Field`` / ``is*Field(``)
  2. iterates a caller record  (``Object.entries(`` / ``Object.keys(``)
  3. writes to the database    (``.update(`` / ``.upsert(`` / ``.insert(``)

Functions that write a fixed, hard-coded column set cannot express this defect
and are out of scope.

ALLOW-LIST
----------
``// partial-write-ok: <reason>`` on any line inside the function body.

USAGE
-----
    python3 scripts/check-partial-write-safety.py [--src src]
    python3 scripts/check-partial-write-safety.py --self-test

Related: BUGS-70 / BUGS-73 / BUGS-74; tests/unit/partial-write-safety.test.ts
asserts the same invariant behaviourally at runtime.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# --- scope predicate -------------------------------------------------------

ALLOWLIST_RE = re.compile(r"[A-Z][A-Z0-9_]*_FIELDS\b|isAllowed[A-Za-z]*Field|\bis[A-Z][A-Za-z]*Field\(")
ITERATE_RE = re.compile(r"Object\.(entries|keys)\(")
WRITE_RE = re.compile(r"\.(update|upsert|insert)\(")

# --- guard detection -------------------------------------------------------

UNDEFINED_GUARD_RE = re.compile(
    r"(===|!==)\s*undefined"
    r"|typeof\s+[A-Za-z_$][\w$.]*\s*(===|!==)\s*['\"]undefined['\"]"
)
# `?? null` / `|| null` applied to an incoming value re-creates the defect:
# it converts "not provided" back into "explicitly cleared" before any guard
# can help.
NULL_COERCE_RE = re.compile(r"\b(val|value|v|raw|input)\b\s*(\?\?|\|\|)\s*null")

ALLOW_MARKER = "partial-write-ok"

FUNCTION_START_RE = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]"
    r"|^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\("
)


class Function:
    def __init__(self, name: str, start_line: int, body: str):
        self.name = name
        self.start_line = start_line
        self.body = body

    @property
    def in_scope(self) -> bool:
        return bool(
            ALLOWLIST_RE.search(self.body)
            and ITERATE_RE.search(self.body)
            and WRITE_RE.search(self.body)
        )


def split_functions(source: str) -> list[Function]:
    """Split a TS/TSX module into top-level function bodies by brace depth.

    Deliberately simple: it tracks string/template/comment state so braces
    inside literals do not confuse the depth counter. It does not need to be a
    real parser -- it only needs to attribute each line to the right function.
    """
    lines = source.split("\n")
    functions: list[Function] = []
    i = 0
    n = len(lines)

    while i < n:
        match = FUNCTION_START_RE.match(lines[i])
        if not match:
            i += 1
            continue

        name = match.group(1) or match.group(2) or "<anonymous>"
        start = i
        depth = 0
        opened = False
        body_lines: list[str] = []

        while i < n:
            line = lines[i]
            body_lines.append(line)
            depth_delta, opened_here = _brace_delta(line)
            if opened_here:
                opened = True
            depth += depth_delta
            i += 1
            if opened and depth <= 0:
                break

        functions.append(Function(name, start + 1, "\n".join(body_lines)))

    return functions


def _brace_delta(line: str) -> tuple[int, bool]:
    """Net brace depth change for a line, ignoring braces inside strings/comments."""
    delta = 0
    opened = False
    in_single = in_double = in_tick = False
    idx = 0
    length = len(line)

    while idx < length:
        ch = line[idx]
        nxt = line[idx + 1] if idx + 1 < length else ""

        if not (in_single or in_double or in_tick):
            if ch == "/" and nxt == "/":
                break  # rest of line is a comment
            if ch == "'":
                in_single = True
            elif ch == '"':
                in_double = True
            elif ch == "`":
                in_tick = True
            elif ch == "{":
                delta += 1
                opened = True
            elif ch == "}":
                delta -= 1
        else:
            if ch == "\\":
                idx += 2
                continue
            if in_single and ch == "'":
                in_single = False
            elif in_double and ch == '"':
                in_double = False
            elif in_tick and ch == "`":
                in_tick = False

        idx += 1

    return delta, opened


def check_source(source: str, path: str) -> list[str]:
    """Return a list of violation messages for one module."""
    problems: list[str] = []

    for fn in split_functions(source):
        if not fn.in_scope:
            continue
        if ALLOW_MARKER in fn.body:
            continue

        if not UNDEFINED_GUARD_RE.search(fn.body):
            problems.append(
                f"::error file={path},line={fn.start_line}::"
                f"{fn.name}() filters a caller-supplied record through an allowlist and "
                f"writes it, but has no explicit `undefined` guard. Omitted fields will be "
                f"written as NULL -- silent member data loss (BUGS-74)."
            )
            continue

        coerce = NULL_COERCE_RE.search(fn.body)
        if coerce:
            offset = fn.body[: coerce.start()].count("\n")
            problems.append(
                f"::error file={path},line={fn.start_line + offset}::"
                f"{fn.name}() coerces an incoming field value with `?? null` / `|| null`, "
                f"which turns \"not provided\" back into \"explicitly cleared\" and re-creates "
                f"the BUGS-74 data-loss path."
            )

    return problems


# --- self-test (the "test the test" control) -------------------------------

_VULNERABLE = """
'use server';
import { ALLOWED_PROFILE_FIELDS, isAllowedProfileField } from './profile-fields';

export async function updateProfileFields(data) {
  const sanitised = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isAllowedProfileField(key)) continue;
    sanitised[key] = val;
  }
  await supabase.from('profiles').update(sanitised).eq('user_id', user.id);
}
"""

_COERCING = """
'use server';
import { MANUAL_OF_ME_FIELDS, isManualOfMeField } from './manual-of-me-fields';

export async function updateManualOfMe(data) {
  const sanitised = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isManualOfMeField(key)) continue;
    if (val === undefined) { /* guard present but... */ }
    sanitised[key] = val ?? null;
  }
  await supabase.from('profile_manual_of_me').upsert(sanitised);
}
"""

_SAFE = """
'use server';
import { MANUAL_OF_ME_FIELDS, isManualOfMeField } from './manual-of-me-fields';

export async function updateManualOfMe(data) {
  const sanitised = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isManualOfMeField(key)) continue;
    if (val === undefined) continue;
    if (val === null) { sanitised[key] = null; continue; }
    sanitised[key] = sanitiseText(val);
  }
  await supabase.from('profile_manual_of_me').upsert(sanitised);
}
"""

# The false-negative that the first, file-scoped version of this check shipped
# with: a guarded function elsewhere in the same file must NOT launder an
# unguarded allowlist-driven writer.
_GUARD_IN_WRONG_FUNCTION = """
'use server';
import { isAllowedProfileField } from './profile-fields';

export async function updateProfileFields(data) {
  const sanitised = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isAllowedProfileField(key)) continue;
    sanitised[key] = val;
  }
  await supabase.from('profiles').update(sanitised).eq('user_id', user.id);
}

export async function updateProfileItem(itemId, data) {
  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  await supabase.from('profile_items').update(patch).eq('id', itemId);
}
"""

_OUT_OF_SCOPE = """
'use server';
export async function setDeliveryCountry(code) {
  await supabase.from('profiles').update({ delivery_country_code: code }).eq('user_id', u);
}
"""

_ALLOWLISTED = """
'use server';
import { isAllowedProfileField } from './profile-fields';

export async function bulkReplaceProfile(data) {
  // partial-write-ok: KAN-000 deliberate full-row replace, caller always sends every field
  const sanitised = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isAllowedProfileField(key)) continue;
    sanitised[key] = val;
  }
  await supabase.from('profiles').update(sanitised).eq('user_id', u);
}
"""

_CASES = [
    ("vulnerable: no undefined guard", _VULNERABLE, 1),
    ("vulnerable: ?? null coercion", _COERCING, 1),
    ("vulnerable: guard is in a DIFFERENT function", _GUARD_IN_WRONG_FUNCTION, 1),
    ("safe: explicit undefined guard", _SAFE, 0),
    ("out of scope: fixed column set", _OUT_OF_SCOPE, 0),
    ("allow-listed with a reason", _ALLOWLISTED, 0),
]


def self_test() -> int:
    failures = 0
    for label, source, expected in _CASES:
        found = len(check_source(source, "fixture.ts"))
        ok = found == expected
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected}, got {found})")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-partial-write-safety self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(_CASES)} fixture case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default="src", help="source root to scan (default: src)")
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="verify the detector against known-good and known-bad fixtures",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    root = Path(args.src)
    if not root.is_dir():
        print(f"::error::source directory '{root}' not found.")
        return 1

    files = sorted(
        p for p in root.rglob("*") if p.suffix in {".ts", ".tsx"} and p.is_file()
    )

    in_scope: list[str] = []
    problems: list[str] = []

    for path in files:
        try:
            source = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if not (ALLOWLIST_RE.search(source) and ITERATE_RE.search(source) and WRITE_RE.search(source)):
            continue
        rel = str(path)
        fns = [f for f in split_functions(source) if f.in_scope]
        if fns:
            in_scope.extend(f"{rel}::{f.name}()" for f in fns)
        problems.extend(check_source(source, rel))

    # Vacuous-pass guard. This repo has had allowlist-driven write actions since
    # KAN-154. Finding none means the detector's shape assumptions have drifted
    # (a rename, a refactor to a different idiom), not that the risk is gone.
    # Reporting green here is precisely the false positive the repo's Workflow &
    # Backup Integrity Policy forbids.
    if not in_scope:
        print(f"::error::No allowlist-driven write functions found under '{root}'.")
        print("::error::This check has lost its target -- it would be passing vacuously.")
        print("Expected at least the profile + Manual-of-Me actions.")
        print("Update the scope predicate in scripts/check-partial-write-safety.py.")
        return 1

    print(f"Scanning {len(in_scope)} allowlist-driven write function(s) for partial-write safety…")
    for name in in_scope:
        print(f"  · {name}")

    if problems:
        print()
        for msg in problems:
            print(msg)
        print()
        print(f"::error::Found {len(problems)} partial-write-safety violation(s).")
        print()
        print("Fix pattern (src/app/dashboard/profile/manual-of-me-actions.ts):")
        print()
        print("    for (const [key, val] of Object.entries(data)) {")
        print("      if (!isAllowedField(key)) { rejected.push(key); continue; }")
        print("      if (val === undefined) continue;              // NOT PROVIDED -> leave stored value alone")
        print("      if (val === null) { payload[key] = null; continue; }  // EXPLICIT CLEAR")
        print("      payload[key] = sanitise(val);")
        print("    }")
        print()
        print("Then add a contract case to tests/unit/partial-write-safety.test.ts.")
        print("Allow-list only with '// partial-write-ok: <reason>' plus a Jira key.")
        return 1

    print('All allowlist-driven write functions distinguish "not provided" from "cleared". ✓')
    return 0


if __name__ == "__main__":
    sys.exit(main())
