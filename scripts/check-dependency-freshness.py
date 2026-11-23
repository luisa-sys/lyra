#!/usr/bin/env python3
"""SEC-197 / CTL-081 — dependency freshness: vulnerable or >90-day-old means upgrade.

THE RULE (founder, 2026-11-23)
------------------------------
"Always upgrade whenever external software has vulnerabilities or is more than
3 months old." The full policy is docs/DEPENDENCY_POLICY.md. This script is the
control that keeps it from being a sentence nobody checks.

WHAT COUNTS AS OUT OF POLICY
----------------------------
  vulnerability  any npm advisory, ANY severity, that npm attributes directly to
                 an installed package (direct or transitive). A package that is
                 only flagged because something BELOW it is vulnerable is not
                 listed separately: the thing below it is listed, and upgrading
                 that is the fix.
  age            a DIRECT dependency whose installed version was published more
                 than 90 days ago AND whose registry `latest` is a newer stable
                 release (majors included). Old and still-latest is fine.
  age (runtime)  a Node.js major pinned by `node-version:` in a workflow whose
                 newest release is more than 90 days old while a newer LTS major
                 exists — i.e. the line has stopped receiving releases.
                 Measured in the daily report only.

Anything out of policy must be upgraded on `develop`, or carried by an
unexpired entry in security/dependency-freshness-waivers.json.

WHY TWO MODES — AND WHY NEITHER RECREATES THE SEC-88 FREEZE
-----------------------------------------------------------
SEC-88 froze the pipeline for ~11 days because a gate keyed on a THIRD-PARTY
FEED sat in front of every PR and every deploy: an advisory published overnight
turned an unchanged repo red. This control is built so that cannot happen.

  --report (daily, dependency-freshness.yml)   measures the whole tree and opens or
      updates ONE tracking issue. With --report-only, out-of-policy findings
      and stale waivers are reported, not failed: the issue is the work item.
      It still exits 1 on an EXPIRED or malformed waiver — a lapse is a
      decision falling due, known 90 days ahead — and 2 if it could not
      measure.
  --pr (pr-checks.yml)   blocking, but ONLY when the PR changes package.json,
      package-lock.json or the waiver file. It then fails only on what the PR
      itself INTRODUCES, judged against the BASE tree, not in the abstract:
        - a (package, advisory) pair on a new or re-versioned lockfile entry
          that the base tree's audit does NOT already report. Re-resolving a
          still-vulnerable subtree (e.g. glob 10.4.5 -> 10.4.6, same GHSA, fix
          only via a parent's major) is not "introducing" anything;
        - a changed direct dependency that is out of the age rule, unless the
          base version was ALSO out of it and the PR does not downgrade it
          (eslint 9.39.3 -> 9.39.4 while 10.x is latest is an improvement).
      A vulnerable package the PR did not touch never blocks it. An expired or
      malformed waiver does. Every other PR is "not applicable" and makes no
      network call at all.
      Time- and feed-dependent by nature: re-running an UNCHANGED dependency PR
      can flip red when a new advisory lands on a version it introduces or an
      introduced version crosses 90 days. Only dependency PRs are exposed.

NETWORK IS ISOLATED
-------------------
The two feeds — `npm audit --json` and the npm registry's `time` field (plus
nodejs.org/dist/index.json for the runtime) — are reached only through the
fetchers built in `_fetchers()`. Every judgement function takes plain data, so
the self-test and the jest suite drive it from fixtures and never touch the
network. The audit itself is run by check-npm-audit-gate.py's `run_audit`
(CTL-052), imported rather than copied, so its bounded retry on transient
failure and its fail-closed parsing (SEC-136/SEC-140) apply here unchanged.

USAGE
    python3 scripts/check-dependency-freshness.py --report [--report-only] [--markdown FILE] [--github-output FILE]
    python3 scripts/check-dependency-freshness.py --pr --base origin/develop
    python3 scripts/check-dependency-freshness.py --check-waivers
    python3 scripts/check-dependency-freshness.py --self-test

  Fixture flags (tests): --package-json --lockfile --base-lockfile
  --changed-files --audit-json --base-audit-json --registry-dir
  --node-index-json --workflows-dir --waivers --today

EXIT CODES
    0  clean / not applicable / --report-only with findings
    1  out of policy (or a stale waiver) without --report-only; ANY expired or
       malformed waiver, in every mode
    2  could not measure — never reported as clean
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WAIVERS = REPO_ROOT / "security" / "dependency-freshness-waivers.json"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

MAX_AGE_DAYS = 90
MAX_WAIVER_DAYS = 90
MIN_REASON_CHARS = 40
# Upgrade deadlines from the moment a fix exists (docs/DEPENDENCY_POLICY.md §3).
SLA_DAYS = {"critical": 2, "high": 2, "moderate": 14, "low": 14, "info": 14}
SEVERITY_ORDER = ("critical", "high", "moderate", "low", "info")

PR_TRIGGER_FILES = (
    "package.json",
    "package-lock.json",
    "security/dependency-freshness-waivers.json",
)
WAIVER_KEYS = ("package", "kind", "advisory", "reason", "jira", "expires", "approved_by")
WAIVER_KINDS = ("age", "vulnerability")
GHSA_RE = re.compile(r"^GHSA(-[0-9a-z]{4}){3}$")
# Any Jira-style key (the waiver shape says <KEY-n>); same pattern CTL-042 uses.
JIRA_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")
NODE_VERSION_RE = re.compile(r"""^\s*-?\s*node-version:\s*['"]?(\d+)(?:\.x)?['"]?\s*(?:#.*)?$""", re.M)

REGISTRY_URL = "https://registry.npmjs.org/"
NODE_INDEX_URL = "https://nodejs.org/dist/index.json"
HTTP_ATTEMPTS = 3
HTTP_BACKOFF_S = (2, 4)  # len == HTTP_ATTEMPTS - 1


class MeasureError(RuntimeError):
    """The check could not measure. Never collapsed into a clean result."""


# --------------------------------------------------------------------------
# semver (just enough: registry versions are always full x.y.z[-pre][+build])
# --------------------------------------------------------------------------


def parse_semver(version):
    m = SEMVER_RE.match(str(version or "").strip())
    if not m:
        return None
    pre = None
    if m.group(4):
        pre = tuple(int(p) if p.isdigit() else p for p in m.group(4).split("."))
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), pre)


