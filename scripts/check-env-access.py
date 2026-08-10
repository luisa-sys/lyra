#!/usr/bin/env python3
"""KAN-414 F8 — the env-access ratchet.

WHY THIS EXISTS
---------------
"Modules can be configured independently" is currently false. There are 49
distinct environment variables read from 38 files under `src/`, and only a
handful pass through `src/modules/platform/env.ts`, the module built to be the single
resolver. Every other call site re-reads `process.env` directly, so:

  * a missing variable surfaces as `undefined` deep inside a request rather
    than as a loud failure at boot;
  * no module can state its own configuration surface, because its config is
    scattered across whichever files happen to need it;
  * a rename or a typo is invisible until the code path runs in production.

The plan's own precedent is the reason this is a GATE and not a refactor:
`src/modules/platform/deploy-env.ts` was created to be the single environment resolver. It is
pure, tested and self-documenting — and **all six of the derivations it was
meant to replace are still inline.** Creating the canonical module is ~10% of
the work. Retiring the call sites and preventing new ones is the other 90%, and
only CI does the 90%.

So this does not migrate anything. It freezes the existing 73 references as a
baseline and makes the set shrink-only. Migration then happens file by file,
and the gate guarantees the number only ever goes down.

WHAT IT CHECKS
--------------
The baseline maps each file to the exact set of variables it reads.

  * a file reading `process.env` that is NOT in the baseline    -> FAIL (new)
  * a baselined file reading a variable not listed for it       -> FAIL (creep)
  * a baselined file that no longer reads `process.env` at all  -> FAIL (it was
    migrated — delete its entry, so the baseline keeps shrinking)
  * a listed variable that is no longer read                    -> FAIL (same)

Keyed on FILE plus variable-set, deliberately not on line number: line numbers
churn on every unrelated edit, and a baseline that needs updating for reasons
unconnected to its purpose is one people learn to update without reading.

`process.env[expr]` — a dynamic read — is recorded as the pseudo-variable
`<dynamic>`, because the actual name cannot be known statically and pretending
otherwise would let an arbitrary read hide behind a computed key.

SANCTIONED READERS
------------------
`src/modules/platform/env.ts` is the canonical resolver and is exempt by design — it is
where `process.env` is SUPPOSED to be read. Anything else needs a baseline
entry or an escape hatch.

ESCAPE HATCH
------------
    // env-access-ok: <JIRA-KEY> <reason>

on the reading line or the line above. Requires a Jira key; suppresses exactly
one line. Every active exception is printed on every run.

FAIL-CLOSED
-----------
Exit 2 if the baseline is missing or unparseable, or if `git ls-files` yields
nothing. A gate that cannot see the tree must not report it clean.

USAGE
    python3 scripts/check-env-access.py
    python3 scripts/check-env-access.py --show      # current map, as JSON
    python3 scripts/check-env-access.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE = REPO / "env-access-baseline.json"

# src/modules/platform/env.ts is the resolver: reading process.env is its entire job.
SANCTIONED = {"src/modules/platform/env.ts"}

DYNAMIC = "<dynamic>"

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_FAIL_CLOSED = 2

VAR_RE = re.compile(r"process\.env\.([A-Za-z_][A-Za-z_0-9]*)")
DYN_RE = re.compile(r"process\.env\s*\[")
HATCH_RE = re.compile(r"env-access-ok:\s*(?P<key>[A-Z]+-\d+)?\s*(?P<reason>.*)$")


class Unparseable(Exception):
    """Missing or malformed input — always exit 2, never 0."""


def tracked_ts_files() -> list[str]:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "ls-files", "src"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise Unparseable(f"git ls-files failed: {exc}")
    files = [f for f in out.split() if f.endswith((".ts", ".tsx"))]
    if not files:
        raise Unparseable("git ls-files src returned no TypeScript files — "
                          "refusing to report a clean tree we cannot see")
    return sorted(files)



def code_only(line: str, in_block: bool) -> tuple[str, bool]:
    """Return (the executable part of `line`, whether a block comment is open after it).

    CTL-037 matched DOCSTRINGS. It flagged src/modules/access/context.ts for a
    NEW env read that did not exist, having matched the phrase `process.env.X`
    in a comment explaining where the reads live — and extracted the variable
    name "X" from it. Same comment-shadowing class as CTL-039 and the SEC-100
    sitemap scan, arrived at from the other direction.

    It errs SAFE — a comment can only ADD a finding, never suppress one — so
    this is noise rather than danger. But noise on a ratchet is how a ratchet
    gets waved through, and the phrasing workaround (never write the literal in
    a comment) is exactly the kind of unwritten rule that erodes.

    Comments cannot simply be stripped before scanning: the escape hatch
    (`env-access-ok`) LIVES in a comment and is detected on the full line. So
    the two are separated — this returns the code, the caller keeps the
    original for hatch detection.

    String literals are blanked FIRST, so a `//` inside a URL does not start a
    comment. `process.env.X` never appears inside a real string literal, and if
    it did, treating it as a read would be a false positive anyway.
    """
    out: list[str] = []
    i, n = 0, len(line)
    while i < n:
        if in_block:
            end = line.find("*/", i)
            if end == -1:
                return "".join(out), True
            in_block = False
            i = end + 2
            continue
        ch = line[i]
        if ch in "'\"":
            # Ordinary string: skip it whole, honouring backslash escapes.
            quote = ch
            i += 1
            while i < n:
                if line[i] == "\\":
                    i += 2
                    continue
                if line[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if ch == "`":
            # TEMPLATE LITERAL. Its ${...} interpolations are CODE, not string
            # content, and blanking them wholesale is how this fix first went
            # wrong: src/app/dashboard/page.tsx reads NEXT_PUBLIC_SITE_URL only
            # inside `${...}`, so a naive skip made a REAL read vanish and the
            # ratchet reported a phantom migration. A normaliser that removes
            # too much reports agreement that is not there.
            i += 1
            while i < n:
                if line[i] == "\\":
                    i += 2
                    continue
                if line[i] == "`":
                    i += 1
                    break
                if line.startswith("${", i):
                    depth = 1
                    i += 2
                    while i < n and depth:
                        if line[i] == "{":
                            depth += 1
                        elif line[i] == "}":
                            depth -= 1
                            if depth == 0:
                                i += 1
                                break
                        out.append(line[i])
                        i += 1
                    continue
                i += 1
            continue
        if line.startswith("//", i):
            return "".join(out), False
        if line.startswith("/*", i):
            in_block = True
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out), in_block


def scan() -> tuple[dict[str, list[str]], list[dict]]:
    """Returns (file -> sorted var list, active exceptions)."""
    found: dict[str, set[str]] = {}
    exceptions: list[dict] = []

    for rel in tracked_ts_files():
        if rel in SANCTIONED:
            continue
        p = REPO / rel
        try:
            lines = p.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise Unparseable(f"cannot read {rel}: {exc}")

        in_block = False
        for i, line in enumerate(lines):
            # Match against CODE ONLY; the hatch below still reads the full line.
            code, in_block = code_only(line, in_block)
            vars_here = set(VAR_RE.findall(code))
            dyn_here = bool(DYN_RE.search(code))
            if not vars_here and not dyn_here:
                continue

            # A hatch may sit on this line or the one above it.
            context = line + "\n" + (lines[i - 1] if i > 0 else "")
            if "env-access-ok" in context:
                m = HATCH_RE.search(context)
                key = m.group("key") if m else None
                if key:
                    exceptions.append({
                        "file": rel, "line": i + 1, "key": key,
                        "reason": (m.group("reason") or "").strip(),
                        "vars": sorted(vars_here) + ([DYNAMIC] if dyn_here else []),
                    })
                    continue
                # A hatch with no Jira key does not suppress. Fall through so
                # the read is still counted against the baseline.

            bucket = found.setdefault(rel, set())
            bucket |= vars_here
            if dyn_here:
                bucket.add(DYNAMIC)

    return {k: sorted(v) for k, v in sorted(found.items())}, exceptions


def load_baseline() -> dict[str, list[str]]:
    if not BASELINE.is_file():
        raise Unparseable(f"baseline missing: {BASELINE.name}")
    try:
        data = json.loads(BASELINE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Unparseable(f"baseline is not valid JSON: {exc}")
    if "allowed" not in data or not isinstance(data["allowed"], dict):
        raise Unparseable("baseline has no `allowed` object")
    return data["allowed"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    try:
        found, exceptions = scan()
    except Unparseable as exc:
        print(f"::error::env-access cannot verify: {exc}")
        print("::error::Failing closed (Workflow & Backup Integrity Policy).")
        return EXIT_FAIL_CLOSED

    if args.show:
        print(json.dumps({"allowed": found}, indent=2))
        return EXIT_OK

    try:
        allowed = load_baseline()
    except Unparseable as exc:
        print(f"::error::env-access cannot verify: {exc}")
        print("::error::Failing closed (Workflow & Backup Integrity Policy).")
        return EXIT_FAIL_CLOSED

    problems = 0

    for rel, vars_ in found.items():
        if rel not in allowed:
            problems += 1
            print(f"::error file={rel}::env-access: NEW direct `process.env` read in a file "
                  f"that is not baselined ({', '.join(vars_)}). Resolve configuration "
                  f"through src/modules/platform/env.ts instead. If this read genuinely belongs here, "
                  f"add `// env-access-ok: <JIRA-KEY> <reason>`.")
            continue
        extra = sorted(set(vars_) - set(allowed[rel]))
        if extra:
            problems += 1
            print(f"::error file={rel}::env-access: this file already reads env directly, "
                  f"and now reads MORE ({', '.join(extra)}). A known-bad file may shrink, "
                  f"never grow — route new configuration through src/modules/platform/env.ts.")

    for rel, vars_ in allowed.items():
        if rel not in found:
            problems += 1
            print(f"::error file={rel}::env-access: baselined but no longer reads "
                  f"`process.env` — it was migrated. Delete its entry from "
                  f"{BASELINE.name} so the baseline keeps shrinking.")
            continue
        gone = sorted(set(vars_) - set(found[rel]))
        if gone:
            problems += 1
            print(f"::error file={rel}::env-access: these baselined variables are no "
                  f"longer read ({', '.join(gone)}) — remove them from {BASELINE.name}. "
                  f"A baseline that only grows is a suppression list.")

    if exceptions:
        print(f"\nActive env-access-ok exceptions ({len(exceptions)}):")
        for e in exceptions:
            print(f"  - {e['file']}:{e['line']}  [{e['key']}] {e['reason']}")

    total_refs = sum(len(v) for v in found.values())
    print(f"\nDirect env reads: {total_refs} references across {len(found)} files "
          f"(baseline: {sum(len(v) for v in allowed.values())} across {len(allowed)}).")

    if problems:
        print(f"::error::{problems} env-access problem(s). The set of direct "
              f"`process.env` reads may only shrink (KAN-414 F8).")
        return EXIT_DRIFT

    print("Direct env reads match the baseline exactly — no new ones, none silently kept.")
    return EXIT_OK


def self_test() -> int:
    cases: list[tuple[str, bool]] = []

    # ── comment-awareness (KAN-415 D4) ──────────────────────────────────
    # CTL-037 matched DOCSTRINGS until 2026-08-10, and flagged a file for a read
    # that did not exist by extracting the variable name "X" from the phrase
    # `process.env.X` in a comment. These pin both directions, because the first
    # attempt at the fix over-corrected: it blanked template literals wholesale,
    # which made a REAL read inside `${...}` vanish and reported a phantom
    # migration. A normaliser that removes too much is worse than none.
    def _vars(line: str, in_block: bool = False) -> list[str]:
        code, _ = code_only(line, in_block)
        return sorted(VAR_RE.findall(code))

    cases += [
        ("real read is found", _vars("const x = process.env.FOO;") == ["FOO"]),
        ("line comment is not", _vars("// process.env.FOO") == []),
        ("block comment is not", _vars("/* process.env.FOO */") == []),
        ("trailing comment is not", _vars("const x = 1; // process.env.FOO") == []),
        ("code before a comment survives",
         _vars("const x = process.env.FOO; // process.env.BAR") == ["FOO"]),
        ("TEMPLATE INTERPOLATION IS CODE",
         _vars("const u = `${process.env.FOO}/x`;") == ["FOO"]),
        ("plain string is not code", _vars("const s = 'process.env.FOO';") == []),
        ("a // inside a string does not start a comment",
         _vars("const u = 'https://a.example'; const x = process.env.FOO;") == ["FOO"]),
        ("a continuation line inside a block comment is not code",
         _vars(" * The seven process.env.X reads", in_block=True) == []),
    ]


    cases.append(("static var found", VAR_RE.findall("const a = process.env.FOO_BAR") == ["FOO_BAR"]))
    cases.append(("dynamic read detected", bool(DYN_RE.search("process.env[key]"))))
    cases.append(("dynamic with space detected", bool(DYN_RE.search("process.env [k]"))))
    cases.append(("NEXT_PUBLIC captured",
                  VAR_RE.findall("process.env.NEXT_PUBLIC_SITE_URL") == ["NEXT_PUBLIC_SITE_URL"]))
    cases.append(("two on one line",
                  set(VAR_RE.findall("process.env.A || process.env.B")) == {"A", "B"}))
    m = HATCH_RE.search("// env-access-ok: KAN-414 bootstrap only")
    cases.append(("hatch key parsed", m is not None and m.group("key") == "KAN-414"))
    m2 = HATCH_RE.search("// env-access-ok: no key")
    cases.append(("hatch without key rejected", m2 is not None and m2.group("key") is None))
    cases.append(("no false positive on comment text",
                  VAR_RE.findall("// mentions process env but not the property") == []))

    failed = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}")
    if failed:
        print(f"::error::self-test: {len(failed)} failed: {', '.join(failed)}")
        return EXIT_DRIFT
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
