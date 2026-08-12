#!/usr/bin/env python3
"""CTL-048 — column parity across the three LIVE databases, and against the
committed type snapshots.

WHY THIS EXISTS WHEN CTL-036 ALREADY DOES "SCHEMA DRIFT"
--------------------------------------------------------
`scripts/check-schema-type-parity.py` (CTL-036) is a real control and it works.
But read its own docstring: it diffs the three COMMITTED snapshots in
`src/types/database/{dev,staging,prod}.ts` against a recorded baseline. It never
talks to a database — deliberately, because that needs credentials.

That leaves one hole, and it is not hypothetical:

    if all three snapshots go stale in the SAME way, CTL-036 compares
    stale-to-stale, finds no RELATIVE drift, and passes — while every snapshot
    is wrong about reality.

Measured 2026-08-11: `public.profiles` has 42 columns on dev, 42 on staging and
38 on production. All three committed snapshots said 41 / 41 / 37 — every one of
them missing `gift_voucher_hint`, which the KAN-443 migration added to all three
databases. CTL-036 was green throughout. It could not have been otherwise: it
cannot see a column that no snapshot mentions.

So this control asks the databases. It is the live counterpart, not a
replacement — CTL-036 still runs on every PR (no credentials needed), and this
runs where credentials exist.

WHAT IT ASSERTS
---------------
1. LIVE-VS-LIVE. Every table present on more than one database exposes the same
   column set, except where the difference is in the ticketed baseline
   (`supabase/schema-drift-baseline.json`). Drift not in the baseline FAILS.
2. LIVE-VS-SNAPSHOT. Each committed `src/types/database/<env>.ts` matches its
   own live database. A stale snapshot FAILS, because the app compiles against
   `dev` and a snapshot that overstates a database is how TypeScript ends up
   asserting production has columns it does not have.
3. Drift BOTH ways. `gathering_invite_messages.claimed_at` exists on staging and
   production but NOT dev (BUGS-62) — so "prod is behind" is the common case,
   not the rule, and a check that only looks for prod-is-missing would sail past
   the reverse.

WHY IT BLOCKS A PROMOTION RATHER THAN JUST REPORTING
----------------------------------------------------
The founder's framing, 2026-08-11: the gate should fire "as we do promotions".
A promotion is precisely when a column gap becomes an outage — code written
against dev's schema arrives at a database that lacks the column, and the first
symptom is a 500 on whatever page reads it. Reporting it daily catches it within
a day; blocking the promote catches it before it ships.

⚠️ FAIL-CLOSED, AND NO SILENT SKIP.
If a credential is absent this exits NON-ZERO and says which one. The Workflow &
Backup Integrity Policy forbids the `if: env.X != ''` pattern for exactly this
reason: a control that quietly passes when it cannot run is worse than no
control, because it also produces a green tick.

USAGE
    python3 scripts/check-live-schema-parity.py            # all three
    python3 scripts/check-live-schema-parity.py --self-test
    python3 scripts/check-live-schema-parity.py --env prod

ENVIRONMENT
    NEXT_PUBLIC_SUPABASE_URL     / SUPABASE_SERVICE_ROLE_KEY          (dev)
    STAGING_SUPABASE_URL         / STAGING_SUPABASE_SERVICE_ROLE_KEY  (staging)
    PROD_SUPABASE_URL            / PROD_SUPABASE_SERVICE_ROLE_KEY     (prod)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = REPO_ROOT / "supabase" / "schema-drift-baseline.json"
SNAPSHOT_DIR = REPO_ROOT / "src" / "types" / "database"
TIMEOUT_SECONDS = 30

ENVIRONMENTS = [
    ("dev", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
    ("staging", "STAGING_SUPABASE_URL", "STAGING_SUPABASE_SERVICE_ROLE_KEY"),
    ("prod", "PROD_SUPABASE_URL", "PROD_SUPABASE_SERVICE_ROLE_KEY"),
]

# PostgREST cannot query information_schema directly, so parity is read through
# the same reporting-function pattern SEC-101 already uses. Until that function
# exists everywhere, fall back to the REST root, which advertises every exposed
# table and its columns in an OpenAPI document.
OPENAPI_PATH = "/rest/v1/"


def fetch_openapi(url: str, key: str) -> dict:
    endpoint = url.rstrip("/") + OPENAPI_PATH
    request = urllib.request.Request(
        endpoint,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/openapi+json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def columns_from_openapi(doc: dict) -> dict[str, set[str]]:
    """{table: {column, ...}} for every table PostgREST exposes."""
    out: dict[str, set[str]] = {}
    for name, definition in (doc.get("definitions") or {}).items():
        props = definition.get("properties") or {}
        if props:
            out[name] = set(props.keys())
    return out


def columns_from_snapshot(env: str) -> dict[str, set[str]]:
    """Parse `Row: { ... }` blocks out of a committed Database type snapshot.

    Deliberately a parser over the committed text rather than a TypeScript
    import: this must report what the FILE says, including when the file is
    wrong. Importing it would make the check agree with itself.
    """
    path = SNAPSHOT_DIR / f"{env}.ts"
    text = path.read_text(encoding="utf-8")
    out: dict[str, set[str]] = {}
    # Tables appear as `      <name>: {` followed eventually by `Row: {`.
    for match in re.finditer(r"\n      (\w+): \{\n        Row: \{\n(.*?)\n        \}", text, re.S):
        table, body = match.group(1), match.group(2)
        cols = set()
        for line in body.split("\n"):
            m = re.match(r"\s*(\w+)\??:", line)
            if m:
                cols.add(m.group(1))
        if cols:
            out[table] = cols
    return out


def load_baseline() -> set[tuple[str, str, str]]:
    """{(table, column, missing_from_env)} — the KNOWN, ticketed differences.

    Parses the SAME `supabase/schema-drift-baseline.json` shape CTL-036
    (check-schema-type-parity.py) already reads: entries live two levels
    down, under `drift.<leg>.<only_in_first|only_in_second>[]`, and each one
    carries a single `line` string such as
    `"column:profiles.discoverable_by_phone"` — there is no `table`/`column`
    (or `object`/`name`) field to read directly.
    """
    if not BASELINE_PATH.exists():
        return set()
    raw = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    known: set[tuple[str, str, str]] = set()
    for payload in (raw.get("drift") or {}).values():
        if not isinstance(payload, dict):
            continue
        for direction in ("only_in_first", "only_in_second"):
            for entry in payload.get(direction, []) or []:
                if not isinstance(entry, dict):
                    continue
                line = entry.get("line", "")
                if not line.startswith("column:") or "." not in line:
                    continue  # enum-label:/function: entries are out of this
                    # checker's scope — it only compares columns (module
                    # docstring point 1)
                table, column = line[len("column:") :].split(".", 1)
                if table and column:
                    # Recorded leg-agnostically: the point is "this pair is
                    # known to differ somewhere", and the leg is in the file for
                    # a human to read.
                    known.add((table, column, "*"))
    return known


def compare_live(live: dict[str, dict[str, set[str]]], baseline) -> list[str]:
    violations: list[str] = []
    all_tables = sorted({t for env in live.values() for t in env})
    for table in all_tables:
        present_in = [e for e in live if table in live[e]]
        if len(present_in) < 2:
            continue  # a table on one database only is a different finding
        union = set().union(*(live[e][table] for e in present_in))
        for env in present_in:
            for column in sorted(union - live[env][table]):
                if (table, column, "*") in baseline:
                    continue
                others = [e for e in present_in if column in live[e][table]]
                violations.append(
                    f"{table}.{column} is MISSING on {env} but present on {', '.join(others)}"
                )
    return violations


def compare_snapshots(
    live: dict[str, dict[str, set[str]]],
    snapshot_reader=columns_from_snapshot,
) -> list[str]:
    """SEC-133: `snapshot_reader` is injectable ONLY so the self-test can reach
    this comparator. Until now all nine self-test cases exercised compare_live()
    and NONE touched this function — and this is the half that runs daily and
    the half that caught SEC-131. A comparator with no fixture is the thing this
    file's own docstring warns about, one level in."""
    violations: list[str] = []
    for env, tables in live.items():
        try:
            snap = snapshot_reader(env)
        except FileNotFoundError:
            violations.append(f"{env}: no committed snapshot at src/types/database/{env}.ts")
            continue
        for table in sorted(set(tables) & set(snap)):
            missing = sorted(tables[table] - snap[table])
            extra = sorted(snap[table] - tables[table])
            if missing:
                violations.append(
                    f"{env}: src/types/database/{env}.ts is STALE — {table} has "
                    f"{', '.join(missing)} on the database but not in the snapshot"
                )
            if extra:
                violations.append(
                    f"{env}: src/types/database/{env}.ts OVERSTATES — {table}.{extra[0]}"
                    f"{' (+%d more)' % (len(extra) - 1) if len(extra) > 1 else ''} "
                    f"is in the snapshot but NOT on the database"
                )
    return violations