def _semver_key(parsed):
    major, minor, patch, pre = parsed
    # A release sorts above every prerelease of the same x.y.z.
    if pre is None:
        pre_key = (1,)
    else:
        pre_key = (0,) + tuple((0, p, "") if isinstance(p, int) else (1, 0, p) for p in pre)
    return (major, minor, patch, pre_key)


def is_stable(version) -> bool:
    parsed = parse_semver(version)
    return parsed is not None and parsed[3] is None


def is_newer(candidate, installed) -> bool:
    a, b = parse_semver(candidate), parse_semver(installed)
    if a is None or b is None:
        raise MeasureError(f"cannot compare versions {candidate!r} and {installed!r}")
    return _semver_key(a) > _semver_key(b)


def _date_of(iso) -> date:
    try:
        return datetime.strptime(str(iso)[:10], "%Y-%m-%d").date()
    except ValueError as exc:
        raise MeasureError(f"unparseable date {iso!r}") from exc


# --------------------------------------------------------------------------
# waivers
# --------------------------------------------------------------------------


def validate_waivers(data, today: date):
    """Return (valid, errors, expired). Pure: no file or clock access."""
    if not isinstance(data, dict) or not isinstance(data.get("waivers"), list):
        return [], ["the waiver file has no top-level 'waivers' array"], []
    valid, errors, expired, seen = [], [], [], set()
    for i, w in enumerate(data["waivers"]):
        label = f"waiver[{i}]"
        if not isinstance(w, dict):
            errors.append(f"{label}: not an object")
            continue
        label = f"waiver[{i}] ({w.get('package', '?')}, {w.get('kind', '?')})"
        problems = []
        missing = [k for k in WAIVER_KEYS if k not in w]
        extra = sorted(set(w) - set(WAIVER_KEYS))
        if missing:
            problems.append(f"missing field(s) {', '.join(missing)}")
        if extra:
            problems.append(f"unknown field(s) {', '.join(extra)}")
        if not isinstance(w.get("package"), str) or not w.get("package", "").strip():
            problems.append("'package' must be a non-empty string")
        kind = w.get("kind")
        if kind not in WAIVER_KINDS:
            problems.append(f"'kind' must be one of {'|'.join(WAIVER_KINDS)}")
        advisory = w.get("advisory")
        if kind == "vulnerability" and not (isinstance(advisory, str) and GHSA_RE.match(advisory)):
            problems.append("a vulnerability waiver must name one GHSA id in 'advisory'")
        if kind == "age" and advisory is not None:
            problems.append("an age waiver must set 'advisory' to null")
        reason = w.get("reason")
        if not isinstance(reason, str) or len(reason.strip()) < MIN_REASON_CHARS:
            problems.append(
                f"'reason' must say why it was not upgraded and what mitigates it "
                f"(at least {MIN_REASON_CHARS} characters)"
            )
        if not isinstance(w.get("jira"), str) or not JIRA_RE.match(w.get("jira", "")):
            problems.append("'jira' must be a Jira key such as SEC-197")
        if not isinstance(w.get("approved_by"), str) or not w.get("approved_by", "").strip():
            problems.append("'approved_by' must be a non-empty string")
        lapsed = False
        try:
            expires = datetime.strptime(str(w.get("expires")), "%Y-%m-%d").date()
        except ValueError:
            problems.append("'expires' must be a YYYY-MM-DD date")
        else:
            if expires - today > timedelta(days=MAX_WAIVER_DAYS):
                problems.append(
                    f"'expires' {expires} is more than {MAX_WAIVER_DAYS} days away — "
                    f"a longer waiver is a repeal, not an exception"
                )
            if expires < today:
                lapsed = True
        # repr() so an unhashable value (e.g. "advisory": ["GHSA-..."]) is reported
        # as malformed above instead of crashing the run with a TypeError here.
        key = tuple(repr(x) for x in (w.get("package"), kind, advisory))
        if key in seen:
            problems.append("duplicates an earlier waiver for the same package/kind/advisory")
        seen.add(key)
        if problems:
            errors.extend(f"{label}: {p}" for p in problems)
        elif lapsed:
            expired.append(w)
        else:
            valid.append(w)
    return valid, errors, expired


def apply_waivers(findings, waivers):
    """Split findings into (unwaived, waived, stale_waivers)."""
    index = {(w["package"], w["kind"], w["advisory"]): w for w in waivers}
    used, unwaived, waived = set(), [], []
    for f in findings:
        if f["kind"] == "age":
            key = (f["package"], "age", None)
            if key in index:
                used.add(key)
                waived.append({**f, "waived_by": index[key]["jira"]})
            else:
                unwaived.append(f)
            continue
        covered = [a for a in f["advisories"] if (f["package"], "vulnerability", a) in index]
        used.update((f["package"], "vulnerability", a) for a in covered)
        uncovered = [a for a in f["advisories"] if a not in covered]
        # A finding npm reports without any GHSA id cannot be waived: there is
        # nothing to name. It stays out of policy until upgraded.
        if f["advisories"] and not uncovered:
            waived.append({**f, "waived_by": ", ".join(index[(f["package"], "vulnerability", a)]["jira"] for a in covered)})
        else:
            unwaived.append({**f, "advisories": uncovered or f["advisories"]})
    stale = [w for w in waivers if (w["package"], w["kind"], w["advisory"]) not in used]
    return unwaived, waived, stale


# --------------------------------------------------------------------------
# findings — pure functions over already-fetched data
# --------------------------------------------------------------------------


