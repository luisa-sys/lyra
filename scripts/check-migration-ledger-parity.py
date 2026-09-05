#!/usr/bin/env python3
"""CTL-049 — can the schema be rebuilt from the repo?

WHY THIS EXISTS WHEN THREE DATABASE CONTROLS ALREADY RUN
--------------------------------------------------------
CTL-036 diffs the three committed type snapshots against each other. CTL-048
asks the three live databases for their columns and compares them to each other
and to those snapshots. `check-db-invariants.py` asks each database what its
privilege posture is. All three are real controls, all three work, and all three
were green on 2026-08-12.

Every one of them asks some version of "is the schema RIGHT?".

None of them reads `supabase/migrations/` at all. So nothing anywhere asked the
other question:

    can this schema be REBUILT from the repo?

which is the only one that matters the day the database is gone. Measured when
this script was written, against all three projects:

    repo migration files ............ 82
    dev ledger rows ................. 84   identifiable by version AND name: 1
    staging ledger rows ............. 76   identifiable by version AND name: 0
    prod ledger rows ................ 78   identifiable by version AND name: 1

The repo and the databases are two parallel records of the same schema
evolution, related by neither filename nor version stamp. `mcp_tool_call_log`
and `content_moderation_flags` are live tables on all three environments whose
creating SQL does not exist in version control. Production's ledger has no row
for `create_lyra_schema` at all. `add_api_keys` is in the repo, its table is
live everywhere, and no ledger records it as ever having run.

The mechanism is not carelessness. Per CLAUDE.md gotcha #9, migrations are
applied with the Supabase MCP `apply_migration` tool, which writes to the
database and to its ledger but does NOT write a file into the repo. Committing
the SQL is a separate step, and a separate step is one that can be missed.

WHY THE FAILURE WAS INVISIBLE
-----------------------------
The three environments are individually healthy and mutually consistent, so the
existing controls are green *correctly*. The drift is not between environments;
it is between the running system and its source of truth, and no control was
pointed at that axis. A control that cannot see an axis reports nothing about
it — which reads exactly like reporting that it is fine.

WHAT IT ASSERTS
---------------
For each environment, two sets, in both directions:

1. APPLIED-NOT-IN-REPO. A ledger row with no corresponding file under
   `supabase/migrations/`. These are the unrebuildable ones: schema that exists
   because someone ran SQL that was never committed. Several are the June 2026
   anon-grant and SECURITY DEFINER revokes, so a rebuild would be insecure in
   exactly the way the repo appears to have fixed.

2. IN-REPO-NOT-APPLIED. A migration file no ledger records. Either it never ran,
   or it ran under a name the ledger disagrees with — and the second is not
   better than the first, because it means the ledger cannot be used to decide
   what to replay.

⚠️ TWO-WAY RATCHET, NOT A SUPPRESSION LIST.
Today's ~30 divergences per environment are grandfathered in
`supabase/migration-ledger-baseline.json`, because a control that is red on the
day it lands is a control someone turns off. But the baseline may only SHRINK:
a NEW divergence fails, and so does a baselined divergence that has since been
RESOLVED. Without the second half, the file becomes a place to record defects
rather than a record of ones being fixed — the failure mode CLAUDE.md names
directly ("a list you may only add to is a suppression list, not a ratchet").

⚠️ ...EXCEPT THAT `applied_not_in_repo` COULD NOT SHRINK. THIS IS SEC-160.
The paragraph above was true of `in_repo_not_applied` and FALSE of
`applied_not_in_repo`, and the gap went unnoticed for the same reason gaps
usually do: the arm that could not fire is invisible from a green run.

Read the remediation this file's own failure text prescribes — "commit the
migration SQL that was applied out-of-band". Do it. Nothing changes. A ledger
row is a historical fact: it records that a migration RAN, under the name it
ran as, and committing SQL today cannot reach back and alter it. The row still
has no file of that name, so the entry still computes, so the STALE arm never
fires. Every entry in that list was permanent BY CONSTRUCTION — a list you may
only add to, which is exactly what the paragraph above forbids.

That is not hypothetical. SEC-160 committed the missing SQL for
`kan_232_mcp_tool_call_log`, `kan_244_content_moderation_flags` and
`kan_245_mcp_tool_call_log_retention`. Measured before the fix below existed:
the three entries stayed exactly where they were, AND the three new repo files
appeared as NINE `NEW — ... in the repo but NOT recorded as applied` failures,
three per environment. Doing the prescribed fix turned the control RED.

`reconciliations` closes it. Each entry pairs a ledger name with the repo file
that now carries its SQL:

    {"ledger": "kan_232_mcp_tool_call_log",
     "repo":   "sec160_reconcile_mcp_tool_call_log",
     "ticket": "SEC-160"}

The pairing is ADDITIVE and deliberately does NOT edit `applied_not_in_repo`.
That list stays the raw measurement — the ledger row genuinely has no file of
its own name, and rewriting history to hide that would lose the fact that the
migration was applied out of band in the first place. What the pairing does is
(a) stop reporting the repo file as unapplied, because it names schema that IS
applied, and (b) let the summary state the honest number: how many baselined
entries are genuinely unrebuildable versus merely renamed.

⚠️ A RECONCILIATION IS A CLAIM, NOT EVIDENCE — the same shape as the
`UI-No-Visual-Change:` trailer in CLAUDE.md. Nothing here verifies that the
named repo file actually contains the SQL that ledger row ran; a wrong pairing
would silence a real finding. What IS verified is that the claim stays live,
in both directions: the repo file must still exist (delete it and the
reconciliation fails, so the fix cannot be silently reverted), and the ledger
name must still be a real divergence somewhere (invent one and it fails as
stale). Those two arms are why this is a ratchet and not an annotation.

⚠️ NAME NORMALISATION IS DELIBERATE, AND IT IS THE WEAK POINT.
The repo names a migration `profile_items_visibility`; dev's ledger calls the
same thing `kan_143_profile_items_visibility`. Matching them strictly would
report ~50 false divergences per environment and drown the ~10 real ones. So
`normalise()` strips ticket prefixes and a few known suffixes. That is a
heuristic, and a heuristic that is too aggressive would MASK a real finding by
collapsing two different migrations onto one name. `--self-test` pins the
specific pairs it must and must not collapse; extend those fixtures before
extending the rules.

⚠️ FAIL-CLOSED, AND NO SILENT SKIP.
Missing token, non-200, unparseable body — every one exits non-zero and says
which environment. The Workflow & Backup Integrity Policy forbids the
`if: env.X != ''` pattern for exactly this reason, and SEC-136 is a live example
of the same defect in this repo's own weekly audit: a control that quietly
passes when it could not run still produces a green tick.

⚠️ READ-ONLY, DELIBERATELY.
`DELETE /v1/projects/{ref}/database/migrations` exists on the SAME path this
script GETs and rolls migrations out of the history table. This script must
never issue anything but GET; `fetch_ledger` hard-codes the method and
`--self-test` asserts no other verb appears in the source.

USAGE
    python3 scripts/check-migration-ledger-parity.py             # all three
    python3 scripts/check-migration-ledger-parity.py --env prod
    python3 scripts/check-migration-ledger-parity.py --self-test
    python3 scripts/check-migration-ledger-parity.py --write-baseline

ENVIRONMENT
    SUPABASE_ACCESS_TOKEN   personal access token (same one gen-db-types.sh uses)
    DEV_SUPABASE_PROJECT_REF / STAGING_SUPABASE_PROJECT_REF / PROD_SUPABASE_PROJECT_REF
        optional overrides; default to the refs recorded in PROJECT_REFS below,
        which are also the ones documented in CLAUDE.md gotcha #19.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
BASELINE_PATH = REPO_ROOT / "supabase" / "migration-ledger-baseline.json"
TIMEOUT_SECONDS = 30
API_ROOT = "https://api.supabase.com"

# ⚠️ THIS HEADER IS LOAD-BEARING. Without it CTL-049 CANNOT WORK, with any
# token, from any IP.
#
# `api.supabase.com` sits behind Cloudflare, and Cloudflare bans Python's
# default `User-Agent: Python-urllib/3.x` by browser signature — **error 1010**,
# returned as a bare `403 Forbidden`. The request never reaches Supabase's auth
# layer at all.
#
# That 403 is indistinguishable at a glance from "your token lacks permission",
# and it cost real time on 2026-08-14: a freshly minted PAT was blamed and
# nearly regenerated. The tell was the Supabase dashboard still reporting the
# token as **"Never used"** after two CI runs — a token that had been presented
# and REFUSED would have registered a use. Measured, no credentials, from a
# residential IP:
#
#   default python-urllib UA  -> 403  Cloudflare error 1010
#   browser-like UA           -> 401  Unauthorized   <- reached Supabase
#   bogus bearer + python UA  -> 403  Cloudflare error 1010
#
# So a 401 is the HEALTHY failure here and a 403 is the infrastructure one.
# This is CLAUDE.md gotcha #7 ("Cloudflare 403 from CI") one layer deeper: it is
# not only the runner's IP, it is the user agent, and it reproduces anywhere.
#
# Pinned by `--self-test` so the header cannot be dropped as tidying.
USER_AGENT = "lyra-ci-migration-ledger-parity/1.0 (+https://github.com/luisa-sys/lyra; CTL-049)"

# Project refs per CLAUDE.md gotcha #19. Not secrets — they appear in every
# project URL — but overridable so a fork or a restored project can be pointed
# elsewhere without editing the script.
PROJECT_REFS = [
    ("dev", "DEV_SUPABASE_PROJECT_REF", "ilprytcrnqyrsbsrfujj"),
    ("staging", "STAGING_SUPABASE_PROJECT_REF", "uobmlkzrjkptwhttzmmi"),
    ("prod", "PROD_SUPABASE_PROJECT_REF", "llzkgprqewuwkiwclowi"),
]


class LedgerError(RuntimeError):
    """Raised when an environment's ledger cannot be read. Never swallowed."""


