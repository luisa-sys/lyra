#!/usr/bin/env python3
"""KAN-467 Phase 0 — the preflight. Nothing else in the sweep may run unless
this exits 0.

WHY THIS EXISTS
---------------
The QA sweep is a robot that clicks every button it can find. Pointed at the
right environment it is a coverage tool; pointed at the wrong one it is an
incident. The distance between the two is one environment variable, and the
failure is silent until it isn't:

  * `beta.checklyra.com` LOOKS like a test environment. It is production data
    on the production Supabase project, gated in-app by middleware.
  * With `RESEND_API_KEY` set, the contact form and the beta-queue mails have
    NO recipient allowlist — the default destination is the founder's real
    inbox. A sweep that fills in every form sends every one of those.
  * `deleteAccount`'s "type DELETE" confirmation is client-side only.

So this runs first, and it is the whole gate. It is deliberately boring: a list
of yes/no questions, each of which must be answered YES before a run starts.

FAIL-CLOSED IS THE ENTIRE POINT
-------------------------------
Every unknown is a failure. Not "warn and continue", not "assume dev" — a
failure, exit 2. That means:

  * no target given                  -> FAIL (not "default to localhost")
  * target not in the allowlist      -> FAIL (not "probably fine")
  * the envelope will not import     -> FAIL (a denylist that cannot load is
                                        indistinguishable from an empty one,
                                        and an empty denylist permits
                                        everything by vacuous truth)
  * a Supabase URL we cannot parse   -> FAIL (an unparseable ref is not a safe
                                        ref; it is an unmeasured one)

The temptation this resists is the one that produced SEC-113 and the nine
vacuous suites: a check that passes when it did not actually run. A guard that
cannot see what it is guarding must not report it clean. Exit 0 from this
script is a positive claim that every question was asked AND answered.

WHY THE CF BYPASS IS A CHECK AND NOT A SHRUG
--------------------------------------------
Phase 3 is local-run only until SEC-125 provisions the Cloudflare bypass
(founder decision, 2026-08-04). Without the bypass a CI run cannot reach a
proxied origin — Cloudflare returns a 403 interstitial, and a runner that
treats that as "page loaded" will report every route as broken. Locally the
bypass is irrelevant and its absence is correct. So the rule is conditional:
absent bypass is FATAL only when the run claims to be CI, and is reported as a
visible state otherwise. Surfacing the state beats pretending it is fine.

EXIT CODES
    0  every check asked and passed — the run may proceed
    2  fail-closed: something failed, or could not be determined

There is deliberately no exit 1, on ANY path — including `--self-test`, and
including an unforeseen exception, both of which used to emit it. A "soft"
failure tier is how a preflight becomes advisory, and an advisory preflight is
decoration; an exit 1 that means "the tool broke" is worse still, because it is
the code a caller retries instead of reads. Two things hold that line: the
enumerated `REQUIRED_ENVELOPE_ATTRS` shape check, which turns a renamed constant
in `config.py` into a reported FAIL rather than an AttributeError, and the
catch-all in `main()`.

USAGE
    python3 qa-sweep/preflight.py --target e2e-dev.checklyra.com
    python3 qa-sweep/preflight.py --target localhost:3000 --ci
    python3 qa-sweep/preflight.py --self-test
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The import itself is a check. If the envelope will not load there is no
# denylist, and a run with no denylist is exactly the run this script exists to
# prevent — so this failure is fatal and loud rather than a caught warning that
# degrades into "0 denylisted actions, all clear".
try:
    import config as envelope
except Exception as exc:  # noqa: BLE001 - any import failure is fatal here
    sys.stderr.write(
        "::error::qa-sweep preflight FAILED CLOSED — the safety envelope "
        "(qa-sweep/config.py) could not be imported: {0}\n".format(exc)
    )
    sys.stderr.write(
        "Without it there is no denylist, and an absent denylist permits every "
        "destructive action by vacuous truth. Refusing to report a pass.\n"
    )
    sys.exit(2)


#: A single preflight question. `ok=None` means UNDETERMINED, which is treated
#: exactly like False — the type exists so the report can say which it was.
class Check(object):
    def __init__(self, name, ok, detail=""):
        # type: (str, Optional[bool], str) -> None
        self.name = name
        self.ok = ok
        self.detail = detail

    @property
    def passed(self):
        # type: () -> bool
        return self.ok is True

    @property
    def status(self):
        # type: () -> str
        if self.ok is True:
            return "PASS"
        if self.ok is False:
            return "FAIL"
        return "UNDETERMINED"


#: Every attribute of the safety envelope this preflight reads. Enumerated so a
#: missing one is a FAILED CHECK rather than an AttributeError — see
#: `check_envelope_shape`.
REQUIRED_ENVELOPE_ATTRS = (
    "ALLOWED_REFS",
    "CF_BYPASS_ENV_VARS",
    "CF_BYPASS_PENDING_TICKET",
    "DESTRUCTIVE_DENYLIST",
    "DEV_REF",
    "REFUSED_HOSTS",
    "REFUSED_REFS",
    "REQUIRED_UNSET_ENV",
    "STAGING_REF",
    "TARGET_ALLOWLIST",
    "normalise_host",
    "project_ref_from_url",
)


def check_envelope_shape(mod=None):
    # type: (object) -> List[Check]
    """Does the envelope still expose everything this file reads?

    Without this, a renamed or deleted constant raises AttributeError out of
    `evaluate()` and the process exits **1** — a code this script's own
    docstring promises never to emit, and one that reads as "the harness is
    broken" rather than "the safety envelope is broken". Those are the same
    event and only one of them gets investigated.

    Only `DESTRUCTIVE_DENYLIST` was guarded (in `check_denylist`), so it was the
    single attribute whose absence failed closed. Every other one failed open in
    the sense that matters: no report, no `::error::`, no exit 2.
    """
    target = mod if mod is not None else envelope
    missing = [a for a in REQUIRED_ENVELOPE_ATTRS if not hasattr(target, a)]
    if missing:
        return [
            Check(
                "safety envelope exposes every attribute the preflight reads",
                False,
                "qa-sweep/config.py is missing: {0}. A preflight that cannot "
                "read its own policy has not asked the questions, so it must "
                "not report a pass.".format(", ".join(sorted(missing))),
            )
        ]
    return [
        Check(
            "safety envelope exposes every attribute the preflight reads",
            True,
            "{0} attributes".format(len(REQUIRED_ENVELOPE_ATTRS)),
        )
    ]


def check_target(target):
    # type: (Optional[str]) -> List[Check]
    """Is the target one we are allowed to point a robot at?"""
    out = []  # type: List[Check]

    if not target or not target.strip():
        out.append(
            Check(
                "target supplied",
                False,
                "no --target given. There is no default; a sweep with an "
                "unstated target is a sweep against whatever was in the shell.",
            )
        )
        return out
    out.append(Check("target supplied", True, target))

    host = envelope.normalise_host(target)
    if not host:
        out.append(
            Check(
                "target parses to a host",
                False,
                "could not parse a host from {0!r} — an unparseable target is "
                "not a safe target, it is an unmeasured one".format(target),
            )
        )
        return out

    refused = envelope.REFUSED_HOSTS.get(host)
    if refused is not None:
        out.append(
            Check(
                "target is not a refused (production) host",
                False,
                "{0} is refused: {1}".format(host, refused),
            )
        )
        return out
    out.append(Check("target is not a refused (production) host", True, host))

    entry = envelope.TARGET_ALLOWLIST.get(host)
    if entry is None:
        out.append(
            Check(
                "target is in the allowlist",
                False,
                "{0} is not in the allowlist. Allowed: {1}. An unrecognised "
                "host is refused, never assumed safe.".format(
                    host, ", ".join(sorted(envelope.TARGET_ALLOWLIST))
                ),
            )
        )
        return out

    out.append(
        Check(
            "target is in the allowlist",
            True,
            "{0} -> {1} ({2})".format(host, entry["ref"], entry["env"]),
        )
    )
    return out


def check_supabase_ref(target, supabase_url):
    # type: (Optional[str], Optional[str]) -> List[Check]
    """Mirror `assertNotProd` — refuse prod by ref, allow only dev/staging.

    Mirrors tests/e2e/support/supabase-admin.ts:58. The positive allowlist is
    the real guard; the explicit prod check exists so the operator gets "that
    is production" rather than "unrecognised project".
    """
    out = []  # type: List[Check]
    host = envelope.normalise_host(target or "")
    entry = envelope.TARGET_ALLOWLIST.get(host)

    # Determine the ref under test. An explicit --supabase-url wins, because
    # that is what the harness will actually connect to.
    if supabase_url:
        ref = envelope.project_ref_from_url(supabase_url)
        origin = "--supabase-url"
        if not ref:
            out.append(
                Check(
                    "Supabase project ref is determinable",
                    False,
                    "could not parse a project ref from {0!r}".format(supabase_url),
                )
            )
            return out
    elif entry is not None:
        ref = str(entry["ref"])
        origin = "allowlist mapping"
    else:
        out.append(
            Check(
                "Supabase project ref is determinable",
                None,
                "no --supabase-url and the target is not in the allowlist, so "
                "the project ref cannot be established. UNDETERMINED is a "
                "failure here.",
            )
        )
        return out

    out.append(Check("Supabase project ref is determinable", True, "{0} (via {1})".format(ref, origin)))

    refused_reason = envelope.REFUSED_REFS.get(ref)
    if refused_reason is not None:
        out.append(
            Check(
                "Supabase project ref is not production",
                False,
                "refusing to run against project ref {0} — {1}".format(ref, refused_reason),
            )
        )
        return out
    out.append(Check("Supabase project ref is not production", True, ref))

    if ref not in envelope.ALLOWED_REFS:
        out.append(
            Check(
                "Supabase project ref is positively allowed",
                False,
                "unrecognised project ref {0!r}. Only dev ({1}) and staging "
                "({2}) are allowed.".format(ref, envelope.DEV_REF, envelope.STAGING_REF),
            )
        )
        return out
    out.append(Check("Supabase project ref is positively allowed", True, ref))

    # A host in the allowlist that points somewhere unexpected is the exact
    # shape of a misconfigured run — catch the disagreement rather than
    # trusting whichever source was consulted last.
    if supabase_url and entry is not None and ref != str(entry["ref"]):
        out.append(
            Check(
                "target host and Supabase URL agree",
                False,
                "{0} maps to {1} in the allowlist but --supabase-url resolves "
                "to {2}".format(host, entry["ref"], ref),
            )
        )
    elif supabase_url and entry is not None:
        out.append(Check("target host and Supabase URL agree", True, ref))

    return out


def check_env_unset(env):
    # type: (Dict[str, str]) -> List[Check]
    """Every compensating control must actually be in place."""
    out = []  # type: List[Check]
    for var, reason in sorted(envelope.REQUIRED_UNSET_ENV.items()):
        value = env.get(var)
        # An empty string is unset for our purposes: the code paths guard with
        # falsy checks (`if (!apiKey)`), so '' degrades to the same no-op.
        if value is None or value.strip() == "":
            out.append(Check("{0} is unset".format(var), True))
        else:
            out.append(
                Check(
                    "{0} is unset".format(var),
                    False,
                    "{0} is set. {1}".format(var, reason),
                )
            )
    return out


def check_denylist():
    # type: () -> List[Check]
    """The denylist must exist, be non-empty, and be shaped for lookup."""
    out = []  # type: List[Check]
    try:
        denylist = envelope.DESTRUCTIVE_DENYLIST
    except AttributeError:
        return [
            Check(
                "denylist is loadable",
                False,
                "qa-sweep/config.py defines no DESTRUCTIVE_DENYLIST",
            )
        ]

    if not isinstance(denylist, dict):
        return [Check("denylist is loadable", False, "denylist is not a mapping")]
    out.append(Check("denylist is loadable", True))

    if len(denylist) == 0:
        out.append(
            Check(
                "denylist is non-empty",
                False,
                "the denylist is empty, so every destructive action would be "
                "permitted by vacuous truth",
            )
        )
        return out
    out.append(Check("denylist is non-empty", True, "{0} entries".format(len(denylist))))

    # `file::name` or the lookup silently never matches — which reassures
    # without protecting, the worst property a guard can have.
    malformed = [k for k in denylist if "::" not in k or not k.partition("::")[2].strip()]
    if malformed:
        out.append(
            Check(
                "every denylist key is `file::functionName`",
                False,
                "malformed keys: {0}".format(", ".join(sorted(malformed)[:5])),
            )
        )
    else:
        out.append(Check("every denylist key is `file::functionName`", True))

    unexplained = [k for k, v in denylist.items() if not str(v).strip()]
    if unexplained:
        out.append(
            Check(
                "every denylist entry carries a reason",
                False,
                "unexplained: {0}".format(", ".join(sorted(unexplained)[:5])),
            )
        )
    else:
        out.append(Check("every denylist entry carries a reason", True))

    return out


def check_cf_bypass(env, claimed_ci):
    # type: (Dict[str, str], bool) -> List[Check]
    """CF bypass: fatal when the run claims CI, surfaced otherwise."""
    present = [v for v in envelope.CF_BYPASS_ENV_VARS if str(env.get(v, "")).strip()]
    have_all = len(present) == len(envelope.CF_BYPASS_ENV_VARS)

    if have_all:
        return [Check("Cloudflare bypass available", True, "all bypass vars set")]

    missing = [v for v in envelope.CF_BYPASS_ENV_VARS if v not in present]
    if claimed_ci:
        return [
            Check(
                "Cloudflare bypass available (required in CI)",
                False,
                "run claims CI but the bypass is absent ({0}). Cloudflare will "
                "serve a 403 interstitial and the run would record every route "
                "as broken. Blocked on {1}.".format(
                    ", ".join(missing), envelope.CF_BYPASS_PENDING_TICKET
                ),
            )
        ]
    return [
        Check(
            "Cloudflare bypass state surfaced (local run)",
            True,
            "bypass absent ({0}) — expected for a local run; Phase 3 is "
            "local-only until {1}".format(
                ", ".join(missing), envelope.CF_BYPASS_PENDING_TICKET
            ),
        )
    ]


def evaluate(target, env, claimed_ci=False, supabase_url=None):
    # type: (Optional[str], Dict[str, str], bool, Optional[str]) -> List[Check]
    """Run every preflight question. Pure — no I/O, no globals read."""
    checks = []  # type: List[Check]
    shape = check_envelope_shape()
    checks.extend(shape)
    if not all(c.passed for c in shape):
        # Every question below reads the envelope; asking them now would raise
        # rather than answer, and an unasked question is not a passed one.
        return checks
    checks.extend(check_target(target))
    checks.extend(check_supabase_ref(target, supabase_url))
    checks.extend(check_env_unset(env))
    checks.extend(check_denylist())
    checks.extend(check_cf_bypass(env, claimed_ci))
    return checks


def report(checks, stream=sys.stdout):
    # type: (List[Check], object) -> int
    """Print the checks and return the exit code. 0 or 2, never 1."""
    width = max([len(c.name) for c in checks] + [10])
    stream.write("KAN-467 QA sweep — preflight\n")
    stream.write("-" * (width + 20) + "\n")
    for c in checks:
        stream.write("  [{0:<12}] {1}\n".format(c.status, c.name))
        if c.detail and not c.passed:
            stream.write("      {0}\n".format(c.detail))
        elif c.detail:
            stream.write("      {0}\n".format(c.detail))
    stream.write("-" * (width + 20) + "\n")

    failed = [c for c in checks if not c.passed]
    if failed:
        stream.write(
            "PREFLIGHT FAILED CLOSED — {0} of {1} checks did not pass.\n".format(
                len(failed), len(checks)
            )
        )
        for c in failed:
            stream.write("::error::{0}: {1}\n".format(c.name, c.detail or c.status))
        stream.write("\nNo part of the QA sweep may run. Fix the above and re-run.\n")
        return 2

    stream.write("PREFLIGHT PASSED — {0}/{0} checks.\n".format(len(checks)))
    stream.write("The sweep is cleared to run against this target.\n")
    return 0


# --------------------------------------------------------------------------
# Self-test fixtures. Each is a scenario the preflight must get right; several
# encode a real near-miss rather than a hypothetical.
# --------------------------------------------------------------------------

_CLEAN_ENV = {}  # type: Dict[str, str]


class _EnvelopeShim(object):
    """A stand-in envelope, used to model one constant going missing."""


def _envelope_missing(attr):
    # type: (str) -> object
    """The real envelope with exactly one attribute removed."""
    shim = _EnvelopeShim()
    for name in REQUIRED_ENVELOPE_ATTRS:
        if name == attr:
            continue
        setattr(shim, name, getattr(envelope, name))
    return shim


def self_test():
    # type: () -> int
    cases = []  # type: List[Tuple[str, bool, List[Check]]]
    extras = []  # type: List[Tuple[str, bool, str]]

    def direct(name, ok, detail=""):
        # type: (str, object, str) -> None
        """A fixture that asserts on a helper rather than on a whole run."""
        extras.append((name, bool(ok), detail))

    def case(name, expect_pass, **kwargs):
        checks = evaluate(
            kwargs.get("target"),
            kwargs.get("env", dict(_CLEAN_ENV)),
            kwargs.get("claimed_ci", False),
            kwargs.get("supabase_url"),
        )
        cases.append((name, expect_pass, checks))

    # --- the happy paths ---------------------------------------------------
    case("allowlisted dev target passes", True, target="e2e-dev.checklyra.com")
    case("allowlisted staging target passes", True, target="e2e-stage.checklyra.com")
    case("localhost passes", True, target="http://localhost:3000")

    # --- production refusal, by host --------------------------------------
    case("prod host is refused", False, target="checklyra.com")
    case("www prod host is refused", False, target="https://www.checklyra.com")
    # Beta is the one people argue about. It is production.
    case("beta host is refused", False, target="beta.checklyra.com")
    case("admin host is refused", False, target="admin.checklyra.com")
    case("mcp host is refused", False, target="https://mcp.checklyra.com/x")

    # --- production refusal, by project ref (mirrors assertNotProd) --------
    case(
        "prod Supabase ref is refused even from an allowlisted host",
        False,
        target="e2e-dev.checklyra.com",
        supabase_url="https://{0}.supabase.co".format(envelope.PROD_REF),
    )
    case(
        "an unrecognised Supabase ref is refused",
        False,
        target="e2e-dev.checklyra.com",
        supabase_url="https://someotherproject.supabase.co",
    )
    case(
        "a lookalike host does not smuggle the prod ref through",
        False,
        target="e2e-dev.checklyra.com",
        supabase_url="https://not-prod-{0}.example.com".format(envelope.PROD_REF),
    )

    # --- unknown is a failure ---------------------------------------------
    case("no target fails", False, target=None)
    case("empty target fails", False, target="   ")
    case("an unknown host fails rather than defaulting", False, target="staging.example.com")

    # --- compensating controls --------------------------------------------
    case(
        "RESEND_API_KEY set fails",
        False,
        target="e2e-dev.checklyra.com",
        env={"RESEND_API_KEY": "re_live_abc123"},
    )
    case(
        "GOOGLE_PLACES_API_KEY set fails",
        False,
        target="e2e-dev.checklyra.com",
        env={"GOOGLE_PLACES_API_KEY": "AIza-whatever"},
    )
    case(
        "an empty RESEND_API_KEY counts as unset",
        True,
        target="e2e-dev.checklyra.com",
        env={"RESEND_API_KEY": ""},
    )

    # --- CF bypass conditionality -----------------------------------------
    case(
        "CI without the CF bypass fails",
        False,
        target="e2e-dev.checklyra.com",
        claimed_ci=True,
    )
    case(
        "CI with the CF bypass passes",
        True,
        target="e2e-dev.checklyra.com",
        claimed_ci=True,
        env={"E2E_CF_BYPASS_HEADER": "x-bypass", "E2E_CF_BYPASS_SECRET": "s3cret"},
    )
    case(
        "a partial CF bypass in CI fails",
        False,
        target="e2e-dev.checklyra.com",
        claimed_ci=True,
        env={"E2E_CF_BYPASS_HEADER": "x-bypass"},
    )
    case("local run without the CF bypass passes", True, target="e2e-dev.checklyra.com")

    # --- each Supabase-ref LAYER, pinned by its own check ------------------
    #
    # `case()` above only ever asks "did the whole run pass or fail?", and the
    # four ref layers are defence in depth — so any one of them could be deleted
    # and the next would still produce a FAIL, leaving every case green. That is
    # exactly what happened: all four were individually removable with the whole
    # suite passing. Each layer below is therefore asserted on ITS OWN check,
    # with a paired positive control so a guard that refused everything could
    # not satisfy the refusal half.
    def status_of(checks, name):
        # type: (List[Check], str) -> Optional[str]
        for c in checks:
            if c.name == name:
                return c.status
        return None

    def ref_status(name, target, supabase_url=None):
        # type: (str, Optional[str], Optional[str]) -> Optional[str]
        return status_of(evaluate(target, dict(_CLEAN_ENV), False, supabase_url), name)

    _DETERMINABLE = "Supabase project ref is determinable"
    _NOT_PROD = "Supabase project ref is not production"
    _ALLOWED = "Supabase project ref is positively allowed"
    _AGREES = "target host and Supabase URL agree"

    def supa(ref):
        # type: (str) -> str
        return "https://{0}.supabase.co".format(ref)

    direct(
        "LAYER 1: an unparseable Supabase URL FAILS the determinable check",
        ref_status(_DETERMINABLE, "e2e-dev.checklyra.com", "https://") == "FAIL",
    )
    direct(
        "LAYER 1: a ref that cannot be established is UNDETERMINED",
        ref_status(_DETERMINABLE, "staging.example.com") == "UNDETERMINED",
    )
    direct(
        "LAYER 1 control: a real URL PASSES the determinable check",
        ref_status(_DETERMINABLE, "e2e-dev.checklyra.com", supa(envelope.DEV_REF)) == "PASS",
    )
    direct(
        "LAYER 2: the prod ref FAILS the not-production check itself",
        ref_status(_NOT_PROD, "e2e-dev.checklyra.com", supa(envelope.PROD_REF)) == "FAIL",
    )
    direct(
        "LAYER 2 control: the dev ref PASSES the not-production check",
        ref_status(_NOT_PROD, "e2e-dev.checklyra.com", supa(envelope.DEV_REF)) == "PASS",
    )
    direct(
        "LAYER 3: an unrecognised ref FAILS the positive-allowlist check itself",
        ref_status(_ALLOWED, "e2e-dev.checklyra.com", supa("someotherproject")) == "FAIL",
    )
    direct(
        "LAYER 3 control: an allowed ref PASSES the positive-allowlist check",
        ref_status(_ALLOWED, "e2e-dev.checklyra.com", supa(envelope.DEV_REF)) == "PASS",
    )
    # Both refs here are allowed and neither is prod, so layers 2 and 3 pass —
    # only the agreement check can catch the mismatch, which is what makes it a
    # layer in its own right rather than a restatement of the two above.
    direct(
        "LAYER 4: a host/URL disagreement FAILS the agreement check itself",
        ref_status(_AGREES, "e2e-dev.checklyra.com", supa(envelope.STAGING_REF)) == "FAIL",
    )
    direct(
        "LAYER 4 control: a matching host and URL PASS the agreement check",
        ref_status(_AGREES, "e2e-stage.checklyra.com", supa(envelope.STAGING_REF)) == "PASS",
    )

    # --- the envelope itself must be readable ------------------------------
    import io

    # Enumerated, not sampled: EVERY attribute the preflight reads is removed in
    # turn and must produce a failed check. A spot-check of one attribute would
    # pass while eleven others still raised AttributeError and exited 1.
    unguarded = [
        attr
        for attr in REQUIRED_ENVELOPE_ATTRS
        if all(c.passed for c in check_envelope_shape(_envelope_missing(attr)))
    ]
    direct(
        "a missing envelope attribute is a FAILED CHECK, for every attribute",
        not unguarded,
        str(unguarded),
    )
    # The paired positive control: the shape check must be able to pass, or the
    # assertion above is satisfied by a check that always fails.
    direct(
        "the real envelope passes the shape check",
        all(c.passed for c in check_envelope_shape()),
    )
    direct(
        "a missing attribute reports exit 2, never 1",
        report(check_envelope_shape(_envelope_missing("REFUSED_REFS")), io.StringIO()) == 2,
    )

    passed = 0
    for name, expect_pass, checks in cases:
        actual_pass = all(c.passed for c in checks)
        if actual_pass == expect_pass:
            passed += 1
        else:
            print(
                "  FAIL  {0}: expected {1}, got {2}".format(
                    name,
                    "PASS" if expect_pass else "FAIL",
                    "PASS" if actual_pass else "FAIL",
                )
            )
            for c in checks:
                if not c.passed:
                    print("          {0}: {1}".format(c.name, c.detail))

    for name, ok, detail in extras:
        if ok:
            passed += 1
        else:
            print("  FAIL  {0}{1}".format(name, (" -> " + detail) if detail else ""))

    # An exit-code contract check: the reporter must never emit 1.
    codes = set()
    for _, _, checks in cases:
        codes.add(report(checks, io.StringIO()))
    contract_ok = codes.issubset({0, 2})
    if not contract_ok:
        print("  FAIL  exit-code contract: report() returned {0}".format(sorted(codes)))

    total = len(cases) + len(extras) + 1
    passed += 1 if contract_ok else 0
    print("preflight self-test: {0}/{1} passed".format(passed, total))
    # 2, not 1. The docstring promises this file only ever exits 0 or 2, and a
    # --self-test that exits 1 breaks that promise on the one path most likely
    # to be read by a machine.
    return 0 if passed == total else 2


def main():
    # type: () -> int
    parser = argparse.ArgumentParser(
        description="KAN-467 QA sweep preflight. Fails closed; exit 0 or 2."
    )
    parser.add_argument("--target", help="host or URL the sweep will run against")
    parser.add_argument("--supabase-url", help="Supabase URL the harness will connect to")
    parser.add_argument(
        "--ci",
        action="store_true",
        help="claim this is a CI run (makes the Cloudflare bypass mandatory)",
    )
    parser.add_argument("--self-test", action="store_true", help="run the fixtures")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    # `--ci` is a claim the caller makes; CI=true in the environment is the
    # same claim made by the runner. Either one arms the stricter rule.
    claimed_ci = bool(args.ci) or str(os.environ.get("CI", "")).lower() in ("1", "true")

    # The 0-or-2 contract has to hold for the unforeseen case too, not only the
    # ones enumerated in REQUIRED_ENVELOPE_ATTRS. An uncaught exception here
    # exits 1, which is indistinguishable from an ordinary tool failure and is
    # therefore the one outcome most likely to be retried rather than read.
    try:
        checks = evaluate(args.target, dict(os.environ), claimed_ci, args.supabase_url)
    except Exception as exc:  # noqa: BLE001 - fail closed, loudly, with the cause
        sys.stderr.write(
            "::error::qa-sweep preflight FAILED CLOSED — the preflight itself "
            "raised {0}: {1}\n".format(type(exc).__name__, exc)
        )
        sys.stderr.write(
            "A preflight that crashed did not ask its questions. Refusing to "
            "report a pass.\n"
        )
        return 2
    return report(checks)


if __name__ == "__main__":
    sys.exit(main())
