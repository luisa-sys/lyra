#!/usr/bin/env python3
"""KAN-421 (epic KAN-414) — the `profiles` god-table column inventory.

READ-ONLY. No database connection: the live column list is a committed capture
(`data/kan421-profiles-columns-dev.json`, taken 2026-07-28 from dev
`ilprytcrnqyrsbsrfujj` via SELECT-only `execute_sql` against
information_schema.columns).

What this derives, for the R6 ADR:

  1. Every `profiles` column, its owning module, and every read / filter / write
     site across ALL THREE repos (lyra, lyra-mcp-server, lyra-admin-mcp-server).
     100% of columns must be attributed — an unattributed column is a failure.
  2. The MULTI-WRITER columns — columns written by more than one module. These
     are what make option (A) (column ownership by convention) fragile, so they
     are named explicitly rather than counted.
  3. The BLIND SPOTS of a grep-based column-granularity gate: every call site
     whose column set cannot be bounded from source (`select('*')`, bare
     `select()`, variable write payload, object spread, template interpolation,
     dynamic keys). This is the proof-of-concept gate run the ticket asks for —
     the blind spots ARE the finding.

Column extraction reuses kan416-derive.py's `chain_columns` verbatim (same
heuristic, same CHAIN_WINDOW) so the two artefacts cannot disagree; the module
path map (`MODULE_RULES`, `PROFILES_COLUMNS`) is likewise imported, not copied.

Usage:  python3 docs/modularisation/kan421-profiles-inventory.py
Outputs: data/kan421-profiles-inventory.json + a human-readable stdout report.
"""

import importlib.util
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
LYRA = os.path.normpath(os.path.join(HERE, "..", ".."))
WORKSPACE = os.path.normpath(os.path.join(LYRA, ".."))
MCP = os.path.join(WORKSPACE, "lyra-mcp-server")
ADMIN = os.path.join(WORKSPACE, "lyra-admin-mcp-server")

# --- import kan416-derive.py as a library (its main() is __main__-guarded) ---
_spec = importlib.util.spec_from_file_location(
    "kan416_derive", os.path.join(HERE, "kan416-derive.py"))
k416 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(k416)

PROFILES_COLUMNS = k416.PROFILES_COLUMNS
chain_columns = k416.chain_columns
module_of = k416.module_of


# ---------------------------------------------------------------------------
# Per-COLUMN operation attribution.
#
# kan416's chain_columns returns one merged op set for the whole chain, which is
# right for its purpose (is this site a cross-module access at all?) but wrong
# for R6: in `.update({...}).eq('user_id', x)` it marks `user_id` as WRITTEN,
# when the column is only a filter key. Left uncorrected that alone manufactures
# `user_id` as a five-module "multi-writer" and would send the ADR chasing a
# boundary violation that does not exist.
#
# So the ops are re-derived here per column, from the same regexes:
#   .select('a,b')        -> read   on a, b
#   .eq('c', …) & friends -> filter on c
#   .update({d: …})       -> write  on d
# The bounded/unbounded verdict still comes from chain_columns, unchanged, so
# the two artefacts cannot disagree about what the gate can and cannot see.
# ---------------------------------------------------------------------------
TOP_KEY_RE = re.compile(
    r"""(?:^|[{,])\s*(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+))\s*:""")
COMPUTED_KEY_RE = re.compile(r"""[{,]\s*\[""")


