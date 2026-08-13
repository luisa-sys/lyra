#!/usr/bin/env python3
"""CTL-053 / KAN-415 C2 — `no-deep-module-import`.

WHY THIS EXISTS
---------------
A module boundary that only constrains WHICH modules may depend on each other
(CTL-051) still lets any consumer reach into any file of an allowed dependency.
Measured when this landed: 304 files across 21 modules, of which only **54 are
imported from outside**. The other 250 are already internals in fact — nothing
made them internals in policy, so any of them could acquire an external consumer
without a single check going red.

That is the difference between a module and a directory.

WHY NOT index.ts + tsconfig ALIASES (plan §4.1)
-----------------------------------------------
The plan's first instinct was one alias per module pointing at an index file,
with no wildcard entry, so a deep import fails `type-check`. KAN-432 already
corrected that and the correction is the reason this script exists:

    A path alias only governs imports WRITTEN IN ALIAS FORM.
    `import x from '../../modules/convene/internal/thing'` is an ordinary
    relative specifier. It resolves, it type-checks, and no absence of a
    wildcard alias stops it.

So aliases catch the honest mistake and miss the shortcut. This reads the
resolved import GRAPH, which sees relative specifiers, and it needs no index
files to exist — there are none today, and creating 21 of them plus their
aliases would be a large mechanical change to every import in the app, landed
for enforcement that this script provides directly.

WHAT IT ASSERTS
---------------
For every import that crosses a module boundary, the imported FILE must appear
in the target module's `declaredApi`.

⚠️ TWO-WAY, AND THE SECOND HALF IS THE POINT.
A `declaredApi` entry that nothing outside the module imports is STALE and
fails. Without that, `declaredApi` would be a list you may only add to — a
suppression list — and the public surface could only grow. With it, the surface
RATCHETS DOWN: stop importing a file from outside and its entry must go, at
which point re-importing it is a reviewed decision again.

⚠️ IT IS SEEDED FROM MEASUREMENT, AND THAT IS NOT CIRCULAR.
`declaredApi` was populated from the 54 files actually imported across module
boundaries, so this ships at zero violations. A control that is red on the day
it lands is a control someone turns off. The value is forward-acting: the next
deep import fails, and the fix is either to route through an existing entry
point or to add a reviewed line to `modules.json`. Plan §4.5 prescribes exactly
this basis — an API of "the symbols measured as consumed, not what looks tidy".

`declaredApi` is POLICY and is edited by hand. `publicApi` is the DESCRIPTIVE
measurement alongside it. This script deliberately has no `--write` mode:
regenerating policy from observation would mean the gate could never fail.
`--suggest` prints what a human would need to add.

USAGE
    python3 scripts/check-module-api.py
    python3 scripts/check-module-api.py --self-test
    python3 scripts/check-module-api.py --suggest
    python3 scripts/check-module-api.py --graph <depcruise.json>   # tests

EXIT CODES
    0  the declared surface matches what crosses boundaries
    1  an undeclared deep import, or a stale declaration
    2  the check could not run
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "modules.json"
DEPCRUISE_CONFIG = REPO_ROOT / ".dependency-cruiser.cjs"


class ApiError(RuntimeError):
    """Raised when the check cannot run. Never swallowed into a clean result."""


def load_manifest(override: str | None = None) -> dict:
    path = Path(override) if override else MANIFEST
    if not path.exists():
        raise ApiError(f"{path.name} is missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(f"{path.name} is not valid JSON: {exc}") from exc
    if not isinstance(data.get("modules"), dict) or not data["modules"]:
        raise ApiError(f"{path.name} has no modules — refusing to report clean over nothing")
    return data


def owner_of(path: str, modules: dict) -> str | None:
    """Most-specific declaration wins. Same rule CTL-041 and CTL-051 use."""
    best, best_len = None, -1
    for name, mod in modules.items():
        for raw in mod.get("paths", []):
            p = raw.rstrip("/")
            if path == p or path.startswith(p + "/"):
                if len(p) > best_len:
                    best, best_len = name, len(p)
    return best


def run_depcruise() -> dict:
    cmd = ["npx", "depcruise", "--config", str(DEPCRUISE_CONFIG), "src", "--output-type", "json"]
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ApiError(f"could not run dependency-cruiser: {exc}") from exc
    if not proc.stdout.strip():
        raise ApiError(f"dependency-cruiser produced no output (exit {proc.returncode}): {proc.stderr[:400]}")
    return parse_graph(proc.stdout)


def parse_graph(text: str) -> dict:
    try:
        graph = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ApiError(f"dependency graph is not JSON: {exc}") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("modules"), list):
        raise ApiError("dependency graph has no modules list")
    if not graph["modules"]:
        raise ApiError("dependency graph is EMPTY — refusing to report clean over nothing")
    return graph


def crossings(graph: dict, modules: dict) -> dict[str, dict[str, set[str]]]:
    """target module -> imported file -> set of importing modules (or the app tree)."""
    out: dict[str, dict[str, set[str]]] = {}
    for entry in graph["modules"]:
        src_file = entry.get("source", "")
        src = owner_of(src_file, modules)
        for dep in entry.get("dependencies", []):
            dst_file = dep.get("resolved", "")
            dst = owner_of(dst_file, modules)
            if dst is None or dst == src:
                continue
            out.setdefault(dst, {}).setdefault(dst_file, set()).add(src or "(unowned)")
    return out


def classify(graph: dict, manifest: dict) -> dict:
    modules = manifest["modules"]
    seen = crossings(graph, modules)

    deep, stale = [], []
    for name in sorted(modules):
        declared = {e["file"] for e in modules[name].get("declaredApi", []) if isinstance(e, dict) and "file" in e}
        actual = seen.get(name, {})

        for f in sorted(set(actual) - declared):
            deep.append({"module": name, "file": f, "importers": sorted(actual[f])})
        for f in sorted(declared - set(actual)):
            stale.append({"module": name, "file": f})

    return {"declared": sum(len(m.get("declaredApi", [])) for m in modules.values()),
            "crossings": sum(len(v) for v in seen.values()),
            "deep": deep, "stale": stale}


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    failures: list[str] = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    mods = {
        "core": {
            "paths": ["src/core/"],
            "declaredApi": [{"file": "src/core/api.ts"}],
        },
        "app": {"paths": ["src/app2/"], "declaredApi": []},
    }
    manifest = {"modules": mods}

    def graph_of(pairs):
        by_src = {}
        for s, d in pairs:
            by_src.setdefault(s, []).append({"resolved": d})
        return {"modules": [{"source": s, "dependencies": deps} for s, deps in by_src.items()]}

    # --- the declared entry point is fine ---------------------------------
    g = graph_of([("src/app2/page.ts", "src/core/api.ts")])
    r = classify(g, manifest)
    check("importing a DECLARED entry point is legal", (r["deep"], r["stale"]), ([], []))

    # --- reaching past it is not ------------------------------------------
    g = graph_of([("src/app2/page.ts", "src/core/internal.ts")])
    r = classify(g, manifest)
    check("a DEEP import violates", len(r["deep"]), 1)
    check("...and names the file", r["deep"][0]["file"], "src/core/internal.ts")
    check("...and names who did it", r["deep"][0]["importers"], ["app"])
    # api.ts is declared but now unimported -> also stale. Both halves fire.
    check("...and the now-unused declaration is stale", len(r["stale"]), 1)

    # --- INTERNAL use of an internal file is fine --------------------------
    g = graph_of([("src/core/other.ts", "src/core/internal.ts"), ("src/app2/p.ts", "src/core/api.ts")])
    r = classify(g, manifest)
    check("a module may use its own internals", (r["deep"], r["stale"]), ([], []))

    # --- staleness: the surface must be able to shrink ---------------------
    g = graph_of([("src/core/a.ts", "src/core/api.ts")])
    r = classify(g, manifest)
    check("a declared entry nobody imports is STALE", len(r["stale"]), 1)
    check("...and is not also reported as deep", r["deep"], [])

    # --- an unowned importer (the app tree) is still an external consumer --
    g = graph_of([("src/unowned/x.ts", "src/core/internal.ts")])
    r = classify(g, manifest)
    check("an unowned file reaching in still violates", len(r["deep"]), 1)
    check("...and is labelled as unowned", r["deep"][0]["importers"], ["(unowned)"])

    # --- a module with no declaredApi at all -------------------------------
    bare = {"modules": {"core": {"paths": ["src/core/"]}, "app": {"paths": ["src/app2/"]}}}
    g = graph_of([("src/app2/p.ts", "src/core/anything.ts")])
    check("no declaredApi means NO entry points, not all of them",
          len(classify(g, bare)["deep"]), 1)

    # --- fail-closed -------------------------------------------------------
    for label, text in [
        ("a non-JSON graph", "<html>error</html>"),
        ("a graph with no modules list", '{"summary":{}}'),
        ("an EMPTY module list", '{"modules":[]}'),
    ]:
        try:
            parse_graph(text)
            raised = False
        except ApiError:
            raised = True
        check(f"{label} raises rather than reporting clean", raised, True)

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


SELF_TEST_CASES = 14


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="CTL-053 — no deep module imports")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--suggest", action="store_true", help="print the declaredApi lines a human would add")
    ap.add_argument("--graph", help="read a depcruise JSON instead of running it (tests)")
    # Paired with --graph so a fixture is SELF-CONTAINED. Without it, a
    # single-edge fixture graph is judged against the real 54-entry manifest and
    # every unrelated declaration reads as stale — the test would then be
    # asserting something about modules.json, not about the code under test.
    ap.add_argument("--manifest", help="read a modules.json instead of the repo's (tests)")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        manifest = load_manifest(args.manifest)
        graph = parse_graph(Path(args.graph).read_text(encoding="utf-8")) if args.graph else run_depcruise()
        r = classify(graph, manifest)
    except (ApiError, OSError) as exc:
        print(f"::error::check-module-api: {exc}")
        print("::error::  Failing closed (exit 2): a check that could not run is not a clean result.")
        return 2

    print(f"{r['crossings']} file(s) imported across a module boundary; {r['declared']} declared as API")

    if args.suggest:
        if not r["deep"]:
            print("Nothing to add. ✓")
            return 0
        print("\nAdd to modules.json (declaredApi), if these are genuinely public:")
        for d in r["deep"]:
            print(f'  {d["module"]}: {{ "file": "{d["file"]}", "consumedBy": {json.dumps(d["importers"])} }}')
        return 0

    if not r["deep"] and not r["stale"]:
        print("Every cross-module import lands on a declared entry point. ✓")
        return 0

    print()
    print("::error::Module API surface FAILED.")
    for d in r["deep"]:
        print(f"::error::  DEEP   {d['file']}")
        print(f"::error::         reached from {', '.join(d['importers'])}, but `{d['module']}` does not declare it")
    for s in r["stale"]:
        print(f"::error::  STALE  {s['module']} declares {s['file']}, which nothing outside the module imports")

    print()
    print("A DEEP import means something reached past a module's declared surface into")
    print("its internals. Import an existing entry point instead — or, if the file really")
    print("is public, add it to that module's `declaredApi` in modules.json. That line is")
    print("the review: widening a module's API should be a decision, not a side effect.")
    print("    python3 scripts/check-module-api.py --suggest")
    print()
    print("A STALE entry means the surface SHRANK and the declaration did not follow.")
    print("Delete it. Without this half, declaredApi could only grow, which is a")
    print("suppression list rather than a ratchet.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
