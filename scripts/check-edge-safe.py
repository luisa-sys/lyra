#!/usr/bin/env python3
"""CTL-054 / KAN-415 C2 — `edge-safe`.

WHY THIS EXISTS
---------------
`src/middleware.ts` runs in the **Edge runtime**, which is not Node. It has no
`fs`, no `crypto` module, no `child_process`; `next/headers` is a Server
Component API and throws there; and the full `@supabase/supabase-js` client is
both heavy and Node-oriented (`@supabase/ssr` is the Edge-safe path, and is what
this repo uses).

The hazard is that **nothing in the import chain announces itself as edge code.**
`src/modules/access/gates/suspension.ts` looks like any other module file. Add a
`node:crypto` import to something it transitively pulls in — three or four hops
away, in a file whose author had no idea it was in the middleware bundle — and
the failure surfaces at request time on a deployed environment, on the gate
pipeline that every request passes through.

Measured when this landed: **23 files reachable from middleware.ts** —
middleware itself, the whole `access` module, four `guards` files and two
`platform` files — importing exactly three external packages (`@supabase/ssr`,
`jose`, `next/server`), all Edge-safe. Zero violations, which is why this can
ship blocking rather than baselined.

WHAT IT ASSERTS
---------------
No file transitively reachable from an Edge entry point imports a specifier on
the banned list: any `node:` builtin, the classic bare Node builtins, and the
two Next/Supabase APIs that are specifically wrong here.

⚠️ VACUITY GUARD — THE FAILURE THIS CONTROL IS MOST LIKELY TO HAVE.
A traversal that silently reaches nothing reports "0 violations" and a green
tick, indistinguishable from a clean bundle. If the resolved set is smaller than
MIN_REACHABLE the check FAILS rather than passing: the bundle has been 23 files
since it was first measured, and a sudden collapse to 1 means the graph did not
resolve, not that the middleware stopped importing anything.

WHY A BANNED LIST RATHER THAN AN ALLOWLIST
An allowlist of Edge-safe packages would fail every time someone adds a
legitimate new one, and a gate that fires on legitimate work is one people learn
to wave through. The banned list names things that are *always* wrong in the
Edge runtime, so a hit is always a real finding.

USAGE
    python3 scripts/check-edge-safe.py
    python3 scripts/check-edge-safe.py --self-test
    python3 scripts/check-edge-safe.py --graph <depcruise.json>   # tests

EXIT CODES
    0  nothing in the edge bundle imports a Node-only or server-only API
    1  a banned import is reachable from an Edge entry point
    2  the check could not run (no entry point, unusable graph, vacuous result)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEPCRUISE_CONFIG = REPO_ROOT / ".dependency-cruiser.cjs"

# The Edge entry points. `middleware.ts` is the only one today; the list exists
# so adding another (a route with `export const runtime = 'edge'`) is a one-line
# change rather than a rewrite.
ENTRY_POINTS = ["src/middleware.ts"]

# Measured at 23. A floor well below that catches a broken traversal without
# failing on ordinary churn.
MIN_REACHABLE = 8

NODE_BUILTINS = (
    "fs", "path", "os", "crypto", "child_process", "net", "tls", "dns", "http",
    "https", "http2", "stream", "zlib", "worker_threads", "cluster", "vm",
    "perf_hooks", "readline", "repl", "tty", "v8", "module",
)

BANNED = {
    # Server Component API. Throws in middleware.
    "next/headers": "a Server Component API — it throws in the Edge runtime",
    # Node-oriented and heavy. @supabase/ssr is the Edge-safe path and is what
    # the middleware already uses.
    "@supabase/supabase-js": "Node-oriented and heavy; use @supabase/ssr in edge code",
}
for _b in NODE_BUILTINS:
    BANNED[f"node:{_b}"] = "a Node builtin — absent from the Edge runtime"
    BANNED[_b] = "a Node builtin — absent from the Edge runtime"

IMPORT_RE = re.compile(r"""(?:from|import|require\()\s*['"]([^'"]+)['"]""")
# A line that is a comment is documentation of the hazard, not a use of it —
# the CTL-039 lesson: the prose explaining a fix must not be what breaks it.
COMMENT_RE = re.compile(r"^\s*(//|\*|/\*)")


class EdgeError(RuntimeError):
    """Raised when the check cannot run. Never swallowed into a clean result."""


def run_depcruise() -> dict:
    cmd = ["npx", "depcruise", "--config", str(DEPCRUISE_CONFIG), "src", "--output-type", "json"]
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as exc:
        raise EdgeError(f"could not run dependency-cruiser: {exc}") from exc
    if not proc.stdout.strip():
        raise EdgeError(f"dependency-cruiser produced no output (exit {proc.returncode}): {proc.stderr[:400]}")
    return parse_graph(proc.stdout)


def parse_graph(text: str) -> dict:
    try:
        graph = json.loads(text)
    except json.JSONDecodeError as exc:
        raise EdgeError(f"dependency graph is not JSON: {exc}") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("modules"), list):
        raise EdgeError("dependency graph has no modules list")
    if not graph["modules"]:
        raise EdgeError("dependency graph is EMPTY — refusing to report clean over nothing")
    return graph


def reachable(graph: dict, entries: list[str]) -> set[str]:
    adj: dict[str, list[str]] = {}
    for entry in graph["modules"]:
        adj[entry.get("source", "")] = [d.get("resolved", "") for d in entry.get("dependencies", [])]

    known = [e for e in entries if e in adj]
    if not known:
        raise EdgeError(
            f"none of the edge entry points {entries} appear in the dependency graph. "
            f"Either they moved, or the graph did not resolve — both mean this check "
            f"cannot see the edge bundle."
        )

    seen: set[str] = set()
    stack = list(known)
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        stack.extend(adj.get(node, []))
    return seen


def banned_imports(files: set[str], root: Path) -> list[dict]:
    hits = []
    for rel in sorted(files):
        if not rel.startswith("src/"):
            continue
        path = root / rel
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(lines, start=1):
            if COMMENT_RE.match(line):
                continue
            for m in IMPORT_RE.finditer(line):
                spec = m.group(1)
                if spec in BANNED:
                    hits.append({"file": rel, "line": lineno, "import": spec, "why": BANNED[spec]})
    return hits


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    import tempfile

    failures: list[str] = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    def graph_of(pairs):
        by_src: dict[str, list] = {}
        for s, d in pairs:
            by_src.setdefault(s, []).append({"resolved": d})
        for _, d in pairs:
            by_src.setdefault(d, [])
        return {"modules": [{"source": s, "dependencies": deps} for s, deps in by_src.items()]}

    # --- reachability -------------------------------------------------------
    g = graph_of([("src/middleware.ts", "src/a.ts"), ("src/a.ts", "src/b.ts")])
    check("transitive closure follows every hop", reachable(g, ["src/middleware.ts"]), {"src/middleware.ts", "src/a.ts", "src/b.ts"})
    g2 = graph_of([("src/other.ts", "src/unrelated.ts"), ("src/middleware.ts", "src/a.ts")])
    check("an unrelated subtree is NOT in the bundle", "src/unrelated.ts" in reachable(g2, ["src/middleware.ts"]), False)

    # --- a missing entry point must not read as an empty, clean bundle ------
    try:
        reachable(graph_of([("src/x.ts", "src/y.ts")]), ["src/middleware.ts"])
        raised = False
    except EdgeError:
        raised = True
    check("a missing entry point raises rather than reporting clean", raised, True)

    # --- detection ----------------------------------------------------------
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "src").mkdir()
        (root / "src" / "clean.ts").write_text("import { NextResponse } from 'next/server'\n")
        (root / "src" / "bad.ts").write_text("import { randomUUID } from 'node:crypto'\n")
        (root / "src" / "bare.ts").write_text("import fs from 'fs'\n")
        (root / "src" / "hdrs.ts").write_text("import { cookies } from 'next/headers'\n")
        (root / "src" / "sb.ts").write_text("import { createClient } from '@supabase/supabase-js'\n")
        (root / "src" / "ssr.ts").write_text("import { createServerClient } from '@supabase/ssr'\n")
        (root / "src" / "commented.ts").write_text("// never import 'node:crypto' here\nexport const x = 1\n")

        check("a clean file is clean", banned_imports({"src/clean.ts"}, root), [])
        check("@supabase/ssr is the SAFE one and must not fire", banned_imports({"src/ssr.ts"}, root), [])
        check("node: builtin is caught", len(banned_imports({"src/bad.ts"}, root)), 1)
        check("a BARE builtin is caught too", len(banned_imports({"src/bare.ts"}, root)), 1)
        check("next/headers is caught", len(banned_imports({"src/hdrs.ts"}, root)), 1)
        check("@supabase/supabase-js is caught", len(banned_imports({"src/sb.ts"}, root)), 1)
        # CTL-039: the prose explaining the hazard must not trip the scan, or
        # documenting the rule makes the file fail it.
        check("a COMMENT naming a banned import does not fire", banned_imports({"src/commented.ts"}, root), [])
        check("the finding says which file and why",
              [(h["file"], "Node builtin" in h["why"]) for h in banned_imports({"src/bad.ts"}, root)],
              [("src/bad.ts", True)])

    # --- fail-closed --------------------------------------------------------
    for label, text in [
        ("a non-JSON graph", "<html>error</html>"),
        ("a graph with no modules list", '{"summary":{}}'),
        ("an EMPTY module list", '{"modules":[]}'),
    ]:
        try:
            parse_graph(text)
            raised = False
        except EdgeError:
            raised = True
        check(f"{label} raises rather than reporting clean", raised, True)

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


SELF_TEST_CASES = 15


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="CTL-054 — edge-safe middleware bundle")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--graph", help="read a depcruise JSON instead of running it (tests)")
    ap.add_argument("--root", help="scan files under this root instead of the repo (tests)")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        graph = parse_graph(Path(args.graph).read_text(encoding="utf-8")) if args.graph else run_depcruise()
        files = reachable(graph, ENTRY_POINTS)
    except (EdgeError, OSError) as exc:
        print(f"::error::check-edge-safe: {exc}")
        print("::error::  Failing closed (exit 2): a check that could not run is not a clean result.")
        return 2

    if len(files) < MIN_REACHABLE:
        print(f"::error::check-edge-safe: only {len(files)} file(s) reachable from {ENTRY_POINTS}.")
        print(f"::error::  Expected at least {MIN_REACHABLE}. The middleware bundle has been ~23 files")
        print("::error::  since it was first measured, so a collapse to almost nothing means the")
        print("::error::  traversal failed — not that the bundle got clean. Failing closed (exit 2):")
        print("::error::  a scan that reached nothing reports zero findings and a green tick.")
        return 2

    hits = banned_imports(files, Path(args.root) if args.root else REPO_ROOT)
    print(f"{len(files)} file(s) reachable from {', '.join(ENTRY_POINTS)}; {len(hits)} banned import(s)")

    if not hits:
        print("Nothing in the edge bundle imports a Node-only or server-only API. ✓")
        return 0

    print()
    print("::error::Edge-safety FAILED.")
    for h in hits:
        print(f"::error::  {h['file']}:{h['line']} imports `{h['import']}` — {h['why']}")
    print()
    print("These files are reachable from src/middleware.ts, so they run in the EDGE")
    print("runtime on every request that passes the gate pipeline. Nothing in the chain")
    print("announces itself as edge code, which is the whole hazard: a file three hops")
    print("away can break every request, and the failure surfaces at request time on a")
    print("deployed environment rather than at build time here.")
    print()
    print("Use an Edge-safe equivalent (`@supabase/ssr` rather than `@supabase/supabase-js`,")
    print("Web Crypto rather than `node:crypto`, the `NextRequest` headers rather than")
    print("`next/headers`) — or move the work out of the middleware's import chain.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