def object_keys(obj_src):
    """Top-level keys of an object literal, and whether the key set is bounded.

    kan416's IDENT_KEY_RE is anchored at line start (`(?m)^\\s*<key>:`), so a
    SINGLE-LINE literal — `.update({ dashboard_widget_state: next })` — yields
    no keys and is scored `unbounded`. That is a false positive, and it inflates
    the committed KAN-416 seed's `unboundedSites` figure (see artefact §6).
    Here keys are matched after `{` or `,` at nesting depth 1 instead, so
    single-line and multi-line literals are read identically.

    Returns (keys:set, bounded:bool). Not bounded when the literal carries an
    object spread or a computed `[expr]:` key — then the key set is genuinely
    unknowable from source.
    """
    depth, top = 0, []
    for i, ch in enumerate(obj_src):
        if ch == "{":
            depth += 1
            if depth == 1:
                start = i
        elif ch == "}":
            depth -= 1
            if depth == 0:
                top.append(obj_src[start:i + 1])
    if not top:
        return set(), False
    src = top[0]
    # strip nested objects/arrays so only depth-1 keys are matched
    flat, depth = "", 0
    for ch in src[1:-1]:
        if ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif depth == 0:
            flat += ch
            continue
        if depth == 0 and ch in "}]":
            flat += ","
    keys = {m.group(1) or m.group(2) or m.group(3)
            for m in TOP_KEY_RE.finditer("," + flat)}
    bounded = "..." not in flat and not COMPUTED_KEY_RE.search("," + flat)
    return {k for k in keys if k}, bounded


def chain_window(text, start):
    end = min(len(text), start + k416.CHAIN_WINDOW)
    nxt = text.find(".from(", start + 6)
    if 0 < nxt < end:
        end = nxt
    blank = text.find("\n\n", start)
    if 0 < blank < end:
        end = blank
    return text[start:end]


VAR_PAYLOAD_RE = re.compile(r"""\.(?:update|insert|upsert)\(\s*[A-Za-z_$]""")


def unbounded_reasons(text, start):
    """Why (if at all) a site's column set cannot be bounded from source.

    Returns a sorted list of reason codes; empty means fully bounded. This is
    the proof-of-concept gate's own honesty report — each code is a distinct
    way a column-granularity grep gate goes blind.
    """
    w = chain_window(text, start)
    reasons = set()
    for m in k416.SELECT_RE.finditer(w):
        raw = m.group(1) or m.group(2) or m.group(3) or ""
        if "${" in raw:
            reasons.add("select-template-interpolation")
        if "*" in re.split(r"[(:!]", raw)[0] or raw.strip() == "*":
            reasons.add("select-star")
        if any(p.strip() == "*" for p in raw.split(",")):
            reasons.add("select-star")
    if re.search(r"\.select\(\s*\)", w):
        reasons.add("select-bare")
    if VAR_PAYLOAD_RE.search(w):
        reasons.add("write-variable-payload")
    for m in k416.WRITE_RE.finditer(w):
        obj = k416._balanced_object(w, m.start(1))
        if not obj:
            reasons.add("write-unbalanced-literal")
            continue
        _keys, bounded = object_keys(obj)
        if not bounded:
            reasons.add("write-spread-or-computed-key")
    return sorted(reasons)


def chain_columns_by_op(text, start):
    """{'read': {...}, 'filter': {...}, 'write': {...}} for one chain."""
    end = min(len(text), start + k416.CHAIN_WINDOW)
    nxt = text.find(".from(", start + 6)
    if 0 < nxt < end:
        end = nxt
    blank = text.find("\n\n", start)
    if 0 < blank < end:
        end = blank
    window = text[start:end]
    by_op = {"read": set(), "filter": set(), "write": set()}

    def clean(raw):
        raw = raw.strip()
        if not raw or raw == "*":
            return None
        raw = re.split(r"[(:!]", raw)[0].strip()
        return raw if re.fullmatch(r"[A-Za-z0-9_]+", raw) else None

    for m in k416.SELECT_RE.finditer(window):
        raw = m.group(1) or m.group(2) or m.group(3) or ""
        if "${" in raw:
            continue
        depth, cur = 0, ""
        for ch in raw + ",":
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                c = clean(cur)
                if c:
                    by_op["read"].add(c)
                cur = ""
            else:
                cur += ch

    for m in k416.FILTER_RE.finditer(window):
        c = clean(m.group(1))
        if c:
            by_op["filter"].add(c)

    for m in k416.WRITE_RE.finditer(window):
        obj = k416._balanced_object(window, m.start(1))
        if not obj:
            continue
        keys, _bounded = object_keys(obj)
        for key in keys:
            c = clean(key)
            if c:
                by_op["write"].add(c)
    return by_op