# --------------------------------------------------------------------------
# name normalisation
# --------------------------------------------------------------------------

# Ticket prefixes the two conventions disagree about: the ledger usually carries
# the Jira key, the repo filename usually does not. `kan_143_`, `kan443_`,
# `sec104_`, `bugs77_` all appear.
_TICKET_PREFIX = re.compile(r"^(kan|sec|bugs)_?\d+[a-z]?_")
# The June 2026 security audit stamped its own date into the ledger name.
_AUDIT_PREFIX = re.compile(r"^security_audit_\d{8}_")


def normalise(name: str) -> str:
    """Reduce a migration name to a form comparable across the two conventions.

    Conservative on purpose: each rule below exists because a specific real pair
    differs only by it, and `--self-test` pins those pairs. A rule that collapses
    two genuinely different migrations would hide a finding, so widen this only
    with a fixture that proves the pair is the same migration.
    """
    s = name.lower()
    s = _AUDIT_PREFIX.sub("security_audit_", s)
    s = _TICKET_PREFIX.sub("", s)
    s = re.sub(r"_rls$", "", s)
    # `add_missing_item_categories` (repo) vs `add_missing_profile_item_categories`
    s = s.replace("profile_item_categories", "item_categories")
    return s


def repo_migrations() -> list[tuple[str, str]]:
    """[(version, name)] for every committed migration, in filename order."""
    out: list[tuple[str, str]] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        stem = path.stem
        if "_" not in stem:
            raise LedgerError(f"migration filename has no version prefix: {path.name}")
        version, name = stem.split("_", 1)
        out.append((version, name))
    return out


