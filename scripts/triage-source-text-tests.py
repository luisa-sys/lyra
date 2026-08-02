#!/usr/bin/env python3
"""KAN-414 F4 — triage the remaining source-text scans in tests/.

WHY
---
KAN-417 §2 estimated Group 3 at "~38 files … mechanical once the pattern is
set". The real number is ~120 files and ~377 source reads, and Group 2 showed
that 6 of its 8 supposedly-convertible files were actually structural. Force-
converting a structural scan produces a test that looks more modern and proves
less, which is the failure this programme exists to prevent.

So: classify before converting. The test is one question —

    CAN A RUNNING PROGRAM OBSERVE THIS?

Absence of a pattern, file content, export surface and call ordering cannot.

WHAT IT DOES
------------
Groups every assertion that follows a `readFileSync` into buckets and prints a
per-file verdict. This is TRIAGE, not a gate: it narrows ~120 files to the ones
worth a human's attention, and it is deliberately conservative — anything it
cannot confidently call is reported as `review`, never silently as convertible.

BUCKETS
  absence      `not.toMatch` / `not.toContain` — proving something is NOT there.
               Unobservable at runtime by construction. STRUCTURAL.
  existence    `existsSync` / "file exists" assertions. STRUCTURAL.
  migration    reads a file under supabase/migrations/. Content of a migration
               is a static fact; observing it needs a database.
  surface      asserts on `export const` / `export function` declarations —
               module export surface, not behaviour.
  ordering     compares `indexOf` positions to assert one thing precedes
               another in the SOURCE. A proxy for ordering, not ordering.
  copy-pin     asserts on natural-language prose — legal headings, button
               text. KAN-417 §8 GROUP 4: founder-gated content, out of scope.
               Rendering the page to assert the same string is the same pin
               with more machinery, so these do not benefit from conversion.
  behavioural  everything else — a positive assertion about what the code does,
               which is the (b) candidate set worth converting.

USAGE
    python3 scripts/triage-source-text-tests.py            # summary
    python3 scripts/triage-source-text-tests.py --files    # per-file detail
    python3 scripts/triage-source-text-tests.py --candidates  # (b) candidates only
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

READ = re.compile(r"readFileSync\(")

# A COPY PIN asserts on natural-language prose — legal headings, button text,
# marketing wording. KAN-417 §8 puts these in GROUP 4: "explicitly out of scope,
# no approval sought … founder-gated content pins, untouched." They also cannot
# be improved by conversion: rendering a page to assert the same string is the
# same pin with more machinery in front of it.
#
# Heuristic: a quoted literal of two or more words containing a word of four or
# more letters, with nothing identifier-ish in it (no _ . ( ) and no camelCase
# run). Deliberately narrow — a false "copy" call would HIDE a real candidate,
# so anything ambiguous stays in the behavioural bucket for a human to judge.
COPY_PIN = re.compile(r"""to(?:Contain|Match)\(\s*['"]([^'"]+)['"]""")
IDENTIFIERISH = re.compile(r"[_.()/]|[a-z][A-Z]")


def _is_copy_pin(block: str) -> bool:
    for m in COPY_PIN.finditer(block):
        phrase = m.group(1)
        if IDENTIFIERISH.search(phrase):
            continue
        words = phrase.split()
        if len(words) >= 2 and any(len(w) >= 4 and w.isalpha() for w in words):
            return True
    return False


BUCKETS = [
    ("absence", re.compile(r"not\.(toMatch|toContain)")),
    ("existence", re.compile(r"existsSync\(|toBe\(true\)\s*;?\s*//\s*exists")),
    ("surface", re.compile(r"toMatch\(/export (const|function|type|interface)")),
    ("ordering", re.compile(r"indexOf\(|toBeLessThan\(|toBeGreaterThan\(")),
]
# Catching a migration read by its path literal alone MISSES the common shape,
# where a test lists the migrations directory and `.find()`s the file it wants —
# `tests/unit/profile-items-visibility-migration.test.js` does exactly that, and
# its 8 assertions on RLS-policy SQL were being reported as convertible.
#
# Any assertion over the text of a `.sql` file is migration content: a static
# fact that needs a database to observe. So match the SQL-ness of what is being
# read, not the spelling of the path.
MIGRATION_READ = re.compile(
    r"supabase/migrations|SRC\.migrations|\.sql\b|\bsql\s*\)|const sql\b"
)


def tracked_tests() -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(REPO), "ls-files", "tests"], capture_output=True, text=True
    ).stdout
    return [
        f
        for f in out.split()
        if f.endswith((".ts", ".tsx", ".js")) and not f.startswith("tests/support/")
    ]


def classify(text: str) -> Counter:
    """Bucket every test block that performs a source read."""
    counts: Counter = Counter()
    # Split into test blocks so a file with both kinds is not judged as one.
    blocks = re.split(r"\n\s{2,}(?:test|it)\(", text)
    for b in blocks:
        if not READ.search(b):
            continue
        if MIGRATION_READ.search(b):
            counts["migration"] += 1
            continue
        for name, rx in BUCKETS:
            if rx.search(b):
                counts[name] += 1
                break
        else:
            counts["copy-pin" if _is_copy_pin(b) else "behavioural"] += 1
    return counts


def main() -> int:
    detail = "--files" in sys.argv
    only_candidates = "--candidates" in sys.argv

    total: Counter = Counter()
    rows = []
    for rel in sorted(tracked_tests()):
        try:
            text = (REPO / rel).read_text(encoding="utf-8")
        except OSError:
            continue
        if not READ.search(text):
            continue
        c = classify(text)
        if not c:
            continue
        total.update(c)
        rows.append((c.get("behavioural", 0), sum(c.values()), rel, c))

    rows.sort(reverse=True)

    if detail or only_candidates:
        for beh, tot, rel, c in rows:
            if only_candidates and beh == 0:
                continue
            parts = " ".join(f"{k}={v}" for k, v in sorted(c.items()))
            print(f"{beh:3} behavioural / {tot:3} total  {rel}\n      {parts}")
        print()

    print("Assertion blocks that read source, by bucket:")
    for k in ("behavioural", "copy-pin", "absence", "existence", "migration", "surface", "ordering"):
        if total.get(k):
            print(f"  {total[k]:4}  {k}")
    structural = sum(v for k, v in total.items() if k != "behavioural")
    print(f"\n  {total.get('behavioural', 0)} convertible candidates "
          f"vs {structural} structural, across {len(rows)} files.")
    print("\nTriage only. Every candidate still needs its invariant written in "
          "words and a mutation proof before its text block may be deleted "
          "(KAN-417 §8).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
