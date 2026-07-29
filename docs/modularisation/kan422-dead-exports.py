#!/usr/bin/env python3
"""KAN-422 (R7) — enumerate exported symbols in src/** with zero consumers.

Read-only. Produces docs/modularisation/data/kan422-dead-exports.json.

Definition used (from the ticket):
  A symbol is a ZERO-CONSUMER EXPORT when no file *outside its own directory*
  and outside its own co-located tests imports it by name.

Method
------
1. Enumerate exported symbols per file in src/** (.ts/.tsx) with a line-oriented
   scan of the export forms actually used in this repo.
2. Build the import graph over the whole repo (src, tests, scripts, .github,
   root configs), resolving the single tsconfig alias `@/* -> ./src/*`, relative
   specifiers, and bare specifiers (ignored). Both static `import`, re-export
   `export ... from`, dynamic `import()` and `require()` are counted.
3. For each symbol, partition its importers into
      same-dir / other-src-dir / test / script-or-ci
   and flag those with an empty `other-src-dir` set.
4. Subtract framework-contract exports: Next.js consumes some exports by
   convention with no import statement anywhere (page/layout/route handlers,
   metadata, middleware, instrumentation, generateStaticParams, ...). Those are
   NOT dead; they are reported separately so the number stays honest.
5. Grep for the symbol name as a *string* anywhere in the repo (and the two
   sibling repos, if present) so dynamic/string-keyed reachability is visible
   before anything is proposed for deletion.

Run:  python3 docs/modularisation/kan422-dead-exports.py
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
OUT = REPO / "docs" / "modularisation" / "data" / "kan422-dead-exports.json"

CODE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}

# Directories scanned for *consumers* (the import graph), repo-relative.
CONSUMER_ROOTS = ["src", "tests", "scripts", ".github", "supabase", "controls"]
# Root-level config files that can import from src.
ROOT_GLOBS = ["*.ts", "*.js", "*.mjs", "*.cjs", "*.config.ts", "*.config.js"]

SKIP_DIR_PARTS = {"node_modules", ".git", ".next", "dist", "coverage", "out"}

# ---------------------------------------------------------------------------
# Next.js / tooling framework contracts: exported by convention, never imported.
# ---------------------------------------------------------------------------
NEXT_FILE_CONVENTIONS = {
    "page", "layout", "template", "loading", "error", "global-error",
    "not-found", "route", "default", "sitemap", "robots", "manifest",
    "opengraph-image", "twitter-image", "icon", "apple-icon",
    "middleware", "instrumentation", "instrumentation-client",
}
NEXT_CONVENTION_SYMBOLS = {
    "default", "metadata", "generateMetadata", "generateStaticParams",
    "generateViewport", "viewport", "dynamic", "dynamicParams", "revalidate",
    "fetchCache", "runtime", "preferredRegion", "maxDuration", "alt", "size",
    "contentType", "config", "onRequestError", "register",
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
}

TEST_RE = re.compile(r"(^|/)(tests?|__tests__)/|\.(test|spec)\.[cm]?[jt]sx?$")


def is_test(rel: str) -> bool:
    return bool(TEST_RE.search(rel))


def walk(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_PARTS]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix in CODE_EXT:
                yield p


# ---------------------------------------------------------------------------
# 1. Exported symbols
# ---------------------------------------------------------------------------
DECL_RE = re.compile(
    r"^\s*export\s+(?:declare\s+)?"
    r"(?:(?:async\s+)?function\*?|const|let|var|class|abstract\s+class|"
    r"type|interface|enum|const\s+enum)\s+"
    r"([A-Za-z_$][\w$]*)"
)
DEFAULT_RE = re.compile(r"^\s*export\s+default\b")
# export { a, b as c }   /   export { a } from './x'   /   export * from './x'
BRACE_RE = re.compile(r"^\s*export\s*\{([^}]*)\}\s*(from\s*['\"]([^'\"]+)['\"])?")
STAR_FROM_RE = re.compile(r"^\s*export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*['\"]([^'\"]+)['\"]")
# export const { a, b } = ...
DESTRUCT_RE = re.compile(r"^\s*export\s+(?:const|let|var)\s*\{([^}]*)\}")


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def internal_uses(text_nocomments: str, sym: str, decl_line: int) -> int:
    """How many times the symbol is referenced in its own file, other than at
    its declaration. Distinguishes DEAD code from live code with a too-wide
    `export` — the two need opposite dispositions."""
    if sym == "default":
        return 0
    rx = re.compile(r"\b" + re.escape(sym) + r"\b")
    n = 0
    for i, line in enumerate(text_nocomments.splitlines(), 1):
        if i == decl_line:
            continue
        n += len(rx.findall(line))
    return n


def decl_loc(text_nocomments: str, decl_line: int) -> int:
    """Lines spanned by a declaration, by brace/paren balance from its first line."""
    lines = text_nocomments.splitlines()
    if decl_line > len(lines):
        return 1
    depth, started, span = 0, False, 0
    for line in lines[decl_line - 1:]:
        span += 1
        for ch in line:
            if ch in "{([":
                depth += 1
                started = True
            elif ch in "})]":
                depth -= 1
        if started and depth <= 0:
            break
        if not started and line.rstrip().endswith(";"):
            break
        if span > 400:
            break
    return span


def exports_of(path: Path) -> dict[str, int]:
    """symbol -> 1-based line number of its export."""
    raw = path.read_text(encoding="utf-8", errors="replace")
    text = strip_comments(raw)
    found: dict[str, int] = {}
    for i, line in enumerate(text.splitlines(), 1):
        m = DECL_RE.match(line)
        if m:
            found.setdefault(m.group(1), i)
            continue
        m = DESTRUCT_RE.match(line)
        if m:
            for part in m.group(1).split(","):
                name = part.split(":")[-1].strip().lstrip(".")
                if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
                    found.setdefault(name, i)
            continue
        m = BRACE_RE.match(line)
        if m:
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                name = part.split(" as ")[-1].strip()
                if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
                    found.setdefault(name, i)
            continue
        m = STAR_FROM_RE.match(line)
        if m and m.group(1):
            found.setdefault(m.group(1), i)
            continue
        if DEFAULT_RE.match(line):
            found.setdefault("default", i)
    return found


# ---------------------------------------------------------------------------
# 2. Import graph
# ---------------------------------------------------------------------------
IMPORT_FROM_RE = re.compile(
    r"import\s+(?:type\s+)?([\s\S]*?)\s+from\s*['\"]([^'\"]+)['\"]"
)
SIDE_EFFECT_RE = re.compile(r"import\s*['\"]([^'\"]+)['\"]")
EXPORT_FROM_RE = re.compile(r"export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s*from\s*['\"]([^'\"]+)['\"]")
DYNAMIC_RE = re.compile(r"(?:import|require)\s*\(\s*['\"]([^'\"]+)['\"]\s*\)")
JEST_MOCK_RE = re.compile(r"jest\.(?:mock|unstable_mockModule|requireActual|doMock)\s*\(\s*['\"]([^'\"]+)['\"]")


def parse_clause(clause: str) -> set[str]:
    """`{a, b as c}, Default, * as ns` -> the set of *source* names imported."""
    names: set[str] = set()
    brace = re.search(r"\{([\s\S]*)\}", clause)
    if brace:
        for part in brace.group(1).split(","):
            part = part.strip().removeprefix("type ").strip()
            if not part:
                continue
            src_name = part.split(" as ")[0].strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", src_name):
                names.add(src_name)
        clause = clause[: brace.start()] + clause[brace.end():]
    if re.search(r"\*\s*as\s+[\w$]+", clause):
        names.add("*")
    head = clause.split("{")[0].split(",")[0].strip()
    if re.fullmatch(r"[A-Za-z_$][\w$]*", head):
        names.add("default")
    return names


def resolve(spec: str, importer: Path) -> Path | None:
    """Resolve a specifier to a repo file, or None for bare/unresolvable."""
    if spec.startswith("@/"):
        base = SRC / spec[2:]
    elif spec.startswith("."):
        base = (importer.parent / spec).resolve()
    elif spec.startswith("/"):
        return None
    else:
        return None
    cands = [base]
    for ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
        cands.append(base.with_suffix(base.suffix + ext) if base.suffix else Path(str(base) + ext))
        cands.append(Path(str(base) + ext))
        cands.append(base / ("index" + ext))
    for c in cands:
        if c.is_file():
            return c.resolve()
    return None


def consumer_files() -> list[Path]:
    files: list[Path] = []
    for root in CONSUMER_ROOTS:
        p = REPO / root
        if p.is_dir():
            files.extend(walk(p))
    for pat in ROOT_GLOBS:
        files.extend(x for x in REPO.glob(pat) if x.is_file())
    # .github workflows are YAML — scanned separately for string references.
    return sorted(set(files))


def build_graph(files: list[Path]):
    """(target_abs, symbol) -> set of importer rel paths.  '*' = namespace import."""
    edges: dict[tuple[str, str], set[str]] = defaultdict(set)
    for f in files:
        try:
            text = strip_comments(f.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        rel = str(f.relative_to(REPO))
        for clause, spec in IMPORT_FROM_RE.findall(text):
            t = resolve(spec, f)
            if not t:
                continue
            for name in parse_clause(clause):
                edges[(str(t.relative_to(REPO)), name)].add(rel)
        for spec in EXPORT_FROM_RE.findall(text):
            t = resolve(spec, f)
            if t:
                edges[(str(t.relative_to(REPO)), "*")].add(rel)
        for rx in (SIDE_EFFECT_RE, DYNAMIC_RE, JEST_MOCK_RE):
            for spec in rx.findall(text):
                t = resolve(spec, f)
                if t:
                    edges[(str(t.relative_to(REPO)), "*")].add(rel)
    return edges


# ---------------------------------------------------------------------------
# 5. string reachability
# ---------------------------------------------------------------------------
def string_hits(symbols: list[str], extra_repos: list[Path]) -> dict[str, list[str]]:
    """Literal occurrences of each symbol name outside its own module tree."""
    hits: dict[str, list[str]] = {}
    roots = [REPO / d for d in (".github", "scripts", "supabase", "controls", "docs")]
    roots += [r for r in extra_repos if r.is_dir()]
    roots = [r for r in roots if r.is_dir()]
    if not roots:
        return hits
    for sym in symbols:
        try:
            res = subprocess.run(
                ["grep", "-rIl", "--exclude-dir=node_modules", "--exclude-dir=.git",
                 "--exclude-dir=.next", "-F", sym, *[str(r) for r in roots]],
                capture_output=True, text=True, timeout=90,
            )
        except Exception:
            continue
        files = [ln for ln in res.stdout.splitlines() if ln.strip()]
        if files:
            hits[sym] = files[:12]
    return hits


def main() -> int:
    src_files = sorted(walk(SRC))
    graph = build_graph(consumer_files())

    # namespace / side-effect importers, per target file
    ns_importers: dict[str, set[str]] = defaultdict(set)
    for (tgt, name), imps in graph.items():
        if name == "*":
            ns_importers[tgt] |= imps

    records = []
    for f in src_files:
        rel = str(f.relative_to(REPO))
        if is_test(rel):
            continue
        stem = f.stem
        conventional_file = stem in NEXT_FILE_CONVENTIONS
        d = str(f.parent.relative_to(REPO))
        body = strip_comments(f.read_text(encoding="utf-8", errors="replace"))
        for sym, line in exports_of(f).items():
            imps = set(graph.get((rel, sym), set())) | ns_importers.get(rel, set())
            imps.discard(rel)
            same_dir, other_src, tests, tooling = [], [], [], []
            for i in sorted(imps):
                if is_test(i):
                    tests.append(i)
                elif i.startswith("src/"):
                    (same_dir if str(Path(i).parent) == d else other_src).append(i)
                else:
                    tooling.append(i)
            framework = conventional_file and sym in NEXT_CONVENTION_SYMBOLS
            zero = (not framework) and not other_src and not same_dir and not tooling
            uses = internal_uses(body, sym, line) if zero else 0
            # Disposition bucket — the distinction the raw zero-importer count hides:
            #   OVER-EXPORTED = live code reached from inside its own file; the
            #                   defect is the `export` keyword, not the code.
            #   DEAD-*        = no reference anywhere; the code itself is dead.
            if not zero:
                bucket = "CONSUMED"
            elif uses > 0:
                bucket = "OVER-EXPORTED"
            elif tests:
                bucket = "DEAD-TESTED"
            else:
                bucket = "DEAD-ISOLATED"
            records.append({
                "file": rel,
                "dir": d,
                "symbol": sym,
                "line": line,
                "loc": decl_loc(body, line) if zero else 0,
                "internalUses": uses,
                "bucket": bucket,
                "frameworkContract": framework,
                "consumersOutsideDir": other_src,
                "consumersSameDir": same_dir,
                "toolingConsumers": tooling,
                "testConsumers": tests,
                "zeroConsumer": zero,
                "testedOnly": zero and bool(tests),
            })

    dead = [r for r in records if r["zeroConsumer"]]
    tested_dead = [r for r in records if r["testedOnly"]]
    truly_dead = [r for r in records if r["bucket"].startswith("DEAD")]

    extra = [REPO.parent / "lyra-mcp-server", REPO.parent / "lyra-admin-mcp-server"]
    syms = sorted({r["symbol"] for r in dead if len(r["symbol"]) > 4})
    hits = string_hits(syms, extra)

    by_file: dict[str, list[str]] = defaultdict(list)
    for r in dead:
        by_file[r["file"]].append(r["symbol"])

    out = {
        "$comment": "KAN-422 R7 — zero-consumer export enumeration. Reproduce with "
                    "`python3 docs/modularisation/kan422-dead-exports.py`.",
        "generatedFrom": subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO,
                                        capture_output=True, text=True).stdout.strip(),
        "totals": {
            "srcFilesScanned": len(src_files),
            "exportedSymbols": len(records),
            "frameworkContractSymbols": sum(1 for r in records if r["frameworkContract"]),
            "zeroConsumerSymbols": len(dead),
            "zeroConsumerButTested": len(tested_dead),
            "bucket_OVER_EXPORTED": sum(1 for r in dead if r["bucket"] == "OVER-EXPORTED"),
            "bucket_DEAD_TESTED": sum(1 for r in dead if r["bucket"] == "DEAD-TESTED"),
            "bucket_DEAD_ISOLATED": sum(1 for r in dead if r["bucket"] == "DEAD-ISOLATED"),
            "deadLOC": sum(r["loc"] for r in truly_dead),
            "overExportedLOC": sum(r["loc"] for r in dead if r["bucket"] == "OVER-EXPORTED"),
            "filesWithAnyZeroConsumerExport": len(by_file),
            "filesEntirelyZeroConsumer": sum(
                1 for f, s in by_file.items()
                if len(s) == len([r for r in records if r["file"] == f and not r["frameworkContract"]])
            ),
        },
        "zeroConsumerByFile": {f: sorted(s) for f, s in sorted(by_file.items())},
        "zeroConsumerSymbols": sorted(dead, key=lambda r: (r["file"], r["symbol"])),
        "stringReachability": hits,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out["totals"], indent=1))
    print(f"\nwrote {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
