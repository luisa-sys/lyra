#!/usr/bin/env python3
"""CTL-051 — enforce the layered architecture modules.json already declares.

WHY THIS EXISTS
---------------
`modules.json` describes a complete dependency architecture: every module has a
`layer`, a `mayDependOn`, a `mustNot`, and the file carries an explicit
`layerPolicy`:

    edge src->dst allowed iff layer(dst) < layer(src) OR dst in declaredSameLayer[src]
    upwardEdges: FORBIDDEN ABSOLUTELY - no declaration can legalise one

Nothing checked any of it. Every one of the 21 modules carried `"enforced":
false`, and no script or test read that field — so the manifest was a
description of an architecture rather than a constraint on one. Measured when
this landed: 62 cross-module edges, **12 of them violating the declared
policy**, including `access` (L2) importing `admin` (L4).

That is the shape this repo keeps finding: a declaration standing in for a
control. The KAN-425 scope note in `.dependency-cruiser.cjs` says the remaining
rules "need modules.json and land in KAN-415 C2" — modules.json is now complete,
so they can.

WHY NOT A dependency-cruiser RULE
---------------------------------
depcruise rules are path regexes. The policy here is a function of two JSON
fields (`layer`, `declaredSameLayer`) across 21 modules, which would mean
generating ~400 pairwise rules and regenerating them whenever a layer changes —
a derived artefact that goes stale exactly like the path literals KAN-419
measured at 18% dead. Reading the manifest directly keeps one source of truth.

depcruise is still what produces the GRAPH; this script only classifies it.

WHAT IT ASSERTS
---------------
For every import edge between two different modules:

1. LAYER RULE. `layer(dst) < layer(src)`, or `dst` appears in the
   `declaredSameLayer` list for `src`. An UPWARD edge is a violation no
   declaration can legalise — that is the manifest's own wording, and it is
   why `declaredSameLayer` cannot rescue one.
2. MUSTNOT. `dst` must not appear in `src`'s `mustNot` list. Largely implied by
   the layer rule today, and kept because the two are independent declarations:
   if someone renumbers a layer, this catches the edge the renumbering just
   legalised. Two statements of the same intent that must agree.
3. DECLARED DEPENDENCY (KAN-415 C2 `no-undeclared-module-dep`). `dst` must
   appear in `src`'s `mayDependOn`. This is the rule that catches what the
   layer rule structurally CANNOT: a *downward* edge is legal at every layer,
   so without this any module may quietly acquire a dependency on any lower
   one. Measured when it landed: of 62 cross-module edges, 50 were declared, 9
   sat in `mayDependOnCandidatesPendingDecision` and 3 were declared nowhere.
   The two are reported as distinct kinds — `pending-decision` records an
   architecture question the manifest itself says is open, `undeclared-dep` is
   plain drift — because collapsing them would lose the only signal
   distinguishing "not decided" from "not noticed".

...and, before any of that, the manifest is checked against ITSELF.

   A permission that contradicts the policy is worse than a missing one,
   because it reads as approval. `trust-safety.mayDependOn` contained `admin`
   — an L3 -> L4 edge, which `layerPolicy` calls forbidden absolutely, so the
   grant could never be honoured — while the same edge ALSO sat in that
   module's pending-decision list. One entry claiming the question was both
   settled and open. Contradictions are NOT baselineable: a baseline records an
   accepted violation of the policy, and an incoherent policy has nothing to
   violate. Fix the manifest.

MODULE-LEVEL CYCLES ARE ALREADY COVERED — deliberately not a fourth rule.
depcruise's `no-circular` works on FILES and reports zero, but the module graph
has four cycles: access<->admin, admin<->trust-safety, age<->auth and
profile<->recommendations. Each is one legal downward edge plus one upward edge
that rule 1 already flags, which is the point of a strict layering — drive the
upward edges to zero and cycles become unrepresentable. A separate cycle check
would add a second baseline listing the same edges.

⚠️ TWO-WAY RATCHET, NOT A SUPPRESSION LIST.
The 12 violations present when this landed are grandfathered in
`modules-layering-baseline.json`, because a control that is red on the day it
ships is a control someone turns off. The baseline may only SHRINK: a NEW
violation fails, and so does a baselined one that has been FIXED. Without the
second half this becomes a place to record architecture drift rather than a
record of it being paid down.

⚠️ FAIL-CLOSED.
An unreadable manifest, an unproducible graph, or a corrupt baseline exits 2 —
distinct from 1 (ran, found violations). A control that cannot run must never
report clean; that is SEC-136, live in this repo three weeks ago.

USAGE
    python3 scripts/check-module-layering.py
    python3 scripts/check-module-layering.py --self-test
    python3 scripts/check-module-layering.py --write-baseline
    python3 scripts/check-module-layering.py --graph <depcruise.json>   # tests
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "modules.json"
BASELINE = REPO_ROOT / "modules-layering-baseline.json"
DEPCRUISE_CONFIG = REPO_ROOT / ".dependency-cruiser.cjs"


class LayeringError(RuntimeError):
    """Raised when the check cannot run. Never swallowed into a clean result."""


# --------------------------------------------------------------------------
# manifest
# --------------------------------------------------------------------------


def load_manifest() -> dict:
    if not MANIFEST.exists():
        raise LayeringError(f"{MANIFEST.name} is missing")
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LayeringError(f"{MANIFEST.name} is not valid JSON: {exc}") from exc


def owner_of(path: str, modules: dict) -> str | None:
    """Most-specific declaration wins.

    Identical to the rule modules-manifest-integrity.test.js pins. Longest
    matching prefix, so `src/lib/recommend/convene/` beats `src/lib/recommend/`
    when both are declared by different modules.
    """
    best, best_len = None, -1
    for name, mod in modules.items():
        for raw in mod.get("paths", []):
            p = raw.rstrip("/")
            if path == p or path.startswith(p + "/"):
                if len(p) > best_len:
                    best, best_len = name, len(p)
    return best


def same_layer_allowances(manifest: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for entry in manifest.get("layerPolicy", {}).get("declaredSameLayer", []):
        out.setdefault(entry["from"], set()).add(entry["to"])
    return out


def contradictions(manifest: dict) -> list[str]:
    """Places where the manifest disagrees with itself.

    Checked BEFORE the graph, and never baselineable. A baseline records an
    accepted violation OF the policy; an incoherent policy is not something an
    edge can violate, so grandfathering one would mean grandfathering the
    yardstick. Every finding here is fixed by editing modules.json.

    The one that motivated this: `trust-safety.mayDependOn` granted `admin`,
    an L3 -> L4 edge the same file calls "FORBIDDEN ABSOLUTELY", while listing
    that identical edge as an open question in its pending-decision list. A
    grant that can never be honoured is not harmless — it reads as approval to
    anyone checking whether the dependency is allowed, and it would activate
    silently the day layer precedence changed.
    """
    modules = manifest["modules"]
    layer = {n: d["layer"] for n, d in modules.items()}
    same = same_layer_allowances(manifest)
    found: list[str] = []

    for name in sorted(modules):
        mod = modules[name]
        may = list(mod.get("mayDependOn", []))
        pending = list(mod.get("mayDependOnCandidatesPendingDecision", []))
        must = list(mod.get("mustNot", []))

        for field, targets in (
            ("mayDependOn", may),
            ("mayDependOnCandidatesPendingDecision", pending),
            ("mustNot", must),
        ):
            for t in targets:
                if t not in modules:
                    found.append(f"{name}.{field} names `{t}`, which is not a module")

        for t in may:
            if t not in modules:
                continue
            if layer[t] > layer[name]:
                found.append(
                    f"{name}.mayDependOn grants `{t}` — an UPWARD edge "
                    f"L{layer[name]} -> L{layer[t]}, which layerPolicy forbids "
                    f"absolutely. The grant can never be honoured."
                )
            elif layer[t] == layer[name] and t not in same.get(name, set()):
                found.append(
                    f"{name}.mayDependOn grants `{t}` — a same-layer L{layer[name]} "
                    f"edge absent from layerPolicy.declaredSameLayer."
                )
            if t in must:
                found.append(f"{name} declares `{t}` in BOTH mayDependOn and mustNot")
            if t in pending:
                found.append(
                    f"{name} declares `{t}` in BOTH mayDependOn and "
                    f"mayDependOnCandidatesPendingDecision — settled and open at once"
                )

    return found


# --------------------------------------------------------------------------
# graph
# --------------------------------------------------------------------------


def run_depcruise() -> dict:
    """Produce the import graph. depcruise is the repo's existing instrument."""
    cmd = ["npx", "depcruise", "--config", str(DEPCRUISE_CONFIG), "src", "--output-type", "json"]
    try:
        proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as exc:
        raise LayeringError(f"could not run dependency-cruiser: {exc}") from exc
    # depcruise exits non-zero when its OWN rules find violations, which says
    # nothing about whether the graph was produced. Judge the output, not the rc.
    if not proc.stdout.strip():
        raise LayeringError(f"dependency-cruiser produced no output (exit {proc.returncode}): {proc.stderr[:400]}")
    return parse_graph(proc.stdout)


