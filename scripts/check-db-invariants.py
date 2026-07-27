#!/usr/bin/env python3
"""SEC-101 — assert the live database security invariants, per environment.

WHY A *LIVE* CHECK EXISTS AS WELL AS THE MIGRATION LINT
-------------------------------------------------------
`scripts/check-migration-privileges.py` holds every migration in a PR to the
privilege rules. That is necessary but not sufficient: per CLAUDE.md, Lyra
applies schema changes with the Supabase MCP `apply_migration` tool, so DDL
routinely reaches a database **without ever passing through a pull request**.

SEC-42 is precisely that failure mode — an `authenticated` EXECUTE grant on the
admin RPCs was restored by a later migration *after* SEC-29 had been closed and
verified. No repo-side control could have seen it. Nine tickets in this family
(SEC-12/15/27/28/29/42/43, BUGS-48/65/69) share the same shape: fixed, closed,
then silently re-opened.

This script closes that loop by asking each running database what its posture
actually is, rather than inferring it from the repo.

HOW IT WORKS
------------
Calls the `security_invariants_report()` RPC (see
`supabase/migrations/20260727090000_security_invariants_report.sql`) with the
environment's service-role key and compares the returned violations against a
waiver file.

WAIVERS — `supabase/security-invariants-waivers.json`
-----------------------------------------------------
Two deliberately different kinds, because conflating them is how gates become
noise and get switched off:

  "expires"    a TEMPORARY acceptance of a real, open risk. The build FAILS
               once the date passes. Use for anything with an open SEC ticket.
  "review_by"  an accepted-BY-DESIGN exception. Emits a notice once the date
               passes; never fails. Use where the invariant's heuristic is
               wrong, not where the risk is real.

Every waiver needs `ticket`, `owner` and `reason`. A waiver that matches no
live violation is reported as stale so it gets removed — waivers must not
outlive the thing they excuse.

HONEST STATUSES (Workflow & Backup Integrity Policy)
----------------------------------------------------
Missing credentials, an unreachable host, or an RPC that has not been applied
yet are all **UNVERIFIED**, never a silent PASS. A check that cannot run must
never look like a check that ran and found nothing — that is the exact
false-green class behind SEC-79 and SEC-96.

EXIT CODES  (matching scripts/daily-security-check.sh)
  0  every configured environment verified clean
  1  at least one environment UNVERIFIED, no failures
  2  at least one real violation, or a lapsed "expires" waiver

USAGE
    python3 scripts/check-db-invariants.py                 # all configured envs
    python3 scripts/check-db-invariants.py --env production
    python3 scripts/check-db-invariants.py --self-test

ENVIRONMENT VARIABLES (per env; absent env = skipped as UNVERIFIED)
    DEV_SUPABASE_URL           DEV_SUPABASE_SERVICE_ROLE_KEY
    STAGING_SUPABASE_URL       STAGING_SUPABASE_SERVICE_ROLE_KEY
    PROD_SUPABASE_URL          PROD_SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

WAIVERS_PATH = Path("supabase/security-invariants-waivers.json")
RPC_NAME = "security_invariants_report"
TIMEOUT_SECONDS = 30

ENVIRONMENTS = [
    ("dev", "DEV_SUPABASE_URL", "DEV_SUPABASE_SERVICE_ROLE_KEY"),
    ("staging", "STAGING_SUPABASE_URL", "STAGING_SUPABASE_SERVICE_ROLE_KEY"),
    ("production", "PROD_SUPABASE_URL", "PROD_SUPABASE_SERVICE_ROLE_KEY"),
]

PASS, FAIL, UNVERIFIED = "PASS", "FAIL", "UNVERIFIED"


class EnvResult:
    def __init__(self, env: str):
        self.env = env
        self.status = UNVERIFIED
        self.reason = ""
        self.violations: list[dict] = []
        self.waived: list[dict] = []
        self.lapsed: list[dict] = []
        self.stale_waivers: list[dict] = []
        self.overdue_reviews: list[dict] = []


# --- transport -------------------------------------------------------------


def call_rpc(url: str, service_role_key: str) -> list[dict]:
    """POST to the PostgREST RPC endpoint. Raises on any non-200."""
    endpoint = f"{url.rstrip('/')}/rest/v1/rpc/{RPC_NAME}"
    request = urllib.request.Request(
        endpoint,
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


# --- waivers ---------------------------------------------------------------


def load_waivers() -> list[dict]:
    if not WAIVERS_PATH.exists():
        return []
    return json.loads(WAIVERS_PATH.read_text(encoding="utf-8")).get("waivers", [])


def waiver_matches(waiver: dict, env: str, violation: dict) -> bool:
    return (
        waiver.get("env") in (env, "*")
        and waiver.get("invariant") == violation.get("invariant")
        and waiver.get("object") in (violation.get("object_name"), "*")
    )


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def evaluate(env: str, rows: list[dict], waivers: list[dict], today: date) -> EnvResult:
    result = EnvResult(env)
    used: set[int] = set()

    for row in rows:
        match_index = next(
            (i for i, w in enumerate(waivers) if waiver_matches(w, env, row)), None
        )
        if match_index is None:
            result.violations.append(row)
            continue

        used.add(match_index)
        waiver = waivers[match_index]
        entry = {**row, "waiver": waiver}

        expires = parse_date(waiver.get("expires"))
        if expires is not None:
            if today > expires:
                result.lapsed.append(entry)
            else:
                result.waived.append(entry)
            continue

        review_by = parse_date(waiver.get("review_by"))
        if review_by is not None and today > review_by:
            result.overdue_reviews.append(entry)
        result.waived.append(entry)

    # A waiver scoped to this env that matched nothing is stale.
    for i, waiver in enumerate(waivers):
        if i in used:
            continue
        if waiver.get("env") in (env, "*"):
            result.stale_waivers.append(waiver)

    if result.violations or result.lapsed:
        result.status = FAIL
    else:
        result.status = PASS
    return result


# --- self-test (the "test the test" control) -------------------------------


def self_test() -> int:
    today = date(2026, 7, 27)
    waivers = [
        {
            "env": "production",
            "invariant": "INV-6-public-storage-bucket",
            "object": "profile-photos",
            "ticket": "SEC-60",
            "owner": "founder",
            "reason": "open risk",
            "expires": "2026-10-31",
        },
        {
            "env": "dev",
            "invariant": "INV-4-secdef-authed-execute-no-authz",
            "object": "search_by_contact_hash",
            "ticket": "SEC-80",
            "owner": "founder",
            "reason": "by design",
            "review_by": "2026-01-01",
        },
        {
            "env": "staging",
            "invariant": "INV-1-secdef-anon-execute",
            "object": "ghost_fn",
            "ticket": "SEC-000",
            "owner": "founder",
            "reason": "no longer present",
            "expires": "2027-01-01",
        },
    ]

    cases = []

    # 1. Unwaived violation -> FAIL
    r = evaluate("production", [{"invariant": "INV-1-secdef-anon-execute", "object_name": "leaky"}], waivers, today)
    cases.append(("unwaived violation fails", r.status == FAIL and len(r.violations) == 1))

    # 2. Live waiver -> PASS, counted as waived
    r = evaluate("production", [{"invariant": "INV-6-public-storage-bucket", "object_name": "profile-photos"}], waivers, today)
    cases.append(("in-date waiver passes", r.status == PASS and len(r.waived) == 1))

    # 3. Lapsed "expires" waiver -> FAIL
    r = evaluate("production", [{"invariant": "INV-6-public-storage-bucket", "object_name": "profile-photos"}], waivers, date(2026, 11, 1))
    cases.append(("lapsed expires-waiver fails", r.status == FAIL and len(r.lapsed) == 1))

    # 4. Overdue "review_by" -> still PASS, but flagged
    r = evaluate("dev", [{"invariant": "INV-4-secdef-authed-execute-no-authz", "object_name": "search_by_contact_hash"}], waivers, today)
    cases.append(("overdue review_by notifies but passes", r.status == PASS and len(r.overdue_reviews) == 1))

    # 5. Waiver matching nothing -> reported stale
    r = evaluate("staging", [], waivers, today)
    cases.append(("stale waiver reported", any(w["object"] == "ghost_fn" for w in r.stale_waivers)))

    # 6. Clean database -> PASS
    r = evaluate("production", [], [], today)
    cases.append(("clean database passes", r.status == PASS))

    # 7. A waiver must not leak across environments
    r = evaluate("staging", [{"invariant": "INV-6-public-storage-bucket", "object_name": "profile-photos"}], waivers, today)
    cases.append(("production waiver does not cover staging", r.status == FAIL))

    failures = 0
    for label, ok in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-db-invariants self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(cases)} case(s) behave as specified. ✓")
    return 0


# --- reporting -------------------------------------------------------------


def report(result: EnvResult) -> None:
    header = f"[{result.status}] {result.env}"
    if result.status == UNVERIFIED:
        print(f"{header} — {result.reason}")
        return

    counts = (
        f"{len(result.violations)} violation(s), "
        f"{len(result.waived)} waived, {len(result.lapsed)} lapsed waiver(s)"
    )
    print(f"{header} — {counts}")

    for row in result.violations:
        print(
            f"::error::[{result.env}] {row.get('invariant')} — "
            f"{row.get('object_name')}: {row.get('detail', '')}"
        )
    for row in result.lapsed:
        waiver = row["waiver"]
        print(
            f"::error::[{result.env}] WAIVER LAPSED {waiver.get('expires')} — "
            f"{row.get('invariant')} on {row.get('object_name')} "
            f"({waiver.get('ticket')}, owner {waiver.get('owner')}). "
            f"Fix the finding or re-authorise the waiver with a new date."
        )
    for row in result.overdue_reviews:
        waiver = row["waiver"]
        print(
            f"::warning::[{result.env}] waiver past its review date "
            f"({waiver.get('review_by')}) — {row.get('invariant')} on "
            f"{row.get('object_name')} ({waiver.get('ticket')}). Re-confirm it is still by design."
        )
    for waiver in result.stale_waivers:
        print(
            f"::warning::[{result.env}] stale waiver — {waiver.get('invariant')} on "
            f"{waiver.get('object')} ({waiver.get('ticket')}) matches no live finding. Remove it."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", choices=[e[0] for e in ENVIRONMENTS], help="check one environment only")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    waivers = load_waivers()
    today = date.today()
    targets = [e for e in ENVIRONMENTS if args.env is None or e[0] == args.env]

    results: list[EnvResult] = []
    for env, url_var, key_var in targets:
        result = EnvResult(env)
        url, key = os.environ.get(url_var), os.environ.get(key_var)

        if not url or not key:
            result.reason = (
                f"{url_var} / {key_var} not set — cannot verify. "
                f"This is UNVERIFIED, not a pass."
            )
            results.append(result)
            continue

        try:
            rows = call_rpc(url, key)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:300]
            if exc.code in (404, 400) and RPC_NAME in body:
                result.reason = (
                    f"RPC {RPC_NAME}() not found (HTTP {exc.code}). Apply "
                    f"supabase/migrations/20260727090000_security_invariants_report.sql "
                    f"to this environment."
                )
            else:
                result.reason = f"HTTP {exc.code} calling {RPC_NAME}(): {body}"
            results.append(result)
            continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            result.reason = f"could not reach the database: {exc}"
            results.append(result)
            continue

        results.append(evaluate(env, rows, waivers, today))

    print(f"Database security invariants — {len(results)} environment(s), {len(waivers)} waiver(s)")
    print()
    for result in results:
        report(result)

    failed = [r for r in results if r.status == FAIL]
    unverified = [r for r in results if r.status == UNVERIFIED]

    print()
    print(
        f"Summary: {len([r for r in results if r.status == PASS])} PASS, "
        f"{len(failed)} FAIL, {len(unverified)} UNVERIFIED"
    )

    if failed:
        print("::error::Database security invariants FAILED. See findings above.")
        return 2
    if unverified:
        print(
            "::error::At least one environment could not be verified. "
            "Treat as unknown, not healthy."
        )
        return 1
    print("All configured environments satisfy the database security invariants. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
