#!/usr/bin/env python3
"""KAN-414 F6 — the schema-drift ratchet over the committed `Database` types.

WHY THIS EXISTS
---------------
`src/types/database/{dev,staging,prod}.ts` are the three Supabase projects'
schemas. They are not identical, and the differences are real (KAN-420 R5):
production lacks the KAN-153 discoverability columns, the KAN-143 `draft`
visibility label and two functions; dev lacks BUGS-62's `claimed_at`.

The app compiles against `dev` (see `src/types/database/index.ts` for why), so
**TypeScript actively asserts that production has columns it does not have.**
That is a deliberate, documented trade — and it means the type system cannot be
the control here. This gate is.

WHAT IT DOES
------------
Diffs the three committed schemas and compares the drift against a recorded
baseline (`supabase/schema-drift-baseline.json`). The baseline is SHRINK-ONLY:

  * drift that is in the baseline  -> known, ticketed, allowed
  * drift that is NOT              -> FAIL. Something diverged unnoticed.
  * baseline entry no longer drifting -> FAIL. It was fixed; record that by
    removing the entry, so the baseline cannot quietly over-state the problem.

That last rule is the one that matters. A baseline you may only add to is a
suppression list; a baseline that must shrink when reality improves is a
ratchet, and it is the only version that ever reaches zero.

WHY IT DOES NOT REGENERATE
--------------------------
The plan's F6 asks for a "CI regeneration diff". Regenerating needs Supabase
credentials in CI, which do not exist and are founder-gated. Rather than ship a
step that silently skips when a secret is absent — the exact `if: env.X != ''`
pattern the Workflow & Backup Integrity Policy forbids — this gate checks what
it CAN check without credentials, and regeneration stays an explicit documented
step (`docs/RUNBOOK.md`). A control that only works when a secret happens to be
present is not a control.

FAIL-CLOSED
-----------
Exit 2 if a schema file or the baseline is missing or unparseable. A gate that
cannot read its inputs must never report green.

USAGE
    python3 scripts/check-schema-type-parity.py
    python3 scripts/check-schema-type-parity.py --show     # print current drift
    python3 scripts/check-schema-type-parity.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TYPES_DIR = REPO / "src/types/database"
BASELINE = REPO / "supabase/schema-drift-baseline.json"
ENVS = ("dev", "staging", "prod")

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_FAIL_CLOSED = 2


class Unparseable(Exception):
    """An input is missing or not in the shape we must read — always exit 2."""


def load_schema(env: str) -> str:
    p = TYPES_DIR / f"{env}.ts"
    if not p.is_file():
        raise Unparseable(f"schema file missing: {p.relative_to(REPO)}")
    text = p.read_text(encoding="utf-8")
    if "export type Database" not in text:
        raise Unparseable(
            f"{p.relative_to(REPO)} does not declare `export type Database` — "
            "refusing to diff a file that is not a generated schema"
        )
    return text


def significant_lines(text: str) -> set[str]:
    """The schema as a set of SEMANTIC FACTS, not lines.

    A raw line diff is unusable here for two reasons, both of which showed up
    immediately on the real schemas:

      * Generated types repeat every column three times (Row / Insert /
        Update), tripling every finding.
      * Formatting is not stable across environments. `visibility_level` has
        five labels on staging and four on prod, so the generator wraps the
        union on one and inlines it on the other — producing SIXTEEN differing
        lines for what is one fact: "prod is missing the `draft` label".

    Sixteen lines of noise around one real finding is how a gate earns the
    right to be ignored. So this extracts facts instead:

        column:<table>.<name>        (from the Row block only — Insert/Update
                                      are the same columns re-stated)
        enum:<name>=<sorted labels>
        function:<name>
        view:<name>

    Indentation-driven rather than regex-over-the-whole-file, because the
    generated shape is stable and predictable, and because keeping the table
    context is what makes a column fact meaningful.
    """
    facts: set[str] = set()
    section: str | None = None  # Tables | Views | Functions | Enums | CompositeTypes
    section_indent = 0
    current_obj: str | None = None
    obj_indent = 0
    in_row = False
    row_indent = 0

    for raw in text.splitlines():
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()

        m_section = re.match(r"^(Tables|Views|Functions|Enums|CompositeTypes):\s*\{", line)
        if m_section:
            section, section_indent = m_section.group(1), indent
            current_obj, in_row = None, False
            continue

        if section and indent <= section_indent and line.startswith("}"):
            section, current_obj, in_row = None, None, False
            continue

        if not section:
            continue

        # Enums are one-liners or wrapped unions; capture labels wherever they sit.
        if section == "Enums":
            # ALWAYS emit one fact per label, never an aggregate. The generator
            # inlines a short union and wraps a long one, so the same enum is
            # shaped differently in two environments purely because one has an
            # extra label. Aggregating would make that formatting difference
            # look like a second, separate finding.
            m = re.match(r"^(\w+):\s*(.*)$", line)
            if m:
                current_obj, obj_indent = m.group(1), indent
                for lbl in re.findall(r'"([^"]+)"', m.group(2)):
                    facts.add(f"enum-label:{current_obj}.{lbl}")
                continue
            if current_obj and indent > obj_indent:
                # continuation lines of a wrapped union
                for lbl in re.findall(r'"([^"]+)"', line):
                    facts.add(f"enum-label:{current_obj}.{lbl}")
            continue

        m_obj = re.match(r"^(\w+):\s*\{?\s*$", line)
        if m_obj and indent == section_indent + 2:
            current_obj, obj_indent, in_row = m_obj.group(1), indent, False
            if section == "Functions":
                facts.add(f"function:{current_obj}")
            elif section == "Views":
                facts.add(f"view:{current_obj}")
            continue

        # Single-line function declarations, e.g.
        #   e2e_fix_auth_tokens: { Args: { uid: string }; Returns: undefined }
        m_inline = re.match(r"^(\w+):\s*\{.*\}\s*$", line)
        if m_inline and indent == section_indent + 2 and section == "Functions":
            facts.add(f"function:{m_inline.group(1)}")
            continue

        if section == "Tables" and current_obj:
            if re.match(r"^Row:\s*\{", line):
                in_row, row_indent = True, indent
                continue
            if in_row and indent <= row_indent and line.startswith("}"):
                in_row = False
                continue
            if in_row:
                m_col = re.match(r"^(\w+)\??:", line)
                if m_col:
                    facts.add(f"column:{current_obj}.{m_col.group(1)}")

    return facts


def drift_between(a: str, b: str) -> dict[str, list[str]]:
    sa, sb = significant_lines(a), significant_lines(b)
    return {
        "only_in_first": sorted(sa - sb),
        "only_in_second": sorted(sb - sa),
    }


def current_drift() -> dict[str, dict[str, list[str]]]:
    schemas = {e: load_schema(e) for e in ENVS}
    return {
        "dev_vs_staging": drift_between(schemas["dev"], schemas["staging"]),
        "staging_vs_prod": drift_between(schemas["staging"], schemas["prod"]),
    }


def load_baseline() -> dict:
    if not BASELINE.is_file():
        raise Unparseable(f"baseline missing: {BASELINE.relative_to(REPO)}")
    try:
        data = json.loads(BASELINE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Unparseable(f"baseline is not valid JSON: {exc}")
    if "drift" not in data or not isinstance(data["drift"], dict):
        raise Unparseable("baseline has no `drift` object")
    return data


def flatten(drift: dict[str, dict[str, list[str]]]) -> set[tuple[str, str, str]]:
    out: set[tuple[str, str, str]] = set()
    for pair, sides in drift.items():
        for side, lines in sides.items():
            for ln in lines:
                out.add((pair, side, ln))
    return out


def flatten_baseline(baseline: dict) -> tuple[set[tuple[str, str, str]], dict]:
    entries: set[tuple[str, str, str]] = set()
    meta: dict = {}
    for pair, sides in baseline["drift"].items():
        for side, items in sides.items():
            for item in items:
                key = (pair, side, item["line"])
                entries.add(key)
                meta[key] = item
    return entries, meta


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--show", action="store_true", help="print the current drift and exit 0")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    # --show deliberately does NOT require the baseline: it is how the baseline
    # gets bootstrapped in the first place, and demanding the output of a file
    # that does not exist yet is a chicken-and-egg that invites hand-authoring.
    try:
        drift = current_drift()
    except Unparseable as exc:
        print(f"::error::schema-type-parity cannot verify: {exc}")
        print("::error::Failing closed — a gate that cannot read its inputs must not "
              "report green (Workflow & Backup Integrity Policy).")
        return EXIT_FAIL_CLOSED

    if args.show:
        print(json.dumps(drift, indent=2))
        return EXIT_OK

    try:
        baseline = load_baseline()
    except Unparseable as exc:
        print(f"::error::schema-type-parity cannot verify: {exc}")
        print("::error::Failing closed — a gate that cannot read its inputs must not "
              "report green (Workflow & Backup Integrity Policy).")
        return EXIT_FAIL_CLOSED

    actual = flatten(drift)
    expected, meta = flatten_baseline(baseline)

    unexpected = sorted(actual - expected)
    resolved = sorted(expected - actual)

    for pair, side, line in unexpected:
        print(f"::error::NEW schema drift ({pair}, {side}): {line}")

    for pair, side, line in resolved:
        item = meta[(pair, side, line)]
        print(f"::error::baseline entry no longer drifting ({pair}, {side}): {line} "
              f"[{item.get('ticket', 'no ticket')}] — it was fixed. Remove it from "
              f"supabase/schema-drift-baseline.json so the baseline keeps shrinking.")

    by_ticket: dict[str, int] = {}
    for key in expected & actual:
        t = meta[key].get("ticket", "untracked")
        by_ticket[t] = by_ticket.get(t, 0) + 1

    print(f"\nSchema drift: {len(actual)} differing declarations across 3 environments.")
    for ticket, n in sorted(by_ticket.items()):
        print(f"  {n:3}  {ticket}")

    if unexpected or resolved:
        print(f"::error::{len(unexpected)} new, {len(resolved)} stale. The three "
              f"Supabase schemas diverged in a way nobody recorded, or converged in "
              f"a way nobody noticed. Both are findings.")
        return EXIT_DRIFT

    print("All drift is known, ticketed and unchanged.")
    return EXIT_OK


def _schema(columns: str, enum_labels: str, functions: str = "      do_thing: {\n") -> str:
    """A minimal but structurally faithful generated-schema fixture."""
    return (
        "export type Database = {\n"
        "  public: {\n"
        "    Tables: {\n"
        "      widgets: {\n"
        "        Row: {\n"
        f"{columns}"
        "        }\n"
        "        Insert: {\n"
        f"{columns.replace(': ', '?: ')}"
        "        }\n"
        "      }\n"
        "    }\n"
        "    Enums: {\n"
        f"      visibility_level: {enum_labels}\n"
        "    }\n"
        "    Functions: {\n"
        f"{functions}"
        "        Args: { x: string }\n"
        "        Returns: undefined\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "}\n"
    )


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    base_cols = "          id: string\n          claimed_at: string | null\n"
    a = _schema(base_cols, '"public" | "draft"')

    facts = significant_lines(a)

    # The Row/Insert(/Update) repetition must collapse to ONE fact, not two.
    cases.append(("Row/Insert repetition collapses to one fact",
                  len([f for f in facts if f == "column:widgets.claimed_at"]) == 1
                  and "column:widgets.claimed_at" in facts))
    cases.append(("column is qualified by its table",
                  "column:widgets.id" in facts))
    cases.append(("function captured", "function:do_thing" in facts))
    cases.append(("enum labels captured individually",
                  {"enum-label:visibility_level.public",
                   "enum-label:visibility_level.draft"} <= facts))

    # Identical schemas produce no drift.
    cases.append(("identical -> no drift",
                  drift_between(a, a) == {"only_in_first": [], "only_in_second": []}))

    # A dropped column is detected, in the right direction.
    b = _schema("          id: string\n", '"public" | "draft"')
    d = drift_between(a, b)
    cases.append(("dropped column detected",
                  d["only_in_first"] == ["column:widgets.claimed_at"]))
    cases.append(("direction is right", d["only_in_second"] == []))

    # THE ONE THAT MATTERS: an enum losing a label must be exactly ONE fact,
    # even though the generator wraps the longer union across several lines and
    # inlines the shorter one. A line diff reports sixteen differences here.
    wrapped = _schema(base_cols,
                      '\n        | "public"\n        | "draft"\n        | "tribe_only"')
    inline = _schema(base_cols, '"public" | "tribe_only"')
    d2 = drift_between(wrapped, inline)
    cases.append(("enum label loss is exactly one fact despite reformatting",
                  d2["only_in_first"] == ["enum-label:visibility_level.draft"]
                  and d2["only_in_second"] == []))

    # Braces and comments are not schema facts.
    cases.append(("noise ignored",
                  significant_lines("{\n}\n},\n// note\n* doc\n") == set()))

    failed = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}")
    if failed:
        print(f"::error::self-test: {len(failed)} failed: {', '.join(failed)}")
        return EXIT_DRIFT
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