def parse_graph(text: str) -> dict:
    try:
        graph = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LayeringError(f"dependency graph is not JSON: {exc}") from exc
    if not isinstance(graph, dict) or not isinstance(graph.get("modules"), list):
        raise LayeringError("dependency graph has no modules list")
    if not graph["modules"]:
        raise LayeringError("dependency graph is EMPTY — refusing to report clean over nothing")
    return graph


# --------------------------------------------------------------------------
# classification
# --------------------------------------------------------------------------


def classify(graph: dict, manifest: dict) -> dict:
    """Every cross-module edge, split into legal and violating."""
    modules = manifest["modules"]
    layer = {n: d["layer"] for n, d in modules.items()}
    same = same_layer_allowances(manifest)

    edges: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for entry in graph["modules"]:
        src_file = entry.get("source", "")
        src = owner_of(src_file, modules)
        if src is None:
            continue
        for dep in entry.get("dependencies", []):
            dst_file = dep.get("resolved", "")
            dst = owner_of(dst_file, modules)
            if dst is None or dst == src:
                continue
            edges.setdefault((src, dst), []).append((src_file, dst_file))

    violations = []
    for (src, dst), examples in sorted(edges.items()):
        # (kind, detail). The KIND is what the ratchet compares — a stable
        # enum, so rewording a message does not invalidate every baseline
        # entry, while an edge that starts violating for an ADDITIONAL reason
        # still fails instead of hiding under a key that is already listed.
        reasons: list[tuple[str, str]] = []
        if layer[dst] > layer[src]:
            reasons.append(("upward", f"UPWARD edge L{layer[src]} -> L{layer[dst]} (forbidden absolutely)"))
        elif layer[dst] == layer[src] and dst not in same.get(src, set()):
            reasons.append(("same-layer", f"same-layer L{layer[src]} edge not in declaredSameLayer"))
        if dst in modules[src].get("mustNot", []):
            reasons.append(("must-not", f"`{dst}` is in `{src}`.mustNot"))
        if dst not in modules[src].get("mayDependOn", []):
            if dst in modules[src].get("mayDependOnCandidatesPendingDecision", []):
                reasons.append(
                    ("pending-decision", f"`{dst}` is only a PENDING candidate in `{src}`.mayDependOn")
                )
            else:
                reasons.append(("undeclared-dep", f"`{dst}` is not in `{src}`.mayDependOn"))
        if reasons:
            violations.append(
                {
                    "from": src,
                    "to": dst,
                    "kinds": sorted(k for k, _ in reasons),
                    "reasons": [d for _, d in reasons],
                    "example": f"{examples[0][0]} -> {examples[0][1]}",
                    "edge_count": len(examples),
                }
            )

    return {"edges": len(edges), "violations": violations}


