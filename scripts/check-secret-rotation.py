#!/usr/bin/env python3
"""KAN-170: scan docs/SECURITY_ROTATION.md for secrets due for rotation.

Reads the "Infrastructure Secrets" Markdown table, computes the next-due
date for each row from `Last Rotated` + `Rotation` cadence, and prints any
rows whose next-due date is within --warn-days of today (default 30).

Exits non-zero if any rows are within the warn window. The weekly report
workflow consumes this exit code to decide whether to surface the warning
in the Monday email.

Strict by design: a secret without a parseable `Last Rotated` date is
treated as a hard error. We'd rather fail loud than silently skip
rotations like the silent-skip pattern KAN-167 was created to eliminate.
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path
from typing import List, NamedTuple, Optional

DOC_PATH = Path(__file__).resolve().parent.parent / "docs" / "SECURITY_ROTATION.md"

# Cadence string → days until next rotation.
CADENCE_DAYS = {
    "annual": 365,
    "annual or on suspicion": 365,
    "90 days": 90,
    "60 days": 60,
    "30 days": 30,
    "quarterly": 90,
}


class SecretRow(NamedTuple):
    name: str
    rotation: str
    last_rotated: str
    location: str

    def cadence_days(self) -> Optional[int]:
        key = self.rotation.strip().lower()
        return CADENCE_DAYS.get(key)

    def last_rotated_date(self) -> Optional[dt.date]:
        s = self.last_rotated.strip()
        if not s or s.lower() == "initial setup":
            return None
        # Accept "29 April 2026" or "2026-04-29".
        for fmt in ("%d %B %Y", "%Y-%m-%d", "%d %b %Y"):
            try:
                return dt.datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    def next_due(self) -> Optional[dt.date]:
        d = self.last_rotated_date()
        days = self.cadence_days()
        if d is None or days is None:
            return None
        return d + dt.timedelta(days=days)


def parse_rotation_doc(path: Path) -> List[SecretRow]:
    """
    Parse the first Markdown table under '## Secrets Inventory' →
    '### Infrastructure Secrets'. We deliberately do NOT parse the
    user-facing table (different schema, user-controlled cadence).
    """
    text = path.read_text(encoding="utf-8")

    # Find the Infrastructure Secrets section.
    section_match = re.search(
        r"###\s*Infrastructure Secrets[^\n]*\n(.*?)(?=\n###\s|\Z)",
        text,
        flags=re.DOTALL,
    )
    if not section_match:
        raise SystemExit(
            "::error::Could not find '### Infrastructure Secrets' section in SECURITY_ROTATION.md"
        )
    section = section_match.group(1)

    # Find the markdown table — header line, separator line, then rows.
    table_match = re.search(
        r"\|\s*Secret\s*\|.*?\|\s*Last Rotated\s*\|\s*\n\|[-|\s]+\|\s*\n((?:\|.*?\|\s*\n)+)",
        section,
        flags=re.DOTALL,
    )
    if not table_match:
        raise SystemExit(
            "::error::Could not find Infrastructure Secrets table (expected | Secret | Location(s) | Rotation | How to Rotate | Last Rotated |)"
        )

    rows: List[SecretRow] = []
    for line in table_match.group(1).strip().split("\n"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue
        rows.append(
            SecretRow(
                name=cells[0],
                location=cells[1],
                rotation=cells[2],
                last_rotated=cells[4],
            )
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--warn-days", type=int, default=30, help="Warn N days before due date.")
    ap.add_argument("--doc", type=Path, default=DOC_PATH, help="Path to SECURITY_ROTATION.md")
    ap.add_argument("--today", type=str, default=None, help="Override today's date (YYYY-MM-DD) for testing.")
    args = ap.parse_args()

    today = (
        dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    )
    rows = parse_rotation_doc(args.doc)

    if not rows:
        print("::error::Infrastructure Secrets table is empty")
        return 1

    warnings: List[str] = []
    errors: List[str] = []
    unrotated: List[str] = []

    for row in rows:
        # "Initial setup" means the secret has never been rotated since the
        # project began. We can't compute next-due, but we should surface it
        # so it doesn't sit forever. Distinct bucket from genuinely
        # unparseable rows so a malformed table doesn't hide unrotated tokens.
        if row.last_rotated.strip().lower() == "initial setup":
            unrotated.append(
                f"  ⚠️  {row.name}: Last Rotated='Initial setup' — never rotated. Add a real date to SECURITY_ROTATION.md."
            )
            continue
        next_due = row.next_due()
        if next_due is None:
            errors.append(
                f"  ❌ {row.name}: Last Rotated='{row.last_rotated}' or Rotation='{row.rotation}' is unparseable"
            )
            continue
        days_until = (next_due - today).days
        if days_until <= 0:
            errors.append(
                f"  🔴 {row.name}: rotation OVERDUE by {-days_until} days (was due {next_due.isoformat()})"
            )
        elif days_until <= args.warn_days:
            warnings.append(
                f"  ⚠️  {row.name}: rotation due {next_due.isoformat()} ({days_until} days)"
            )

    if errors:
        print(f"❌ {len(errors)} secret(s) overdue or unparseable:")
        for e in errors:
            print(e)
    if warnings:
        print(f"⚠️  {len(warnings)} secret(s) due within {args.warn_days} days:")
        for w in warnings:
            print(w)
    if unrotated:
        print(f"⚠️  {len(unrotated)} secret(s) never rotated (still at 'Initial setup'):")
        for u in unrotated:
            print(u)
    if not errors and not warnings and not unrotated:
        print(f"✅ All {len(rows)} infrastructure secrets are >{args.warn_days} days from rotation.")
        return 0

    # Errors and "real" overdue → fail loud.
    # Warnings (within window) → fail loud so the workflow surfaces them.
    # 'Initial setup' rows alone → warning only, exit 0 (not a hard fail).
    if errors or warnings:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
