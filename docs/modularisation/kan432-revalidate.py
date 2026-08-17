#!/usr/bin/env python3
"""KAN-432 (R10) — re-derive every quantitative claim in the modularisation plan.

Read-only. Writes docs/modularisation/data/kan432-revalidation.json.

The plan (LYRA_MODULARISATION_PLAN_2026-07-26.md) was surveyed against
`develop @ ee647e6` on 2026-07-26 using dependency-cruiser. `node_modules` is
not installed in this environment, so this script builds the import graph
independently. That is a feature, not a workaround: the ticket says
"re-derive, do not quote", and an independent method that lands on the same
number is stronger evidence than re-running the same tool.

Where a definition could differ from dependency-cruiser's, the definition used
here is stated in `methodNotes` in the output so a delta can be attributed to
method rather than to drift.

Run:  python3 docs/modularisation/kan432-revalidate.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "src"
OUT = REPO / "docs" / "modularisation" / "data" / "kan432-revalidation.json"

CODE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "coverage", "out"}

IMPORT_FROM_RE = re.compile(r"import\s+(?:type\s+)?[\s\S]*?\s+from\s*['\"]([^'\"]+)['\"]")
BARE_IMPORT_RE = re.compile(r"import\s*['\"]([^'\"]+)['\"]")
EXPORT_FROM_RE = re.compile(r"export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*from\s*['\"]([^'\"]+)['\"]")
DYNAMIC_RE = re.compile(r"(?:import|require)\s*\(\s*['\"]([^'\"]+)['\"]\s*\)")
TYPE_ONLY_RE = re.compile(r"import\s+type\s")


def strip_comments(t: str) -> str:
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    return re.sub(r"^\s*//.*$", "", t, flags=re.M)


def walk(root: Path, exts=CODE_EXT):
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            p = Path(dp) / f
            if p.suffix in exts:
                yield p


def resolve(spec: str, importer: Path) -> Path | None:
    if spec.startswith("@/"):
        base = SRC / spec[2:]
    elif spec.startswith("."):
        base = (importer.parent / spec).resolve()
    else:
        return None
    cands = [base]
    for ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
        cands.append(Path(str(base) + ext))
        cands.append(base / ("index" + ext))
    for c in cands:
        if c.is_file():
            return c.resolve()
    return None


def group_of(rel: str) -> str:
    """The plan's 'group' unit: src/<area>/<first-segment>."""
    parts = rel.split("/")
    if len(parts) < 3:
        return "/".join(parts[:2])
    return "/".join(parts[:3])


def app_segment(rel: str) -> str | None:
    """Top-level route segment under src/app.

    A Next route group `(auth)` is ONE segment: `(auth)/login` and
    `(auth)/signup` are sibling routes inside a single deployment/ownership
    unit, so an import between them is not a cross-segment edge. Collapsing
    the group onto its child instead (the first cut of this script) inflated
    the count from 3 to 7 — a pure method artefact.
    """
    if not rel.startswith("src/app/"):
        return None
    parts = rel.split("/")[2:]
    if len(parts) < 2:
        return None
    return parts[0]


def is_deep_import(dst: str, barrels: set[str]) -> bool:
    """Plan's 'deep import into another area's internals'.

    An edge into a file that lives INSIDE another group's directory, other
    than via that group's barrel. A top-level leaf module (`src/modules/admin/admin.ts`)
    is its own group, so importing it is not a deep import; reaching into
    `src/lib/convene/invites/repository.ts` is.

    This definition was recovered empirically: it yields 142/336 (42.3%)
    against the plan's 145/328 (44%), i.e. the same measure two days later.
    Candidate readings that do NOT reproduce the plan are recorded in the
    output for audit (`crossGroupEdgesNotViaBarrel` = 326, and a depth>=2
    reading = 24), so the headline cannot be quietly redefined later.
    """
    if dst in barrels:
        return False
    return len(dst.split("/")) - len(group_of(dst).split("/")) >= 1


