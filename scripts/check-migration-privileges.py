#!/usr/bin/env python3
"""SEC-12/15/28/29/42/43 + BUGS-48/60/65/69 — the Postgres privilege-drift class.

THE DEFECT CLASS
----------------
Lyra's single most recurrent security defect, by a wide margin. A
``SECURITY DEFINER`` function ships to production with ``EXECUTE`` still held by
``anon`` or ``authenticated``, so an unauthenticated or ordinary logged-in user
can call code that runs with the owner's privileges. It has recurred at least
nine times across fourteen months::

    SEC-12  convene_vault_* executable by anon                    (CRITICAL, prod)
    SEC-15  further SECURITY DEFINER fns executable by anon
    SEC-27  is_admin self-elevation on prod
    SEC-28  admin_* granted to anon on dev
    SEC-29  the same two promoted to prod/staging without the revoke
    SEC-42  re-granted by a later (kan326) migration after SEC-29 closed
    SEC-43  promoted again with authenticated EXECUTE
    BUGS-48 residual PUBLIC execute on trigger/maintenance fns
    BUGS-65 two newer trigger fns, same residual
    BUGS-69 one more, same residual

WHY IT KEEPS COMING BACK — the Postgres semantics
-------------------------------------------------
``CREATE FUNCTION`` grants ``EXECUTE`` to ``PUBLIC`` by default. In Supabase,
``PUBLIC`` includes ``anon`` and ``authenticated``. So *every* new function is
born world-executable, and ``CREATE OR REPLACE`` on an existing function
**resets** the ACL to that default. A one-off ``REVOKE`` migration therefore
protects only the functions that existed when it ran; the next migration that
adds — or merely re-creates — a function silently re-opens the hole.

The fix is not another REVOKE. It is a rule that every migration must carry its
own revoke, enforced before merge.

WHAT THIS ENFORCES (per migration file)
---------------------------------------
  R1  a ``SECURITY DEFINER`` function must pin ``SET search_path``
      (an unpinned search_path lets a caller shadow a table it references —
      SEC-11, SEC-54)
  R2  a ``SECURITY DEFINER`` function must be followed by an explicit
      ``REVOKE ... ON FUNCTION ... FROM PUBLIC`` in the same file
  R3  no migration may ``GRANT EXECUTE`` on a ``SECURITY DEFINER`` function
      ``TO anon``
  R4  ``CREATE TABLE public.x`` must be followed by
      ``ALTER TABLE ... ENABLE ROW LEVEL SECURITY`` in the same file

THE RATCHET
-----------
73 migrations predate this rule and many would fail it. Rather than rewrite
history (migrations are immutable once applied), violations present at adoption
are recorded in ``supabase/migration-privileges-baseline.json``. The baseline
may only SHRINK: any violation not in it fails the build, and a baseline entry
whose violation has been fixed is reported so the entry can be removed. New
migrations are held to the full standard from day one.

This is a *pre-merge* control and cannot see out-of-band DDL. Migrations here
are applied with the Supabase MCP ``apply_migration`` tool, so DDL can and does
reach a database without passing through this file. The live counterpart —
``scripts/check-db-invariants.py`` — asserts the same invariants against each
running database and is the backstop for anything applied out of band. Neither
replaces the other.

USAGE
-----
    python3 scripts/check-migration-privileges.py
    python3 scripts/check-migration-privileges.py --self-test
    python3 scripts/check-migration-privileges.py --write-baseline   # adoption only
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MIGRATIONS_DIR = Path("supabase/migrations")
BASELINE_PATH = Path("supabase/migration-privileges-baseline.json")
ALLOW_MARKER = "db-privileges-ok"

# --- SQL shapes ------------------------------------------------------------

FUNCTION_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][\w]*)\s*\(",
    re.IGNORECASE,
)
TABLE_RE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][\w]*)",
    re.IGNORECASE,
)


def strip_sql_comments(sql: str) -> str:
    """Drop -- line comments and /* */ blocks so header prose is never parsed as DDL.

    Rollback hints in migration headers routinely contain real DDL
    (``-- DROP TABLE …``); parsing those would produce phantom findings.
    """
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return "\n".join(
        line for line in sql.split("\n") if not line.lstrip().startswith("--")
    )


def function_bodies(sql: str) -> list[tuple[str, str]]:
    """Return (name, body) for each CREATE FUNCTION, body ending at its terminator."""
    out: list[tuple[str, str]] = []
    for match in FUNCTION_RE.finditer(sql):
        name = match.group(1).lower()
        tail = sql[match.start():]
        # A function body ends at the dollar-quote close followed by a semicolon,
        # or failing that at the next CREATE.
        end = len(tail)
        dollar = re.search(r"\$\$\s*;|\$[a-z_]*\$\s*;", tail, re.IGNORECASE)
        if dollar:
            end = dollar.end()
        else:
            nxt = FUNCTION_RE.search(tail, match.end() - match.start())
            if nxt:
                end = nxt.start()
        out.append((name, tail[:end]))
    return out


def check_sql(sql: str, path: str) -> list[str]:
    """Return a list of violation codes (``file::RULE::object``) for one migration."""
    if ALLOW_MARKER in sql:
        return []

    body = strip_sql_comments(sql)
    violations: list[str] = []

    for name, fn_body in function_bodies(body):
        is_secdef = re.search(r"security\s+definer", fn_body, re.IGNORECASE)
        if not is_secdef:
            continue

        # R1 — search_path must be pinned, either inline or via a later ALTER.
        pinned_inline = re.search(r"set\s+search_path", fn_body, re.IGNORECASE)
        pinned_alter = re.search(
            rf"alter\s+function\s+(?:public\.)?{re.escape(name)}\b[^;]*set\s+search_path",
            body,
            re.IGNORECASE | re.DOTALL,
        )
        if not (pinned_inline or pinned_alter):
            violations.append(f"{path}::R1-unpinned-search-path::{name}")

        # R2 — an explicit REVOKE ... FROM PUBLIC must appear in the same file.
        revoked = re.search(
            rf"revoke\s+(?:all|execute)[^;]*\bon\s+function\s+(?:public\.)?{re.escape(name)}\b[^;]*\bfrom\b[^;]*\bpublic\b",
            body,
            re.IGNORECASE | re.DOTALL,
        )
        if not revoked:
            violations.append(f"{path}::R2-missing-revoke-from-public::{name}")

        # R3 — never grant a SECURITY DEFINER function to anon.
        granted_anon = re.search(
            rf"grant\s+execute[^;]*\bon\s+function\s+(?:public\.)?{re.escape(name)}\b[^;]*\bto\b[^;]*\banon\b",
            body,
            re.IGNORECASE | re.DOTALL,
        )
        if granted_anon:
            violations.append(f"{path}::R3-granted-to-anon::{name}")

    # R4 — a new public table must enable RLS in the same migration.
    for match in TABLE_RE.finditer(body):
        table = match.group(1).lower()
        rls = re.search(
            rf"alter\s+table\s+(?:public\.)?{re.escape(table)}\s+enable\s+row\s+level\s+security",
            body,
            re.IGNORECASE,
        )
        if not rls:
            violations.append(f"{path}::R4-table-without-rls::{table}")

    return violations


# --- baseline ratchet ------------------------------------------------------


def collect_all(migrations_dir: Path) -> list[str]:
    found: list[str] = []
    for path in sorted(migrations_dir.glob("*.sql")):
        found.extend(check_sql(path.read_text(encoding="utf-8"), path.name))
    return found


def load_baseline() -> set[str]:
    if not BASELINE_PATH.exists():
        return set()
    data = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    return set(data.get("violations", []))


# --- self-test (the "test the test" control) -------------------------------

_BAD_NO_REVOKE = """
create or replace function public.leaky() returns void
language sql security definer set search_path = public as $$ select 1 $$;
"""

_BAD_UNPINNED = """
create or replace function public.unpinned() returns void
language sql security definer as $$ select 1 $$;
revoke all on function public.unpinned() from public;
"""

_BAD_GRANT_ANON = """
create or replace function public.open_to_all() returns void
language sql security definer set search_path = public as $$ select 1 $$;
revoke all on function public.open_to_all() from public;
grant execute on function public.open_to_all() to anon;
"""

_BAD_TABLE_NO_RLS = """
create table public.secrets (id uuid primary key, body text);
"""

_GOOD = """
create or replace function public.tight() returns void
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.tight() from public, anon, authenticated;
grant execute on function public.tight() to service_role;