def key(v: dict) -> str:
    return f"{v['from']} -> {v['to']}"


def baselined_kinds(entry: object) -> list[str]:
    """The kinds recorded for one baseline entry."""
    if isinstance(entry, dict):
        return sorted(entry.get("kinds", []))
    # A pre-kinds baseline (or a hand-written stub) carries no kind data. Treat
    # it as matching whatever is found rather than inventing a mismatch — the
    # key-level ratchet still applies, and --write-baseline upgrades it.
    return []


def evaluate(actual: dict, baseline: dict) -> list[str]:
    """Three-way: NEW fails, FIXED-but-still-baselined fails, and a baselined
    edge that acquires a violation kind it was not baselined for fails too.

    That third case is the one a key-only comparison misses. When rule 3 was
    added, every already-baselined edge could have silently absorbed it —
    the key was listed, so nothing would have gone red, and a new class of
    violation would have arrived pre-suppressed on twelve edges.
    """
    was = baseline.get("violations", {})
    now = {key(v): v for v in actual["violations"]}
    failures = []
    for k in sorted(set(now) - set(was)):
        v = now[k]
        failures.append(f"NEW  {k} — {'; '.join(v['reasons'])}\n         e.g. {v['example']}")
    for k in sorted(set(was) - set(now)):
        failures.append(
            f"STALE  {k} is baselined but no longer violates. "
            f"Remove it from the baseline in the same commit that fixed it."
        )
    for k in sorted(set(now) & set(was)):
        had, has = baselined_kinds(was[k]), now[k]["kinds"]
        if had and had != has:
            gained = sorted(set(has) - set(had))
            lost = sorted(set(had) - set(has))
            what = []
            if gained:
                what.append(f"newly violates: {', '.join(gained)}")
            if lost:
                what.append(f"no longer violates: {', '.join(lost)}")
            failures.append(
                f"CHANGED  {k} is baselined, but for different reasons "
                f"({'; '.join(what)}). A baselined key is not a blanket permit."
            )
    return failures


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    failures: list[str] = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    mods = {
        "kernel": {"layer": 0, "paths": ["src/k/"], "mustNot": ["ui"], "mayDependOn": []},
        "mid": {"layer": 1, "paths": ["src/m/"], "mustNot": [], "mayDependOn": ["kernel", "midb"]},
        "midb": {"layer": 1, "paths": ["src/b/"], "mustNot": [], "mayDependOn": ["kernel"]},
        "ui": {"layer": 2, "paths": ["src/u/"], "mustNot": [], "mayDependOn": ["mid"]},
    }
    manifest = {
        "modules": mods,
        "layerPolicy": {"declaredSameLayer": [{"from": "mid", "to": "midb", "reason": "fixture"}]},
    }

    def graph_of(pairs):
        by_src = {}
        for s, d in pairs:
            by_src.setdefault(s, []).append({"resolved": d})
        return {"modules": [{"source": s, "dependencies": deps} for s, deps in by_src.items()]}

    # --- ownership: most specific wins ------------------------------------
    nested = {"outer": {"layer": 1, "paths": ["src/x/"], "mustNot": []},
              "inner": {"layer": 1, "paths": ["src/x/y/"], "mustNot": []}}
    check("most specific path wins", owner_of("src/x/y/a.ts", nested), "inner")
    check("outer keeps its own files", owner_of("src/x/a.ts", nested), "outer")
    check("unowned resolves to None", owner_of("src/zzz/a.ts", nested), None)

    # --- downward edges are legal -----------------------------------------
    r = classify(graph_of([("src/u/a.ts", "src/m/b.ts")]), manifest)
    check("a downward edge is legal", r["violations"], [])

    # --- upward edges are violations, and cannot be declared away ---------
    r = classify(graph_of([("src/k/a.ts", "src/u/b.ts")]), manifest)
    check("an upward edge violates", len(r["violations"]), 1)
    check("upward is reported as upward", "UPWARD" in r["violations"][0]["reasons"][0], True)
    # kernel.mustNot names ui, and kernel.mayDependOn is empty, so all three
    # rules must fire — they are independent declarations and a violation
    # should say so. Asserted by NAME rather than by count: a count of N is
    # satisfied by any N reasons, and this assertion exists to prove that
    # `mustNot` is reported ALONGSIDE the layer rule rather than instead of it.
    check(
        "every independent rule that the edge breaks is reported",
        r["violations"][0]["kinds"],
        ["must-not", "undeclared-dep", "upward"],
    )

    # --- same-layer: declared vs undeclared -------------------------------
    r = classify(graph_of([("src/m/a.ts", "src/b/b.ts")]), manifest)
    check("a DECLARED same-layer edge is legal", r["violations"], [])
    r = classify(graph_of([("src/b/a.ts", "src/m/b.ts")]), manifest)
    check("the reverse direction is NOT declared, so it violates", len(r["violations"]), 1)

    # --- mustNot fires even when the layer rule would allow the edge ------
    m2 = json.loads(json.dumps(manifest))
    m2["modules"]["ui"]["mustNot"] = ["mid"]
    r = classify(graph_of([("src/u/a.ts", "src/m/b.ts")]), m2)
    check("mustNot catches an otherwise-legal downward edge", len(r["violations"]), 1)

    # --- rule 3: the declared-dependency rule -----------------------------
    # ui.mayDependOn lists `mid` but not `kernel`. Both edges are DOWNWARD and
    # so indistinguishable to rule 1 — which is exactly the gap rule 3 fills.
    r = classify(graph_of([("src/u/a.ts", "src/k/b.ts")]), manifest)
    check("an undeclared downward edge violates", len(r["violations"]), 1)
    check("...and is reported as undeclared", r["violations"][0]["kinds"], ["undeclared-dep"])
    r = classify(graph_of([("src/u/a.ts", "src/m/b.ts")]), manifest)
    check("a DECLARED downward edge stays legal", r["violations"], [])

    m3 = json.loads(json.dumps(manifest))
    m3["modules"]["ui"]["mayDependOnCandidatesPendingDecision"] = ["kernel"]
    r = classify(graph_of([("src/u/a.ts", "src/k/b.ts")]), m3)
    check(
        "an OPEN question is a distinct kind, not silent approval",
        r["violations"][0]["kinds"],
        ["pending-decision"],
    )

    # --- ratchet ----------------------------------------------------------
    actual = classify(graph_of([("src/k/a.ts", "src/u/b.ts")]), manifest)
    check("a NEW violation fails", any("NEW" in f for f in evaluate(actual, {"violations": {}})), True)
    base_ku = {"violations": {"kernel -> ui": {"kinds": actual["violations"][0]["kinds"]}}}
    check("a baselined violation passes", evaluate(actual, base_ku), [])
    check(
        "a FIXED baselined violation fails as stale",
        any("STALE" in f for f in evaluate({"edges": 0, "violations": []}, base_ku)),
        True,
    )
    # The case a key-only ratchet misses: same edge, extra rule broken.
    check(
        "a baselined edge that gains a violation kind fails as CHANGED",
        any("CHANGED" in f for f in evaluate(actual, {"violations": {"kernel -> ui": {"kinds": ["upward"]}}})),
        True,
    )

    # --- manifest self-consistency ----------------------------------------
    check("a coherent manifest has no contradictions", contradictions(manifest), [])
    m4 = json.loads(json.dumps(manifest))
    m4["modules"]["kernel"]["mayDependOn"] = ["ui"]
    got = contradictions(m4)
    check("an unhonourable upward GRANT is a contradiction", len(got), 2)  # upward + mustNot clash
    check("...and says so", any("UPWARD" in g for g in got), True)
    m5 = json.loads(json.dumps(manifest))
    m5["modules"]["ui"]["mayDependOn"] = ["mid", "ghost"]
    check(
        "a grant naming a non-module is a contradiction",
        any("not a module" in g for g in contradictions(m5)),
        True,
    )
    m6 = json.loads(json.dumps(manifest))
    m6["modules"]["ui"]["mayDependOnCandidatesPendingDecision"] = ["mid"]
    check(
        "settled-and-open at once is a contradiction",
        any("settled and open at once" in g for g in contradictions(m6)),
        True,
    )

    # --- fail-closed on unusable graphs -----------------------------------
    for label, text in [
        ("a non-JSON graph", "<html>error</html>"),
        ("a graph with no modules list", '{"summary":{}}'),
        ("an EMPTY module list", '{"modules":[]}'),
    ]:
        try:
            parse_graph(text)
            raised = False
        except LayeringError:
            raised = True
        check(f"{label} raises rather than reporting clean", raised, True)

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