# ---------------------------------------------------------------------------
# Module attribution for the two MCP repos.
#
# The lyra repo maps files -> modules via kan416's MODULE_RULES. The MCP repos
# have no such map, so one is declared here, longest-prefix wins. Each entry is
# the module whose data the file is a second surface of — NOT a new module.
# A file matching nothing is reported as `mcp:<repo>:<file>` and counted as
# UNATTRIBUTED, never silently folded into a module.
# ---------------------------------------------------------------------------
MCP_MODULE_RULES = [
    # lyra-mcp-server
    ("src/auth.ts", "account"),                       # API-key / bearer auth
    ("src/feature-entitlements.ts", "features"),
    ("src/write-tools.ts", "profile"),                # profile mutation tools
    ("src/convene-availability-tool.ts", "convene"),
    ("src/convene-contact-tools.ts", "convene"),
    ("src/index.ts", "public-profile"),               # read tools: get/search
    # lyra-admin-mcp-server
    ("src/admin-auth.ts", "admin"),
    ("src/admin-tools.ts", "admin"),
]

REPOS = [
    ("lyra", LYRA, "src"),
    ("lyra-mcp-server", MCP, "src"),
    ("lyra-admin-mcp-server", ADMIN, "src"),
]

# Test / E2E harness paths in lyra that also touch profiles. Counted separately:
# they are not module code, but they DO write the table and would break on an
# option-(B) split, so option (B)'s cost must include them.
TEST_DIRS = ("tests/",)

FROM_PROFILES_RE = re.compile(r"""\.from\(\s*['"]profiles['"]\s*\)""")


def owner_of_column(col):
    for owner, cols in PROFILES_COLUMNS.items():
        if col in cols:
            return owner
    return None


def attribute(repo, relpath):
    """(module, how) for a file. `how` records the basis of the attribution."""
    if repo == "lyra":
        if relpath.startswith(TEST_DIRS):
            return "(test-harness)", "test-path"
        mod, _matches = module_of(relpath)
        if mod:
            return mod, "MODULE_RULES"
        return None, "unmapped"
    for rule, mod in sorted(MCP_MODULE_RULES, key=lambda r: -len(r[0])):
        if relpath == rule or relpath.startswith(rule.rstrip("/") + "/"):
            return mod, "MCP_MODULE_RULES"
    return None, "unmapped"


def walk(root, subdir, extra_dirs=()):
    out = []
    for base in (subdir,) + tuple(extra_dirs):
        for dirpath, dirs, files in os.walk(os.path.join(root, base)):
            dirs[:] = [d for d in dirs if d != "node_modules"]
            for f in files:
                if f.endswith((".ts", ".tsx")):
                    out.append(os.path.relpath(
                        os.path.join(dirpath, f), root).replace(os.sep, "/"))
    return sorted(out)


