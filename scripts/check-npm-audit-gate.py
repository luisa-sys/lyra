#!/usr/bin/env python3
"""SEC-105 — the npm-audit gate, scoped to what it can actually defend.

WHY THIS EXISTS
---------------
`npm audit --audit-level=high` ran full-tree at FIVE blocking sites: the PR
gate and all four deploy workflows. Measured on the day this landed: the
production dependency tree had **0 vulnerabilities at every severity**, while
973 of 1249 resolved packages were dev-only. The gate could stop a production
deploy over a package production does not install.

It is also the only gate in the estate keyed on a **third-party feed** rather
than on Lyra's own code. Every other control here can only be tripped by a
change in the PR. This one goes red overnight, on an unchanged repo, when
somebody else publishes an advisory — and in `deploy-production.yml` it sat in
`lint-and-unit-tests`, a transitive `needs:` ancestor of the deploy job, so it
killed the release before any other step ran.

THE COST WAS PAID IN UNSHIPPED SECURITY FIXES. SEC-88: ~11 days frozen, 40+
CI-green PRs queued, twelve tested security fixes left live-vulnerable in every
environment. Six outages in five weeks (SEC-89/90/91/92/94/97). A control that
holds security fixes out of production, in order to protect production from
advisories in packages production does not run, is net-negative on the axis it
claims to defend.

⚠️ `--omit=dev` IS NOT "WHAT SHIPS" — DO NOT DESCRIBE IT THAT WAY.
npm's prod/dev split is a *declaration* (`dependencies` vs `devDependencies`),
not a runtime boundary. Measured here: `minimatch`, `brace-expansion` and
`fast-uri` are all in the production tree, via
`@sentry/nextjs > @sentry/bundler-plugin-core > glob` and
`> @sentry/webpack-plugin > webpack`, and `postcss` arrives via `next` itself.
Those are BUILD-TIME tools that never execute in the Vercel serverless runtime.
So the prod tree is a much better risk proxy than the full tree, and it is not
a clean ships/does-not-ship line. Someone will eventually find webpack in a
"production" audit; this paragraph is why.

WHAT THIS ASSERTS
-----------------
1. The audit RAN. Empty output, unparseable JSON, or a missing `metadata`
   block exits 2 — never 0. "No findings" and "no measurement" must not look
   alike; that is SEC-136, live in this repo three weeks ago.
2. No HIGH or CRITICAL advisory in scope, except those waived.
3. Every waiver still MATCHES something. A waiver whose advisory has gone is
   stale and must be removed — otherwise the file only ever grows and becomes
   a suppression list. Enforced as an error only under `--scope full`, which is
   the run with complete information; a prod-scope run cannot see a dev-only
   advisory and so reports staleness as a warning rather than asserting it.

Waiver hygiene itself (ticket, owner, reason, expires-or-review_by, 12-month
cap, fails on lapse) is CTL-025's job, not this script's — one concern, one
owner.

USAGE
    python3 scripts/check-npm-audit-gate.py --scope prod
    python3 scripts/check-npm-audit-gate.py --scope full --report-only
    python3 scripts/check-npm-audit-gate.py --self-test
    python3 scripts/check-npm-audit-gate.py --scope prod --audit-json <file>

EXIT CODES
    0  clean (or --report-only with findings)
    1  blocking findings, or a stale waiver under --scope full
    2  the audit could not be run or its output could not be trusted
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WAIVERS = REPO_ROOT / "security" / "npm-audit-waivers.json"

BLOCKING_SEVERITIES = ("high", "critical")


class AuditError(RuntimeError):
    """The gate could not run. Never collapsed into a clean result."""


def run_audit(scope: str) -> dict:
    cmd = ["npm", "audit", "--json"]
    if scope == "prod":
        cmd.insert(2, "--omit=dev")
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as exc:
        raise AuditError(f"could not run npm audit: {exc}") from exc
    # npm audit exits NON-ZERO simply because findings exist. The return code
    # says nothing about whether the audit ran, so judge the output instead.
    if not proc.stdout.strip():
        raise AuditError(
            f"npm audit produced no output (exit {proc.returncode}): {proc.stderr.strip()[:400] or '<no stderr>'}"
        )
    return parse_audit(proc.stdout)


def parse_audit(text: str) -> dict:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AuditError(f"npm audit output is not JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise AuditError(f"npm audit output is a {type(data).__name__}, not an object")
    if "error" in data and "metadata" not in data:
        detail = data["error"]
        if isinstance(detail, dict):
            detail = detail.get("summary") or detail.get("detail") or detail
        raise AuditError(f"npm audit reported an error instead of a report: {str(detail)[:300]}")
    # The presence of `metadata.vulnerabilities` is what makes this an audit
    # report rather than some other JSON document that happens to parse.
    meta = data.get("metadata")
    if not isinstance(meta, dict) or not isinstance(meta.get("vulnerabilities"), dict):
        raise AuditError("npm audit output has no metadata.vulnerabilities — this is not an audit report")
    if not isinstance(data.get("vulnerabilities"), dict):
        raise AuditError("npm audit output has no vulnerabilities map (npm <7 format?)")
    return data


def load_waivers() -> list[dict]:
    if not WAIVERS.exists():
        raise AuditError(f"{WAIVERS.relative_to(REPO_ROOT)} is missing — refusing to run without it")
    try:
        data = json.loads(WAIVERS.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AuditError(f"{WAIVERS.name} is not valid JSON: {exc}") from exc
    waivers = data.get("waivers")
    if not isinstance(waivers, list):
        raise AuditError(f"{WAIVERS.name} has no 'waivers' array")
    return waivers


def advisory_ids(node: dict) -> set[str]:
    """Every GHSA/CVE id npm attributes to one vulnerability node."""
    out: set[str] = set()
    for via in node.get("via", []):
        if isinstance(via, dict):
            for key in ("source", "url", "title"):
                value = via.get(key)
                if isinstance(value, str) and ("GHSA-" in value or "CVE-" in value):
                    for token in value.replace("/", " ").split():
                        if token.startswith(("GHSA-", "CVE-")):
                            out.add(token)
    return out


def classify(audit: dict, waivers: list[dict]) -> dict:
    """Split blocking findings into waived and unwaived, and find stale waivers."""
    waived_keys = {(w.get("advisory"), w.get("package")) for w in waivers}
    waived_advisories = {w.get("advisory") for w in waivers}

    blocking, waived_hits, matched = [], [], set()
    for name, node in sorted(audit.get("vulnerabilities", {}).items()):
        severity = node.get("severity")
        if severity not in BLOCKING_SEVERITIES:
            continue
        ids = advisory_ids(node)
        hit = next((a for a in ids if (a, name) in waived_keys), None)
        if hit is None and ids & waived_advisories:
            # Advisory waived, but against a different package name. Deliberately
            # NOT honoured: a waiver names one package, and silently widening it
            # to every package sharing the advisory is how one decision becomes
            # a blanket one.
            hit = None
        record = {"package": name, "severity": severity, "advisories": sorted(ids)}
        if hit:
            matched.add((hit, name))
            waived_hits.append({**record, "waived_by": hit})
        else:
            blocking.append(record)

    stale = [
        f"{w.get('advisory')} on {w.get('package')} (ticket {w.get('ticket')})"
        for w in waivers
        if (w.get("advisory"), w.get("package")) not in matched
    ]
    return {"blocking": blocking, "waived": waived_hits, "stale": stale}


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def _report(vulns: dict) -> str:
    counts = {"info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0}
    for node in vulns.values():
        counts[node["severity"]] = counts.get(node["severity"], 0) + 1
    return json.dumps(
        {
            "vulnerabilities": vulns,
            "metadata": {"vulnerabilities": {**counts, "total": sum(counts.values())}, "dependencies": {"prod": 1}},
        }
    )


def self_test() -> int:
    failures: list[str] = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    def node(sev, ghsa):
        return {"severity": sev, "via": [{"source": 1, "url": f"https://github.com/advisories/{ghsa}"}]}

    # --- fail-closed: none of these may look like a clean audit ------------
    for label, text in [
        ("empty output", ""),
        ("not JSON", "<html>502 Bad Gateway</html>"),
        ("a bare array", "[]"),
        ("null", "null"),
        ("an empty object", "{}"),
        ("an npm error envelope", '{"error":{"summary":"ENOLOCK: no lockfile"}}'),
        ("metadata without vulnerabilities", '{"metadata":{"dependencies":{}}}'),
        ("a report with no vulnerabilities map", '{"metadata":{"vulnerabilities":{"high":0}}}'),
    ]:
        try:
            parse_audit(text)
            raised = False
        except AuditError:
            raised = True
        check(f"{label} raises rather than reporting clean", raised, True)

    # A genuinely clean report must still PARSE — fail-closed must not mean
    # "fail on everything", or the gate is just permanently red.
    clean = parse_audit(_report({}))
    check("a clean report parses", classify(clean, [])["blocking"], [])

    # --- blocking vs non-blocking severities -------------------------------
    audit = parse_audit(_report({"lodash": node("high", "GHSA-aaaa-bbbb-cccc")}))
    check("a HIGH finding blocks", len(classify(audit, [])["blocking"]), 1)
    audit = parse_audit(_report({"lodash": node("moderate", "GHSA-aaaa-bbbb-cccc")}))
    check("a MODERATE finding does not block", classify(audit, [])["blocking"], [])
    audit = parse_audit(_report({"lodash": node("critical", "GHSA-aaaa-bbbb-cccc")}))
    check("a CRITICAL finding blocks", len(classify(audit, [])["blocking"]), 1)

    # --- waivers ------------------------------------------------------------
    audit = parse_audit(_report({"lodash": node("high", "GHSA-aaaa-bbbb-cccc")}))
    waiver = [{"advisory": "GHSA-aaaa-bbbb-cccc", "package": "lodash", "ticket": "SEC-1"}]
    result = classify(audit, waiver)
    check("a matching waiver clears the finding", result["blocking"], [])
    check("...and records what it waived", len(result["waived"]), 1)
    check("...and is not stale", result["stale"], [])

    # A waiver is for ONE package. Same advisory, different package, must still
    # block — otherwise one decision silently becomes a blanket one.
    audit = parse_audit(_report({"other-pkg": node("high", "GHSA-aaaa-bbbb-cccc")}))
    check("a waiver does not transfer to another package", len(classify(audit, waiver)["blocking"]), 1)

    # Wrong advisory on the right package must also still block.
    audit = parse_audit(_report({"lodash": node("high", "GHSA-zzzz-yyyy-xxxx")}))
    check("a waiver does not cover a different advisory", len(classify(audit, waiver)["blocking"]), 1)

    # --- staleness: the file must shrink -----------------------------------
    clean = parse_audit(_report({}))
    check("a waiver matching nothing is STALE", len(classify(clean, waiver)["stale"]), 1)
    check("an empty waiver list is never stale", classify(clean, [])["stale"], [])

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


SELF_TEST_CASES = 19


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="SEC-105 — npm audit gate")
    ap.add_argument("--scope", choices=("prod", "full"), default="prod")
    ap.add_argument("--report-only", action="store_true", help="report findings without failing on them")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--audit-json", help="read an npm audit report instead of running one (tests)")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        audit = parse_audit(Path(args.audit_json).read_text(encoding="utf-8")) if args.audit_json else run_audit(args.scope)
        waivers = load_waivers()
        result = classify(audit, waivers)
    except (AuditError, OSError) as exc:
        print(f"::error::check-npm-audit-gate: {exc}")
        print("::error::  Failing closed (exit 2): an audit that did not run is not a clean audit.")
        return 2

    counts = audit["metadata"]["vulnerabilities"]
    tree = "production dependency tree" if args.scope == "prod" else "full tree (incl. dev)"
    print(
        f"npm audit — {tree}: "
        f"{counts.get('critical', 0)} critical, {counts.get('high', 0)} high, "
        f"{counts.get('moderate', 0)} moderate, {counts.get('low', 0)} low"
    )
    for w in result["waived"]:
        print(f"  WAIVED   {w['package']} ({w['severity']}) via {w['waived_by']}")

    failed = False

    if result["stale"]:
        # Only the full-tree run has complete information. A prod-scope run
        # cannot see a dev-only advisory, so a waiver for one legitimately
        # matches nothing here — asserting staleness there would fail the build
        # for being correct.
        level = "error" if args.scope == "full" else "warning"
        for s in result["stale"]:
            print(f"::{level}::stale waiver — matches no current finding: {s}")
        if args.scope == "full":
            print("::error::Remove it. A waiver file that only grows is a suppression list.")
            failed = True

    if result["blocking"]:
        for b in result["blocking"]:
            print(f"::{'warning' if args.report_only else 'error'}::{b['severity'].upper()}  {b['package']}  {', '.join(b['advisories']) or '(no id)'}")
        if not args.report_only:
            print()
            print(f"::error::{len(result['blocking'])} unwaived high/critical advisory(ies) in the {tree}.")
            print()
            print("Fix it if it has a fix. If it genuinely has none, that is a decision, not a")
            print("bug: record it in security/npm-audit-waivers.json with a ticket, an owner, a")
            print("real reason and a dated `expires` — which FAILS the build on lapse, so the")
            print("decision comes back for a second look instead of quietly becoming permanent.")
            failed = True

    if failed:
        return 1
    if result["blocking"]:
        print(f"\n{len(result['blocking'])} finding(s) reported, not blocking (--report-only).")
    else:
        print("No unwaived high/critical advisories. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