def self_test() -> int:
    """Prove the comparators can fail. A checker nobody has seen fail is a
    checker nobody has seen work."""
    checks: list[tuple[str, bool]] = []

    live = {
        "dev": {"profiles": {"id", "slug", "gift_voucher_hint"}},
        "prod": {"profiles": {"id", "slug"}},
    }
    v = compare_live(live, set())
    checks.append(("live drift is detected", len(v) == 1 and "gift_voucher_hint" in v[0]))
    checks.append(("the missing side is named", "MISSING on prod" in v[0]))

    v = compare_live(live, {("profiles", "gift_voucher_hint", "*")})
    checks.append(("a baselined difference is allowed", v == []))

    identical = {"dev": {"profiles": {"id"}}, "prod": {"profiles": {"id"}}}
    checks.append(("identical schemas produce no violation", compare_live(identical, set()) == []))

    # Reverse drift (BUGS-62 shape): dev is the one behind.
    reverse = {
        "dev": {"t": {"id"}},
        "prod": {"t": {"id", "claimed_at"}},
    }
    v = compare_live(reverse, set())
    checks.append(("reverse drift (dev behind) is detected", len(v) == 1 and "MISSING on dev" in v[0]))

    # A table on one database only must not be reported as drift.
    single = {"dev": {"only_here": {"id"}}, "prod": {}}
    checks.append(("a single-database table is not drift", compare_live(single, set()) == []))

    # The real baseline file's shape, not a hand-built stand-in. Every check
    # above calls compare_live() with a baseline set it constructed itself,
    # so none of them exercise load_baseline()'s own parsing of the committed
    # JSON — which is exactly how the field-name mismatch (table/column vs.
    # the file's single "line" string) and the missing "drift" nesting level
    # shipped invisibly: load_baseline() silently returned an empty set
    # against the real file on every run, so every already-ticketed SEC-107 /
    # BUGS-62 entry read as new, unbaselined drift the first time this
    # checker ran for real (2026-08-12, blocked develop -> staging).
    real_baseline = load_baseline()
    checks.append(("the real baseline file parses to a non-empty set", len(real_baseline) > 0))
    checks.append((
        "a known SEC-107 entry (profiles.discoverable_by_phone) is recognised",
        ("profiles", "discoverable_by_phone", "*") in real_baseline,
    ))
    checks.append((
        "a known BUGS-62 entry (gathering_invite_messages.claimed_at) is recognised",
        ("gathering_invite_messages", "claimed_at", "*") in real_baseline,
    ))

    # ------------------------------------------------------------------
    # SEC-133: compare_snapshots() fixtures. Added when this half started
    # running daily (--snapshot-only). Every case above tests compare_live();
    # before this, the snapshot comparator had NO coverage at all — despite
    # being the half that found SEC-131, and the only half that can see a
    # snapshot which has gone stale against its own database.
    # ------------------------------------------------------------------
    def reader(mapping):
        def _read(env):
            if env not in mapping:
                raise FileNotFoundError(env)
            return mapping[env]
        return _read

    # THE SEC-131 SHAPE: the database has a column the committed snapshot does
    # not. This is invisible to compare_live() when every database agrees —
    # which is exactly how group_label and custom_prompt survived.
    live_one = {"dev": {"profile_items": {"id", "group_label"}}}
    v = compare_snapshots(live_one, reader({"dev": {"profile_items": {"id"}}}))
    checks.append(("a STALE snapshot is detected", len(v) == 1 and "group_label" in v[0]))
    checks.append(("the stale snapshot names its env", v and v[0].startswith("dev:")))

    # The reverse: the snapshot claims a column the database does not have.
    # This is how a type asserts a column exists on a database it does not.
    v = compare_snapshots(live_one, reader({"dev": {"profile_items": {"id", "group_label", "ghost"}}}))
    checks.append(("an OVERSTATING snapshot is detected", len(v) == 1 and "ghost" in v[0]))

    v = compare_snapshots(live_one, reader({"dev": {"profile_items": {"id", "group_label"}}}))
    checks.append(("a matching snapshot produces no violation", v == []))

    # Intersection-only, deliberately: a relation absent from the snapshot is
    # not a violation (that is how public_profiles sat unlisted without failing).
    v = compare_snapshots(live_one, reader({"dev": {"other_table": {"id"}}}))
    checks.append(("a relation absent from the snapshot is not a violation", v == []))

    # A missing snapshot FILE must be reported, not swallowed.
    v = compare_snapshots(live_one, reader({}))
    checks.append(("a missing snapshot file is reported", len(v) == 1 and "no committed snapshot" in v[0]))

    passed = sum(1 for _, ok in checks if ok)
    for name, ok in checks:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    print(f"live-schema-parity self-test: {passed}/{len(checks)} passed")
    return 0 if passed == len(checks) else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--env", action="append", help="limit to one or more environments")
    parser.add_argument(
        "--snapshot-only",
        action="store_true",
        help=(
            "SEC-133: run ONLY the live-vs-snapshot half (each committed snapshot "
            "against its own database). This is the daily mode. See the note in main()."
        ),
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    wanted = set(args.env) if args.env else {e for e, _, _ in ENVIRONMENTS}
    live: dict[str, dict[str, set[str]]] = {}
    missing_credentials: list[str] = []

    for env, url_var, key_var in ENVIRONMENTS:
        if env not in wanted:
            continue
        url, key = os.environ.get(url_var), os.environ.get(key_var)
        if not url or not key:
            # FAIL-CLOSED. Never skip: a green tick from a check that did not
            # run is the failure mode this whole file exists to avoid.
            missing_credentials.append(f"{env} (needs {url_var} and {key_var})")
            continue
        try:
            live[env] = columns_from_openapi(fetch_openapi(url, key))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            print(f"::error::check-live-schema-parity: could not read {env}: {exc}")
            return 2

    if missing_credentials:
        for item in missing_credentials:
            print(f"::error::check-live-schema-parity: no credentials for {item}")
        print("A control that cannot run must not report success.")
        return 2

    # SEC-133 — WHY --snapshot-only EXISTS, AND WHY IT IS THE DAILY MODE.
    #
    # The two halves behave OPPOSITELY during a staged migration rollout, and
    # rollouts here span days (dev, then staging, then production):
    #
    #   live-vs-live      compares the three databases to each other. Mid-rollout
    #                     they genuinely differ, so it is RED for the whole window
    #                     until the divergence is baselined. Correct on a promote —
    #                     you should not promote mid-rollout — and pure noise daily.
    #   live-vs-snapshot  compares each env to its OWN database. Unaffected by a
    #                     rollout, provided <env>.ts is regenerated when <env> is
    #                     migrated. Red exactly when a snapshot has gone stale.
    #
    # And the half worth running daily is settled by evidence, not preference:
    # SEC-131 (two columns missing from all three snapshots) was COMPLETELY
    # INVISIBLE to live-vs-live, because all three databases agreed perfectly.
    # Only the snapshot half could see it. Running the cross-database half daily
    # would have caught nothing and gone red for days at a time — and a red you
    # learn to expect is a control you have switched off.
    #
    # So: snapshot half daily, both halves on the promote. The promote path is
    # unchanged by this flag.
    minimum = 1 if args.snapshot_only else 2
    if len(live) < minimum:
        print(
            f"::error::check-live-schema-parity: fewer than {minimum} database(s) read; "
            "nothing to compare"
        )
        return 2

    if args.snapshot_only:
        violations = compare_snapshots(live)
    else:
        violations = compare_live(live, load_baseline()) + compare_snapshots(live)

    if violations:
        for v in violations:
            print(f"::error::check-live-schema-parity: {v}")
        print()
        if args.snapshot_only:
            print("A committed snapshot no longer matches its own database.")
            print()
            print("This is not cosmetic. src/types/database/ is what the app's")
            print("`Database` type is built from, so a stale snapshot means the")
            print("compiler is reasoning about a schema that does not exist — and")
            print("CTL-036 cannot see it, because it only compares the snapshots to")
            print("EACH OTHER. That is how SEC-131 stayed green in every gate.")
            print()
            print("Fix it in one command, naming the environment that drifted:")
            print("    npm run gen:db-types -- --env dev")
            print("and commit the regenerated file. Full steps: docs/RUNBOOK.md")
            print("-> 'Regenerating a database type snapshot'.")
        else:
            print("Column parity is a promotion precondition: code written against one")
            print("schema is about to reach a database with a different one, and the")
            print("first symptom is a 500 on whatever page reads the missing column.")
            print()
            print("Fix by applying the missing migration, or — if the difference is")
            print("known and ticketed — record it in supabase/schema-drift-baseline.json.")
            print("Regenerate a stale snapshot with `npm run gen:db-types -- --env <env>`")
            print("(docs/RUNBOOK.md -> 'Regenerating a database type snapshot').")
        return 1

    tables = len({t for env in live.values() for t in env})
    if args.snapshot_only:
        print(
            f"check-live-schema-parity OK (snapshot-only) — {len(live)} database(s), "
            f"{tables} relation(s); every committed snapshot matches its own database."
        )
    else:
        print(
            f"check-live-schema-parity OK — {len(live)} database(s), {tables} table(s), "
            "columns agree and every committed snapshot matches its database."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
