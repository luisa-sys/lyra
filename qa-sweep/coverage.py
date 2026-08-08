#!/usr/bin/env python3
"""KAN-467 Phase 2 — the coverage ledger. One row per inventoried item.

WHY THIS EXISTS
---------------
"We have 250 test suites and 2978 passing tests" is a statement about effort,
not about coverage. It says nothing about WHICH surfaces are tested, and this
repo has already learned the hard way what hides in that gap: nine vacuous
suites found in a single day, one of them satisfied by a code comment
(CTL-039), two more that reimplemented their subject and tested the copy
(BUGS-85, SEC-113). Every one of those reported green.

So this file does not count tests. It joins the Phase 1 inventory — the
denominator — against what tests demonstrably touch, and emits a row per item
saying covered / uncovered / denylisted / inventory-only. A row that cannot be
shown to be covered is uncovered. That is the whole discipline.

THE JOIN IS DELIBERATELY STRICT
-------------------------------
The tempting join is "a test file imports actions.ts, therefore all 40 actions
in it are covered". That single inference would mark most of the estate green
while proving nothing, and it is precisely the reasoning that produced the
vacuous suites. So:

  * A ROUTE is covered only if a Playwright spec actually navigates to it.
  * An ACTION is covered only if some test references its FILE *and* names the
    action itself. Importing the module is recorded as `file_touched_only` — a
    real signal, kept visible, that does NOT count as coverage.
  * An ELEMENT or FIELD is covered only if a spec visits its route *and*
    mentions its identifier. Rendering a page does not test its buttons.

Every one of these can be argued as too strict. None of them can be argued as
flattering, and only one of those two failure modes gets caught later.

DYNAMIC ROUTES
--------------
`/[slug]` would otherwise swallow every visited path and report the public
surface as fully covered. So an exact route match always wins; a dynamic route
only claims a visited path that no static route matched.

WHAT COUNTS AS A TEST SIGNAL
----------------------------
  e2e     `page.goto('/x')`, template literals (`/x?cb=${…}` -> `/x`), and the
          `path: '/x'` table entries the axe suite drives its loop from.
  unit    import specifiers (`@/app/...` and relative), `jest.mock(...)`, raw
          `src/...` literals, and `SRC.<key>` lookups resolved through
          tests/support/source-paths.json — the manifest exists precisely so
          tests stop hardcoding paths, so a join that ignored it would
          under-count the better-written tests.
  jest    coverage/coverage-final.json when present. Reported per file; never
          used to flip a row to covered, because statement coverage of a module
          says nothing about which exported action was exercised.

FAIL-CLOSED
-----------
Exit 2 if the inventory cannot be built, or if the test tree is missing
entirely. Zero discovered specs against a non-empty inventory is reported
loudly rather than rendered as an honest-looking 0%.

USAGE
    python3 qa-sweep/coverage.py                 # writes qa-sweep/qa-coverage.json
    python3 qa-sweep/coverage.py --summary       # readable summary only
    python3 qa-sweep/coverage.py --self-test     # fixtures
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Optional, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import inventory as inv_mod
except Exception as exc:  # noqa: BLE001
    sys.stderr.write("::error::qa-sweep/inventory.py could not be imported: {0}\n".format(exc))
    sys.exit(2)

REPO = inv_mod.REPO
E2E_DIR = os.path.join(REPO, "tests", "e2e")
TESTS_DIR = os.path.join(REPO, "tests")
MANIFEST = os.path.join(REPO, "tests", "support", "source-paths.json")
JEST_COVERAGE = os.path.join(REPO, "coverage", "coverage-final.json")
OUT_PATH = os.path.join(REPO, "qa-sweep", "qa-coverage.json")

TEST_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")


# --------------------------------------------------------------------------
# Test-signal extraction
# --------------------------------------------------------------------------

GOTO_RE = re.compile(r"\.goto\(\s*[`'\"]([^`'\"]+)[`'\"]")
PATH_ENTRY_RE = re.compile(r"\bpath\s*:\s*'([^']+)'")


def routes_visited(spec_text):
    # type: (str) -> Set[str]
    """Route paths a Playwright spec navigates to.

    Template literals are truncated at the first `${` or `?`, so
    `` `/dashboard?cb=${Date.now()}` `` yields `/dashboard` rather than being
    discarded — the authed journey drives almost every visit that way, and
    dropping them would under-count the one suite that exercises the dashboard.
    """
    clean = inv_mod.strip_comments(spec_text)
    out = set()  # type: Set[str]
    for raw in list(GOTO_RE.findall(clean)) + list(PATH_ENTRY_RE.findall(clean)):
        p = raw.split("${")[0].split("?")[0].split("#")[0].strip()
        if not p.startswith("/"):
            continue
        if len(p) > 1:
            p = p.rstrip("/")
        out.add(p or "/")
    return out


IMPORT_RE = re.compile(r"""(?:from|require\(|jest\.mock\(|import\()\s*['"]([^'"]+)['"]""")
RAW_PATH_RE = re.compile(r"""['"](src/[A-Za-z0-9_./\[\]()@-]+)['"]""")
SRC_KEY_RE = re.compile(r"\bSRC\.([A-Za-z0-9_$]+)")


def load_manifest():
    # type: () -> Dict[str, str]
    """tests/support/source-paths.json -> {symbolicName: repoPath}."""
    try:
        with open(MANIFEST, "r") as fh:
            return json.load(fh).get("SRC", {})
    except (IOError, OSError, ValueError):
        return {}


def modules_referenced(test_text, test_rel, manifest):
    # type: (str, str, Dict[str, str]) -> Set[str]
    """Repo-relative source files a test file demonstrably references."""
    clean = inv_mod.strip_comments(test_text)
    out = set()  # type: Set[str]

    for spec in IMPORT_RE.findall(clean):
        if spec.startswith("@/"):
            out.add("src/" + spec[2:])
        elif spec.startswith("."):
            base = os.path.dirname(os.path.join(REPO, test_rel))
            resolved = os.path.normpath(os.path.join(base, spec))
            rel = os.path.relpath(resolved, REPO).replace(os.sep, "/")
            if rel.startswith("src/"):
                out.add(rel)

    for raw in RAW_PATH_RE.findall(clean):
        out.add(raw)

    for key in SRC_KEY_RE.findall(clean):
        path = manifest.get(key)
        if path and path.startswith("src/"):
            out.add(path)

    # Import specifiers carry no extension; the inventory keys on real files.
    expanded = set()  # type: Set[str]
    for m in out:
        expanded.add(m)
        if not m.endswith((".ts", ".tsx")):
            expanded.add(m + ".ts")
            expanded.add(m + ".tsx")
            expanded.add(m + "/index.ts")
    return expanded


def walk_tests(root):
    # type: (str) -> List[str]
    out = []  # type: List[str]
    if not os.path.isdir(root):
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in sorted(filenames):
            if fn.endswith(TEST_EXTS):
                out.append(os.path.relpath(os.path.join(dirpath, fn), REPO).replace(os.sep, "/"))
    return out


def collect_signals():
    # type: () -> Dict[str, object]
    """Everything the test estate demonstrably touches."""
    manifest = load_manifest()

    specs = {}  # type: Dict[str, Dict[str, object]]
    for rel in walk_tests(E2E_DIR):
        if not rel.endswith(".spec.ts"):
            continue
        text = inv_mod.read(os.path.join(REPO, rel)) or ""
        specs[rel] = {"routes": sorted(routes_visited(text)), "text": text}

    unit = {}  # type: Dict[str, Dict[str, object]]
    for sub in ("unit", "scripts", "integration"):
        for rel in walk_tests(os.path.join(TESTS_DIR, sub)):
            text = inv_mod.read(os.path.join(REPO, rel)) or ""
            unit[rel] = {"modules": modules_referenced(text, rel, manifest), "text": text}

    jest_cov = {}  # type: Dict[str, float]
    if os.path.isfile(JEST_COVERAGE):
        try:
            with open(JEST_COVERAGE, "r") as fh:
                raw = json.load(fh)
            for abs_path, entry in raw.items():
                rel = os.path.relpath(abs_path, REPO).replace(os.sep, "/")
                stmts = entry.get("s", {})
                total = len(stmts)
                hit = len([1 for v in stmts.values() if v])
                jest_cov[rel] = round(100.0 * hit / total, 1) if total else 0.0
        except (IOError, OSError, ValueError):
            jest_cov = {}

    return {
        "specs": specs,
        "unit": unit,
        "jest_coverage": jest_cov,
        "jest_coverage_present": os.path.isfile(JEST_COVERAGE),
        "manifest_entries": len(manifest),
    }


# --------------------------------------------------------------------------
# Route matching
# --------------------------------------------------------------------------


def _is_dynamic(route_path):
    # type: (str) -> bool
    return "[" in route_path


def _dynamic_matches(route_path, visited):
    # type: (str, str) -> bool
    rp = [s for s in route_path.split("/") if s]
    vp = [s for s in visited.split("/") if s]
    if len(rp) != len(vp):
        return False
    for a, b in zip(rp, vp):
        if a.startswith("[") and a.endswith("]"):
            continue
        if a != b:
            return False
    return True


def match_routes(route_paths, visited_paths):
    # type: (List[str], Set[str]) -> Dict[str, Set[str]]
    """Map route -> the visited paths that reach it.

    Exact wins. A dynamic route only claims a visited path that NO static route
    matched, so `/[slug]` cannot quietly absorb `/search` and report the entire
    public surface as covered.
    """
    static = set(p for p in route_paths if not _is_dynamic(p))
    hits = {}  # type: Dict[str, Set[str]]
    for visited in visited_paths:
        if visited in static:
            hits.setdefault(visited, set()).add(visited)
            continue
        for rp in route_paths:
            if _is_dynamic(rp) and _dynamic_matches(rp, visited):
                hits.setdefault(rp, set()).add(visited)
    return hits


def _word_in(name, text):
    # type: (str, str) -> bool
    return re.search(r"\b" + re.escape(name) + r"\b", text) is not None


# --------------------------------------------------------------------------
# The ledger
# --------------------------------------------------------------------------


def state_for(scope, covered):
    # type: (str, bool) -> str
    """Scope wins over coverage. A denylisted action is never 'uncovered' —
    it is out of the exerciser's remit by policy, and conflating the two would
    make the gap list read as work nobody intends to do."""
    if scope == "denylisted":
        return "denylisted"
    if scope == "inventory-only":
        return "inventory-only"
    return "covered" if covered else "uncovered"


def build_ledger(inv, signals):
    # type: (Dict[str, object], Dict[str, object]) -> Dict[str, object]
    specs = signals["specs"]
    unit = signals["unit"]
    jest_cov = signals["jest_coverage"]

    all_visited = set()  # type: Set[str]
    for s in specs.values():
        all_visited.update(s["routes"])

    route_paths = sorted(set(r["path"] for r in inv["routes"]))
    hits = match_routes(route_paths, all_visited)

    spec_for_route = {}  # type: Dict[str, List[str]]
    for rel, s in specs.items():
        for visited in s["routes"]:
            for rp, matched in hits.items():
                if visited in matched:
                    spec_for_route.setdefault(rp, []).append(rel)

    rows = []  # type: List[Dict[str, object]]

    # --- routes ------------------------------------------------------------
    for r in inv["routes"]:
        covering = sorted(set(spec_for_route.get(r["path"], [])))
        rows.append(
            {
                "kind": "route",
                "id": "{0} [{1}]".format(r["path"], r["kind"]),
                "path": r["path"],
                "file": r["file"],
                "surface": r["surface"],
                "auth": r["auth"],
                "scope": r["scope"],
                "state": state_for(r["scope"], bool(covering)),
                "covered_by": covering,
                "jest_coverage_pct": jest_cov.get(r["file"]),
                "confidence": r["confidence"],
            }
        )

    # --- actions -----------------------------------------------------------
    for a in inv["actions"]:
        touching = [rel for rel, u in unit.items() if a["file"] in u["modules"]]
        naming = [rel for rel in touching if _word_in(a["name"], unit[rel]["text"])]
        # Deliberately: referencing the file is NOT coverage of the action.
        rows.append(
            {
                "kind": "action",
                "id": "{0}::{1}".format(a["file"], a["name"]),
                "path": a["route"],
                "file": a["file"],
                "surface": a["surface"],
                "auth": None,
                "scope": a["scope"],
                "state": state_for(a["scope"], bool(naming)),
                "covered_by": sorted(naming),
                "file_touched_only": sorted(set(touching) - set(naming)),
                "jest_coverage_pct": jest_cov.get(a["file"]),
                "confidence": a["confidence"],
                # Carried through so the ledger distinguishes an exported action
                # from one declared inline in a page.tsx. The inline ones were
                # missing from the denominator entirely until 2026-08-04, and a
                # reader should be able to see which rows are of that shape.
                "declaration": a.get("declaration", "exported"),
                "anonymous": bool(a.get("anonymous", False)),
            }
        )

    # --- elements + fields --------------------------------------------------
    for group, key in (("element", "elements"), ("field", "fields")):
        for it in inv[key]:
            route = it.get("route")
            covering_specs = spec_for_route.get(route, []) if route else []
            ident = it.get("identifier") if group == "element" else it.get("name")
            named_by = []
            if ident:
                for rel in set(covering_specs):
                    if _word_in(str(ident), specs[rel]["text"]):
                        named_by.append(rel)
            rows.append(
                {
                    "kind": group,
                    "id": "{0}#{1}:{2}".format(
                        it["file"], it["index"], ident or "<unidentified>"
                    ),
                    "path": route,
                    "file": it["file"],
                    "surface": it["surface"],
                    "auth": it["auth"],
                    "scope": it["scope"],
                    "state": state_for(it["scope"], bool(named_by)),
                    "covered_by": sorted(named_by),
                    "route_visited_only": sorted(set(covering_specs) - set(named_by)),
                    "jest_coverage_pct": None,
                    "confidence": it["confidence"],
                    "tag": it.get("tag"),
                }
            )

    return {
        "_comment": (
            "KAN-467 Phase 2 coverage ledger. A row is 'covered' only where a "
            "test demonstrably exercises THAT item — importing an action's "
            "module, or rendering an element's page, is recorded separately "
            "(file_touched_only / route_visited_only) and does NOT count."
        ),
        "ticket": "KAN-467",
        "signals": {
            "e2e_specs": len(specs),
            "unit_test_files": len(unit),
            "routes_visited_by_e2e": sorted(all_visited),
            "manifest_entries": signals["manifest_entries"],
            "jest_coverage_present": signals["jest_coverage_present"],
        },
        "rows": rows,
        "totals": totals(rows),
    }


def totals(rows):
    # type: (List[Dict[str, object]]) -> Dict[str, object]
    def bucket(pred):
        out = {}  # type: Dict[str, Dict[str, int]]
        for r in rows:
            if not pred(r):
                continue
            k = str(r["surface"])
            out.setdefault(k, {"covered": 0, "uncovered": 0, "denylisted": 0, "inventory-only": 0})
            out[k][str(r["state"])] += 1
        return out

    by_state = {}  # type: Dict[str, int]
    for r in rows:
        by_state[str(r["state"])] = by_state.get(str(r["state"]), 0) + 1

    per_kind = {}  # type: Dict[str, Dict[str, object]]
    for kind in ("route", "action", "element", "field"):
        subset = [r for r in rows if r["kind"] == kind]
        states = {}  # type: Dict[str, int]
        for r in subset:
            states[str(r["state"])] = states.get(str(r["state"]), 0) + 1
        exercisable = [r for r in subset if r["state"] in ("covered", "uncovered")]
        covered = len([r for r in exercisable if r["state"] == "covered"])
        per_kind[kind] = {
            "total": len(subset),
            "by_state": dict(sorted(states.items())),
            "exercisable": len(exercisable),
            "covered": covered,
            "coverage_pct": round(100.0 * covered / len(exercisable), 1) if exercisable else None,
        }

    return {
        "rows": len(rows),
        "by_state": dict(sorted(by_state.items())),
        "by_kind": per_kind,
        "by_surface": bucket(lambda r: True),
        "routes_by_surface": bucket(lambda r: r["kind"] == "route"),
        "actions_by_surface": bucket(lambda r: r["kind"] == "action"),
    }


def print_summary(ledger, stream=sys.stdout):
    # type: (Dict[str, object], object) -> None
    t = ledger["totals"]
    s = ledger["signals"]
    stream.write("KAN-467 Phase 2 — coverage ledger\n")
    stream.write("=" * 66 + "\n")
    stream.write(
        "signals: {0} e2e spec(s), {1} unit/script test file(s), "
        "{2} manifest entries, jest report {3}\n".format(
            s["e2e_specs"],
            s["unit_test_files"],
            s["manifest_entries"],
            "present" if s["jest_coverage_present"] else "ABSENT",
        )
    )
    stream.write("routes visited by e2e: {0}\n".format(", ".join(s["routes_visited_by_e2e"])))
    stream.write("\nOVERALL  {0} rows -> {1}\n".format(t["rows"], t["by_state"]))

    stream.write("\nBY KIND (coverage % is of EXERCISABLE items only)\n")
    stream.write("  {0:<9} {1:>6} {2:>9} {3:>9} {4:>9}\n".format(
        "kind", "total", "exercis.", "covered", "cov %"))
    for kind, v in t["by_kind"].items():
        stream.write("  {0:<9} {1:>6} {2:>9} {3:>9} {4:>8}%\n".format(
            kind, v["total"], v["exercisable"], v["covered"],
            v["coverage_pct"] if v["coverage_pct"] is not None else "n/a"))

    stream.write("\nBY SURFACE (all item kinds)\n")
    for surface, v in sorted(t["by_surface"].items()):
        exercisable = v["covered"] + v["uncovered"]
        pct = round(100.0 * v["covered"] / exercisable, 1) if exercisable else None
        stream.write(
            "  {0:<10} covered {1:>4}  uncovered {2:>4}  denylisted {3:>3}  "
            "inventory-only {4:>3}   -> {5}\n".format(
                surface, v["covered"], v["uncovered"], v["denylisted"],
                v["inventory-only"], "{0}%".format(pct) if pct is not None else "n/a")
        )

    _print_gaps(ledger, stream)


def _print_gaps(ledger, stream):
    # type: (Dict[str, object], object) -> None
    """Name the biggest gaps. A summary that reports only percentages lets the
    reader choose a comfortable interpretation; naming the surfaces does not."""
    rows = ledger["rows"]
    stream.write("\nBIGGEST GAPS\n")

    uncovered_routes = [r for r in rows if r["kind"] == "route" and r["state"] == "uncovered"]
    by_surface = {}  # type: Dict[str, List[str]]
    for r in uncovered_routes:
        by_surface.setdefault(str(r["surface"]), []).append(str(r["path"]))

    for surface in ("api", "public", "dashboard", "admin"):
        paths = sorted(set(by_surface.get(surface, [])))
        if not paths:
            continue
        stream.write(
            "  {0}: {1} uncovered route(s) — {2}{3}\n".format(
                surface, len(paths), ", ".join(paths[:6]),
                ", …" if len(paths) > 6 else "")
        )

    uncovered_actions = [r for r in rows if r["kind"] == "action" and r["state"] == "uncovered"]
    touched_only = [r for r in uncovered_actions if r.get("file_touched_only")]
    stream.write(
        "  actions: {0} uncovered of {1} exercisable; {2} have their MODULE "
        "imported by a test but are never named in it\n".format(
            len(uncovered_actions),
            ledger["totals"]["by_kind"]["action"]["exercisable"],
            len(touched_only),
        )
    )

    inv_only = [r for r in rows if r["state"] == "inventory-only"]
    denied = [r for r in rows if r["state"] == "denylisted"]
    stream.write(
        "  excluded by policy: {0} inventory-only (/admin), {1} denylisted "
        "(destructive) — counted, never exercised\n".format(len(inv_only), len(denied))
    )

    lowconf = [r for r in rows if r["confidence"] == "low-confidence"]
    stream.write(
        "  parse confidence: {0} of {1} rows are low-confidence — they stay in "
        "the denominator, so the percentages above are the pessimistic read\n".format(
            len(lowconf), len(rows))
    )


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------


def self_test():
    # type: () -> int
    checks = []  # type: List[Tuple[str, bool, str]]

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    spec = """
    // await page.goto('/never-visited-because-commented');
    test('a', async ({ page }) => { await page.goto('/login'); });
    test('b', async ({ page }) => { await page.goto(`/dashboard?cb=${Date.now()}`); });
    const PAGES = [{ name: 'terms', path: '/terms' }];
    """
    visited = routes_visited(spec)
    check("plain goto captured", "/login" in visited, str(visited))
    check("template literal truncated at ${", "/dashboard" in visited, str(visited))
    check("`path:` table entry captured", "/terms" in visited, str(visited))
    check("commented-out goto ignored", "/never-visited-because-commented" not in visited)

    # Dynamic-route containment: this is the check that stops /[slug] from
    # reporting the whole public surface as covered.
    routes = ["/", "/search", "/[slug]", "/admin/users/[slug]"]
    hits = match_routes(routes, {"/search", "/some-person", "/admin/users/abc"})
    check("exact route match wins", "/search" in hits, str(hits))
    check(
        "a static path is NOT claimed by the dynamic route",
        "/search" not in hits.get("/[slug]", set()),
        str(hits),
    )
    check("dynamic route claims an unmatched path", "/some-person" in hits.get("/[slug]", set()))
    check("nested dynamic route matches", "/admin/users/[slug]" in hits, str(hits))
    check(
        "a dynamic route does not match a different depth",
        "/admin/users/abc" not in hits.get("/[slug]", set()),
        str(hits),
    )

    # State precedence
    check("denylisted beats covered", state_for("denylisted", True) == "denylisted")
    check("denylisted beats uncovered", state_for("denylisted", False) == "denylisted")
    check("inventory-only beats covered", state_for("inventory-only", True) == "inventory-only")
    check("exercisable + covered", state_for("exercisable", True) == "covered")
    check("exercisable + uncovered", state_for("exercisable", False) == "uncovered")

    # Module reference extraction
    manifest = {"someAction": "src/app/x/actions.ts"}
    refs = modules_referenced(
        "import { a } from '@/app/x/actions';\nconst p = SRC.someAction;\n"
        "readFileSync('src/lib/y.ts');",
        "tests/unit/z.test.ts",
        manifest,
    )
    check("alias import resolved", "src/app/x/actions.ts" in refs, str(sorted(refs)))
    check("SRC manifest key resolved", "src/app/x/actions.ts" in refs)
    check("raw src literal captured", "src/lib/y.ts" in refs, str(sorted(refs)))

    # THE central anti-flattery property: importing a module is not coverage
    # of the actions inside it.
    fake_inv = {
        "routes": [],
        "actions": [
            {
                "type": "action", "name": "namedAction", "file": "src/app/x/actions.ts",
                "route": "/x", "glob": "actions.ts", "scope": "exercisable",
                "scope_reason": None, "surface": "public", "confidence": "high",
            },
            {
                "type": "action", "name": "unnamedAction", "file": "src/app/x/actions.ts",
                "route": "/x", "glob": "actions.ts", "scope": "exercisable",
                "scope_reason": None, "surface": "public", "confidence": "high",
            },
        ],
        "elements": [],
        "fields": [],
    }
    fake_signals = {
        "specs": {},
        "unit": {
            "tests/unit/z.test.ts": {
                "modules": set(["src/app/x/actions.ts"]),
                "text": "import { namedAction } from '@/app/x/actions'; namedAction();",
            }
        },
        "jest_coverage": {},
        "jest_coverage_present": False,
        "manifest_entries": 0,
    }
    ledger = build_ledger(fake_inv, fake_signals)
    by_id = dict((r["id"], r) for r in ledger["rows"])
    named = by_id["src/app/x/actions.ts::namedAction"]
    unnamed = by_id["src/app/x/actions.ts::unnamedAction"]
    check("an action named by a test is covered", named["state"] == "covered", str(named))
    check(
        "an action whose module is imported but is never named is UNCOVERED",
        unnamed["state"] == "uncovered",
        str(unnamed),
    )
    check(
        "the weaker signal is preserved, not discarded",
        unnamed["file_touched_only"] == ["tests/unit/z.test.ts"],
        str(unnamed),
    )

    # An element on a rendered page is not automatically covered.
    fake_inv2 = {
        "routes": [
            {"path": "/x", "kind": "page", "auth": "public", "file": "src/app/x/page.tsx",
             "scope": "exercisable", "scope_reason": None, "surface": "public",
             "confidence": "high", "type": "route"},
        ],
        "actions": [],
        "elements": [
            {"type": "element", "tag": "button", "identifier": "save-btn",
             "identifier_source": "data-testid", "text": "Save", "file": "src/app/x/page.tsx",
             "route": "/x", "attributed_via": "same-directory", "auth": "public",
             "scope": "exercisable", "scope_reason": None, "surface": "public",
             "confidence": "high", "note": None, "index": 0},
            {"type": "element", "tag": "button", "identifier": "never-mentioned",
             "identifier_source": "data-testid", "text": None, "file": "src/app/x/page.tsx",
             "route": "/x", "attributed_via": "same-directory", "auth": "public",
             "scope": "exercisable", "scope_reason": None, "surface": "public",
             "confidence": "high", "note": None, "index": 1},
        ],
        "fields": [],
    }
    fake_signals2 = {
        "specs": {
            "tests/e2e/x.spec.ts": {
                "routes": ["/x"],
                "text": "await page.goto('/x'); await page.click('[data-testid=save-btn]');",
            }
        },
        "unit": {}, "jest_coverage": {}, "jest_coverage_present": False, "manifest_entries": 0,
    }
    ledger2 = build_ledger(fake_inv2, fake_signals2)
    by_id2 = dict((r["id"], r) for r in ledger2["rows"])
    check(
        "a route visited by a spec is covered",
        by_id2["/x [page]"]["state"] == "covered",
        str(by_id2["/x [page]"]),
    )
    el_cov = by_id2["src/app/x/page.tsx#0:save-btn"]
    el_unc = by_id2["src/app/x/page.tsx#1:never-mentioned"]
    check("an element named by the spec is covered", el_cov["state"] == "covered", str(el_cov))
    check(
        "an element on a VISITED page that the spec never names is UNCOVERED",
        el_unc["state"] == "uncovered",
        str(el_unc),
    )
    check(
        "the route-visited signal is preserved",
        el_unc["route_visited_only"] == ["tests/e2e/x.spec.ts"],
        str(el_unc),
    )

    # Admin stays inventory-only even if something visits it.
    fake_inv3 = {
        "routes": [
            {"path": "/admin/users", "kind": "page", "auth": "admin",
             "file": "src/app/admin/users/page.tsx", "scope": "inventory-only",
             "scope_reason": "founder decision", "surface": "admin",
             "confidence": "high", "type": "route"},
        ],
        "actions": [], "elements": [], "fields": [],
    }
    fake_signals3 = {
        "specs": {"tests/e2e/a.spec.ts": {"routes": ["/admin/users"], "text": "goto('/admin/users')"}},
        "unit": {}, "jest_coverage": {}, "jest_coverage_present": False, "manifest_entries": 0,
    }
    ledger3 = build_ledger(fake_inv3, fake_signals3)
    check(
        "an admin route stays inventory-only even when visited",
        ledger3["rows"][0]["state"] == "inventory-only",
        str(ledger3["rows"][0]),
    )

    # Totals must not count policy-excluded rows in the coverage percentage.
    t3 = ledger3["totals"]["by_kind"]["route"]
    check("policy-excluded rows leave coverage % as n/a", t3["coverage_pct"] is None, str(t3))

    passed = sum(1 for _, ok, _ in checks if ok)
    for name, ok, detail in checks:
        if not ok:
            print("  FAIL  {0}{1}".format(name, (" -> " + detail) if detail else ""))
    print("coverage self-test: {0}/{1} passed".format(passed, len(checks)))
    return 0 if passed == len(checks) else 1


def main():
    # type: () -> int
    parser = argparse.ArgumentParser(description="KAN-467 Phase 2 coverage ledger.")
    parser.add_argument("--summary", action="store_true", help="print the summary, do not write")
    parser.add_argument("--out", default=OUT_PATH, help="output path for the ledger JSON")
    parser.add_argument("--self-test", action="store_true", help="run the fixtures")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    try:
        inv = inv_mod.build()
    except inv_mod.SystemExit2 as exc:
        print("::error::coverage FAILED CLOSED — inventory unavailable: {0}".format(exc))
        return 2

    if not os.path.isdir(TESTS_DIR):
        print("::error::coverage FAILED CLOSED — tests/ not found at {0}.".format(TESTS_DIR))
        print("Zero test signal against a non-empty inventory is not 0% coverage,")
        print("it is an unmeasured run. Refusing to emit a ledger.")
        return 2

    signals = collect_signals()
    if not signals["specs"] and inv["counts"]["routes_total"]:
        print("::error::coverage FAILED CLOSED — no Playwright specs discovered under")
        print("tests/e2e while the inventory holds {0} route(s). That is a broken".format(
            inv["counts"]["routes_total"]))
        print("harness, not an honest zero.")
        return 2

    ledger = build_ledger(inv, signals)
    print_summary(ledger)
    if not args.summary:
        with open(args.out, "w") as fh:
            fh.write(json.dumps(ledger, indent=2, sort_keys=True) + "\n")
        print("\nWrote {0}".format(os.path.relpath(args.out, REPO)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
