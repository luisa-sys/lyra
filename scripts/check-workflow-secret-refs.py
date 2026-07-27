#!/usr/bin/env python3
"""SEC-101 — every `secrets.X` a workflow references must actually exist.

THE DEFECT CLASS
----------------
GitHub expands an undefined secret to the **empty string**, silently. No
warning, no annotation, no failed step. A workflow referencing a secret that
was never created therefore runs to green having done something subtly
different from what it claims.

Found on 2026-07-27: `deploy-dev.yml` passed `secrets.DEV_SUPABASE_URL` and
`secrets.DEV_SUPABASE_ANON_KEY` into its "Verify build" step. Neither exists —
not at repo level, and the `development` environment holds no secrets either.
So that step had been building against a blank Supabase configuration and
passing. It verified that the code compiles, not that it compiles with the
configuration dev actually runs on.

This is the same family as SEC-79 (workflows silently disabled for a month
while reporting green) and SEC-96 (a monitoring badge reporting green from a
presence check rather than live state): the control ran, reported success, and
was measuring nothing.

HOW THIS WORKS
--------------
CI cannot list repository secrets — that needs an admin token, and handing CI
an admin token to check its own configuration would be a worse problem than
the one being solved. Instead every referenced secret must appear in one of two
committed manifests:

  `.github/known-secrets.txt`         secrets that EXIST. Regenerated verbatim
                                      from `gh secret list` and reviewed.

  `.github/absent-secrets.txt`        secrets deliberately NOT set, each with a
                                      reason and a Jira key. Not every absence
                                      is a defect: several report sections
                                      render "DATA UNAVAILABLE" with the missing
                                      variable named, which is the honest
                                      behaviour this repo's Workflow & Backup
                                      Integrity Policy asks for.

That makes the failure mode loud in the right direction: adding a NEW secret
reference fails the build until someone either creates the secret or writes
down why its absence is acceptable and who is tracking it. Both are useful; a
silent empty string is not.

DELIBERATELY NOT ENFORCED
-------------------------
The manifest may list secrets no workflow references (a secret can exist for a
cloud routine, a local script, or a not-yet-built workflow). Only the reverse
direction — a reference in neither manifest — is an error.

USAGE
    python3 scripts/check-workflow-secret-refs.py
    python3 scripts/check-workflow-secret-refs.py --self-test
    gh secret list --json name --jq '.[].name' | sort   # to refresh the manifest
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

WORKFLOWS_DIR = Path(".github/workflows")
MANIFEST_PATH = Path(".github/known-secrets.txt")
ABSENT_PATH = Path(".github/absent-secrets.txt")

# A secret is only ever expanded inside a `${{ … }}` expression. Matching bare
# `secrets.FOO` anywhere on the line also matches PROSE — this check's own
# explanatory comment in pr-checks.yml ("every `secrets.X` must be in
# .github/known-secrets.txt") made it flag `secrets.X` and `secrets.txt` as
# undeclared secrets. Scope the match to the expression span so documentation
# about the mechanism can never be mistaken for a use of it.
EXPRESSION_RE = re.compile(r"\$\{\{(.*?)\}\}", re.DOTALL)
SECRET_IN_EXPR_RE = re.compile(r"\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)")
JIRA_KEY_RE = re.compile(r"\b(KAN|SEC|BUGS)-\d+\b", re.IGNORECASE)

# `secrets.GITHUB_TOKEN` is minted automatically by Actions for every run and
# never appears in `gh secret list`.
BUILTIN_SECRETS = {"GITHUB_TOKEN"}


def load_manifest(path: Path = MANIFEST_PATH) -> set[str]:
    if not path.exists():
        return set()
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            names.add(line)
    return names


def load_absent(path: Path = ABSENT_PATH) -> dict[str, str]:
    """Deliberately-absent secrets: `NAME  # reason (TICKET)`."""
    entries: dict[str, str] = {}
    if not path.exists():
        return entries
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        name, _, note = stripped.partition("#")
        name = name.strip()
        if name:
            entries[name] = note.strip()
    return entries


def find_references(workflows_dir: Path) -> dict[str, list[tuple[str, int]]]:
    """Map secret name -> [(file, line), …] across every workflow."""
    refs: dict[str, list[tuple[str, int]]] = {}
    for path in sorted(workflows_dir.glob("*.y*ml")):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (UnicodeDecodeError, OSError):
            continue
        for lineno, line in enumerate(lines, start=1):
            for expr in EXPRESSION_RE.findall(line):
                for name in SECRET_IN_EXPR_RE.findall(expr):
                    refs.setdefault(name, []).append((str(path), lineno))
    return refs


def check(
    refs: dict[str, list[tuple[str, int]]],
    manifest: set[str],
    absent: dict[str, str] | None = None,
) -> list[str]:
    absent = absent or {}
    problems: list[str] = []

    for name in sorted(refs):
        if name in BUILTIN_SECRETS or name in manifest:
            continue

        if name in absent:
            # A documented absence still has to name an owner's ticket, or it is
            # just an undocumented absence with extra steps.
            if not JIRA_KEY_RE.search(absent[name]):
                problems.append(
                    f"::error file={ABSENT_PATH}::`{name}` is listed as deliberately absent "
                    f"but cites no Jira key. An absence nobody is tracking is not a decision. "
                    f"Use: `{name}  # <why absence is safe> (SEC-123)`"
                )
            continue

        for file, lineno in refs[name]:
            problems.append(
                f"::error file={file},line={lineno}::`secrets.{name}` is in neither "
                f"{MANIFEST_PATH} nor {ABSENT_PATH}. GitHub expands an undefined secret to "
                f"the EMPTY STRING with no warning, so this step would run and pass while "
                f"doing something other than what it claims. Either create the secret and "
                f"refresh the manifest, or record why its absence is safe (with a ticket) "
                f"in {ABSENT_PATH}."
            )
    return problems


# --- self-test (the "test the test" control) -------------------------------


def self_test() -> int:
    manifest = {"RESEND_API_KEY", "PROD_SUPABASE_URL"}
    cases: list[tuple[str, bool]] = []

    known = {"RESEND_API_KEY": [("w.yml", 3)]}
    cases.append(("a manifest-listed secret passes", check(known, manifest) == []))

    unknown = {"DEV_SUPABASE_URL": [("deploy-dev.yml", 40)]}
    cases.append(("an unlisted secret fails", len(check(unknown, manifest)) == 1))

    builtin = {"GITHUB_TOKEN": [("w.yml", 5)]}
    cases.append(("GITHUB_TOKEN is exempt", check(builtin, manifest) == []))

    multi = {"DEV_SUPABASE_URL": [("a.yml", 1), ("b.yml", 2)]}
    cases.append(("every reference site is reported", len(check(multi, manifest)) == 2))

    cases.append(
        ("a manifest entry with no reference is NOT an error", check({}, manifest | {"UNUSED"}) == [])
    )

    absent_ok = {"VERCEL_API_TOKEN": "renders DATA UNAVAILABLE when unset (SEC-102)"}
    absent_ref = {"VERCEL_API_TOKEN": [("weekly-report.yml", 949)]}
    cases.append(
        ("a ticketed deliberate absence passes", check(absent_ref, manifest, absent_ok) == [])
    )

    absent_no_ticket = {"VERCEL_API_TOKEN": "we know about it"}
    cases.append(
        ("a deliberate absence with no ticket fails",
         len(check(absent_ref, manifest, absent_no_ticket)) == 1),
    )

    cases.append(
        ("an absence entry does not excuse a DIFFERENT secret",
         len(check({"OTHER_TOKEN": [("w.yml", 1)]}, manifest, absent_ok)) == 1),
    )

    # Parsing: the regex must find refs in real workflow syntax.
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "x.yml").write_text(
            "env:\n"
            "  A: ${{ secrets.ALPHA }}\n"
            "  B: ${{secrets.BETA}}\n"
            "  C: ${{ secrets.GITHUB_TOKEN }}\n",
            encoding="utf-8",
        )
        found = find_references(d)
        cases.append(("parses spaced and unspaced refs", set(found) == {"ALPHA", "BETA", "GITHUB_TOKEN"}))
        cases.append(("records the right line number", found["BETA"][0][1] == 3))

        # THE MISS. This check's own explanatory comment in pr-checks.yml
        # ("every `secrets.X` must be in .github/known-secrets.txt") made the
        # first version flag `secrets.X` and `secrets.txt` as undeclared
        # secrets — a false positive generated by documenting the control.
        # A secret only expands inside `${{ … }}`; prose must never count.
        (d / "prose.yml").write_text(
            "# every `secrets.X` must be listed in .github/known-secrets.txt\n"
            "# or in .github/absent-secrets.txt with a reason\n"
            "env:\n"
            "  REAL: ${{ secrets.ALPHA }}\n",
            encoding="utf-8",
        )
        prose = find_references(d)
        cases.append(
            ("prose mentioning secrets.X / .txt is NOT a reference",
             "X" not in prose and "txt" not in prose),
        )
        cases.append(("a real reference on the same file still counts", "ALPHA" in prose))

    failures = 0
    for label, ok in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            failures += 1
    if failures:
        print(f"::error::check-workflow-secret-refs self-test: {failures} case(s) failed.")
        return 1
    print(f"Self-test: all {len(cases)} case(s) behave as specified. ✓")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflows", default=str(WORKFLOWS_DIR))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    workflows_dir = Path(args.workflows)
    if not workflows_dir.is_dir():
        print(f"::error::workflows directory '{workflows_dir}' not found.")
        return 1

    manifest = load_manifest()
    if not manifest:
        print(f"::error::{MANIFEST_PATH} is missing or empty — this check would pass vacuously.")
        print(f"Regenerate with:  gh secret list --json name --jq '.[].name' | sort > {MANIFEST_PATH}")
        return 1

    absent = load_absent()
    refs = find_references(workflows_dir)

    # Vacuous-pass guard: this repo's workflows have referenced secrets since the
    # first deploy pipeline. Zero references means the parser has drifted.
    if not refs:
        print(f"::error::No `secrets.*` references found under '{workflows_dir}'.")
        print("::error::This check has lost its target — it would be passing vacuously.")
        return 1

    print(
        f"Checking {len(refs)} distinct secret reference(s) across "
        f"{len(list(workflows_dir.glob('*.y*ml')))} workflow(s) — "
        f"{len(manifest)} known to exist, {len(absent)} documented as absent…"
    )

    problems = check(refs, manifest, absent)
    if problems:
        print()
        for problem in problems:
            print(problem)
        print()
        print(f"::error::{len(problems)} reference(s) to a secret that is not known to exist.")
        print()
        print("An undefined secret expands to the EMPTY STRING silently — the step still")
        print("runs and still reports green. Refresh the manifest with:")
        print(f"    gh secret list --json name --jq '.[].name' | sort > {MANIFEST_PATH}")
        return 1

    unused = sorted(manifest - set(refs) - BUILTIN_SECRETS)
    if unused:
        print(f"::notice::{len(unused)} manifest entr(y/ies) referenced by no workflow "
              f"(fine — may serve routines or scripts): {', '.join(unused[:10])}"
              + (" …" if len(unused) > 10 else ""))

    print("Every secret referenced by a workflow is known to exist. ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