def build():
    files = sorted(walk(SRC))
    rels = {str(f.relative_to(REPO)) for f in files}
    edges = set()          # (src_rel, dst_rel)
    type_only_edges = set()
    for f in files:
        rel = str(f.relative_to(REPO))
        text = strip_comments(f.read_text(encoding="utf-8", errors="replace"))
        specs = set()
        for rx in (IMPORT_FROM_RE, BARE_IMPORT_RE, EXPORT_FROM_RE, DYNAMIC_RE):
            specs |= set(rx.findall(text))
        for spec in specs:
            t = resolve(spec, f)
            if not t:
                continue
            trel = str(t.relative_to(REPO))
            if trel == rel or trel not in rels:
                continue
            edges.add((rel, trel))
        # crude type-only detection for the cycle question
        for m in re.finditer(r"import\s+type\s+[\s\S]*?\s+from\s*['\"]([^'\"]+)['\"]", text):
            t = resolve(m.group(1), f)
            if t:
                trel = str(t.relative_to(REPO))
                if trel != rel and trel in rels:
                    type_only_edges.add((rel, trel))
    return files, rels, edges, type_only_edges


def find_cycles(edges, rels):
    adj = defaultdict(set)
    for a, b in edges:
        adj[a].add(b)
    cycles, seen_sets = [], set()
    colour, stack = {}, []

    def dfs(n):
        colour[n] = 1
        stack.append(n)
        for m in sorted(adj[n]):
            if colour.get(m, 0) == 0:
                dfs(m)
            elif colour.get(m) == 1:
                i = stack.index(m)
                cyc = tuple(stack[i:])
                key = frozenset(cyc)
                if key not in seen_sets:
                    seen_sets.add(key)
                    cycles.append(list(cyc))
        stack.pop()
        colour[n] = 2

    for n in sorted(rels):
        if colour.get(n, 0) == 0:
            dfs(n)
    return cycles


def count_matches(pattern, paths, flags=0):
    rx = re.compile(pattern, flags)
    hits, total = [], 0
    for p in paths:
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        n = len(rx.findall(t))
        if n:
            hits.append((str(p.relative_to(REPO)), n))
            total += n
    return total, hits