create table public.thing (id uuid primary key);
alter table public.thing enable row level security;
"""

_GOOD_INVOKER = """
create or replace function public.plain() returns void
language sql as $$ select 1 $$;
"""

# Rollback hints in a header must not be parsed as DDL.
_GOOD_COMMENT_ONLY = """
-- Rollback:
--   create table public.oops (id uuid);
--   create function public.oops_fn() returns void language sql security definer as $$ select 1 $$;
select 1;
"""

_ALLOWLISTED = """
-- db-privileges-ok: SEC-000 owner-reviewed, function is trigger-only
create or replace function public.trigger_fn() returns trigger
language plpgsql security definer as $$ begin return new; end $$;
"""

_CASES = [
    ("secdef without REVOKE FROM PUBLIC", _BAD_NO_REVOKE, ["R2"]),
    ("secdef with unpinned search_path", _BAD_UNPINNED, ["R1"]),
    ("secdef granted to anon", _BAD_GRANT_ANON, ["R3"]),
    ("new table without RLS", _BAD_TABLE_NO_RLS, ["R4"]),
    ("fully hardened migration", _GOOD, []),
    ("SECURITY INVOKER function is out of scope", _GOOD_INVOKER, []),
    ("DDL inside a comment is not parsed", _GOOD_COMMENT_ONLY, []),
    ("allow-listed with a reason", _ALLOWLISTED, []),
]


def self_test() -> int:
    failures = 0
    for label, sql, expected_rules in _CASES:
        found = check_sql(sql, "fixture.sql")
        found_rules = sorted({v.split("::")[1].split("-")[0] for v in found})
        ok = found_rules == sorted(expected_rules)
        print(f"  {'PASS' if ok else 'FAIL'}  {label} (expected {expected_rules or 'clean'}, got {found_rules or 'clean'})")
        if not ok:
            failures += 1
            for v in found:
                print(f"          → {v}")
    if failures:
        print(f"::error::check-migration-privileges self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(_CASES)} fixture case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="record current violations as the ratchet baseline (adoption only)",
    )
    parser.add_argument("--migrations", default=str(MIGRATIONS_DIR))
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    migrations_dir = Path(args.migrations)
    if not migrations_dir.is_dir():
        print(f"::error::migrations directory '{migrations_dir}' not found.")
        return 1

    migration_count = len(list(migrations_dir.glob("*.sql")))
    if migration_count == 0:
        print(f"::error::No .sql migrations found in '{migrations_dir}' — check is vacuous.")
        return 1

    found = collect_all(migrations_dir)

    if args.write_baseline:
        BASELINE_PATH.write_text(
            json.dumps(
                {
                    "_comment": (
                        "Ratchet baseline for scripts/check-migration-privileges.py. "
                        "Violations present when the rule was adopted. This list may only "
                        "SHRINK — never add to it. Migrations are immutable once applied, so "
                        "these are fixed forward with a NEW migration that REVOKEs, not by "
                        "editing history. The live backstop is scripts/check-db-invariants.py."
                    ),
                    "adopted": "2026-07-27",
                    "ticket": "SEC-101",
                    "violations": sorted(found),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Baseline written: {len(found)} pre-existing violation(s) across {migration_count} migrations.")
        return 0

    baseline = load_baseline()
    found_set = set(found)

    new_violations = sorted(found_set - baseline)
    fixed = sorted(baseline - found_set)

    print(f"Scanned {migration_count} migration(s); baseline holds {len(baseline)} grandfathered violation(s).")

    if fixed:
        print()
        print(f"::notice::{len(fixed)} baselined violation(s) are now fixed — remove them from {BASELINE_PATH}:")
        for v in fixed:
            print(f"  - {v}")

    if new_violations:
        print()
        for v in new_violations:
            path, rule, obj = v.split("::")
            print(f"::error file={migrations_dir}/{path}::[{rule}] {obj}")
        print()
        print(f"::error::{len(new_violations)} new migration-privilege violation(s).")
        print()
        print("Postgres grants EXECUTE to PUBLIC on every new function, and CREATE OR")
        print("REPLACE RESETS the ACL to that default. Every migration must carry its own")
        print("revoke. Required shape:")
        print()
        print("    create or replace function public.fn(...) returns ...")
        print("      language plpgsql")
        print("      security definer")
        print("      set search_path = public, pg_temp   -- R1")
        print("    as $$ ... $$;")
        print()
        print("    revoke all on function public.fn(...) from public, anon, authenticated;  -- R2/R3")
        print("    grant execute on function public.fn(...) to service_role;")
        print()
        print("New public tables must enable RLS in the same migration (R4).")
        print("Allow-list only with '-- db-privileges-ok: <reason>' plus a SEC key.")
        return 1

    print("No new migration-privilege violations. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
