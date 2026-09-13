#!/usr/bin/env python3
"""CTL-071 — does a committed schema snapshot still match what the database would generate?

WHY THIS EXISTS WHEN TWO SNAPSHOT CONTROLS ALREADY RUN
------------------------------------------------------
SEC-151. On 2026-08-16 all three committed snapshots
(`src/types/database/{dev,staging,prod}.ts`) were simultaneously wrong about
their own databases, in three different ways, and both existing controls were
green throughout:

    snapshot claimed                              live databases said
    ------------------------------------------   ------------------------------
    profile_conversation_starters.prompt_id       is_nullable = YES on all three
      typed `string`
    enum member `favourite_custom` absent         present
    `public_profiles` view has no Insert/Update   relkind = v, is_updatable = YES

Neither control was defective:

  * CTL-036 diffs the three committed snapshots AGAINST EACH OTHER. All three
    were stale IN THE SAME WAY, so there was no relative drift to find.
    UNIFORM staleness reads as zero drift, by construction.
  * CTL-048 does ask the databases, but through PostgREST's OpenAPI document,
    which advertises column NAMES. A column that exists with the wrong
    nullability is still in the set. An enum member is not a column. View
    updatability is not a column.

So the gap was real and nothing was broken. There was simply no control on
those dimensions.

WHY A WHOLE-FILE DIFF RATHER THAN THREE NEW ASSERTIONS
-----------------------------------------------------
The obvious fix is to teach CTL-048 about nullability, enum membership and view
updatability. It was rejected, and the reason is the important part: those three
dimensions are not a category, they are *the three we happened to find*. A
control that enumerates dimensions can only ever catch the ones somebody thought
of, and the finding here is precisely that nobody thought of these. The fourth
dimension would be discovered the same way — by accident, months later.

Regenerating the file and diffing it catches every dimension the generator
expresses, including ones not yet enumerated. That is the whole argument for it.

⚠️ WHAT IT NORMALISES, AND WHY THAT IS EXACTLY ONE THING
--------------------------------------------------------
Trailing whitespace at end of file, and line endings. Nothing else.

Measured 2026-08-17: the committed `dev.ts` ends `as const\n\n` while a fresh
generation ends `as const\n`. Content byte-identical, 2,546 lines the same, one
trailing newline different. The snapshots can legitimately be produced by two
transports — the Supabase CLI (`scripts/gen-db-types.sh`) and the Supabase MCP
tool `generate_typescript_types`, which that script's own header offers as the
alternative when you have no CLI token — and they disagree about the final
newline.

A control that reddened on all three environments from day one over a blank line
is a control someone switches off within a week, and it would have taught nobody
anything about schema. So EOF whitespace is normalised.

**The stated gap:** a change consisting only of trailing whitespace is invisible
to this check. That is a deliberate, bounded trade and not a dimension anyone
needs, but it is written down rather than left to be rediscovered.

⚠️ THE GENERATOR IS NOT PINNED, AND THIS CONTROL IS SENSITIVE TO THAT
---------------------------------------------------------------------
`gen-db-types.sh` invokes `npx --yes supabase`, which resolves to whatever the
latest CLI is at run time. `supabase` is not in `package.json`, so there is no
lockfile entry either.

For the WRITE path that is merely untidy. For a whole-file DIFF it is
load-bearing: a CLI release that changes formatting — reorders a union, adds a
header comment, alters indentation — turns all three environments red with no
schema change whatsoever. The failure text below names this as a candidate
cause, because the alternative is somebody spending an afternoon looking for a
migration that does not exist. Pinning it is SEC-151's follow-up; doing it here
would mean choosing a version this session cannot run to verify.

⚠️ FAIL-CLOSED, WITH THREE DISTINCT EXITS
-----------------------------------------
    0   every snapshot matches a fresh generation
    1   a snapshot has DRIFTED — this is the finding
    2   UNVERIFIED — could not generate, so nothing was compared

Exit 2 is not exit 1. "The schema drifted" and "I could not look" are different
facts that need different responses, and collapsing them is the SEC-136 defect
this repo has already paid for once: a control that quietly passes when it could
not run still produces a green tick.

USAGE
    python3 scripts/check-snapshot-regeneration.py                 # all three
    python3 scripts/check-snapshot-regeneration.py --env dev
    python3 scripts/check-snapshot-regeneration.py --self-test
    python3 scripts/check-snapshot-regeneration.py --generated-dir DIR

ENVIRONMENT
    SUPABASE_ACCESS_TOKEN   personal access token, same one gen-db-types.sh uses
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = REPO_ROOT / "src" / "types" / "database"
INDEX_PATH = SNAPSHOT_DIR / "index.ts"
ENVIRONMENTS = ["dev", "staging", "prod"]
GENERATE_TIMEOUT_SECONDS = 180

# A generated snapshot shorter than this is an error body, a truncated
# response, or an empty schema — never a real one. Mirrors the same floor
# gen-db-types.sh applies before it overwrites a file, for the same reason:
# comparing against garbage produces a difference nobody can interpret.
MIN_PLAUSIBLE_LINES = 200


class SnapshotError(RuntimeError):
    """Raised when a snapshot cannot be produced or read. Never swallowed."""


# --------------------------------------------------------------------------
# comparison
# --------------------------------------------------------------------------


def normalise(text: str) -> str:
    """Strip the ONE class of difference that is provably not schema.

    Line endings, and trailing whitespace at end of file. See the module
    docstring — the two legitimate generation transports disagree about the
    final newline, and nothing else.

    Deliberately NOT stripping per-line trailing whitespace, blank lines
    inside the file, or indentation: all of those are generator output and a
    change in any of them is a change worth seeing.
    """
    return text.replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"


def diff_summary(committed: str, generated: str, env: str, limit: int = 12) -> list[str]:
    """Human-readable first differences, or [] when the two agree.

    Reports LINE NUMBERS and content rather than a unified diff, because the
    reader's next action is to open the committed file at that line and decide
    whether the database or the snapshot is right.
    """
    if normalise(committed) == normalise(generated):
        return []

    left = normalise(committed).split("\n")
    right = normalise(generated).split("\n")
    out: list[str] = [
        f"{env}: the committed snapshot does not match a fresh generation "
        f"({len(left)} lines committed vs {len(right)} generated)"
    ]

    shown = 0
    for index in range(max(len(left), len(right))):
        a = left[index] if index < len(left) else "<end of file>"
        b = right[index] if index < len(right) else "<end of file>"
        if a == b:
            continue
        shown += 1
        if shown > limit:
            out.append(f"{env}:   ... and further differences beyond line {index + 1}")
            break
        out.append(f"{env}:   line {index + 1}")
        out.append(f"{env}:     committed: {a.strip()[:160]}")
        out.append(f"{env}:     database:  {b.strip()[:160]}")
    return out


# --------------------------------------------------------------------------
# generation
# --------------------------------------------------------------------------


def project_ref(env: str) -> str:
    """Read the ref from index.ts rather than repeating it here.

    Two copies of a project ref is one copy too many, and that file is already
    what the other drift gates read. Asserts the file is present instead of
    inferring it from a search's exit code (gotcha #30).
    """
    if not INDEX_PATH.exists() or not os.access(INDEX_PATH, os.R_OK):
        raise SnapshotError(
            f"{INDEX_PATH.relative_to(REPO_ROOT)} is missing or unreadable, so the project "
            f"ref cannot be resolved. Failing closed rather than guessing a ref."
        )
    match = re.search(
        rf"^\s*{re.escape(env)}:\s*'([a-z]+)'", INDEX_PATH.read_text(encoding="utf-8"), re.M
    )
    if not match:
        raise SnapshotError(f"no project ref for {env!r} in {INDEX_PATH.name} (SCHEMA_PROJECT_REFS)")
    return match.group(1)


def generate(env: str, token: str) -> str:
    """Ask Supabase what the types for this environment SHOULD be."""
    ref = project_ref(env)
    try:
        completed = subprocess.run(
            ["npx", "--yes", "supabase", "gen", "types", "typescript", "--project-id", ref],
            capture_output=True,
            text=True,
            timeout=GENERATE_TIMEOUT_SECONDS,
            env={**os.environ, "SUPABASE_ACCESS_TOKEN": token},
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SnapshotError(f"could not run the Supabase CLI for {env} ({ref}): {exc}") from exc

    if completed.returncode != 0:
        detail = " ".join((completed.stderr or "").split())[:300]
        raise SnapshotError(f"'supabase gen types' failed for {env} ({ref}): {detail}")

    return validate_generated(completed.stdout, env)


def validate_generated(text: str, env: str) -> str:
    """Refuse to compare against something that is not a snapshot.

    Split out so `--self-test` exercises the REAL validation rather than a copy
    of it — CTL-038, and the defect CTL-049's own self-test reproduced by
    accident while being written.
    """
    if "export type Database" not in text:
        first = " ".join(text.split())[:200] or "<empty>"
        raise SnapshotError(
            f"generated output for {env} contains no 'export type Database' — this is not a "
            f"snapshot. First of what came back: {first}"
        )
    lines = len(text.splitlines())
    if lines < MIN_PLAUSIBLE_LINES:
        raise SnapshotError(
            f"generated output for {env} is only {lines} lines, implausibly short for a full "
            f"schema. Suspect an auth or project-ref problem; refusing to compare against it."
        )
    return text


def read_committed(env: str) -> str:
    path = SNAPSHOT_DIR / f"{env}.ts"
    if not path.exists():
        raise SnapshotError(f"committed snapshot {path.relative_to(REPO_ROOT)} does not exist")
    return path.read_text(encoding="utf-8")


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    """Prove the comparison can fail, on each dimension SEC-151 found.

    The three fixtures below are the ACTUAL staleness measured on 2026-08-16,
    not invented examples — a nullable column typed non-null, a missing enum
    member, and a view with no Insert/Update block.
    """
    failures: list[str] = []
    evaluated = 0

    def check(label: str, got, want) -> None:
        # Counted inside the assertion, never declared as a constant below.
        # CTL-049 carried a hand-maintained count that read 29 while 33
        # assertions ran; a number a human must remember to raise goes stale.
        nonlocal evaluated
        evaluated += 1
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    fresh = (
        "export type Database = {\n"
        "  public: {\n"
        "    Tables: {\n"
        "      profile_conversation_starters: {\n"
        "        Row: { prompt_id: string | null }\n"
        "      }\n"
        "    }\n"
        "    Enums: {\n"
        "      item_category: 'likes' | 'favourite_custom'\n"
        "    }\n"
        "    Views: {\n"
        "      public_profiles: { Row: { id: string }; Insert: { id?: string } }\n"
        "    }\n"
        "  }\n"
        "} as const\n"
    )

    # --- the normalisation is exactly one thing --------------------------
    check("an identical file matches", diff_summary(fresh, fresh, "t"), [])
    check(
        "a trailing newline difference is NOT drift",
        diff_summary(fresh + "\n\n", fresh, "t"),
        [],
    )
    check(
        "CRLF line endings are NOT drift",
        diff_summary(fresh.replace("\n", "\r\n"), fresh, "t"),
        [],
    )
    # ...and the normalisation must not be so broad it hides real change.
    check(
        "a blank line INSIDE the file IS drift",
        diff_summary(fresh.replace("  public: {", "  public: {\n"), fresh, "t") != [],
        True,
    )
    check(
        "changed indentation IS drift",
        diff_summary(fresh.replace("      profile", "    profile"), fresh, "t") != [],
        True,
    )

    # --- the three dimensions SEC-151 actually found ---------------------
    for label, stale in [
        ("nullability", fresh.replace("prompt_id: string | null", "prompt_id: string")),
        ("enum membership", fresh.replace(" | 'favourite_custom'", "")),
        ("view updatability", fresh.replace("; Insert: { id?: string } ", " ")),
    ]:
        # Assert the fixture actually differs from the source before drawing
        # any conclusion from it — a string-replace that silently matched
        # nothing produces a "pass" identical to a real one.
        check(f"the {label} fixture genuinely differs from fresh", stale != fresh, True)
        check(f"stale {label} is reported as drift", diff_summary(stale, fresh, "t") != [], True)

    # --- the report has to be actionable ---------------------------------
    report = diff_summary(
        fresh.replace("prompt_id: string | null", "prompt_id: string"), fresh, "dev"
    )
    check("the report names the environment", all(r.startswith("dev:") for r in report), True)
    check("the report shows both sides", any("database:" in r for r in report), True)
    check("the report gives a line number", any("line " in r for r in report), True)

    # --- validation: never compare against something that is not a snapshot
    for label, payload in [
        ("an HTML error page", "<html>504 Gateway Timeout</html>"),
        ("an empty body", ""),
        ("a plausible-looking but truncated file", "export type Database = {}\n"),
    ]:
        try:
            validate_generated(payload, "t")
            raised = False
        except SnapshotError:
            raised = True
        check(f"{label} is refused, not compared", raised, True)

    # ...and a real one passes, so the guard above is not merely rejecting all.
    check(
        "a plausible full snapshot is accepted",
        validate_generated("export type Database = {}\n" + ("x\n" * 250), "t").endswith("x\n"),
        True,
    )

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  ✗ {f}")
        return 1

    print(f"Self-test passed ({evaluated} cases).")
    return 0


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="CTL-071 — schema snapshot regeneration parity")
    parser.add_argument("--self-test", action="store_true", help="run built-in fixtures and exit")
    parser.add_argument("--env", choices=ENVIRONMENTS, help="check one environment")
    parser.add_argument(
        "--generated-dir",
        metavar="DIR",
        help=(
            "read <env>.ts from DIR instead of calling the Supabase CLI. For proving "
            "the comparison against a real generation without a CLI token. CI must "
            "NOT pass this — see the warning in the source."
        ),
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    # ⚠️ THE OFFLINE SEAM IS THE WEAKEST POINT IN THIS CONTROL, as it is in
    # CTL-049. A run using it is only as honest as the files it was handed, so
    # it proves the COMPARISON and says nothing about live state. It exists
    # because the Supabase MCP tool `generate_typescript_types` returns the
    # same output as the CLI, which makes the control provable in a session
    # with no CLI token — and a control never seen to fail is indistinguishable
    # from no control. It is not wired into CI and must not be.
    if args.generated_dir:
        print("::warning::--generated-dir in use: reading captured files, NOT the live databases.")
        print("::warning::A run using this seam proves nothing about live state.")

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token and not args.generated_dir:
        print("::error::SUPABASE_ACCESS_TOKEN is not set.")
        print("::error::Cannot regenerate any snapshot, so nothing was compared.")
        print("::error::Reporting UNVERIFIED (exit 2), NOT a clean pass — 'the snapshots match'")
        print("::error::and 'I could not look' are different facts.")
        return 2

    targets = [args.env] if args.env else ENVIRONMENTS
    drifted: list[str] = []

    for env in targets:
        try:
            committed = read_committed(env)
            if args.generated_dir:
                path = Path(args.generated_dir) / f"{env}.ts"
                generated = validate_generated(path.read_text(encoding="utf-8"), env)
            else:
                generated = generate(env, token)
        except (SnapshotError, OSError) as exc:
            print(f"::error::{env}: {exc}")
            print("::error::Failing closed (exit 2) — a snapshot that could not be regenerated")
            print("::error::is not a snapshot that agrees.")
            return 2

        differences = diff_summary(committed, generated, env)
        if differences:
            drifted.extend(differences)
        else:
            print(f"{env}: committed snapshot matches a fresh generation ✓")

    if drifted:
        print()
        print("::error::Schema snapshot regeneration parity FAILED.")
        for line in drifted:
            print(f"::error::{line}")
        print()
        print("Two causes, and they need opposite responses:")
        print()
        print("  1. THE SCHEMA CHANGED and the snapshot was not regenerated. This is the")
        print("     finding. Fix:  npm run gen:db-types -- --env <env>  then commit.")
        print("     Note the app compiles against dev.ts, so a stale dev snapshot means")
        print("     TypeScript is asserting guarantees the database does not make.")
        print()
        print("  2. THE GENERATOR CHANGED. gen-db-types.sh runs 'npx --yes supabase',")
        print("     which is unpinned, so a CLI release can alter formatting with no")
        print("     schema change at all. The tell is a diff that is purely cosmetic, or")
        print("     one that hits all three environments at once. Fix is the same command,")
        print("     but the commit message should say so — and pinning the CLI is SEC-151's")
        print("     follow-up precisely because this ambiguity exists.")
        return 1

    print()
    print(f"Every committed snapshot matches its database for {len(targets)} environment(s). ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