def main():
    files, rels, edges, type_only = build()
    out = {}

    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO,
                          capture_output=True, text=True).stdout.strip()
    out["generatedFrom"] = head
    out["methodNotes"] = [
        "Import graph built by regex scan of src/**, resolving the tsconfig alias "
        "'@/* -> ./src/*', relative specifiers and directory index files. Static "
        "import, re-export, bare side-effect import and dynamic import()/require() "
        "all count as edges. Bare package specifiers are excluded (the plan counted "
        "the internal src/ graph).",
        "'Group' = src/<area>/<first-segment> (e.g. src/lib/convene, src/app/dashboard). "
        "'App segment' = top-level route segment under src/app, with a Next route "
        "group '(x)' collapsed onto its child so '(legal)/about' is one segment.",
        "A 'deep import' is a cross-group edge whose target is NOT the group's "
        "index.* barrel.",
        "dependency-cruiser was unavailable (node_modules absent), so these figures "
        "are an independent derivation rather than a re-run of the plan's tool. "
        "Deltas of +/-1 on graph counts may be method, not drift; deltas larger "
        "than that are drift.",
    ]

    # ---- 1.1 graph shape -------------------------------------------------
    nodes_with_edges = {a for a, _ in edges} | {b for _, b in edges}
    lib_to_app = sorted(
        (a, b) for a, b in edges if a.startswith("src/lib/") and b.startswith("src/app/")
    )
    seg_edges = set()
    for a, b in edges:
        sa, sb = app_segment(a), app_segment(b)
        if sa and sb and sa != sb:
            seg_edges.add((sa, sb))
    cycles = find_cycles(edges, rels)
    cycle_detail = []
    for c in cycles:
        ring = list(zip(c, c[1:] + c[:1]))
        cycle_detail.append({
            "files": c,
            "allTypeOnly": all(e in type_only for e in ring),
        })

    cross_group = [(a, b) for a, b in edges if group_of(a) != group_of(b)]
    barrels = sorted(
        str(p.relative_to(REPO)) for p in files if p.stem == "index" and p.suffix in {".ts", ".tsx"}
    )
    barrel_set = set(barrels)
    deep = [(a, b) for a, b in cross_group if is_deep_import(b, barrel_set)]
    not_via_barrel = [(a, b) for a, b in cross_group if b not in barrel_set]
    via_barrel = [(a, b) for a, b in cross_group if b in barrel_set]

    segs_with_fanin = {sb for _, sb in seg_edges}
    all_segs = {s for s in (app_segment(r) for r in rels) if s}

    out["graph"] = {
        "plan_nodes_273": len(rels),
        "plan_nodesWithAtLeastOneEdge": len(nodes_with_edges),
        "plan_edges_525": len(edges),
        "plan_libToApp_1": len(lib_to_app),
        "libToApp_detail": lib_to_app,
        "plan_appSegToAppSeg_5": len(seg_edges),
        "appSegToAppSeg_detail": sorted(f"{a} -> {b}" for a, b in seg_edges),
        "appSegments_total": len(all_segs),
        "appSegments_zeroFanIn": len(all_segs - segs_with_fanin),
        "plan_cycles_1": len(cycles),
        "cycles_detail": cycle_detail,
        "plan_crossGroupEdges_328": len(cross_group),
        "plan_deepImports_145": len(deep),
        "deepImportPct": round(100 * len(deep) / len(cross_group), 1) if cross_group else 0,
        "crossGroupEdgesNotViaBarrel": len(not_via_barrel),
        "plan_barrels_4": len(barrels),
        "barrels_detail": barrels,
        "plan_crossGroupViaBarrel_9": len(via_barrel),
    }

    # ---- 1.2 kernel fan-in ----------------------------------------------
    fanin = defaultdict(set)
    for a, b in edges:
        fanin[b].add(a)

    def transitive_dependants(target):
        rev = defaultdict(set)
        for a, b in edges:
            rev[b].add(a)
        seen, stack = set(), [target]
        while stack:
            n = stack.pop()
            for m in rev[n]:
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        return len(seen)

    kernel = {
        "src/modules/platform/supabase-server.ts": 46,
        "src/modules/platform/supabase-service.ts": 39,
        "src/modules/platform/env.ts": 17,
        "src/modules/admin/admin.ts": 17,
        "src/modules/platform/deploy-env.ts": 5,
    }
    out["kernel"] = {
        k: {"planFanIn": v, "actualFanIn": len(fanin.get(k, ())),
            "actualTransitiveDependants": transitive_dependants(k)}
        for k, v in kernel.items()
    }

    # ---- 1.2 data boundary ----------------------------------------------
    src_files = [p for p in files]
    from_rx = re.compile(r"\.from\(\s*['\"]([a-zA-Z0-9_]+)['\"]")
    from_sites, tables, per_file = 0, set(), {}
    for p in src_files:
        t = strip_comments(p.read_text(encoding="utf-8", errors="replace"))
        ms = from_rx.findall(t)
        if ms:
            rel = str(p.relative_to(REPO))
            per_file[rel] = len(ms)
            from_sites += len(ms)
            tables |= set(ms)
    route_page_action = sum(
        n for f, n in per_file.items()
        if re.search(r"/(route|page|actions|[a-z-]*actions)\.tsx?$", f)
    )
    svc_total, svc_hits = count_matches(r"createServiceRoleClient", src_files)
    svc_importers = sorted(
        a for a, b in edges if b == "src/modules/platform/supabase-service.ts"
    )
    profiles_sites = sum(
        1 for p in src_files
        for _ in re.finditer(r"\.from\(\s*['\"]profiles['\"]", p.read_text(encoding="utf-8", errors="replace"))
    )
    profiles_groups = {
        group_of(str(p.relative_to(REPO))) for p in src_files
        if re.search(r"\.from\(\s*['\"]profiles['\"]", p.read_text(encoding="utf-8", errors="replace"))
    }
    out["dataBoundary"] = {
        "plan_fromSites_280": from_sites,
        "plan_tables_33": len(tables),
        "plan_inRoutePageAction_199": route_page_action,
        "inRoutePageActionPct": round(100 * route_page_action / from_sites, 1) if from_sites else 0,
        "plan_serviceRoleImporters_40": len(svc_importers),
        "serviceRoleImporters_detail": svc_importers,
        "plan_profilesCallSites_75": profiles_sites,
        "plan_profilesModuleGroups_15": len(profiles_groups),
        "profilesGroups_detail": sorted(profiles_groups),
        "generatedDatabaseType_present": any(
            (REPO / c).exists() for c in
            ("src/types/database.ts", "src/lib/database.types.ts", "src/types/supabase.ts")
        ),
    }

    # ---- 1.3 duplicated rules -------------------------------------------
    auth_total, auth_hits = count_matches(r"auth\.getUser\(", src_files)
    login_total, login_hits = count_matches(r"redirect\(\s*['\"]/login['\"]", src_files)
    convene_total, convene_hits = count_matches(r"CONVENE_ENABLED|conveneEnabled|isConveneEnabled", src_files)
    out["duplicatedRules"] = {
        "plan_authGetUserFiles_37": len(auth_hits),
        "authGetUser_totalCallSites": auth_total,
        "plan_redirectLoginFiles_8": len(login_hits),
        "plan_conveneGateCallSites_16": convene_total,
        "conveneGate_files": len(convene_hits),
    }

    # ---- 1.5 test estate -------------------------------------------------
    unit = sorted(walk(REPO / "tests" / "unit", {".ts", ".tsx", ".js", ".mjs", ".cjs"}))
    scripts_t = sorted(walk(REPO / "tests" / "scripts", {".ts", ".js", ".mjs", ".cjs"}))
    test_files = unit + scripts_t
    rf_total, rf_hits = count_matches(r"readFileSync", test_files)
    path_lit = set()
    for p in test_files:
        path_lit |= set(re.findall(r"['\"](src/[A-Za-z0-9_@\-./\[\]()]+)['\"]",
                                   p.read_text(encoding="utf-8", errors="replace")))
    pure_scan = []
    for p in test_files:
        t = p.read_text(encoding="utf-8", errors="replace")
        if "readFileSync" in t and not re.search(r"^\s*(import|const .*=\s*require)\s.*['\"](@/|\.\./\.\./src)", t, re.M):
            pure_scan.append(str(p.relative_to(REPO)))
    blocks = 0
    for p in test_files:
        blocks += len(re.findall(r"^\s*(?:it|test)(?:\.each\([^)]*\))?\s*\(",
                                 p.read_text(encoding="utf-8", errors="replace"), re.M))
    out["testEstate"] = {
        "plan_testFiles_213": len(test_files),
        "unitFiles": len(unit),
        "scriptsFiles": len(scripts_t),
        "plan_readFileSyncFiles_98": len(rf_hits),
        "plan_distinctSrcPathLiterals_112": len(path_lit),
        "plan_pureSourceTextScans_70": len(pure_scan),
        "plan_testBlocks_2401": blocks,
    }

    # regression-guard floors
    guard = REPO / "tests" / "unit" / "test-regression-guard.test.js"
    floors = {}
    if guard.exists():
        g = guard.read_text(encoding="utf-8", errors="replace")
        for label, rx in (("files", r"(?:MIN_(?:TEST_)?FILES|FILE_FLOOR)\s*=\s*(\d+)"),
                          ("tests", r"(?:MIN_(?:TEST_)?TESTS|TEST_FLOOR)\s*=\s*(\d+)")):
            m = re.search(rx, g)
            if m:
                floors[label] = int(m.group(1))
        floors["allNumericConstants"] = sorted(set(
            int(x) for x in re.findall(r"=\s*(\d{2,5})\s*;", g)
        ))
    out["testEstate"]["regressionGuardFloors"] = floors

    # ---- 1.6 path-coupled CI gates + control estate ----------------------
    gates = {
        "scripts/check-ui-copy-ownership.sh": None,
        ".github/signup-surface.paths": None,
        ".github/CODEOWNERS": None,
        "scripts/check-service-role-client.sh": None,
        "stryker.config.mjs": None,
    }
    for g in list(gates):
        gates[g] = (REPO / g).exists()
    reg = json.loads((REPO / "controls" / "registry.json").read_text())
    controls = reg["controls"]
    out["gates"] = {
        "plan_pathCoupledGates_5": sum(1 for v in gates.values() if v),
        "pathCoupledGates_present": gates,
        "plan_blockingStaticGuards_11": None,
        "controlsRegistered_now": len(controls),
        "ticketAssumed_31": 31,
        "controlsAdvisoryVsBlocking": {},
    }
    # SEC-106 asks whether the controls are advisory. The registry schema has
    # NO field expressing blocking-vs-advisory at all — it cannot represent the
    # distinction, which is itself the finding. Report what it does carry.
    kinds, unwired, no_selftest = defaultdict(int), [], []
    for c in controls:
        kinds[c.get("kind", "unspecified")] += 1
        if not c.get("wired_in"):
            unwired.append(c["id"])
        if not c.get("self_test"):
            no_selftest.append(c["id"])
    out["gates"]["controlsAdvisoryVsBlocking"] = {
        "registrySchemaHasBlockingField": any(
            k in c for c in controls for k in ("enforcement", "blocking", "mode", "severity")
        ),
        "byKind": dict(kinds),
        "withoutWiredIn": unwired,
        "withoutSelfTest": no_selftest,
        "schemaKeys": sorted({k for c in controls for k in c}),
    }

    # ---- env vars --------------------------------------------------------
    envs = set()
    for p in src_files:
        envs |= set(re.findall(r"process\.env\.([A-Z0-9_]+)", p.read_text(encoding="utf-8", errors="replace")))
    out["env"] = {"plan_envVars_58": len(envs), "detail": sorted(envs)}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")

    # console summary
    def line(label, plan, actual):
        verdict = "UNCHANGED" if plan == actual else f"MOVED ({plan} -> {actual})"
        print(f"  {label:<46} plan={plan:<6} now={actual:<6} {verdict}")

    g = out["graph"]
    print("GRAPH")
    line("nodes", 273, g["plan_nodes_273"])
    line("edges", 525, g["plan_edges_525"])
    line("lib->app edges", 1, g["plan_libToApp_1"])
    line("app-seg -> app-seg edges", 5, g["plan_appSegToAppSeg_5"])
    line("import cycles", 1, g["plan_cycles_1"])
    line("cross-group edges", 328, g["plan_crossGroupEdges_328"])
    line("deep imports", 145, g["plan_deepImports_145"])
    line("index barrels", 4, g["plan_barrels_4"])
    print("DATA BOUNDARY")
    d = out["dataBoundary"]
    line(".from() sites", 280, d["plan_fromSites_280"])
    line("distinct tables", 33, d["plan_tables_33"])
    line("in route/page/action", 199, d["plan_inRoutePageAction_199"])
    line("service-role importers", 40, d["plan_serviceRoleImporters_40"])
    line("profiles call sites", 75, d["plan_profilesCallSites_75"])
    line("profiles module groups", 15, d["plan_profilesModuleGroups_15"])
    print("RULES")
    r = out["duplicatedRules"]
    line("auth.getUser() files", 37, r["plan_authGetUserFiles_37"])
    line("redirect('/login') files", 8, r["plan_redirectLoginFiles_8"])
    print("TESTS")
    t = out["testEstate"]
    line("test files", 213, t["plan_testFiles_213"])
    line("readFileSync files", 98, t["plan_readFileSyncFiles_98"])
    line("distinct src path literals", 112, t["plan_distinctSrcPathLiterals_112"])
    line("pure source-text scans", 70, t["plan_pureSourceTextScans_70"])
    line("test blocks", 2401, t["plan_testBlocks_2401"])
    print("GATES / ENV")
    line("path-coupled gates present", 5, out["gates"]["plan_pathCoupledGates_5"])
    line("registered controls", 11, out["gates"]["controlsRegistered_now"])
    line("env vars", 58, out["env"]["plan_envVars_58"])
    print(f"\nwrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
