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

⚠️ TWO-WAY RATCHET.
The 56 (module, table) pairs present when this landed are grandfathered in
`supabase/table-ownership-baseline.json`, because a control red on the day it
ships is a control someone turns off. A NEW pair fails; a baselined pair that
has been FIXED also fails as STALE, so the list can only shrink. Many baselined
entries are READS of another module's table — legitimate today under a model
where `owns` means "may write" — and the baseline is where that judgement gets
made explicitly, one pair at a time, rather than by a blanket carve-out.

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
    1  a NEW unowned access, or a STALE baseline entry
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


def scan(files: list[str], modules: dict, root: Path) -> dict:
    """Every (module, table) access pair, plus the call-site count."""
    pairs: dict[tuple[str, str], list[str]] = {}
    unowned: dict[str, int] = {}
    total = 0
    for rel in files:
        try:
            lines = (root / rel).read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        mod = owner_of(rel, modules)
        for line in lines:
            if COMMENT_RE.match(line):
                continue
            for table in CALL_RE.findall(line):
                if table in COLUMN_OWNED_TABLES:
                    continue
                total += 1
                if mod is None:
                    unowned[table] = unowned.get(table, 0) + 1
                    continue
                pairs.setdefault((mod, table), []).append(rel)
    return {"pairs": pairs, "unowned": unowned, "total": total}


def classify(scanned: dict, manifest: dict) -> dict:
    modules = manifest["modules"]
    owned: dict[str, set[str]] = {}
    for name, mod in modules.items():
        owns = mod.get("owns", {}) or {}
        for t in (owns.get("tables") or []) + (owns.get("rpcs") or []):
            owned.setdefault(t, set()).add(name)

    violations = []
    for (mod, table), sites in sorted(scanned["pairs"].items()):
        if mod not in owned.get(table, set()):
            violations.append(
                {
                    "module": mod,
                    "table": table,
                    "sites": len(sites),
                    "example": sites[0],
                    "owner": sorted(owned.get(table, set())) or None,
                }
            )
    return {"violations": violations, "total": scanned["total"], "unowned": scanned["unowned"]}


def key(v: dict) -> str:
    return f"{v['module']} -> {v['table']}"


def evaluate(actual: dict, baseline: dict) -> list[str]:
    """Two-way: NEW fails, and FIXED-but-still-baselined fails."""
    was = set(baseline.get("violations", {}))
    now = {key(v): v for v in actual["violations"]}
    failures = []
    for k in sorted(set(now) - was):
        v = now[k]
        owner = f"owned by {', '.join(v['owner'])}" if v["owner"] else "owned by NO module"
        failures.append(f"NEW    {k}  ({v['sites']} site(s), {owner})\n           e.g. {v['example']}")
    for k in sorted(was - set(now)):
        failures.append(
            f"STALE  {k} is baselined but no longer occurs. "
            f"Remove it in the same commit that fixed it."
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

        # --- ratchet ------------------------------------------------------
        actual = run(["src/orders/foreign.ts"])
        check("a NEW violation fails", any("NEW" in f for f in evaluate(actual, {"violations": {}})), True)
        base = {"violations": {"orders -> account": "fixture"}}
        check("a baselined violation passes", evaluate(actual, base), [])
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


SELF_TEST_CASES = 13


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
                "SHRINK-ONLY, BOTH WAYS. A new pair fails; a baselined pair that no longer",
                "occurs fails as STALE. Regenerate with --write-baseline in the same commit",
                "that fixes one.",
                "",
                "Many entries are READS of another module's table, which is legitimate under",
                "a model where `owns` means 'may write'. That judgement belongs here, one",
                "pair at a time, rather than in a blanket carve-out that would also hide the",
                "writes.",
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
                "topFiles": {f: n for f, n in top},
            },
            "violations": {
                key(v): f"{v['sites']} site(s); owned by {', '.join(v['owner']) if v['owner'] else 'NO module'} | e.g. {v['example']}"
                for v in actual["violations"]
            },
        }
        baseline_path.parent.mkdir(parents=True, exist_ok=True)
        baseline_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {baseline_path.name}: {len(actual['violations'])} pair(s) over {actual['total']} call sites")
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
    print(
        f"{actual['total']} database call site(s) outside `profiles`; "
        f"{len(actual['violations'])} (module -> table) pair(s) unowned "
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
