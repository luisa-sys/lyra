#!/usr/bin/env python3
"""CTL-055 / KAN-415 §4.3 — every database call belongs to a module that owns the table.

WHY THIS EXISTS
---------------
`modules.json` records, per module, an `owns.tables` and `owns.rpcs` list. Until
now **nothing read them**. 242 non-`profiles` `.from()`/`.rpc()` call sites, an
ownership map covering every module, and no check that the two agree.

The plan named this script in §4.3 and it was never written. It is the missing
half of KAN-415 criterion 3: the criterion's other half (relocating call sites
into `src/modules/*/data/**`) is a large programme gated on decisions that are
not taken, but *asserting that a module only touches tables it owns* needs no
relocation at all and can land today.

WHAT IT CATCHES, CONCRETELY
---------------------------
The motivating case is Convene. It is otherwise the best-contained module in the
estate — exactly 2 declared entry points, all outward edges legal and downward,
both enforced two-way by CTL-051/CTL-053. And it still makes **12 database calls
on 4 tables it does not own**, which no control could see. Boundary enforcement
on the IMPORT graph says nothing about the DATA graph, and the data graph is
where a dark, un-soaked feature can reach into another module's state.

⚠️ `profiles` IS DELIBERATELY OUT OF SCOPE, AND THAT IS A STATED GAP.
`profiles` is co-owned at COLUMN granularity — 8 modules declare
`owns.profilesColumns`, covering 37 of its 42 columns with zero bogus claims —
and no module owns the table. Enforcing it here at table granularity would
therefore flag all 68 call sites as violations, which is not the policy.

Enforcing it at COLUMN granularity was considered and rejected for v1, because
it cannot be done honestly with static analysis: of 18 `profiles` writes, **6
pass a variable rather than a literal object**, so their column set is not
statically knowable. A gate covering the 12 literal writes and silently passing
the other 6 would report clean over exactly the shape BUGS-74 was — a partial
write destroying columns the caller never named.

The column contract is instead pinned at RUNTIME by
`tests/unit/partial-write-safety.test.ts`, which discovers every reader of a
form-backed table by scanning the tree and checks each field allowlist against
the actually-migrated columns. That is the right instrument for it. This script
records the boundary rather than pretending to cover it.

⚠️ RATCHET WITH THREE WAYS TO FAIL.
The 56 (module, table) pairs present when this landed are grandfathered in
`supabase/table-ownership-baseline.json`, because a control red on the day it
ships is a control someone turns off. A NEW pair fails; a baselined pair that
has been FIXED fails as STALE; and a pair baselined as a READ that starts
WRITING fails as ESCALATED.

That third case is the one the first cut of this control could not see. A pair
is keyed `module -> table`, so a baselined read that quietly became a write kept
its key and stayed green — a module beginning to mutate state it does not own,
with nothing going red. That is the BUGS-74 shape.

⚠️ `mode` IS THE FIELD THAT MATTERS.
`owns` means "this module may WRITE this table", so a cross-module READ is
legitimate and is not work; a cross-module WRITE is a real boundary break. At
landing: **44 read, 12 write**. Only the writes are a list of things to fix.
Demanding a ticket and an expiry on all 56 would be a renewal ritual over
mostly-fine entries, which is how a ratchet decays into a suppression list.

⚠️ `basis` SAYS HOW MUCH TO TRUST EACH `write`.
Of the 12: **7 are `mutation-call`** — a literal `.insert/.update/.upsert/
.delete`, hard evidence. **5 are `rpc-undecidable`** — the function body is SQL
and not in this import tree, so they are flagged conservatively rather than
guessed at. Verify one against `supabase/migrations/` before treating it as a
find: `account -> search_by_contact_hash` is a pure `return query select` in
`20260713093000_sec80_contact_hash_suspended_guard.sql`, so it is an over-flag,
exactly as designed. A list of 12 "boundary breaks" containing an over-flag
nobody labelled is a list people stop trusting.

⚠️ That last example carries a SEPARATE, worse problem, and the two are easy to
conflate. The daily security routine reports under **SEC-107** that
`search_by_contact_hash` does not exist on PRODUCTION at all — so the migration
above says one thing and the live database says another. Nothing here can see
that: this control reads the repo, and a call site to a function that was never
applied looks identical to one that works. The classification above is a
statement about the migration, not about prod. Do not read a green run here as
evidence that any RPC exists where it is called.

⚠️ READ `_concentration` BEFORE PROPOSING A CLEANUP.
29 of the 56 pairs come from ONE file — the account erasure/export path, which
touches every table a user has data in *by definition*. That is a legitimate
cross-cutting concern, not 29 boundary breaks, and the baseline computes the
figure at write time so nobody has to remember it.

USAGE
    python3 scripts/check-module-table-ownership.py
    python3 scripts/check-module-table-ownership.py --self-test
    python3 scripts/check-module-table-ownership.py --write-baseline

EXIT CODES
    0  every database call is on a table its module owns, or is baselined
    1  a NEW pair, a STALE baseline entry, or a read that ESCALATED to a write
    2  the check could not run
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Co-owned at column granularity; see the module docstring. Not a convenience
# exemption — a policy statement with a named alternative instrument.
COLUMN_OWNED_TABLES = {"profiles"}

CALL_RE = re.compile(r"""\.(?:from|rpc)\(\s*['"]([A-Za-z0-9_]+)['"]""")
# A commented-out call is documentation, not an access (CTL-039).
COMMENT_RE = re.compile(r"^\s*(//|\*|/\*)")

# The four PostgREST mutations. `.rpc()` is deliberately NOT here: a function
# may do either, its body is not in this tree, and guessing from the name would
# be a classification nobody could check.
WRITE_RE = re.compile(r"\.(?:insert|update|upsert|delete)\s*\(")
# The only decidable READ marker. `.single()`/`.maybeSingle()` always follow a
# `.select()`, so this one pattern is sufficient and nothing else is guessed at.
READ_RE = re.compile(r"\.select\s*\(")
# Used only to explain WHY a call was undecidable, never to classify it.
RPC_RE = re.compile(r"\.rpc\s*\(")
# How far a chained statement may run before it is called undecidable. Measured:
# the longest real chain in this tree closes well inside this.
STATEMENT_LINES = 8

# A floor well below the measured 242, so a scan that silently stops finding
# call sites fails rather than reporting a clean estate.
MIN_CALL_SITES = 60


class OwnershipError(RuntimeError):
    """Raised when the check cannot run. Never swallowed into a clean result."""


def load_manifest(path: Path) -> dict:
    if not path.exists():
        raise OwnershipError(f"{path.name} is missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OwnershipError(f"{path.name} is not valid JSON: {exc}") from exc
    if not isinstance(data.get("modules"), dict) or not data["modules"]:
        raise OwnershipError(f"{path.name} declares no modules")
    return data


def owner_of(path: str, modules: dict) -> str | None:
    """Most-specific declaration wins. The rule CTL-041/051/053 all use."""
    best, best_len = None, -1
    for name, mod in modules.items():
        for raw in mod.get("paths", []):
            p = raw.rstrip("/")
            if path == p or path.startswith(p + "/"):
                if len(p) > best_len:
                    best, best_len = name, len(p)
    return best


def tracked_sources(root: Path) -> list[str]:
    """git ls-files, never a disk walk: `git mv` leaves an empty dir behind."""
    try:
        out = subprocess.run(
            ["git", "ls-files", "src"], cwd=root, capture_output=True, text=True, timeout=120
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise OwnershipError(f"could not list tracked files: {exc}") from exc
    files = [f for f in out.stdout.split() if f.endswith((".ts", ".tsx"))]
    if not files:
        raise OwnershipError("git ls-files src returned no TypeScript files")
    return files


def mode_of(lines: list[str], i: int) -> tuple[str, str]:
    """`(mode, basis)` for the call starting at line `i`.

    ⚠️ WHICH WAY THIS FAILS IS THE WHOLE DESIGN.

    A cross-module READ is legitimate under the model `owns` encodes — "this
    module may WRITE this table" — and 44 of the 56 baselined pairs are reads.
    A cross-module WRITE is a real boundary break. So the classification is what
    makes the baseline a short list of 12 things to look at rather than a
    renewal ritual over 56 things that are mostly fine.

    Misclassifying a write as a read is therefore the dangerous direction: the
    pair lands in the accepted-reads bucket and a later escalation cannot be
    detected, because it was already a write in truth. Misclassifying a read as
    a write costs one annotation.

    So an UNDECIDABLE statement is classified `write`. Concretely, that is a
    statement whose chain runs past the window without terminating — usually
    because the builder was assigned to a variable and mutated elsewhere, which
    static analysis cannot follow. Failing toward scrutiny is the only honest
    default when the alternative is a silent gap of exactly the BUGS-74 shape.
    """
    depth = 0
    saw_read = False
    for j in range(i, min(i + STATEMENT_LINES, len(lines))):
        seg = lines[j]
        if j > i and COMMENT_RE.match(seg):
            continue
        if WRITE_RE.search(seg):
            return "write", "mutation-call"
        if READ_RE.search(seg):
            saw_read = True
        depth += seg.count("(") - seg.count(")")
        if depth <= 0 and (seg.rstrip().endswith(";") or not seg.strip()):
            break  # statement closed; everything it does has been seen

    # Terminated with a `.select()` and no mutation: a read, decidably.
    if saw_read:
        return "read", "select-call"

    # Everything else is UNDECIDABLE, and undecidable means `write`. The BASIS
    # is recorded so a reader knows which writes are evidence and which are
    # caution — a list of 12 "boundary breaks" where one is an over-flagged
    # read is a list people stop trusting.
    if RPC_RE.search(lines[i]):
        #   `db.rpc('do_the_thing')` — the function body is SQL, not in this
        #   import tree. Guessing from its name would be a classification
        #   nobody could check, which is why `.rpc` is absent from WRITE_RE.
        #   Verify against supabase/migrations/ before treating one as a find.
        return "write", "rpc-undecidable"
    #   `const q = db.from('x');` — a terminated statement that does nothing on
    #   its own; the mutation happens later through the variable, which static
    #   analysis cannot follow. This is the shape that matters most.
    return "write", "opaque-builder"


def scan(files: list[str], modules: dict, root: Path) -> dict:
    """Every (module, table) access pair, plus the call-site count."""
    pairs: dict[tuple[str, str], dict] = {}
    unowned: dict[str, int] = {}
    total = 0
    for rel in files:
        try:
            lines = (root / rel).read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        mod = owner_of(rel, modules)
        for i, line in enumerate(lines):
            if COMMENT_RE.match(line):
                continue
            for table in CALL_RE.findall(line):
                if table in COLUMN_OWNED_TABLES:
                    continue
                total += 1
                if mod is None:
                    unowned[table] = unowned.get(table, 0) + 1
                    continue
                entry = pairs.setdefault(
                    (mod, table), {"sites": [], "mode": "read", "basis": "select-call"}
                )
                entry["sites"].append(rel)
                # A pair is a WRITE if ANY of its call sites writes. One write
                # among twenty reads is still a module writing another's table,
                # and the strongest basis seen is the one worth recording.
                m, basis = mode_of(lines, i)
                if m == "write" and (
                    entry["mode"] != "write" or basis == "mutation-call"
                ):
                    entry["mode"], entry["basis"] = "write", basis
    return {"pairs": pairs, "unowned": unowned, "total": total}


def classify(scanned: dict, manifest: dict) -> dict:
    modules = manifest["modules"]
    owned: dict[str, set[str]] = {}
    for name, mod in modules.items():
        owns = mod.get("owns", {}) or {}
        for t in (owns.get("tables") or []) + (owns.get("rpcs") or []):
            owned.setdefault(t, set()).add(name)

    violations = []
    for (mod, table), entry in sorted(scanned["pairs"].items()):
        if mod not in owned.get(table, set()):
            violations.append(
                {
                    "module": mod,
                    "table": table,
                    "mode": entry["mode"],
                    "basis": entry["basis"],
                    "sites": len(entry["sites"]),
                    "example": entry["sites"][0],
                    "owner": sorted(owned.get(table, set())) or None,
                }
            )
    return {"violations": violations, "total": scanned["total"], "unowned": scanned["unowned"]}


def key(v: dict) -> str:
    return f"{v['module']} -> {v['table']}"


def baseline_mode(entry) -> str:
    """The recorded mode. Tolerates the pre-mode string form as `read`."""
    if isinstance(entry, dict):
        return entry.get("mode", "read")
    return "read"


def evaluate(actual: dict, baseline: dict) -> list[str]:
    """Three ways to fail: NEW, STALE, and ESCALATED.

    The first two are the ordinary two-way ratchet. The third is the one that
    matters most and the one the first cut of this control could not see: a pair
    is keyed `module -> table`, so a baselined READ that quietly becomes a WRITE
    kept the same key and stayed green. That is precisely the BUGS-74 shape — a
    module beginning to mutate state it does not own, with no diff to any
    baseline and nothing going red.

    De-escalation (write -> read) is a FIX, so it fails as stale-ish too: the
    record must follow the code, or the file stops describing reality.
    """
    was_raw = baseline.get("violations", {})
    was = set(was_raw)
    now = {key(v): v for v in actual["violations"]}
    failures = []
    for k in sorted(set(now) - was):
        v = now[k]
        owner = f"owned by {', '.join(v['owner'])}" if v["owner"] else "owned by NO module"
        failures.append(
            f"NEW    {k}  [{v['mode'].upper()}] ({v['sites']} site(s), {owner})"
            f"\n           e.g. {v['example']}"
        )
    for k in sorted(was - set(now)):
        failures.append(
            f"STALE  {k} is baselined but no longer occurs. "
            f"Remove it in the same commit that fixed it."
        )
    for k in sorted(was & set(now)):
        before, after = baseline_mode(was_raw[k]), now[k]["mode"]
        if before == after:
            continue
        if after == "write":
            failures.append(
                f"ESCALATED  {k} is baselined as a READ and now WRITES.\n"
                f"           e.g. {now[k]['example']}\n"
                f"           A cross-module read is legitimate under `owns` = "
                f"'may write'. A cross-module write is not, and this pair just "
                f"became one without changing its key."
            )
        else:
            failures.append(
                f"STALE  {k} is baselined as a WRITE and now only READS. "
                f"That is a fix — record it with --write-baseline."
            )
    return failures


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    import tempfile

    failures: list[str] = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    mods = {
        "orders": {"paths": ["src/orders/"], "owns": {"tables": ["order"], "rpcs": ["place_order"]}},
        "users": {"paths": ["src/users/"], "owns": {"tables": ["account"]}},
    }
    manifest = {"modules": mods}

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "src" / "orders").mkdir(parents=True)
        (root / "src" / "users").mkdir(parents=True)
        (root / "src" / "orders" / "own.ts").write_text("db.from('order').select()\n")
        (root / "src" / "orders" / "rpc.ts").write_text("db.rpc('place_order', {})\n")
        (root / "src" / "orders" / "foreign.ts").write_text("db.from('account').select()\n")
        (root / "src" / "orders" / "profiles.ts").write_text("db.from('profiles').select()\n")
        (root / "src" / "orders" / "commented.ts").write_text("// db.from('account').select()\nexport const x = 1\n")
        (root / "src" / "nowhere.ts").write_text("db.from('account').select()\n")

        def run(fs):
            return classify(scan(fs, mods, root), manifest)

        r = run(["src/orders/own.ts"])
        check("a module may touch a table it owns", r["violations"], [])

        r = run(["src/orders/rpc.ts"])
        check("owns.rpcs counts too", r["violations"], [])

        r = run(["src/orders/foreign.ts"])
        check("touching another module's table violates", len(r["violations"]), 1)
        check("...and names the real owner", r["violations"][0]["owner"], ["users"])

        r = run(["src/orders/profiles.ts"])
        check("`profiles` is out of scope (column-owned)", r["violations"], [])
        check("...and is not counted at all", r["total"], 0)

        r = run(["src/orders/commented.ts"])
        check("a COMMENTED call is not an access (CTL-039)", r["violations"], [])

        r = run(["src/nowhere.ts"])
        check("a file in no module is reported, not failed", r["violations"], [])
        check("...but is surfaced separately", r["unowned"], {"account": 1})

        # --- read / write classification ----------------------------------
        (root / "src" / "orders" / "reads.ts").write_text(
            "const { data } = await db.from('account').select('*').eq('id', x);\n"
        )
        (root / "src" / "orders" / "writes.ts").write_text(
            "await db.from('account').update({ name }).eq('id', x);\n"
        )
        (root / "src" / "orders" / "multiline.ts").write_text(
            "await db\n  .from('account')\n  .insert({ a: 1 })\n  .select();\n"
        )
        (root / "src" / "orders" / "mixed.ts").write_text(
            "await db.from('account').select('*');\n"
            "await db.from('account').delete().eq('id', x);\n"
        )
        (root / "src" / "orders" / "opaque.ts").write_text(
            "const q = db.from('account');\n" + "// ...\n" * 12 + "await q.update({ a: 1 });\n"
        )

        def mode(fs):
            v = run(fs)["violations"]
            return v[0]["mode"] if v else None

        check("a plain select is a read", mode(["src/orders/reads.ts"]), "read")
        check("an update is a write", mode(["src/orders/writes.ts"]), "write")
        check("a write chained across lines is still a write", mode(["src/orders/multiline.ts"]), "write")
        check("one write among reads makes the PAIR a write", mode(["src/orders/mixed.ts"]), "write")
        check(
            "an undecidable statement is a WRITE, never a silent read",
            mode(["src/orders/opaque.ts"]),
            "write",
        )

        # --- ratchet ------------------------------------------------------
        actual = run(["src/orders/foreign.ts"])
        check("a NEW violation fails", any("NEW" in f for f in evaluate(actual, {"violations": {}})), True)
        base = {"violations": {"orders -> account": {"mode": "read"}}}
        check("a baselined violation passes", evaluate(actual, base), [])

        # --- escalation: the case the first cut could not see --------------
        esc = run(["src/orders/writes.ts"])
        check(
            "a baselined READ that starts WRITING fails as ESCALATED",
            any("ESCALATED" in f for f in evaluate(esc, {"violations": {"orders -> account": {"mode": "read"}}})),
            True,
        )
        check(
            "...and the same pair passes when baselined as a write",
            evaluate(esc, {"violations": {"orders -> account": {"mode": "write"}}}),
            [],
        )
        check(
            "a WRITE that de-escalates to a read fails as STALE",
            any(
                "STALE" in f
                for f in evaluate(actual, {"violations": {"orders -> account": {"mode": "write"}}})
            ),
            True,
        )
        check(
            "a FIXED baselined violation fails as STALE",
            any("STALE" in f for f in evaluate({"violations": [], "total": 0, "unowned": {}}, base)),
            True,
        )

    # --- fail-closed --------------------------------------------------------
    for label, bad in [
        ("a manifest with no modules", {"modules": {}}),
        ("a manifest that is not a dict of modules", {"modules": []}),
    ]:
        try:
            if not isinstance(bad.get("modules"), dict) or not bad["modules"]:
                raise OwnershipError("declares no modules")
            raised = False
        except OwnershipError:
            raised = True
        check(f"{label} raises rather than reporting clean", raised, True)

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  x {f}")
        return 1
    print(f"Self-test passed ({SELF_TEST_CASES} cases).")
    return 0


SELF_TEST_CASES = 21


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="CTL-055 — module table ownership")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--write-baseline", action="store_true")
    # Seams, for tests only. Without them a fixture test can only assert things
    # about THIS repo's modules.json, which is a test of the data rather than of
    # the code (the mistake CTL-053's first draft made).
    ap.add_argument("--root", type=Path, default=REPO_ROOT, help=argparse.SUPPRESS)
    ap.add_argument("--manifest", type=Path, default=None, help=argparse.SUPPRESS)
    ap.add_argument("--baseline", type=Path, default=None, help=argparse.SUPPRESS)
    ap.add_argument(
        "--min-call-sites", type=int, default=MIN_CALL_SITES, help=argparse.SUPPRESS
    )
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    root: Path = args.root
    manifest_path: Path = args.manifest or (root / "modules.json")
    baseline_path: Path = args.baseline or (root / "supabase" / "table-ownership-baseline.json")

    try:
        manifest = load_manifest(manifest_path)
        files = tracked_sources(root)
        actual = classify(scan(files, manifest["modules"], root), manifest)
    except (OwnershipError, OSError) as exc:
        print(f"::error::check-module-table-ownership: {exc}")
        print("::error::  Failing closed (exit 2): a check that could not run is not a clean result.")
        return 2

    if actual["total"] < args.min_call_sites:
        print(f"::error::check-module-table-ownership: only {actual['total']} call site(s) found.")
        print(f"::error::  Expected at least {args.min_call_sites} — the estate has ~242. A scan that")
        print("::error::  suddenly finds almost nothing has broken, not been cleaned up. Failing")
        print("::error::  closed (exit 2): zero findings over zero input is not a pass.")
        return 2

    if args.write_baseline:
        # Concentration is computed, never typed. 29 of the first 56 pairs came
        # from ONE file — the erasure/export path, which touches every table a
        # user has data in by definition. Without this the baseline reads as 56
        # separate tangles and invites a cleanup that would be wrong.
        by_file: dict[str, int] = {}
        for v in actual["violations"]:
            by_file[v["example"]] = by_file.get(v["example"], 0) + 1
        top = sorted(by_file.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
        payload = {
            "_why": [
                "CTL-055. (module -> table) pairs where a module reads or writes a table it",
                "does not declare in owns.tables/owns.rpcs, as they stood when the control",
                "landed. Grandfathered so it could ship green.",
                "",
                "SHRINK-ONLY, AND THREE WAYS TO FAIL. A new pair fails; a baselined pair",
                "that no longer occurs fails as STALE; and a pair baselined as a READ that",
                "starts WRITING fails as ESCALATED. Regenerate with --write-baseline in the",
                "same commit that changes one.",
                "",
                "READ THE `mode` FIELD — IT IS THE POINT OF THIS FILE.",
                "`owns` means 'this module may WRITE this table'. So a cross-module READ is",
                "legitimate and is not work; a cross-module WRITE is a real boundary break.",
                "Only the `write` ones are a list of things to look at. Asking for a ticket",
                "and an expiry on all 56 would be a renewal ritual over mostly-fine entries,",
                "which is how a ratchet decays into a suppression list.",
                "",
                "AND READ `basis` BEFORE TREATING A `write` AS A FINDING.",
                "`mutation-call` is hard evidence: a literal .insert/.update/.upsert/.delete.",
                "`rpc-undecidable` and `opaque-builder` are CONSERVATIVE — the statement could",
                "not be decided statically, so it was called a write rather than assumed",
                "harmless. Verify those against supabase/migrations/ before acting:",
                "`account -> search_by_contact_hash` is provably `return query select` and is",
                "an over-flag, exactly as intended.",
                "",
                "The ESCALATED case is what the first cut of this control could not see. A",
                "pair is keyed `module -> table`, so a baselined read that quietly became a",
                "write kept its key and stayed green -- a module beginning to mutate state it",
                "does not own, with nothing going red. That is the BUGS-74 shape.",
                "",
                "An UNDECIDABLE statement is classified `write`, never `read`. A write hidden",
                "in the accepted-reads bucket can never be caught escalating, because it was",
                "already a write; an over-flagged read costs one annotation.",
                "",
                "`profiles` is absent by policy, not by omission: it is co-owned at COLUMN",
                "granularity (8 modules, 37 of 42 columns) and its column contract is pinned",
                "by tests/unit/partial-write-safety.test.ts. See the script docstring.",
            ],
            "ticket": "KAN-415",
            "_concentration": {
                "$comment": (
                    "Computed at --write-baseline, never typed. Files contributing the most "
                    "pairs. A single file with a large share is usually a legitimate "
                    "cross-cutting concern (erasure, export, admin) rather than N separate "
                    "boundary breaks — read the count here before proposing a cleanup."
                ),
                "pairs": len(actual["violations"]),
                "writes": sum(1 for v in actual["violations"] if v["mode"] == "write"),
                "topFiles": {f: n for f, n in top},
            },
            "violations": {
                key(v): {
                    "mode": v["mode"],
                    "basis": v["basis"],
                    "sites": v["sites"],
                    "owner": v["owner"],
                    "example": v["example"],
                }
                for v in actual["violations"]
            },
        }
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        w = [v for v in actual["violations"] if v["mode"] == "write"]
        hard = sum(1 for v in w if v["basis"] == "mutation-call")
        print(
            f"Wrote {baseline_path.name}: {len(actual['violations'])} pair(s) "
            f"({len(w)} write — {hard} by mutation call, {len(w) - hard} conservative; "
            f"{len(actual['violations']) - len(w)} read) over {actual['total']} call sites"
        )
        return 0

    if not baseline_path.exists():
        print(f"::error::check-module-table-ownership: {baseline_path.name} is missing — refusing to")
        print("::error::  report clean with nothing to compare against.")
        return 2
    try:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"::error::check-module-table-ownership: {baseline_path.name} is not valid JSON: {exc}")
        return 2

    failures = evaluate(actual, baseline)
    ws = [v for v in actual["violations"] if v["mode"] == "write"]
    hard = sum(1 for v in ws if v["basis"] == "mutation-call")
    print(
        f"{actual['total']} database call site(s) outside `profiles`; "
        f"{len(actual['violations'])} (module -> table) pair(s) unowned "
        f"— {len(ws)} WRITE ({hard} by mutation call, {len(ws) - hard} conservative), "
        f"{len(actual['violations']) - len(ws)} read "
        f"({len(baseline.get('violations', {}))} baselined)"
    )
    if actual["unowned"]:
        n = sum(actual["unowned"].values())
        print(f"  note: {n} call site(s) live in files no module claims — not failed, but not covered either")

    if failures:
        print()
        print("::error::Module table ownership FAILED.")
        for f in failures:
            print(f"::error::  {f}")
        print()
        print("A module reached a table it does not declare in modules.json `owns`. Either the")
        print("access belongs elsewhere, or the ownership map is wrong — both are worth a")
        print("moment's thought, which is the point of the gate. If the access is legitimate,")
        print("add the table to that module's `owns.tables` (a visible, reviewed line) or")
        print("record the pair:")
        print("    python3 scripts/check-module-table-ownership.py --write-baseline")
        print()
        print("A STALE entry means the access stopped and the baseline did not follow. Delete")
        print("it — without that half this file could only grow, which is a suppression list.")
        return 1

    print("Every database call is on a table its module owns, or is baselined. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
