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

WHY IT KEEPS COMING BACK — the actual Supabase semantics
--------------------------------------------------------
CORRECTED 2026-07-27. The first version of this file claimed "CREATE FUNCTION
grants EXECUTE to PUBLIC by default, and CREATE OR REPLACE resets the ACL".
Both halves are wrong, and rule R2 inherited the error: it required only
``REVOKE ... FROM PUBLIC`` and therefore PASSED a fixture shipping an
anon-callable SECURITY DEFINER function.

What actually happens: Supabase ships
``ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon, authenticated,
service_role``. Those are DIRECT grants, not PUBLIC inheritance. Verified on
production — ``pg_default_acl``, schema ``public``, objtype ``f``::

    {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
     service_role=X/postgres}

So ``REVOKE ALL ON FUNCTION f() FROM PUBLIC`` leaves anon and authenticated
able to call it. ``supabase/migrations/20260622120000_two_axis_access_model.sql``
does exactly that for ``admin_list_users`` and ``admin_filter_profile_ids`` —
which is the whole of SEC-28 (that ticket names the migration), SEC-29, SEC-42
and SEC-43.

``CREATE OR REPLACE`` preserves permissions (Postgres docs: "the ownership and
permissions of the function do not change"). The real second vector is a
SIGNATURE CHANGE, which creates a new overload carrying the defaults while the
old revoked one survives — detected live by INV-2, not statically here.

The fix is a rule that every migration revokes from all three roles explicitly,
enforced before merge — and, durably, inverting the default grant itself
(SEC-103).

WHAT THIS ENFORCES (per migration file)
---------------------------------------
  R1  a ``SECURITY DEFINER`` function must pin ``SET search_path``
      (an unpinned search_path lets a caller shadow a table it references —
      SEC-11, SEC-54)
  R2  a ``SECURITY DEFINER`` function must be revoked from ALL THREE of
      ``public``, ``anon`` and ``authenticated`` in the same file — separate
      REVOKE statements or a blanket schema-wide revoke both count. Revoking
      from PUBLIC alone is NOT sufficient (see above). Re-granting to
      ``authenticated`` afterwards is allowed: admin RPCs need it and gate on
      ``is_admin`` in the body, which INV-4 enforces live.
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


def roles_revoked_from(body: str, name: str) -> set[str]:
    """Union of roles revoked from `name`, across every REVOKE in the migration.

    Counts three shapes:
      REVOKE ... ON FUNCTION public.f(...) FROM public, anon, authenticated;
      REVOKE ... ON FUNCTION public.f(...) FROM anon;        (repeated)
      REVOKE ... ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    """
    roles: set[str] = set()

    patterns = [
        # Targeted at this function.
        rf"revoke\s+(?:all|execute)[^;]*?\bon\s+function\s+(?:public\.)?{re.escape(name)}\b([^;]*);",
        # Blanket over the schema — covers this function too.
        r"revoke\s+(?:all|execute)[^;]*?\bon\s+all\s+functions\s+in\s+schema\s+public\b([^;]*);",
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, body, re.IGNORECASE | re.DOTALL):
            tail = match.group(1)
            from_clause = re.search(r"\bfrom\b(.*)$", tail, re.IGNORECASE | re.DOTALL)
            if not from_clause:
                continue
            for role in re.findall(r"[A-Za-z_][\w]*", from_clause.group(1)):
                roles.add(role.lower())

    return roles


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

        # R2 — the revoke must actually remove the roles that can reach the
        # function. On Supabase that is NOT the same as revoking from PUBLIC.
        #
        # Supabase ships `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO
        # anon, authenticated, service_role`, so anon and authenticated hold
        # DIRECT grants, not PUBLIC inheritance. Verified against Lyra's own
        # production database on 2026-07-27:
        #
        #   pg_default_acl, schema public, objtype 'f':
        #     {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
        #      service_role=X/postgres}
        #
        # `REVOKE ALL ON FUNCTION f() FROM PUBLIC` therefore leaves anon's and
        # authenticated's EXECUTE completely intact. The first version of this
        # rule required only that, and passed a fixture shipping an
        # anon-callable SECURITY DEFINER function — a false negative on the very
        # class it was written to stop. See the `revoke from PUBLIC only`
        # fixture below, which pins that miss.
        revoked_roles = roles_revoked_from(body, name)
        missing = [r for r in ("public", "anon", "authenticated") if r not in revoked_roles]
        if missing:
            violations.append(
                f"{path}::R2-revoke-does-not-cover-{'-'.join(missing)}::{name}"
            )

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


VERSION_RE = re.compile(r"^(\d{14})")


def check_duplicate_versions(migrations_dir: Path) -> list[str]:
    """R5 — two migrations must never share a version timestamp.

    Supabase keys `supabase_migrations.schema_migrations` on `version`, so a
    collision aborts the whole replay with:

        ERROR: duplicate key value violates unique constraint
        "schema_migrations_pkey" (SQLSTATE 23505)

    Consequences, all silent until you need them: Supabase branch PREVIEWS fail
    on every PR that touches migrations; a fresh database cannot be rebuilt from
    the lineage; and the DR restore path is unprovable, because replaying the
    migrations is how you would rebuild.

    This is BUGS-49, closed 2026-06-21. It recurred — one of the surviving
    collisions is dated the very day that ticket closed — because the fix
    de-duplicated the files that existed and no control was built to stop the
    next one. Exactly the pattern docs/DEFECT_FEEDBACK_LOOP.md exists to break.

    Only the SECOND and later file of each colliding version is reported, so the
    historical set is grandfathered by the baseline while a NEW collision fails.
    """
    by_version: dict[str, list[str]] = {}
    for path in sorted(migrations_dir.glob("*.sql")):
        match = VERSION_RE.match(path.name)
        if match:
            by_version.setdefault(match.group(1), []).append(path.name)

    violations: list[str] = []
    for version, names in sorted(by_version.items()):
        if len(names) > 1:
            for name in sorted(names)[1:]:
                violations.append(f"{name}::R5-duplicate-migration-version::{version}")
    return violations


def collect_all(migrations_dir: Path) -> list[str]:
    found: list[str] = []
    for path in sorted(migrations_dir.glob("*.sql")):
        found.extend(check_sql(path.read_text(encoding="utf-8"), path.name))
    found.extend(check_duplicate_versions(migrations_dir))
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
revoke all on function public.unpinned() from public, anon, authenticated;
"""

_BAD_GRANT_ANON = """
create or replace function public.open_to_all() returns void
language sql security definer set search_path = public as $$ select 1 $$;
revoke all on function public.open_to_all() from public, anon, authenticated;
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

# THE MISS. The first version of R2 required only `... FROM PUBLIC` and passed
# this. On Supabase, anon and authenticated hold DIRECT grants from
# ALTER DEFAULT PRIVILEGES, so revoking PUBLIC leaves both intact and the
# function stays callable unauthenticated at /rest/v1/rpc/leak_probe.
_BAD_REVOKE_PUBLIC_ONLY = """
create or replace function public.leak_probe(p text) returns void
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.leak_probe(p text) from public;
"""

_BAD_REVOKE_ANON_ONLY = """
create or replace function public.half_revoked(p text) returns void
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.half_revoked(p text) from public, anon;
"""

_GOOD_SEPARATE_REVOKES = """
create or replace function public.tidy(p text) returns void
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.tidy(p text) from public;
revoke all on function public.tidy(p text) from anon;
revoke all on function public.tidy(p text) from authenticated;
grant execute on function public.tidy(p text) to service_role;
"""

_GOOD_BLANKET_REVOKE = """
create or replace function public.swept(p text) returns void
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.swept(p text) to service_role;
"""

# Revoking then deliberately re-granting to `authenticated` is legitimate for an
# admin RPC that gates on is_admin in its body (admin_list_users). Over-revoking
# broke the admin console in BUGS-60, so the revoke rule must not forbid it —
# the in-body check is enforced separately by INV-4 in the live checker.
_GOOD_REVOKE_THEN_REGRANT = """
create or replace function public.admin_thing(p text) returns void
language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.admin_thing(p text) from public, anon, authenticated;
grant execute on function public.admin_thing(p text) to authenticated;
"""

_CASES = [
    ("REVOKE FROM PUBLIC ONLY — anon/authenticated keep EXECUTE", _BAD_REVOKE_PUBLIC_ONLY, ["R2"]),
    ("REVOKE covers public+anon but not authenticated", _BAD_REVOKE_ANON_ONLY, ["R2"]),
    ("separate REVOKE statements covering all three", _GOOD_SEPARATE_REVOKES, []),
    ("blanket REVOKE over the schema", _GOOD_BLANKET_REVOKE, []),
    ("revoke-then-regrant to authenticated is allowed", _GOOD_REVOKE_THEN_REGRANT, []),
    ("secdef without REVOKE FROM PUBLIC", _BAD_NO_REVOKE, ["R2"]),
    ("secdef with unpinned search_path", _BAD_UNPINNED, ["R1"]),
    ("secdef granted to anon", _BAD_GRANT_ANON, ["R3"]),
    ("new table without RLS", _BAD_TABLE_NO_RLS, ["R4"]),
    ("fully hardened migration", _GOOD, []),
    ("SECURITY INVOKER function is out of scope", _GOOD_INVOKER, []),
    ("DDL inside a comment is not parsed", _GOOD_COMMENT_ONLY, []),
    ("allow-listed with a reason", _ALLOWLISTED, []),
]


def _self_test_duplicates() -> list[tuple[str, bool]]:
    import tempfile

    out: list[tuple[str, bool]] = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "20260101000000_a.sql").write_text("select 1;")
        (root / "20260102000000_b.sql").write_text("select 1;")
        out.append(("distinct versions are clean", check_duplicate_versions(root) == []))

        (root / "20260101000000_c.sql").write_text("select 1;")
        found = check_duplicate_versions(root)
        out.append(("a colliding version is reported once", len(found) == 1))
        out.append(
            ("the SECOND file is the one reported, not the first",
             bool(found) and found[0].startswith("20260101000000_c.sql")),
        )

        (root / "20260101000000_d.sql").write_text("select 1;")
        out.append(("a third collision adds one more", len(check_duplicate_versions(root)) == 2))
    return out


def self_test() -> int:
    failures = 0
    for label, ok in _self_test_duplicates():
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures += 1
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