def _audit_gate():
    """check-npm-audit-gate.py, loaded by path (its name has hyphens)."""
    spec = importlib.util.spec_from_file_location(
        "check_npm_audit_gate", REPO_ROOT / "scripts" / "check-npm-audit-gate.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def vulnerability_findings(audit: dict, advisory_ids) -> list:
    out = []
    for name, node in sorted(audit.get("vulnerabilities", {}).items()):
        direct = [v for v in node.get("via", []) if isinstance(v, dict)]
        if not direct:
            continue  # only flagged because of a dependency; that dependency is listed itself
        severities = [v.get("severity") for v in direct if v.get("severity") in SEVERITY_ORDER]
        severity = min(severities, key=SEVERITY_ORDER.index) if severities else node.get("severity", "unknown")
        fix = node.get("fixAvailable")
        if isinstance(fix, dict):
            fix = f"{fix.get('name')}@{fix.get('version')}" + (" (major)" if fix.get("isSemVerMajor") else "")
        out.append(
            {
                "package": name,
                "kind": "vulnerability",
                "severity": severity,
                "advisories": sorted(advisory_ids({"via": direct})),
                "nodes": sorted(node.get("nodes", [])),
                "range": node.get("range", ""),
                "fix": fix,
            }
        )
    return out


def direct_dependencies(package_json: dict, lock: dict) -> dict:
    names = {}
    for field in ("dependencies", "devDependencies", "optionalDependencies"):
        for name in (package_json.get(field) or {}):
            names[name] = field
    packages = lock.get("packages")
    if not isinstance(packages, dict):
        raise MeasureError("package-lock.json has no 'packages' map (lockfileVersion < 2?)")
    out = {}
    for name in sorted(names):
        path = f"node_modules/{name}"
        entry = packages.get(path)
        if not isinstance(entry, dict) or "version" not in entry:
            raise MeasureError(f"{name} is declared in package.json but missing from package-lock.json")
        resolved = str(entry.get("resolved", ""))
        out[name] = {
            "version": entry["version"],
            "path": path,
            "lookup": entry.get("name", name),  # npm: aliases record the real name here
            "registry": resolved.startswith(REGISTRY_URL) and not entry.get("link"),
        }
    return out


def age_findings(direct: dict, fetch_doc, today: date):
    findings, notes = [], []
    for name, info in sorted(direct.items()):
        if not info["registry"]:
            notes.append(f"{name}: not installed from the npm registry — age not measured")
            continue
        doc = fetch_doc(info["lookup"])
        times = doc.get("time") if isinstance(doc, dict) else None
        tags = doc.get("dist-tags") if isinstance(doc, dict) else None
        if not isinstance(times, dict) or info["version"] not in times:
            raise MeasureError(f"registry metadata for {name} has no publish time for {info['version']}")
        latest = (tags or {}).get("latest")
        if parse_semver(latest) is None:
            raise MeasureError(f"registry metadata for {name} has no usable dist-tags.latest ({latest!r})")
        published = _date_of(times[info["version"]])
        age = (today - published).days
        if age > MAX_AGE_DAYS and is_stable(latest) and is_newer(latest, info["version"]):
            findings.append(
                {
                    "package": name,
                    "kind": "age",
                    "installed": info["version"],
                    "published": published.isoformat(),
                    "age_days": age,
                    "latest": latest,
                    "latest_published": _date_of(times[latest]).isoformat() if latest in times else "?",
                }
            )
    return findings, notes


def pinned_node_majors(workflow_texts: dict) -> dict:
    majors = {}
    for fname, text in sorted(workflow_texts.items()):
        for m in NODE_VERSION_RE.finditer(text):
            majors.setdefault(int(m.group(1)), set()).add(fname)
    return {k: sorted(v) for k, v in majors.items()}


def runtime_findings(majors: dict, index, today: date) -> list:
    if not isinstance(index, list) or not index:
        raise MeasureError("Node.js release index is empty or not a list")
    releases = []
    for r in index:
        parsed = parse_semver(r.get("version")) if isinstance(r, dict) else None
        if parsed is not None and parsed[3] is None:
            releases.append((parsed, r))
    out = []
    for major, files in sorted(majors.items()):
        line = [(p, r) for p, r in releases if p[0] == major]
        if not line:
            raise MeasureError(f"no Node.js {major}.x release found in the release index")
        newest_p, newest = max(line, key=lambda pr: _semver_key(pr[0]))
        age = (today - _date_of(newest.get("date"))).days
        newer_lts = [(p, r) for p, r in releases if p[0] > major and r.get("lts")]
        if age > MAX_AGE_DAYS and newer_lts:
            best_p, best = max(newer_lts, key=lambda pr: _semver_key(pr[0]))
            out.append(
                {
                    "package": "node",
                    "kind": "age",
                    "installed": f"{major}.x (newest {newest['version']})",
                    "published": _date_of(newest.get("date")).isoformat(),
                    "age_days": age,
                    "latest": f"{best['version']} (LTS)",
                    "latest_published": _date_of(best.get("date")).isoformat(),
                    "where": files,
                }
            )
    return out


def changed_lock_paths(base_lock, head_lock: dict) -> set:
    """Lockfile entries the PR added or re-versioned. The root entry ('') is ignored."""
    head = head_lock.get("packages") or {}
    base = (base_lock or {}).get("packages") or {}
    return {
        path
        for path, entry in head.items()
        if path and isinstance(entry, dict)
        and (path not in base or (base.get(path) or {}).get("version") != entry.get("version"))
    }


def _vuln_pairs(findings_vuln: list) -> set:
    """(package, advisory) pairs; a finding npm reports without any id keys on None."""
    return {(f["package"], a) for f in findings_vuln for a in (f["advisories"] or [None])}


def introduced(findings_vuln: list, direct: dict, changed: set, base_findings_vuln=None):
    """(vulnerability findings the PR introduced, direct deps the PR changed).

    A head finding counts only if one of its nodes was added or re-versioned
    by the PR AND it carries a (package, advisory) pair the BASE tree's audit
    does not already report. Only the introduced advisories are kept on it.
    """
    at_base = _vuln_pairs(base_findings_vuln or [])
    vulns = []
    for f in findings_vuln:
        if not set(f["nodes"]) & changed:
            continue
        new = [a for a in (f["advisories"] or [None]) if (f["package"], a) not in at_base]
        if new:
            vulns.append({**f, "advisories": [a for a in new if a is not None]})
    touched = {n: i for n, i in direct.items() if i["path"] in changed}
    return vulns, touched


def age_regressions(age_found: list, touched: dict, base_lock, fetch_doc, today: date) -> list:
    """Keep only age findings the PR made worse.

    A changed direct dependency that is out of the age rule is NOT introduced
    when the base version was also out of it and the PR does not move it
    backwards — that PR is a step toward compliance, and blocking it would
    push people to file waivers for improvements. New dependencies, versions
    that were in policy at base, and downgrades still count.
    """
    base_pkgs = (base_lock or {}).get("packages") or {}
    out = []
    for f in age_found:
        info = touched.get(f["package"])
        base_entry = base_pkgs.get(info["path"]) if info else None
        base_version = base_entry.get("version") if isinstance(base_entry, dict) else None
        if not base_version or parse_semver(base_version) is None:
            out.append(f)  # new direct dependency (or unparseable base): judged on its own
            continue
        if is_newer(base_version, f["installed"]):
            out.append({**f, "downgrade_from": base_version})
            continue
        doc = fetch_doc(info["lookup"])
        times = doc.get("time") or {}
        if base_version not in times:
            raise MeasureError(f"registry metadata for {f['package']} has no publish time for base version {base_version}")
        base_age = (today - _date_of(times[base_version])).days
        if not (base_age > MAX_AGE_DAYS and is_newer(f["latest"], base_version)):
            out.append(f)  # base version was in policy: this PR made it out of policy
    return out


# --------------------------------------------------------------------------
# fetchers — the ONLY code that reaches the network
# --------------------------------------------------------------------------


def http_get_json(url: str, sleep=time.sleep, opener=None):
    opener = opener or (lambda u: urllib.request.urlopen(  # noqa: S310 — fixed https URLs only
        urllib.request.Request(u, headers={"Accept": "application/json", "User-Agent": "lyra-dependency-freshness"}),
        timeout=120,
    ))
    last = None
    for attempt in range(HTTP_ATTEMPTS):
        try:
            with opener(url) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code < 500 and exc.code != 429:
                raise MeasureError(f"GET {url} -> HTTP {exc.code}") from exc
            last = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
        except json.JSONDecodeError as exc:
            raise MeasureError(f"GET {url} returned non-JSON: {exc}") from exc
        if attempt < HTTP_ATTEMPTS - 1:
            sleep(HTTP_BACKOFF_S[attempt])
    raise MeasureError(f"GET {url} failed after {HTTP_ATTEMPTS} attempts: {last}")


def _read_json(path: Path, what: str):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise MeasureError(f"{what} not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise MeasureError(f"{what} is not valid JSON: {exc}") from exc


def _fetchers(args):
    """Build (fetch_audit, fetch_doc, fetch_node_index), from fixtures or the network."""
    gate = _audit_gate()

    if args.audit_json:
        def fetch_audit():
            try:
                return gate.parse_audit(Path(args.audit_json).read_text(encoding="utf-8"))
            except FileNotFoundError as exc:
                raise MeasureError(f"audit fixture not found: {args.audit_json}") from exc
            except gate.AuditError as exc:
                raise MeasureError(str(exc)) from exc
    else:
        def fetch_audit():
            try:
                return gate.run_audit("full")
            except gate.AuditError as exc:
                raise MeasureError(str(exc)) from exc

    if args.base_audit_json:
        def fetch_base_audit(_base_pj, _base_lock):
            try:
                return gate.parse_audit(Path(args.base_audit_json).read_text(encoding="utf-8"))
            except FileNotFoundError as exc:
                raise MeasureError(f"base audit fixture not found: {args.base_audit_json}") from exc
            except gate.AuditError as exc:
                raise MeasureError(str(exc)) from exc
    elif args.audit_json:
        def fetch_base_audit(_base_pj, _base_lock):
            raise MeasureError("--audit-json was given without --base-audit-json; refusing to reach the network from a fixture run")
    else:
        def fetch_base_audit(base_pj, base_lock):
            # Audit the BASE tree from its lockfile alone, in a scratch directory,
            # through the same bounded-retry runner as the head audit.
            with tempfile.TemporaryDirectory(prefix="sec197-base-") as tmp:
                Path(tmp, "package.json").write_text(json.dumps(base_pj), encoding="utf-8")
                Path(tmp, "package-lock.json").write_text(json.dumps(base_lock), encoding="utf-8")

                def runner(cmd):
                    return subprocess.run([*cmd, "--package-lock-only"], cwd=tmp, capture_output=True, text=True, timeout=600)

                try:
                    return gate.run_audit("full", runner=runner)
                except gate.AuditError as exc:
                    raise MeasureError(f"base tree: {exc}") from exc

    if args.registry_dir:
        def fetch_doc(name):
            return _read_json(Path(args.registry_dir) / (name.replace("/", "__") + ".json"), f"registry fixture for {name}")
    else:
        def fetch_doc(name):
            return http_get_json(REGISTRY_URL + urllib.parse.quote(name, safe="@"))

    if args.node_index_json:
        def fetch_node_index():
            return _read_json(Path(args.node_index_json), "Node.js index fixture")
    else:
        def fetch_node_index():
            return http_get_json(NODE_INDEX_URL)

    fetch_audit.base = fetch_base_audit
    return fetch_audit, fetch_doc, fetch_node_index, gate.advisory_ids


def _git(*cmd) -> str:
    try:
        proc = subprocess.run(["git", *cmd], cwd=REPO_ROOT, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        raise MeasureError(f"git {' '.join(cmd)} could not run: {exc}") from exc
    if proc.returncode != 0:
        raise MeasureError(f"git {' '.join(cmd)} failed: {proc.stderr.strip()[:300]}")
    return proc.stdout


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------


def _due(f) -> str:
    if f["kind"] == "vulnerability":
        return f"≤ {SLA_DAYS.get(f['severity'], 14)} days"
    return "upgrade (90-day rule)"


def render_markdown(result: dict, today: date) -> str:
    lines = [
        f"Raised automatically by `dependency-freshness.yml` (SEC-197 / CTL-081), {today.isoformat()}.",
        "Policy: `docs/DEPENDENCY_POLICY.md`. **Upgrade on `develop`, or add a dated waiver to**",
        "`security/dependency-freshness-waivers.json`. This issue blocks no release; the PR check",
        "blocks only PRs that change dependencies and introduce an out-of-policy version.",
        "",
        f"- **Out of policy:** {len(result['unwaived'])}",
        f"- **Waived:** {len(result['waived'])}",
        f"- **Expired waivers (fail):** {len(result['expired'])}",
        f"- **Malformed waivers (fail):** {len(result['errors'])}",
        f"- **Stale waivers (remove):** {len(result['stale'])}",
        "",
    ]
    vulns = [f for f in result["unwaived"] if f["kind"] == "vulnerability"]
    ages = [f for f in result["unwaived"] if f["kind"] == "age"]
    if vulns:
        lines += ["### Vulnerable", "", "| Package | Severity | Advisories | Fix | Upgrade within |", "|---|---|---|---|---|"]
        for f in sorted(vulns, key=lambda f: (SEVERITY_ORDER.index(f["severity"]) if f["severity"] in SEVERITY_ORDER else 9, f["package"])):
            fix = f["fix"] if isinstance(f["fix"], str) else ("yes" if f["fix"] else "**no fix yet — waiver needed**")
            lines.append(f"| `{f['package']}` | {f['severity']} | {', '.join(f['advisories']) or '(no id)'} | {fix} | {_due(f)} |")
        lines.append("")
    if ages:
        lines += ["### More than 90 days old, newer release available", "", "| Package | Installed | Published | Age (days) | Latest |", "|---|---|---|---|---|"]
        for f in sorted(ages, key=lambda f: -f["age_days"]):
            where = f" ({', '.join(f['where'])})" if f.get("where") else ""
            lines.append(f"| `{f['package']}`{where} | {f['installed']} | {f['published']} | {f['age_days']} | {f['latest']} |")
        lines.append("")
    for title, items in (("Expired waivers", result["expired"]), ("Stale waivers", result["stale"])):
        if items:
            lines += [f"### {title}", ""] + [f"- `{w['package']}` {w['kind']} {w['advisory'] or ''} ({w['jira']}, expires {w['expires']})" for w in items] + [""]
    if result["errors"]:
        lines += ["### Malformed waivers", ""] + [f"- {e}" for e in result["errors"]] + [""]
    if result["waived"]:
        lines += ["### Waived", ""] + [f"- `{w['package']}` {w['kind']} — {w['waived_by']}" for w in result["waived"]] + [""]
    if result.get("notes"):
        lines += ["### Not measured", ""] + [f"- {n}" for n in result["notes"]] + [""]
    return "\n".join(lines)


def _print_findings(items, level):
    for f in items:
        if f["kind"] == "vulnerability":
            fix = f["fix"] if isinstance(f["fix"], str) else ("available" if f["fix"] else "NONE YET (waiver needed)")
            print(f"::{level}::VULNERABLE  {f['package']}  {f['severity']}  {', '.join(f['advisories']) or '(no id)'}  fix: {fix}  (upgrade within {SLA_DAYS.get(f['severity'], 14)} days)")
        else:
            print(f"::{level}::OUTDATED    {f['package']}  {f['installed']} published {f['published']} ({f['age_days']} days)  latest {f['latest']}")


# --------------------------------------------------------------------------
# modes
# --------------------------------------------------------------------------


def _load_inputs(args):
    package_json = _read_json(Path(args.package_json or REPO_ROOT / "package.json"), "package.json")
    lock = _read_json(Path(args.lockfile or REPO_ROOT / "package-lock.json"), "package-lock.json")
    return package_json, lock


def _load_waivers(args, today):
    path = Path(args.waivers or WAIVERS)
    if not path.exists():
        raise MeasureError(f"{path} is missing — refusing to run without it")
    return validate_waivers(_read_json(path, "waiver file"), today)


def run_report(args, today: date) -> int:
    fetch_audit, fetch_doc, fetch_node_index, advisory_ids = _fetchers(args)
    valid, errors, expired = _load_waivers(args, today)
    package_json, lock = _load_inputs(args)

    findings = vulnerability_findings(fetch_audit(), advisory_ids)
    ages, notes = age_findings(direct_dependencies(package_json, lock), fetch_doc, today)
    findings += ages
    wf_dir = Path(args.workflows_dir) if args.workflows_dir else WORKFLOWS
    texts = {p.name: p.read_text(encoding="utf-8") for p in sorted(wf_dir.glob("*.yml"))}
    majors = pinned_node_majors(texts)
    if majors:
        findings += runtime_findings(majors, fetch_node_index(), today)

    unwaived, waived, stale = apply_waivers(findings, valid)
    result = {"unwaived": unwaived, "waived": waived, "stale": stale, "expired": expired, "errors": errors, "notes": notes}

    print(
        f"Dependency freshness (SEC-197) {today.isoformat()}: {len(unwaived)} out of policy, "
        f"{len(waived)} waived, {len(expired)} expired waiver(s), {len(errors)} malformed, {len(stale)} stale."
    )
    _print_findings(unwaived, "warning" if args.report_only else "error")
    for w in stale:
        print(f"::warning::stale waiver — matches nothing: {w['package']} {w['kind']} {w['advisory'] or ''} ({w['jira']})")
    for w in expired:
        print(f"::error::EXPIRED waiver: {w['package']} {w['kind']} {w['advisory'] or ''} ({w['jira']}, expired {w['expires']}) — upgrade, or renew with a fresh reason")
    for e in errors:
        print(f"::error::malformed waiver: {e}")

    if args.markdown:
        Path(args.markdown).write_text(render_markdown(result, today), encoding="utf-8")
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as fh:
            fh.write(f"out_of_policy={len(unwaived)}\nexpired={len(expired)}\nmalformed={len(errors)}\nstale={len(stale)}\n")

    if errors or expired:
        return 1
    if (unwaived or stale) and not args.report_only:
        return 1
    return 0


def run_check_waivers(args, today: date) -> int:
    valid, errors, expired = _load_waivers(args, today)
    for e in errors:
        print(f"::error::malformed waiver: {e}")
    for w in expired:
        print(f"::error::EXPIRED waiver: {w['package']} {w['kind']} ({w['jira']}, expired {w['expires']})")
    if errors or expired:
        return 1
    print(f"Waiver file OK: {len(valid)} active waiver(s).")
    return 0


def run_pr(args, today: date) -> int:
    if args.changed_files:
        changed_files = [l.strip() for l in Path(args.changed_files).read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        if not args.base:
            raise MeasureError("--pr needs --base <ref> (or --changed-files for tests)")
        changed_files = _git("diff", "--name-only", f"{args.base}...HEAD").splitlines()
    triggers = sorted(set(changed_files) & set(PR_TRIGGER_FILES))
    if not triggers:
        print("Dependency freshness (SEC-197): not applicable — this PR changes no dependency or waiver file.")
        return 0
    print(f"Dependency freshness (SEC-197): PR changes {', '.join(triggers)} — checking what it introduces.")

    valid, errors, expired = _load_waivers(args, today)
    failed = False
    for e in errors:
        print(f"::error::malformed waiver: {e}")
        failed = True
    for w in expired:
        print(f"::error::EXPIRED waiver: {w['package']} {w['kind']} ({w['jira']}, expired {w['expires']}) — upgrade, or renew with a fresh reason")
        failed = True

    package_json, lock = _load_inputs(args)
    base_pj = package_json
    if args.base_lockfile:
        base_lock = _read_json(Path(args.base_lockfile), "base package-lock.json")
    elif args.changed_files:
        base_lock = lock  # tests that pass --changed-files without a base lockfile: nothing re-versioned
    else:
        try:
            base_lock = json.loads(_git("show", f"{args.base}:package-lock.json"))
        except MeasureError:
            base_lock = {}  # no lockfile on the base: everything is new
        except json.JSONDecodeError as exc:
            raise MeasureError(f"base package-lock.json is not valid JSON: {exc}") from exc
        if base_lock:
            try:
                base_pj = json.loads(_git("show", f"{args.base}:package.json"))
            except json.JSONDecodeError as exc:
                raise MeasureError(f"base package.json is not valid JSON: {exc}") from exc

    changed = changed_lock_paths(base_lock, lock)
    if not changed:
        print("No lockfile entry was added or re-versioned.")
        return 1 if failed else 0

    fetch_audit, fetch_doc, _node, advisory_ids = _fetchers(args)
    direct = direct_dependencies(package_json, lock)
    head_vulns = vulnerability_findings(fetch_audit(), advisory_ids)
    base_vulns = vulnerability_findings(fetch_audit.base(base_pj, base_lock), advisory_ids) if base_lock.get("packages") else []
    vulns, touched = introduced(head_vulns, direct, changed, base_vulns)
    ages, notes = age_findings(touched, fetch_doc, today)
    ages = age_regressions(ages, touched, base_lock, fetch_doc, today)
    unwaived, waived, _stale = apply_waivers(vulns + ages, valid)
    improved = len([f for f in head_vulns if set(f["nodes"]) & changed]) - len(vulns)
    if improved > 0:
        print(f"  {improved} re-versioned vulnerable package(s) were already vulnerable to the same advisory on the base — not introduced by this PR (the daily report still lists them).")

    print(f"{len(changed)} lockfile entr{'y' if len(changed) == 1 else 'ies'} changed; {len(touched)} direct dependenc{'y' if len(touched) == 1 else 'ies'} changed.")
    for w in waived:
        print(f"  WAIVED  {w['package']} ({w['kind']}) via {w['waived_by']}")
    for n in notes:
        print(f"  note: {n}")
    if unwaived:
        _print_findings(unwaived, "error")
        print()
        print(f"::error::This PR introduces {len(unwaived)} out-of-policy dependency version(s) (docs/DEPENDENCY_POLICY.md).")
        print("Upgrade to a fixed / current release. If none exists or the upgrade is genuinely blocked,")
        print("add a dated entry to security/dependency-freshness-waivers.json (expiry at most 90 days).")
        failed = True
    if failed:
        return 1
    print("Nothing out of policy introduced. ✓")
    return 0


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    failures = []
    cases = [0]

    def check(label, got, want):
        cases[0] += 1
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    today = date(2026, 11, 23)

    def raises(fn):
        try:
            fn()
        except MeasureError:
            return True
        return False

    # --- semver ---------------------------------------------------------------
    check("10.0.0 is newer than 9.9.9 (numeric, not lexical)", is_newer("10.0.0", "9.9.9"), True)
    check("a release is newer than its own prerelease", is_newer("2.0.0", "2.0.0-rc.1"), True)
    check("a prerelease is not stable", is_stable("2.0.0-canary.3"), False)
    check("equal versions are not newer", is_newer("1.2.3", "1.2.3"), False)
    check("an unparseable version raises rather than guessing", raises(lambda: is_newer("latest", "1.0.0")), True)

    # --- age rule -------------------------------------------------------------
    def doc(installed, inst_date, latest, latest_date):
        return {"dist-tags": {"latest": latest}, "time": {installed: inst_date, latest: latest_date}}

    direct = {"pkg": {"version": "1.0.0", "path": "node_modules/pkg", "lookup": "pkg", "registry": True}}
    old_with_newer = lambda _n: doc("1.0.0", "2026-08-01T00:00:00Z", "1.1.0", "2026-11-01T00:00:00Z")
    got, _ = age_findings(direct, old_with_newer, today)
    check("114 days old with a newer release -> out of policy", [f["package"] for f in got], ["pkg"])
    check("...and records the age", got[0]["age_days"] if got else None, 114)

    exactly_90 = lambda _n: doc("1.0.0", (today - timedelta(days=90)).isoformat(), "1.1.0", "2026-11-01")
    check("exactly 90 days old is still in policy (> 90, not >= 90)", age_findings(direct, exactly_90, today)[0], [])
    day_91 = lambda _n: doc("1.0.0", (today - timedelta(days=91)).isoformat(), "1.1.0", "2026-11-01")
    check("91 days old with a newer release is out", len(age_findings(direct, day_91, today)[0]), 1)

    old_is_latest = lambda _n: {"dist-tags": {"latest": "1.0.0"}, "time": {"1.0.0": "2025-01-01"}}
    check("old but still the latest release -> in policy", age_findings(direct, old_is_latest, today)[0], [])
    old_newer_is_pre = lambda _n: doc("1.0.0", "2025-01-01", "2.0.0-beta.1", "2026-11-01")
    check("a newer PRERELEASE does not make a version out of policy", age_findings(direct, old_newer_is_pre, today)[0], [])
    major = lambda _n: doc("1.0.0", "2025-01-01", "5.0.0", "2026-11-01")
    check("majors are included", len(age_findings(direct, major, today)[0]), 1)
    fresh = lambda _n: doc("1.0.0", "2026-11-01", "1.1.0", "2026-11-20")
    check("young, even with a newer release -> in policy", age_findings(direct, fresh, today)[0], [])
    no_time = lambda _n: {"dist-tags": {"latest": "1.1.0"}, "time": {}}
    check("registry doc without the installed version's time raises (no silent pass)", raises(lambda: age_findings(direct, no_time, today)), True)
    nonreg = {"pkg": {**direct["pkg"], "registry": False}}
    got, notes = age_findings(nonreg, lambda _n: (_ for _ in ()).throw(AssertionError("must not fetch")), today)
    check("a non-registry dependency is noted, not fetched", (got, len(notes)), ([], 1))

    # --- direct dependencies from the lockfile --------------------------------
    pj = {"dependencies": {"a": "^1"}, "devDependencies": {"b": "^2"}}
    lock = {"packages": {"": {}, "node_modules/a": {"version": "1.2.0", "resolved": REGISTRY_URL + "a/-/a-1.2.0.tgz"},
                         "node_modules/b": {"version": "2.0.0", "resolved": REGISTRY_URL + "b/-/b-2.0.0.tgz"},
                         "node_modules/a/node_modules/c": {"version": "0.1.0"}}}
    d = direct_dependencies(pj, lock)
    check("direct deps include dependencies AND devDependencies, not transitive", sorted(d), ["a", "b"])
    check("installed version comes from the lockfile", d["a"]["version"], "1.2.0")
    check("a declared dep missing from the lockfile raises", raises(lambda: direct_dependencies({"dependencies": {"zz": "1"}}, lock)), True)

    # --- vulnerabilities ------------------------------------------------------
    gate = _audit_gate()
    audit = {"vulnerabilities": {
        "low-pkg": {"severity": "low", "via": [{"source": 1, "severity": "low", "url": "https://github.com/advisories/GHSA-aaaa-bbbb-cccc"}], "nodes": ["node_modules/low-pkg"], "fixAvailable": True},
        "parent": {"severity": "high", "via": ["child"], "nodes": ["node_modules/parent"], "fixAvailable": True},
        "child": {"severity": "high", "via": [{"source": 2, "severity": "high", "url": "https://github.com/advisories/GHSA-dddd-eeee-ffff"}], "nodes": ["node_modules/child"], "fixAvailable": False},
    }}
    v = vulnerability_findings(audit, gate.advisory_ids)
    check("ANY severity counts — a LOW advisory is a finding", "low-pkg" in [f["package"] for f in v], True)
    check("a package flagged only via a dependency is not double-listed", "parent" in [f["package"] for f in v], False)
    check("the vulnerable dependency itself is listed", "child" in [f["package"] for f in v], True)
    check("advisory ids are extracted", [f["advisories"] for f in v if f["package"] == "child"], [["GHSA-dddd-eeee-ffff"]])

    # --- waivers: shape -------------------------------------------------------
    good = {"package": "child", "kind": "vulnerability", "advisory": "GHSA-dddd-eeee-ffff",
            "reason": "No patched release exists; reachable only from build tooling, not runtime.",
            "jira": "SEC-194", "expires": "2027-01-15", "approved_by": "founder 2026-11-23 standing policy"}
    ok, err, exp = validate_waivers({"waivers": [good]}, today)
    check("a well-formed waiver validates", (len(ok), err, exp), (1, [], []))
    check("expiry more than 90 days out is malformed", len(validate_waivers({"waivers": [{**good, "expires": "2027-02-22"}]}, today)[1]) > 0, True)
    check("expiry exactly 90 days out is allowed", validate_waivers({"waivers": [{**good, "expires": "2027-02-21"}]}, today)[1], [])
    ok, err, exp = validate_waivers({"waivers": [{**good, "expires": "2026-11-22"}]}, today)
    check("a lapsed waiver is EXPIRED, not active", (len(ok), len(exp)), (0, 1))
    check("a waiver expiring today is still active", len(validate_waivers({"waivers": [{**good, "expires": "2026-11-23"}]}, today)[0]), 1)
    check("a vulnerability waiver without a GHSA id is malformed", len(validate_waivers({"waivers": [{**good, "advisory": None}]}, today)[1]) > 0, True)
    check("an age waiver with an advisory is malformed", len(validate_waivers({"waivers": [{**good, "kind": "age"}]}, today)[1]) > 0, True)
    check("a thin reason is malformed", len(validate_waivers({"waivers": [{**good, "reason": "temporary"}]}, today)[1]) > 0, True)
    check("a missing field is malformed", len(validate_waivers({"waivers": [{k: x for k, x in good.items() if k != "jira"}]}, today)[1]) > 0, True)
    check("an unknown field is malformed (the shape is fixed)", len(validate_waivers({"waivers": [{**good, "owner": "x"}]}, today)[1]) > 0, True)
    check("a duplicate waiver is malformed", len(validate_waivers({"waivers": [good, good]}, today)[1]) > 0, True)
    check("a file with no waivers array is malformed", len(validate_waivers({}, today)[1]), 1)
    check("an unhashable advisory is malformed, not a crash", len(validate_waivers({"waivers": [{**good, "advisory": ["GHSA-dddd-eeee-ffff"]}]}, today)[1]) > 0, True)
    check("any Jira project key is accepted", validate_waivers({"waivers": [{**good, "jira": "OPS2-7"}]}, today)[1], [])
    check("a non-key jira is malformed", len(validate_waivers({"waivers": [{**good, "jira": "sec 197"}]}, today)[1]) > 0, True)
    check("an empty list is valid", validate_waivers({"waivers": []}, today), ([], [], []))

    # --- waivers: matching ----------------------------------------------------
    un, wv, st = apply_waivers(v, [good])
    check("a matching vulnerability waiver clears that finding", "child" in [f["package"] for f in un], False)
    check("...and nothing else", [f["package"] for f in un], ["low-pkg"])
    check("...and is not stale", st, [])
    other_pkg = {**good, "package": "low-pkg"}
    un, _, st = apply_waivers(v, [other_pkg])
    check("a waiver does not transfer to another package's advisory", "child" in [f["package"] for f in un], True)
    check("...and a waiver matching nothing is STALE", len(st), 1)
    age_f = [{"package": "pkg", "kind": "age", "installed": "1", "published": "x", "age_days": 200, "latest": "2"}]
    age_w = {**good, "package": "pkg", "kind": "age", "advisory": None}
    check("an age waiver clears an age finding", apply_waivers(age_f, [age_w])[0], [])
    check("a vulnerability waiver does NOT clear an age finding", len(apply_waivers(age_f, [good])[0]), 1)
    child_f = [f for f in v if f["package"] == "child"][0]
    two = [{**child_f, "advisories": ["GHSA-dddd-eeee-ffff", "GHSA-gggg-hhhh-jjjj"]}]
    un, _, _ = apply_waivers(two, [good])
    check("a finding with two advisories needs both waived", [f["advisories"] for f in un], [["GHSA-gggg-hhhh-jjjj"]])

    # --- PR scope: only what the PR introduces --------------------------------
    base = {"packages": {"": {"version": "0.1.0"}, "node_modules/child": {"version": "1.0.0"}, "node_modules/a": {"version": "1.0.0"}}}
    head = {"packages": {"": {"version": "0.1.1"}, "node_modules/child": {"version": "1.0.0"}, "node_modules/a": {"version": "1.1.0"}, "node_modules/new": {"version": "0.0.1"}}}
    ch = changed_lock_paths(base, head)
    check("re-versioned and new entries are 'changed'; the root and untouched are not", sorted(ch), ["node_modules/a", "node_modules/new"])
    check("no base lockfile means everything is new", len(changed_lock_paths(None, head)), 3)
    iv, it = introduced(v, {"a": {"path": "node_modules/a"}, "child": {"path": "node_modules/child"}}, ch)
    check("an UNTOUCHED vulnerable package does not block the PR", [f["package"] for f in iv], [])
    check("only direct deps the PR changed are age-checked", sorted(it), ["a"])
    iv, _ = introduced(v, {}, {"node_modules/child"})
    check("a PR that re-versions a vulnerable package is caught", [f["package"] for f in iv], ["child"])
    iv, _ = introduced(v, {}, {"node_modules/child"}, v)
    check("re-versioning a package already vulnerable to the SAME advisory on base is not introduced", iv, [])
    child_two = [{**child_f, "advisories": ["GHSA-dddd-eeee-ffff", "GHSA-gggg-hhhh-jjjj"]}]
    iv, _ = introduced(child_two, {}, {"node_modules/child"}, v)
    check("...but a NEW advisory on that re-versioned package is", [f["advisories"] for f in iv], [["GHSA-gggg-hhhh-jjjj"]])

    # --- PR scope: age judged against the base version ------------------------
    adoc = lambda _n: {"dist-tags": {"latest": "10.0.0"}, "time": {"9.0.3": "2026-03-06", "9.0.2": "2026-02-01", "9.0.4": "2026-08-01", "10.0.0": "2026-11-01"}}
    t_info = {"eslint": {"version": "9.0.3", "path": "node_modules/eslint", "lookup": "eslint", "registry": True}}
    head_age, _ = age_findings(t_info, adoc, today)
    blk = lambda bv: age_regressions(head_age, t_info, {"packages": {"node_modules/eslint": {"version": bv}}}, adoc, today)
    check("an out-of-policy bump from an OLDER out-of-policy version is an improvement, not a regression", blk("9.0.2"), [])
    check("a downgrade that stays out of policy IS a regression", [f.get("downgrade_from") for f in blk("9.0.4")], ["9.0.4"])
    check("a new direct dependency already out of policy is a regression", len(age_regressions(head_age, t_info, {"packages": {}}, adoc, today)), 1)
    young = lambda _n: {**adoc(_n), "time": {**adoc(_n)["time"], "9.0.2": "2026-11-01"}}
    check("moving from an in-policy version to an out-of-policy one is a regression",
          len(age_regressions(head_age, t_info, {"packages": {"node_modules/eslint": {"version": "9.0.2"}}}, young, today)), 1)

    # --- runtime --------------------------------------------------------------
    texts = {"a.yml": "      - uses: x\n        with:\n          node-version: '20'\n", "b.yml": "node-version: 22\n# node-version: '18'\n"}
    check("node-version pins are read; a commented one is not", pinned_node_majors(texts), {20: ["a.yml"], 22: ["b.yml"]})
    index = [
        {"version": "v24.5.0", "date": "2026-11-10", "lts": "Krypton"},
        {"version": "v22.9.0", "date": "2026-11-11", "lts": "Jod"},
        {"version": "v20.20.2", "date": "2026-03-24", "lts": "Iron"},
        {"version": "v25.9.0", "date": "2026-03-31", "lts": False},
    ]
    rt = runtime_findings({20: ["a.yml"], 22: ["b.yml"]}, index, today)
    check("a runtime line with no release in >90 days, newer LTS available -> out", [f["installed"].split()[0] for f in rt], ["20.x"])
    check("a maintained older LTS line stays in policy", any(f["installed"].startswith("22") for f in rt), False)
    check("a pinned major missing from the index raises", raises(lambda: runtime_findings({19: ["x"]}, index, today)), True)

    # --- network seam: bounded retry, then FAIL, never clean -------------------
    class Resp:
        def __init__(self, body): self.body = body
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return self.body

    calls = []

    def flaky(url):
        calls.append(url)
        if len(calls) < 3:
            raise urllib.error.URLError("temporary")
        return Resp(b'{"ok": true}')

    check("a transient network error is retried and then succeeds", http_get_json("u", sleep=lambda s: None, opener=flaky), {"ok": True})
    check("...on exactly the 3rd attempt", len(calls), 3)
    calls.clear()

    def always_down(url):
        calls.append(url)
        raise urllib.error.URLError("down")

    check("exhausted retries raise, never return clean", raises(lambda: http_get_json("u", sleep=lambda s: None, opener=always_down)), True)
    check("...after exactly HTTP_ATTEMPTS tries", len(calls), HTTP_ATTEMPTS)
    calls.clear()

    def not_found(url):
        calls.append(url)
        raise urllib.error.HTTPError(url, 404, "nf", {}, None)

    check("a 404 is not retried", (raises(lambda: http_get_json("u", sleep=lambda s: None, opener=not_found)), len(calls)), (True, 1))
    check("backoff table matches attempt count", len(HTTP_BACKOFF_S), HTTP_ATTEMPTS - 1)

    # The verdict comes LAST, after every check() above (catalogue failure mode 9).
    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({cases[0]} cases).")
    return 0


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="SEC-197 / CTL-081 — dependency freshness")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--report", action="store_true", help="measure the whole tree (daily)")
    mode.add_argument("--pr", action="store_true", help="block a PR that introduces an out-of-policy version")
    mode.add_argument("--check-waivers", action="store_true", help="validate the waiver file only (offline)")
    mode.add_argument("--self-test", action="store_true")
    ap.add_argument("--report-only", action="store_true", help="--report: do not fail on findings or stale waivers")
    ap.add_argument("--base", help="--pr: the base ref to diff against, e.g. origin/develop")
    ap.add_argument("--markdown", help="--report: write the tracking-issue body here")
    ap.add_argument("--github-output", help="--report: append key=value counts here")
    for flag in ("--package-json", "--lockfile", "--base-lockfile", "--changed-files", "--audit-json", "--base-audit-json",
                 "--registry-dir", "--node-index-json", "--workflows-dir", "--waivers", "--today"):
        ap.add_argument(flag, help="fixture override (tests)")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    try:
        today = datetime.strptime(args.today, "%Y-%m-%d").date() if args.today else date.today()
    except ValueError:
        print(f"::error::--today must be YYYY-MM-DD, got {args.today!r}")
        return 2
    try:
        if args.check_waivers:
            return run_check_waivers(args, today)
        if args.pr:
            return run_pr(args, today)
        return run_report(args, today)
    except MeasureError as exc:
        print(f"::error::check-dependency-freshness: {exc}")
        print("::error::  Failing closed (exit 2): a measurement that did not happen is not a clean result.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