# --------------------------------------------------------------------------
# fetching
# --------------------------------------------------------------------------


def fetch_ledger(project_ref: str, token: str) -> list[dict]:
    """GET the applied-migration history for one project.

    READ-ONLY. The same path answers DELETE by rolling migrations out of the
    history table, so the method is hard-coded rather than parameterised.
    """
    endpoint = f"{API_ROOT}/v1/projects/{project_ref}/database/migrations"
    request = urllib.request.Request(
        endpoint,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            # See USER_AGENT above — without this Cloudflare 403s the request
            # before Supabase ever sees the token.
            "User-Agent": USER_AGENT,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:  # noqa: PERF203 - each needs its own message
        # ⚠️ INCLUDE THE BODY. `exc.reason` for a 403 is the literal string
        # "Forbidden", which is unactionable — and this endpoint has TWO
        # distinct 403 sources that need opposite responses:
        #
        #   * Cloudflare bot protection, which 403s before Supabase ever sees
        #     the token (see USER_AGENT above — that header exists for exactly
        #     this). Its body is an HTML challenge page.
        #   * Supabase itself, refusing the token's scope. Its body is JSON
        #     naming the reason.
        #
        # Told apart only by the body, so a message that omits it forces the
        # next person to re-derive what this run already knew. Truncated
        # because a challenge page is large and the first line is the tell.
        detail = ""
        try:
            raw = exc.read().decode("utf-8", "replace").strip()
            if raw:
                detail = f" — body: {' '.join(raw.split())[:300]}"
        except Exception:  # noqa: BLE001 - a body we cannot read must not mask the HTTP error
            detail = " — body: <unreadable>"
        raise LedgerError(f"HTTP {exc.code} from {endpoint} — {exc.reason}{detail}") from exc
    except urllib.error.URLError as exc:
        raise LedgerError(f"could not reach {endpoint} — {exc.reason}") from exc

    return parse_ledger_body(body, project_ref)


def parse_ledger_body(body: str, project_ref: str) -> list[dict]:
    """Turn a raw response body into ledger rows, or raise.

    Split out of `fetch_ledger` so `--self-test` can exercise the REAL parsing
    rather than a copy of it. That is not a stylistic preference: the first
    version of this file inlined the parse and the self-test re-implemented it,
    and a mutation making the parse fail OPEN (malformed body -> empty ledger,
    i.e. "this database has applied nothing", i.e. a clean-looking result)
    passed the self-test untouched. A test that reimplements its subject
    reports on the copy — CTL-038, and CLAUDE.md catalogue failure mode 1.
    """
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LedgerError(f"ledger response from {project_ref} is not JSON: {exc}") from exc

    rows = parsed.get("migrations") if isinstance(parsed, dict) else parsed
    if not isinstance(rows, list):
        raise LedgerError(f"ledger response from {project_ref} has no migrations list")
    return rows


def ledger_pairs(rows: list[dict]) -> list[tuple[str, str]]:
    """[(version, name)] from the API's row shape."""
    out: list[tuple[str, str]] = []
    for row in rows:
        version = str(row.get("version") or "")
        name = str(row.get("name") or "")
        if not version:
            raise LedgerError(f"ledger row without a version: {row!r}")
        out.append((version, name))
    return out


# --------------------------------------------------------------------------
# comparison
# --------------------------------------------------------------------------


def compare(
    repo: list[tuple[str, str]],
    ledger: list[tuple[str, str]],
    reconciled_repo_names: set[str] | None = None,
) -> dict:
    """The two divergence sets, plus duplicate ledger rows.

    Compares on NORMALISED names only. Version stamps genuinely differ between
    the repo and every ledger (the repo's stamp is when the file was written,
    the ledger's is when it was applied), so asserting on them would be a
    permanent red that says nothing about rebuildability.

    `reconciled_repo_names` are migration files declared to carry the SQL of a
    ledger row recorded under a DIFFERENT name (see the module docstring). They
    are excluded from `in_repo_not_applied` because the schema they describe is
    applied — under the old name. They are deliberately NOT removed from
    `applied_not_in_repo`, which stays the raw measurement.
    """
    reconciled = {normalise(n) for n in (reconciled_repo_names or set())}
    repo_norm = {normalise(n) for _, n in repo}
    ledger_norm = {normalise(n) for _, n in ledger}

    seen: dict[str, int] = {}
    for _, name in ledger:
        seen[name] = seen.get(name, 0) + 1

    return {
        "applied_not_in_repo": sorted({n for _, n in ledger if normalise(n) not in repo_norm}),
        "in_repo_not_applied": sorted(
            {
                n
                for _, n in repo
                if normalise(n) not in ledger_norm and normalise(n) not in reconciled
            }
        ),
        "duplicate_ledger_rows": sorted(n for n, c in seen.items() if c > 1),
    }


_TICKET_KEY = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")


def validate_reconciliations(
    entries: list, repo: list[tuple[str, str]], actuals: dict[str, dict]
) -> list[str]:
    """Check every reconciliation claim is well-formed and still live.

    Returns problems; empty means all hold. These are CONFIGURATION errors, not
    divergences, so the caller exits 2 rather than 1 — the distinction the
    workflow branches on, and the one that separates "the repo drifted" from
    "this control was handed something it cannot act on".

    The two liveness arms are the point of the whole mechanism:

      * the `repo` file must still exist. Without this, deleting the committed
        SQL would silently return the ledger row to unrebuildable while the
        pairing kept suppressing the report — the fix could be reverted with no
        red build, which is worse than never having made it.
      * the `ledger` name must still be a real divergence in some environment.
        Without this, a pairing could name anything at all and would sit here
        forever accumulating, which is the suppression-list failure re-entering
        through the mechanism built to prevent it.
    """
    problems: list[str] = []
    if not isinstance(entries, list):
        return ["`reconciliations` must be a list"]

    repo_names = {n for _, n in repo}
    # Union across environments: an entry legitimately diverges on some
    # databases and not others (dev and prod do not share a history), so
    # requiring it everywhere would reject correct pairings.
    all_applied_not_in_repo = {
        name for a in actuals.values() for name in a.get("applied_not_in_repo", [])
    }

    seen_repo: dict[str, int] = {}
    seen_ledger: dict[str, int] = {}

    for index, entry in enumerate(entries):
        where = f"reconciliations[{index}]"
        if not isinstance(entry, dict):
            problems.append(f"{where} is not an object")
            continue

        ledger_name = entry.get("ledger")
        repo_name = entry.get("repo")
        ticket = entry.get("ticket")

        if not isinstance(ledger_name, str) or not ledger_name:
            problems.append(f"{where} has no `ledger` name")
        if not isinstance(repo_name, str) or not repo_name:
            problems.append(f"{where} has no `repo` name")
        if not isinstance(ticket, str) or not _TICKET_KEY.match(ticket or ""):
            problems.append(
                f"{where} needs a `ticket` like SEC-160 — an unattributed pairing is an "
                f"annotation nobody can review (got {ticket!r})"
            )
        if not isinstance(ledger_name, str) or not isinstance(repo_name, str):
            continue

        seen_repo[repo_name] = seen_repo.get(repo_name, 0) + 1
        seen_ledger[ledger_name] = seen_ledger.get(ledger_name, 0) + 1

        if repo_name not in repo_names:
            problems.append(
                f"{where}: no migration file named {repo_name!r} exists under "
                f"supabase/migrations/. Either the reconciliation was reverted — in which "
                f"case {ledger_name!r} is unrebuildable again and this entry must go — or "
                f"the file was renamed and this entry must follow it."
            )
        if ledger_name not in all_applied_not_in_repo:
            problems.append(
                f"{where}: {ledger_name!r} is not applied-not-in-repo on any environment, so "
                f"there is nothing for it to reconcile. Remove the entry; a pairing that "
                f"matches nothing is the stale half of the ratchet."
            )

    for name, count in sorted(seen_repo.items()):
        if count > 1:
            problems.append(f"reconciliations: repo file {name!r} is claimed {count} times")
    for name, count in sorted(seen_ledger.items()):
        if count > 1:
            problems.append(f"reconciliations: ledger row {name!r} is claimed {count} times")

    return problems


def evaluate(env: str, actual: dict, baseline: dict) -> tuple[list[str], list[str]]:
    """(failures, notes) for one environment, against its baselined divergences.

    Two-way: NEW entries fail because the gap widened; STALE entries fail
    because the baseline is overstating the problem and must be shrunk. The
    second half is what stops this file becoming a suppression list.
    """
    expected = baseline.get("environments", {}).get(env, {})
    failures: list[str] = []
    notes: list[str] = []

    for key, label in (
        ("applied_not_in_repo", "applied to the database but NOT in the repo (unrebuildable)"),
        ("in_repo_not_applied", "in the repo but NOT recorded as applied"),
        ("duplicate_ledger_rows", "recorded more than once in the ledger"),
    ):
        was = set(expected.get(key, []))
        now = set(actual.get(key, []))

        for name in sorted(now - was):
            failures.append(f"{env}: NEW — {name} is {label}")
        for name in sorted(was - now):
            failures.append(
                f"{env}: STALE — {name} is baselined as {label}, but no longer diverges. "
                f"Remove it from the baseline in the same commit that fixed it."
            )
        if was & now:
            notes.append(f"{env}: {len(was & now)} baselined ({key}) — unchanged")

    return failures, notes


def load_baseline() -> dict:
    if not BASELINE_PATH.exists():
        raise LedgerError(
            f"baseline missing at {BASELINE_PATH.relative_to(REPO_ROOT)} — refusing to "
            f"report a clean run with nothing to compare against"
        )
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------


def self_test() -> int:
    """Prove the comparison and the ratchet can actually fail.

    Every case here exists because the corresponding bug would otherwise be
    invisible: a normaliser that collapses too much, a ratchet that only
    detects growth, a fetch path that reports clean when it could not read.
    """
    failures: list[str] = []
    evaluated = 0

    def check(label: str, got, want) -> None:
        # COUNTED HERE, not declared at the bottom of the file. The count used
        # to be a hand-maintained constant, and adding twelve cases for SEC-160
        # left it reading 29 — a self-test reporting fewer cases than it ran,
        # which is CLAUDE.md catalogue failure mode 8 in the one place least
        # able to afford it. Incrementing inside the assertion means the number
        # is what was actually EVALUATED: a case added to a loop counts, and a
        # case whose call site is deleted stops counting, with no bookkeeping.
        nonlocal evaluated
        evaluated += 1
        if got != want:
            failures.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")

    # --- normalisation: pairs that MUST collapse ---------------------------
    for repo_name, ledger_name in [
        ("profile_items_visibility", "kan_143_profile_items_visibility"),
        ("manual_of_me", "kan_154_manual_of_me"),
        ("admin_and_moderation", "kan_141_admin_and_moderation"),
        ("gift_redesign", "kan443_gift_redesign"),
        ("public_profiles_view", "sec104_public_profiles_view"),
        ("add_avatar_url_and_storage", "add_avatar_url_and_storage_rls"),
        ("add_missing_item_categories", "add_missing_profile_item_categories"),
        (
            "security_audit_contact_hash_authn_only",
            "security_audit_20260621_contact_hash_authn_only",
        ),
    ]:
        check(
            f"normalise must collapse {repo_name!r} and {ledger_name!r}",
            normalise(repo_name) == normalise(ledger_name),
            True,
        )

    # --- normalisation: pairs that MUST NOT collapse -----------------------
    # A normaliser that is too aggressive HIDES findings, which is worse than
    # one that is too strict, because the result is a green tick.
    for a, b in [
        ("convene_spike_oauth", "drop_convene_spike"),
        ("security_invariants_report", "security_invariants_report_v2"),
        ("sec74_affiliate_clicks_retention_purge", "sec74_gatherings_retention_purge"),
        ("kan_232_mcp_tool_call_log", "kan_245_mcp_tool_call_log_retention"),
        ("beta_access_status", "beta_access_lockdown"),
    ]:
        check(f"normalise must NOT collapse {a!r} and {b!r}", normalise(a) == normalise(b), False)

    # --- compare: the corpus must be non-empty before it means anything ----
    repo_fixture = [("20260101000000", "alpha"), ("20260102000000", "beta")]
    ledger_fixture = [("20260101010101", "kan_1_alpha"), ("20260103000000", "gamma")]
    check("fixture corpus is non-empty", len(repo_fixture) > 0 and len(ledger_fixture) > 0, True)

    result = compare(repo_fixture, ledger_fixture)
    check("compare finds the applied-not-in-repo entry", result["applied_not_in_repo"], ["gamma"])
    check("compare finds the in-repo-not-applied entry", result["in_repo_not_applied"], ["beta"])
    check("compare collapses alpha via the ticket prefix", "alpha" in result["in_repo_not_applied"], False)

    # --- compare: duplicate detection --------------------------------------
    dupes = compare(repo_fixture, ledger_fixture + [("20260103000001", "gamma")])
    check("compare reports a duplicated ledger row", dupes["duplicate_ledger_rows"], ["gamma"])

    # --- ratchet: NEW fails -------------------------------------------------
    baseline = {"environments": {"t": {"applied_not_in_repo": [], "in_repo_not_applied": ["beta"]}}}
    fails, _ = evaluate("t", result, baseline)
    check(
        "a NEW unrebuildable migration fails",
        any("NEW — gamma" in f for f in fails),
        True,
    )

    # --- ratchet: STALE fails (this is the half that is usually missing) ----
    baseline_stale = {
        "environments": {
            "t": {"applied_not_in_repo": ["gamma", "ghost"], "in_repo_not_applied": ["beta"]}
        }
    }
    fails, _ = evaluate("t", result, baseline_stale)
    check("a RESOLVED baselined entry fails as stale", any("STALE — ghost" in f for f in fails), True)
    check("the still-diverging baselined entry does not fail", any("gamma" in f for f in fails), False)

    # --- ratchet: unchanged input stays green ------------------------------
    # A gate that always fires is one people learn to wave through.
    baseline_exact = {
        "environments": {
            "t": {
                "applied_not_in_repo": ["gamma"],
                "in_repo_not_applied": ["beta"],
                "duplicate_ledger_rows": [],
            }
        }
    }
    fails, _ = evaluate("t", result, baseline_exact)
    check("an unchanged environment passes", fails, [])

    # --- reconciliations: the SEC-160 arm ----------------------------------
    # Every case below is a way this mechanism could silently stop working.
    # The first two are the behaviour; the rest are the ways a pairing could
    # become a licence to suppress rather than a claim that stays true.
    recon_repo = [
        ("20260101000000", "alpha"),
        ("20260102000000", "beta"),
        ("20260817100000", "sec160_reconcile_widget"),
    ]
    recon_ledger = [("20260101010101", "kan_1_alpha"), ("20260103000000", "kan_9_widget")]
    pairing = [{"ledger": "kan_9_widget", "repo": "sec160_reconcile_widget", "ticket": "SEC-160"}]

    plain = compare(recon_repo, recon_ledger)
    check(
        "without a reconciliation the committed file reads as unapplied",
        "sec160_reconcile_widget" in plain["in_repo_not_applied"],
        True,
    )

    reconciled = compare(recon_repo, recon_ledger, {"sec160_reconcile_widget"})
    check(
        "a reconciliation stops its repo file being reported as unapplied",
        "sec160_reconcile_widget" in reconciled["in_repo_not_applied"],
        False,
    )
    check(
        "it suppresses ONLY the named file, not every unapplied one",
        reconciled["in_repo_not_applied"],
        ["beta"],
    )
    # The raw measurement must stay raw. Editing `applied_not_in_repo` here
    # would erase the fact that the migration was applied out of band, which
    # is the finding itself and not a wart to tidy away.
    check(
        "it does NOT remove the ledger row from applied-not-in-repo",
        reconciled["applied_not_in_repo"],
        ["kan_9_widget"],
    )

    actual_fixture = {"t": reconciled}
    check(
        "a well-formed, live pairing raises no problem",
        validate_reconciliations(pairing, recon_repo, actual_fixture),
        [],
    )

    # THE ARM THAT MATTERS. Delete the committed SQL and the ledger row is
    # unrebuildable again — but the pairing would go on suppressing the
    # report. Without this case the fix could be reverted with no red build.
    gone = validate_reconciliations(pairing, [("1", "alpha"), ("2", "beta")], actual_fixture)
    check(
        "a reconciliation whose repo file has been deleted fails",
        any("no migration file named" in p for p in gone),
        True,
    )

    # The other direction: a pairing that matches no real divergence would sit
    # here forever, which is the suppression list re-entering through the door
    # built to keep it out.
    orphan = validate_reconciliations(
        [{"ledger": "never_diverged", "repo": "alpha", "ticket": "SEC-160"}],
        recon_repo,
        actual_fixture,
    )
    check(
        "a pairing matching no divergence fails as stale",
        any("nothing for it to reconcile" in p for p in orphan),
        True,
    )

    for label, entry in [
        ("no ticket", {"ledger": "kan_9_widget", "repo": "sec160_reconcile_widget"}),
        (
            "a placeholder ticket",
            {"ledger": "kan_9_widget", "repo": "sec160_reconcile_widget", "ticket": "SEC-xxx"},
        ),
    ]:
        check(
            f"a reconciliation with {label} fails",
            any("needs a `ticket`" in p for p in validate_reconciliations([entry], recon_repo, actual_fixture)),
            True,
        )

    dup = validate_reconciliations(pairing + pairing, recon_repo, actual_fixture)
    check("a repo file claimed twice fails", any("is claimed 2 times" in p for p in dup), True)

    # ...and an empty list is fine, so the checks above are not passing merely
    # because everything raises.
    check("no reconciliations at all is not an error", validate_reconciliations([], recon_repo, actual_fixture), [])

    # --- fetch: malformed bodies must raise, never return empty ------------
    # Calls the REAL parser. An earlier draft re-implemented this loop's
    # parsing inline and therefore kept passing when the real one was mutated
    # to fail open — the exact defect CTL-038 exists to catch, reproduced here
    # by accident while writing a control about controls failing open.
    for label, payload in [
        ("a non-JSON body", "<html>gateway timeout</html>"),
        ("a JSON object with no migrations list", '{"error": "nope"}'),
        ("an empty body", ""),
        ("a JSON null", "null"),
    ]:
        try:
            parse_ledger_body(payload, "fixture")
            raised = False
        except LedgerError:
            raised = True
        check(f"{label} is treated as a failure, not an empty ledger", raised, True)

    # ...and the happy path still parses, so the guard above is not passing
    # merely because everything raises.
    check(
        "a well-formed body parses",
        parse_ledger_body('{"migrations":[{"version":"1","name":"a"}]}', "fixture"),
        [{"version": "1", "name": "a"}],
    )

    # --- read-only: every HTTP request this file makes is a GET ------------
    # Asserted on the `method=` ARGUMENT rather than on raw occurrences of the
    # word. The first draft of this check scanned for the literal strings and
    # failed against its own verb list — the check was executable code
    # containing the very tokens it forbade. Two lessons, both kept: strip
    # prose before scanning source (this file names the destructive endpoint
    # deliberately, and a guard that punishes documenting a hazard is pointed
    # the wrong way), and assert the thing that has meaning — the method
    # actually passed to urllib — rather than a substring that correlates
    # with it.
    source = Path(__file__).read_text(encoding="utf-8")
    code = re.sub(r'"""[\s\S]*?"""', "", source)
    code = "\n".join(line.split("#", 1)[0] for line in code.split("\n"))
    methods = set(re.findall(r'method\s*=\s*"([A-Z]+)"', code))
    check("the file issues at least one request", len(methods) > 0, True)
    check("every request method is GET", methods, {"GET"})

    # --- the User-Agent is load-bearing, not decoration --------------------
    # Cloudflare fronts api.supabase.com and bans Python's default UA by
    # browser signature (error 1010), returning a bare 403 BEFORE Supabase
    # sees the token. Dropping this header does not degrade the check — it
    # makes it impossible, while producing a failure that reads exactly like
    # a credential problem. It cost a nearly-regenerated PAT on 2026-08-14.
    #
    # Asserted on the header actually sent, and on the request wiring, so
    # deleting either the constant or its use reddens this.
    check("a User-Agent constant is defined", bool(re.search(r'^USER_AGENT\s*=', code, re.M)), True)
    check(
        "the outbound request sends that User-Agent",
        bool(re.search(r'"User-Agent"\s*:\s*USER_AGENT', code)),
        True,
    )
    check(
        "the User-Agent is not Python's default",
        USER_AGENT.lower().startswith("python-urllib"),
        False,
    )
    check("the User-Agent identifies this control", "CTL-049" in USER_AGENT, True)

    if failures:
        print("SELF-TEST FAILED")
        for f in failures:
            print(f"  ✗ {f}")
        return 1

    print(f"Self-test passed ({evaluated} cases).")
    return 0


# The FLOOR, not the count — the count is now whatever `check()` actually
# evaluated (see the comment there). `tests/scripts/` asserts the reported
# number does not fall below this, which is how a self-test that quietly stops
# testing things is caught. Raise it when cases are added; never lower it to
# make a run green.
SELF_TEST_FLOOR = 29


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def resolve_environments(only: str | None) -> list[tuple[str, str]]:
    out = []
    for env, override, default in PROJECT_REFS:
        if only and env != only:
            continue
        out.append((env, os.environ.get(override) or default))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="CTL-049 — migration ledger parity")
    parser.add_argument("--self-test", action="store_true", help="run built-in fixtures and exit")
    parser.add_argument("--env", choices=[e for e, _, _ in PROJECT_REFS], help="check one environment")
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="regenerate the baseline from live state (never hand-type it)",
    )
    parser.add_argument(
        "--ledger-dir",
        metavar="DIR",
        help=(
            "read <env>.json instead of calling the API. For generating the first "
            "baseline from a captured measurement and for tests. CI must NOT pass "
            "this — see the warning in the source."
        ),
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    # ⚠️ THE OFFLINE SEAM IS THE WEAKEST POINT IN THIS CONTROL.
    #
    # `--ledger-dir` reads local JSON instead of asking the databases, so a
    # baseline generated with it is only as honest as the files it was handed.
    # It exists because the first baseline had to be built from a measurement
    # taken through the Supabase MCP in a session with no API token, and
    # hand-typing ~90 entries would have been strictly worse — a hand-typed
    # baseline is the failure mode CLAUDE.md calls out by name (the test floor
    # that sat at 29 files against an actual 260).
    #
    # It is NOT wired into CI, and it must not be: a control that can be handed
    # its own answer is a control that can be made to agree with anything. The
    # scheduled job calls the API. Regenerate the baseline from a real run when
    # convenient and the numbers should not move.
    if args.ledger_dir:
        print("::warning::--ledger-dir in use: reading captured files, NOT the live databases.")
        print("::warning::A run using this seam proves nothing about live state.")

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token and not args.ledger_dir:
        print("::error::SUPABASE_ACCESS_TOKEN is not set.")
        print("::error::Refusing to report a clean run for a check that never contacted a database.")
        return 2

    try:
        repo = repo_migrations()
    except LedgerError as exc:
        print(f"::error::{exc}")
        return 2

    if not repo:
        print("::error::No migrations found under supabase/migrations/ — refusing to")
        print("::error::compare against an empty corpus, which would pass trivially.")
        return 2

    # Reconciliations come from the baseline, so they must be read before the
    # comparison that uses them. A missing baseline is fatal below either way;
    # here an unreadable one degrades to "no reconciliations", which is the
    # SAFE direction — it can only cause extra reports, never suppress one.
    try:
        reconciliations = load_baseline().get("reconciliations", [])
    except (LedgerError, json.JSONDecodeError):
        reconciliations = []
    reconciled_repo_names = {
        e.get("repo") for e in reconciliations if isinstance(e, dict) and e.get("repo")
    }

    environments = resolve_environments(args.env)
    actuals: dict[str, dict] = {}

    for env, ref in environments:
        try:
            if args.ledger_dir:
                captured = Path(args.ledger_dir) / f"{env}.json"
                rows = ledger_pairs(parse_ledger_body(captured.read_text(encoding="utf-8"), env))
            else:
                rows = ledger_pairs(fetch_ledger(ref, token))
        except (LedgerError, OSError) as exc:
            print(f"::error::{env}: {exc}")
            print(f"::error::Failing closed — a ledger that cannot be read is not a ledger that agrees.")
            return 2
        actuals[env] = compare(repo, rows, reconciled_repo_names)
        actuals[env]["_ledger_rows"] = len(rows)

    if args.write_baseline:
        payload = {
            "_why": [
                "CTL-049 / SEC-137. Divergences between supabase/migrations/ and each",
                "database's applied-migration ledger, as they stood when this file was",
                "generated. Grandfathered so the control can land green.",
                "",
                "SHRINK-ONLY, BOTH WAYS. A new divergence fails. A baselined divergence",
                "that has been resolved ALSO fails, so this cannot quietly become a",
                "suppression list. Regenerate with --write-baseline in the same commit",
                "that fixes something; never hand-edit.",
                "",
                "`reconciliations` (SEC-160) pairs a ledger name with the repo file that",
                "now carries its SQL. It is CARRIED THROUGH regeneration rather than",
                "recomputed, because it records a human claim that two names denote the",
                "same migration — something no measurement can derive. Losing it on a",
                "regenerate would resurrect the entries it suppresses, so it is preserved",
                "explicitly and its liveness is re-checked on every run.",
            ],
            "ticket": "SEC-137",
            "environments": {
                env: {k: v for k, v in a.items() if not k.startswith("_")}
                for env, a in actuals.items()
            },
            "reconciliations": reconciliations,
        }
        # ensure_ascii=False so the generator emits the same bytes a human
        # would write. With the default, an em-dash in `_why` or a `why` field
        # comes back as — and the committed file stops being reproducible
        # from its own generator — a small thing that makes "is this file
        # generated or hand-edited?" unanswerable from the diff.
        BASELINE_PATH.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"Wrote {BASELINE_PATH.relative_to(REPO_ROOT)}")
        return 0

    try:
        baseline = load_baseline()
    except LedgerError as exc:
        print(f"::error::{exc}")
        return 2

    # Configuration problems are exit 2, not exit 1. A reconciliation naming a
    # file that no longer exists does not mean the repo drifted; it means this
    # control was handed a claim it cannot act on, and reporting that as a
    # divergence would send the reader looking in the wrong place.
    reconciliation_problems = validate_reconciliations(reconciliations, repo, actuals)
    if reconciliation_problems:
        print("::error::Reconciliation claims in the baseline do not hold.")
        for problem in reconciliation_problems:
            print(f"::error::{problem}")
        return 2

    all_failures: list[str] = []
    for env, actual in actuals.items():
        fails, notes = evaluate(env, actual, baseline)
        print(f"\n{env}: {actual['_ledger_rows']} ledger rows vs {len(repo)} repo migrations")
        for note in notes:
            print(f"  · {note}")
        all_failures.extend(fails)

    # The honest count. `applied_not_in_repo` deliberately still holds the
    # reconciled rows (it is the raw measurement), so without this line the
    # summary overstates how much schema is genuinely unrecoverable — and
    # overstating a risk erodes the number the same way understating it does.
    if reconciliations:
        reconciled_ledger = {e["ledger"] for e in reconciliations}
        print()
        for env, actual in actuals.items():
            baselined = set(baseline.get("environments", {}).get(env, {}).get("applied_not_in_repo", []))
            recovered = baselined & reconciled_ledger
            print(
                f"  · {env}: {len(baselined)} applied-not-in-repo — "
                f"{len(recovered)} now have SQL in the repo under another name, "
                f"{len(baselined - recovered)} remain genuinely unrebuildable"
            )

    print()
    if all_failures:
        print("::error::Migration ledger parity FAILED.")
        for f in all_failures:
            print(f"::error::{f}")
        print()
        print("A NEW entry means the repo and a database have drifted further apart —")
        print("either commit the migration SQL that was applied out-of-band, or apply")
        print("the migration that was committed. A STALE entry means a divergence was")
        print("fixed without shrinking the baseline; regenerate it with --write-baseline.")
        return 1

    print(f"Ledger parity holds against the baseline for {len(actuals)} environment(s). ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