def main():
    live = json.load(open(os.path.join(
        HERE, "data", "kan421-profiles-columns-dev.json")))
    live_cols = [c["column_name"] for c in live["columns"]]

    sites = []          # one record per .from('profiles') call site
    for repo, root, subdir in REPOS:
        extra = ("tests",) if repo == "lyra" else ()
        for rel in walk(root, subdir, extra):
            path = os.path.join(root, rel)
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for m in FROM_PROFILES_RE.finditer(text):
                cols, kinds, star = chain_columns(text, m.start())
                by_op = chain_columns_by_op(text, m.start())
                reasons = unbounded_reasons(text, m.start())
                mod, how = attribute(repo, rel)
                sites.append({
                    "repo": repo, "file": rel,
                    "line": text.count("\n", 0, m.start()) + 1,
                    "module": mod, "attribution": how,
                    "columns": sorted(set(cols) | set(by_op["read"])
                                      | set(by_op["filter"])
                                      | set(by_op["write"])),
                    "ops": sorted(kinds),
                    "columnsByOp": {k: sorted(v) for k, v in by_op.items()},
                    "unbounded": bool(reasons),
                    "unboundedReasons": reasons,
                    "kan416Unbounded": star,
                })

    prod_sites = [s for s in sites if s["module"] != "(test-harness)"]
    test_sites = [s for s in sites if s["module"] == "(test-harness)"]

    # --- per-column inventory ------------------------------------------------
    readers, writers, site_count = (defaultdict(set), defaultdict(set),
                                    defaultdict(int))
    for s in prod_sites:
        acc = s["module"] or f"UNATTRIBUTED:{s['repo']}:{s['file']}"
        for c in s["columns"]:
            site_count[c] += 1
        for c in s["columnsByOp"]["write"]:
            writers[c].add(acc)
        for c in s["columnsByOp"]["read"] + s["columnsByOp"]["filter"]:
            readers[c].add(acc)

    inventory = []
    for col in live_cols:
        owner = owner_of_column(col)
        w = sorted(writers.get(col, ()))
        inventory.append({
            "column": col,
            "owner": owner,
            "writers": w,
            "readers": sorted(readers.get(col, ())),
            "boundedSites": site_count.get(col, 0),
            "multiWriter": len(w) > 1,
            "writtenByNonOwner": sorted(x for x in w if x != owner),
        })

    unattributed_cols = [c["column"] for c in inventory if not c["owner"]]
    orphan_owned = [c for cols in PROFILES_COLUMNS.values() for c in cols
                    if c not in live_cols]
    multi = [c for c in inventory if c["multiWriter"]]
    nonowner = [c for c in inventory if c["writtenByNonOwner"]]

    # --- option (A) gate proof-of-concept ------------------------------------
    unbounded = [s for s in prod_sites if s["unbounded"]]
    bounded = [s for s in prod_sites if not s["unbounded"]]
    write_sites = [s for s in prod_sites if "write" in s["ops"]]
    write_blind_codes = {"write-variable-payload", "write-spread-or-computed-key",
                         "write-unbalanced-literal"}
    unbounded_writes = [s for s in write_sites
                        if write_blind_codes & set(s["unboundedReasons"])]
    reason_hist = defaultdict(int)
    for s in prod_sites:
        for r in s["unboundedReasons"]:
            reason_hist[r] += 1
    kan416_unbounded = [s for s in prod_sites if s["kan416Unbounded"]]
    false_positives = [s for s in prod_sites
                       if s["kan416Unbounded"] and not s["unbounded"]]
    unmapped_files = sorted({(s["repo"], s["file"]) for s in prod_sites
                             if s["module"] is None})

    out = {
        "$comment": "KAN-421 R6 — profiles column inventory across all three "
                    "repos. Reproduce: python3 docs/modularisation/"
                    "kan421-profiles-inventory.py",
        "measuredAt": live["capturedAt"],
        "liveColumnCount": len(live_cols),
        "repos": {r: len([s for s in prod_sites if s["repo"] == r])
                  for r, _, _ in REPOS},
        "totals": {
            "productionSites": len(prod_sites),
            "testHarnessSites": len(test_sites),
            "writeSites": len(write_sites),
            "boundedSites": len(bounded),
            "unboundedSites": len(unbounded),
            "unboundedWriteSites": len(unbounded_writes),
            "unboundedReasonHistogram": dict(sorted(reason_hist.items())),
            "kan416UnboundedSites": len(kan416_unbounded),
            "kan416FalsePositives": len(false_positives),
            "unattributedColumns": len(unattributed_cols),
            "columnsInMapNotInLiveSchema": sorted(orphan_owned),
            "multiWriterColumns": len(multi),
            "nonOwnerWrittenColumns": len(nonowner),
            "filesWithNoModule": len(unmapped_files),
        },
        "inventory": inventory,
        "multiWriterColumns": [
            {"column": c["column"], "owner": c["owner"], "writers": c["writers"]}
            for c in multi],
        "nonOwnerWrites": [
            {"column": c["column"], "owner": c["owner"],
             "nonOwnerWriters": c["writtenByNonOwner"]} for c in nonowner],
        "unboundedSites": [
            {k: s[k] for k in ("repo", "file", "line", "module", "ops",
                               "unboundedReasons")}
            for s in unbounded],
        "kan416FalsePositives": [
            {k: s[k] for k in ("repo", "file", "line", "module")}
            for s in false_positives],
        "unmappedFiles": [{"repo": r, "file": f} for r, f in unmapped_files],
        "testHarnessSites": [
            {k: s[k] for k in ("file", "line", "ops", "columns", "unbounded")}
            for s in test_sites],
        "sites": prod_sites,
    }
    dest = os.path.join(HERE, "data", "kan421-profiles-inventory.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, sort_keys=False)
        fh.write("\n")

    # --- report --------------------------------------------------------------
    t = out["totals"]
    print(f"live profiles columns (dev {live['project']}): {len(live_cols)}")
    print(f"production .from('profiles') sites: {t['productionSites']}  "
          f"({'  '.join(f'{k}={v}' for k, v in out['repos'].items())})")
    print(f"test-harness sites (lyra tests/): {t['testHarnessSites']}")
    print()
    print("--- 100% attribution check ---")
    print(f"columns with no owning module : {t['unattributedColumns']} "
          f"{unattributed_cols or ''}")
    print(f"owned columns not in live dev : {t['columnsInMapNotInLiveSchema']}")
    print(f"files with no module          : {t['filesWithNoModule']} "
          f"{unmapped_files or ''}")
    print()
    print("--- multi-writer columns (option A's fragility) ---")
    for c in multi:
        print(f"  {c['column']:<32} owner={c['owner']:<28} "
              f"writers={c['writers']}")
    print(f"  total: {len(multi)}")
    print()
    print("--- columns written by a NON-owner module ---")
    for c in nonowner:
        print(f"  {c['column']:<32} owner={c['owner']:<28} "
              f"non-owner writers={c['writtenByNonOwner']}")
    print(f"  total: {len(nonowner)}")
    print()
    print("--- option (A) gate PoC: attribution confidence ---")
    print(f"  bounded sites (gate can attribute)   : {len(bounded)}"
          f"/{len(prod_sites)}"
          f" ({100*len(bounded)//max(1,len(prod_sites))}%)")
    print(f"  UNBOUNDED sites (gate is blind)      : {len(unbounded)}")
    print(f"  write sites                          : {len(write_sites)}")
    print(f"  UNBOUNDED WRITE sites (gate is blind): {len(unbounded_writes)}"
          f"/{len(write_sites)}"
          f" ({100*len(unbounded_writes)//max(1,len(write_sites))}%)")
    for s in unbounded_writes:
        print(f"      {s['repo']}/{s['file']}:{s['line']}  "
              f"module={s['module']} {s['unboundedReasons']}")
    print()
    print("  blind-spot taxonomy (site counts, a site may hit several):")
    for r, n in sorted(reason_hist.items(), key=lambda kv: -kv[1]):
        print(f"      {r:<32} {n}")
    print()
    print(f"  cross-check vs KAN-416 heuristic: kan416 scores "
          f"{len(kan416_unbounded)} unbounded, of which {len(false_positives)} "
          f"are FALSE POSITIVES (single-line object literal; kan416's "
          f"IDENT_KEY_RE is line-anchored)")
    print()
    print(f"wrote {os.path.relpath(dest, LYRA)}")


if __name__ == "__main__":
    main()