SELF_TEST_CASES = 27


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="CTL-051 — module layering policy")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--graph", help="read a depcruise JSON instead of running it (tests)")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        manifest = load_manifest()
        graph = parse_graph(Path(args.graph).read_text(encoding="utf-8")) if args.graph else run_depcruise()
        actual = classify(graph, manifest)
    except (LayeringError, OSError) as exc:
        print(f"::error::check-module-layering: {exc}")
        print("::error::  Failing closed (exit 2): a check that could not run is not a clean result.")
        return 2

    # The manifest is judged before the graph. A contradiction means the
    # yardstick is bent, and every verdict measured against it is suspect —
    # including a clean one. Not baselineable, and not exit 2 either: the check
    # ran fine, it found a defect.
    if bad := contradictions(manifest):
        print("::error::modules.json contradicts itself.")
        for c in bad:
            print(f"::error::  {c}")
        print()
        print("A permission the policy forbids is worse than a missing one: it reads as")
        print("approval. Fix modules.json — these are not baselineable, because a baseline")
        print("records an accepted violation of the policy, and an incoherent policy has")
        print("nothing to violate.")
        return 1

    if args.write_baseline:
        payload = {
            "_why": [
                "CTL-051. Cross-module edges that violate the dependency policy",
                "modules.json declares — the layer rule, `mustNot`, and `mayDependOn` —",
                "as they stood when each rule landed. Grandfathered so the control could",
                "ship green.",
                "",
                "SHRINK-ONLY, BOTH WAYS. A new violation fails; a baselined one that has",
                "been FIXED also fails, so this cannot become a place to record drift.",
                "Regenerate with --write-baseline in the same commit that fixes one.",
                "",
                "`kinds` is part of the ratchet. A key listed here is not a blanket",
                "permit: if a baselined edge starts violating for an ADDITIONAL reason,",
                "that fails too. Without it, adding a rule would have arrived",
                "pre-suppressed on every edge already listed.",
                "",
                "`pending-decision` means the manifest itself records the architecture",
                "question as open (mayDependOnCandidatesPendingDecision), as against",
                "`undeclared-dep`, which is a dependency nobody declared at all.",
            ],
            "ticket": "KAN-415",
            "violations": {
                key(v): {
                    "kinds": v["kinds"],
                    "detail": f"{'; '.join(v['reasons'])} | e.g. {v['example']}",
                }
                for v in actual["violations"]
            },
        }
        BASELINE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {BASELINE.name}: {len(actual['violations'])} violation(s) across {actual['edges']} edges")
        return 0

    if not BASELINE.exists():
        print(f"::error::check-module-layering: {BASELINE.name} is missing — refusing to")
        print("::error::  report clean with nothing to compare against.")
        return 2
    try:
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"::error::check-module-layering: {BASELINE.name} is not valid JSON: {exc}")
        return 2

    failures = evaluate(actual, baseline)
    print(
        f"{actual['edges']} cross-module edge(s); "
        f"{len(actual['violations'])} violate the declared policy "
        f"({len(baseline.get('violations', {}))} baselined)"
    )

    if failures:
        print()
        print("::error::Module layering policy FAILED.")
        for f in failures:
            print(f"::error::  {f}")
        print()
        print("modules.json declares: edge src->dst is allowed iff layer(dst) < layer(src),")
        print("or dst is in declaredSameLayer[src]; dst is absent from src.mustNot; and dst")
        print("is present in src.mayDependOn. An UPWARD edge is forbidden absolutely — no")
        print("declaration can legalise one.")
        print()
        print("A NEW violation means an import crossed a boundary the architecture forbids.")
        print("Move the shared code down a layer, or make the dependency explicit in")
        print("modules.json if the architecture is what changed. `undeclared-dep` alone")
        print("means the edge is legal by layer but nobody declared it — usually one line")
        print("added to mayDependOn, and the point is that the line is reviewed. A STALE")
        print("entry means a violation was fixed without shrinking the baseline; a CHANGED")
        print("entry means a baselined edge now breaks a rule it was not baselined for.")
        print("Both are resolved the same way:")
        print("    python3 scripts/check-module-layering.py --write-baseline")
        return 1

    print("Layering matches the baseline. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
