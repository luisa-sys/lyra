#!/usr/bin/env python3
"""scripts/check-shared-code-drift.py — CTL-043 (KAN-418).

Shared code that lives as a COPY in two repos, with nothing checking the copies
still agree.

KAN-418 offered two ways to fix that: publish `@lyra/contracts` and have all
three deployables consume it, or keep the copies and add a CI drift check. The
package route was declined on 2026-08-09 — *"do the minimum work and minimise
the supply chain surface"* — and the reasoning holds up: a private package
consumed by the web app and both Railway services becomes a new compromise path
where whoever can publish can execute in production in three places, and it puts
read tokens in four runtimes plus a publish token in a fifth.

This costs **zero tokens, zero registries, zero runtime dependencies**.
`lyra-mcp-server` is a PUBLIC repo, so CI reads it with the built-in
`GITHUB_TOKEN`. Nothing new is provisioned anywhere.

It does NOT remove the duplication. It removes the SILENCE. Divergence becomes a
red build instead of a defect found months later — which is the failure this was
actually written for: `admin_approve_beta` wrote two columns a `lyra` migration
had dropped, and `convene-recommend-scoring.ts` carries a header admitting it is
a verbatim copy with no mechanism to keep it one.

WHY NORMALISED COMPARISON EXISTS
    The MCP repos are `"type": "module"` + NodeNext, so they MUST write
    `./content-moderation.js` where the web app writes `./content-moderation`.
    That difference is real, permanent and harmless.

    When this was first run, `moderation-policy.ts` was ALREADY textually
    drifted — different header comments plus that extension. A byte comparison
    would have failed on day one on a difference nobody can fix, and a gate that
    is red for reasons nobody can fix is a gate that gets switched off by Friday.
    So `mode: normalised` strips comments and normalises the extension, and
    compares what actually executes.

    Verified at the time: with comments and the extension normalised away, the
    two copies of `moderation-policy.ts` are IDENTICAL. The drift was cosmetic.
    It would not have been obvious which it was without looking, and nothing was
    looking.

USAGE
    check-shared-code-drift.py              compare every guarded entry
    check-shared-code-drift.py --self-test  normalisation fixtures

EXIT
    0  every guarded copy agrees
    1  a copy has drifted
    2  cannot verify — fail closed
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "shared-code-manifest.json"
FETCH_ATTEMPTS = 3


def die_unverifiable(msg: str) -> None:
    print(f"::error::check-shared-code-drift: {msg}")
    print(
        "::error::  Failing closed (exit 2). This control's entire job is to notice a "
        "difference, so 'could not look' must never print as 'they match'."
    )
    sys.exit(2)


def normalise(text: str) -> str:
    """Strip what may legitimately differ; keep everything that executes.

    Comments go because the copies carry different provenance headers by design
    — the MCP one says "ported from the web app", which is true and useful and
    should not be a build failure.

    The NodeNext '.js' import extension goes because it is mandatory in one repo
    and forbidden in the other. Nothing else is touched: no whitespace
    collapsing inside string literals, no case folding, no reordering. A
    normaliser that removes too much reports agreement that is not there, which
    is worse than no check.
    """
    # Block comments, then line comments. Order matters: a '//' inside a /* */
    # would otherwise survive as a fragment.
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"^[ \t]*//.*$", "", text, flags=re.M)
    # './x.js' -> './x' in import/export specifiers only.
    text = re.sub(r"(from\s+['\"]\.{1,2}/[^'\"]+?)\.js(['\"])", r"\1\2", text)
    # Blank-line runs left behind by comment removal.
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def fetch_remote(repo: str, path: str) -> str:
    """Read a file from another repo via gh. Retries, then fails CLOSED."""
    last = ""
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            res = subprocess.run(
                ["gh", "api", f"/repos/{repo}/contents/{path}", "--jq", ".content"],
                capture_output=True, text=True, timeout=45,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            last = f"{type(exc).__name__}: {exc}"
            continue
        if res.returncode == 0 and res.stdout.strip():
            try:
                return base64.b64decode(res.stdout.strip()).decode("utf-8")
            except (ValueError, UnicodeDecodeError) as exc:
                die_unverifiable(f"{repo}/{path}: response was not decodable UTF-8 ({exc})")
        last = res.stderr.strip()[:300] or f"exit {res.returncode}"
        if "404" in last or "Not Found" in last:
            # Not transient: the file the manifest names is gone. That is a
            # finding, not a network problem — a manifest entry pointing at a
            # deleted file is dead cover that still reads as protection.
            die_unverifiable(
                f"{repo}/{path} does not exist. The manifest names a file that is not there — "
                "either the remote copy was deleted (in which case remove the entry deliberately) "
                "or it moved (in which case update the entry)."
            )
    die_unverifiable(f"could not read {repo}/{path} after {FETCH_ATTEMPTS} attempts: {last}")
    return ""  # unreachable


def main() -> int:
    if not MANIFEST.exists():
        die_unverifiable(f"{MANIFEST.name} is missing — nothing could be compared.")
    try:
        manifest = json.loads(MANIFEST.read_text())
    except json.JSONDecodeError as exc:
        die_unverifiable(f"{MANIFEST.name} is not valid JSON: {exc}")

    sources = manifest.get("sources") or {}
    shared = manifest.get("shared") or []
    if not shared:
        die_unverifiable(
            "the manifest guards nothing. An empty shared list would pass every run while "
            "proving nothing — if the duplication is genuinely gone, delete this control."
        )

    problems = 0
    for entry in shared:
        local_rel, src_key = entry.get("local"), entry.get("source")
        remote_rel, mode = entry.get("remote"), entry.get("mode", "exact")
        if not (local_rel and src_key and remote_rel):
            die_unverifiable(f"malformed manifest entry: {entry!r}")
        if src_key not in sources:
            die_unverifiable(f"entry '{local_rel}' names unknown source '{src_key}'")
        if mode not in ("exact", "normalised"):
            die_unverifiable(f"entry '{local_rel}' has unknown mode '{mode}'")

        local_path = ROOT / local_rel
        if not local_path.exists():
            print(f"::error::  {local_rel} does not exist locally, but the manifest guards it.")
            print("::error::    If it moved, update shared-code-manifest.json in the same commit.")
            problems += 1
            continue

        repo = sources[src_key]["repo"]
        local_text = local_path.read_text(encoding="utf-8")
        remote_text = fetch_remote(repo, remote_rel)

        a, b = (local_text, remote_text) if mode == "exact" else (normalise(local_text), normalise(remote_text))
        ha = hashlib.sha256(a.encode()).hexdigest()
        hb = hashlib.sha256(b.encode()).hexdigest()

        if ha == hb:
            print(f"  ok  {local_rel}  ==  {repo}/{remote_rel}  ({mode})")
            continue

        problems += 1
        print(f"::error::  DRIFT: {local_rel} != {repo}/{remote_rel} ({mode} comparison)")
        print(f"::error::    local  sha256 {ha[:16]}")
        print(f"::error::    remote sha256 {hb[:16]}")
        print(f"::error::    {entry.get('why', '')}")
        if mode == "exact":
            print("::error::    If the difference is only comments or a NodeNext '.js' import "
                  "extension, this entry should be mode 'normalised' — say so explicitly rather "
                  "than deleting the entry.")
        print("::error::    Otherwise: change BOTH copies in lockstep, in linked PRs "
              "(MCP-main lockstep policy, KAN-222).")

    total = len(shared)
    deferred = manifest.get("deferred") or []
    if deferred:
        # Printed every run. A deferred entry that nobody is reminded of is an
        # entry that quietly becomes permanent.
        print(f"check-shared-code-drift: {len(deferred)} known duplicate(s) DEFERRED, not guarded:")
        for d in deferred:
            print(f"    {d.get('local')}  ~  {d.get('remote')}   ({d.get('why','')[:100]})")

    if problems:
        print(f"::error::check-shared-code-drift: {problems} of {total} shared file(s) have drifted.")
        return 1
    print(f"check-shared-code-drift: {total} shared file(s) still agree across repos. ✓")
    return 0


def self_test() -> int:
    cases = [
        ("block comment stripped",
         normalise("/* hi */\nconst a = 1;") == "const a = 1;"),
        ("line comment stripped",
         normalise("// hi\nconst a = 1;") == "const a = 1;"),
        ("NodeNext .js extension normalised",
         normalise("import x from './a.js';") == normalise("import x from './a';")),
        # The difference that actually exists between the two live copies.
        ("differing headers + extension compare equal",
         normalise("/** web app */\nimport { m } from './content-moderation';\nexport const x = 1;")
         == normalise("/** ported to MCP */\nimport { m } from './content-moderation.js';\nexport const x = 1;")),
        # The normaliser must not be so eager that it hides real changes.
        ("a REAL logic change still differs",
         normalise("if (s === 'block') return 1;") != normalise("if (s === 'warn') return 1;")),
        ("a changed string literal still differs",
         normalise("const e = 'blocked';") != normalise("const e = 'allowed';")),
        # A '//' inside a string is not a comment. Getting this wrong would let a
        # URL change slip past unnoticed.
        ("a double-slash inside a string literal survives",
         "https://a.example" in normalise("const u = 'https://a.example';")),
        ("bare package imports are untouched",
         normalise("import z from 'node:fs';") == "import z from 'node:fs';"),
    ]
    failed = [n for n, ok in cases if not ok]
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if failed:
        print(f"::error::self-test: {len(failed)} case(s) failed: {', '.join(failed)}")
        return 1
    print(f"self-test: {len(cases)}/{len(cases)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else main())
