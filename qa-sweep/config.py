#!/usr/bin/env python3
"""KAN-467 Phase 0 — the QA sweep's safety envelope, in one readable file.

WHY THIS EXISTS
---------------
The sweep's job is to click every button on the site. That is a fine ambition
and a terrible default, because a handful of those buttons are indistinguishable
from the others in the DOM and catastrophic when pressed:

  * `deleteAccount` hard-deletes the auth user. Its "type DELETE to confirm"
    dialog is CLIENT-SIDE ONLY — the server action takes no argument and checks
    nothing (src/app/dashboard/settings/actions.ts:187). A robot that can click
    a button can therefore delete an account without ever typing DELETE.
  * `bulkUserAction` with `selectAll` suspends every matching user in one
    request.
  * `setGlobalFeature` is an environment-wide kill switch whose own comment
    notes it manages beta AND production together.
  * `signOut` and `declineAge` do not damage data — they end the session, which
    silently converts the rest of the run into a tour of the login page.

The envelope is a separate module from the things that enforce it so that the
answer to "what is this run allowed to do?" is one file a human can read in two
minutes, and so a test can assert on the policy without importing a runner.

EVERY ENTRY CARRIES A REASON
----------------------------
Not decoration. A denylist nobody can read is a denylist nobody maintains: the
next person to see an unexplained name either deletes it (because it looks
obsolete) or freezes it forever (because they daren't touch it). Both outcomes
are worse than the list not existing, because both come with the confidence
that a list exists. `--self-test` enforces the presence of a reason, so an
entry added without one fails the build rather than rotting quietly.

WHAT THIS FILE IS NOT
---------------------
It is not the enforcement. `preflight.py` refuses to let a run start, and the
Phase 3 exerciser (NOT built yet — KAN-467 Phase 3) is what will consult the
denylist per click. This module only states policy. Stating it is still load
bearing: the reason Phase 3 is safe to write later is that its constraints were
written down before anybody was in a hurry to make a run go green.

BEWARE THE ENVIRONMENT NAMES
----------------------------
`beta.checklyra.com` is NOT a test environment. It is production data behind an
in-app middleware gate, on the production Supabase project. It is refused here
by the same rule that refuses `checklyra.com`, and the reason string says so,
because "beta" is exactly the word that talks somebody into pointing a fuzzer
at it.

USAGE
    python3 qa-sweep/config.py --show        # the whole envelope, as JSON
    python3 qa-sweep/config.py --self-test   # internal-consistency checks
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Dict, List, Optional, Tuple

# --------------------------------------------------------------------------
# Supabase project refs. Mirrored from tests/e2e/support/supabase-admin.ts,
# which is the existing enforcement point (assertNotProd). Duplicated here
# deliberately: a Python preflight cannot import a TypeScript constant, and a
# silently-diverging copy is caught by the drift self-test below plus the
# mirror assertion in the test suite.
# --------------------------------------------------------------------------

PROD_REF = "llzkgprqewuwkiwclowi"
DEV_REF = "ilprytcrnqyrsbsrfujj"
STAGING_REF = "uobmlkzrjkptwhttzmmi"

#: The ONLY project refs a sweep may touch. Positive allowlist, mirroring
#: `ALLOWED_REFS` in tests/e2e/support/supabase-admin.ts — an unrecognised ref
#: is refused rather than assumed safe.
ALLOWED_REFS: Tuple[str, ...] = (DEV_REF, STAGING_REF)

#: Refs that are refused by name, so the error message says "prod" instead of
#: "unrecognised". The positive allowlist above is the real guard.
REFUSED_REFS: Dict[str, str] = {
    PROD_REF: (
        "Production Supabase project. Real people's real data; deletion here "
        "is not recoverable within the sweep's blast radius."
    ),
}

# --------------------------------------------------------------------------
# Target allowlist: host -> where it actually points.
# --------------------------------------------------------------------------

#: Hosts the sweep may target, and the Supabase project ref each one maps to.
#: A host absent from this table is refused; there is no "probably fine" tier.
TARGET_ALLOWLIST: Dict[str, Dict[str, str]] = {
    "e2e-dev.checklyra.com": {
        "ref": DEV_REF,
        "env": "dev",
        "reason": (
            "DNS-only origin for the dev deploy — bypasses the Cloudflare proxy, "
            "so a sweep cannot trip the WAF or be mistaken for an attack on the "
            "public edge. Seeded data only."
        ),
    },
    "e2e-stage.checklyra.com": {
        "ref": STAGING_REF,
        "env": "staging",
        "reason": (
            "DNS-only origin for the staging deploy. Same reasoning as dev; this "
            "is the environment the E2E suite already targets."
        ),
    },
    "localhost:3000": {
        "ref": DEV_REF,
        "env": "local",
        "reason": (
            "Local `npm run dev` against the dev Supabase project. Phase 3 is "
            "local-run only until SEC-125 provisions the CF bypass, so this is "
            "the default target until then."
        ),
    },
    "127.0.0.1:3000": {
        "ref": DEV_REF,
        "env": "local",
        "reason": "Loopback alias of localhost:3000; same envelope.",
    },
}

#: Hosts that are refused with an explicit explanation rather than a generic
#: "not in the allowlist". Every one of these runs against PROD_REF.
REFUSED_HOSTS: Dict[str, str] = {
    "checklyra.com": "Production. Real users.",
    "www.checklyra.com": "Production (www alias). Real users.",
    "beta.checklyra.com": (
        "NOT a test environment. Beta is PRODUCTION data on the production "
        "Supabase project, gated in-app by middleware. The name is the trap."
    ),
    "admin.checklyra.com": (
        "Production admin surface behind Cloudflare Access. Its actions are "
        "environment-wide (see setGlobalFeature) and it fronts prod data."
    ),
    "mcp.checklyra.com": (
        "Production MCP server. Its tools write to the production database on "
        "behalf of real users."
    ),
}

# --------------------------------------------------------------------------
# Destructive-action denylist, keyed `file::functionName`.
#
# Keyed on the pair, not the bare name, because names repeat across modules and
# a bare-name match would either over-block (freezing an innocent namesake) or
# under-block (if somebody "fixed" the over-block by loosening the match).
# Every function below was verified to exist at the stated path on 2026-08-04.
# --------------------------------------------------------------------------

DESTRUCTIVE_DENYLIST: Dict[str, str] = {
    # --- irreversible data loss -------------------------------------------
    "src/app/dashboard/settings/actions.ts::deleteAccount": (
        "Hard-deletes the auth user; profiles + every owned table + storage "
        "cascade. The 'type DELETE' confirmation is CLIENT-SIDE ONLY — the "
        "server action takes no argument and checks nothing, so clicking the "
        "button IS the deletion."
    ),
    # --- environment-wide blast radius ------------------------------------
    "src/app/admin/users/actions.ts::bulkUserAction": (
        "With selectAll, suspends every user matching the current filter in a "
        "single request. One click can suspend an entire environment."
    ),
    "src/app/admin/features/actions.ts::setGlobalFeature": (
        "Environment-wide feature kill switch. Its own comment notes it "
        "manages beta AND production together."
    ),
    # --- ends the run -----------------------------------------------------
    #
    # This group is keyed on the pair, like every other, and that is exactly
    # what let `switchAccountAndContinue` slip through for as long as it did:
    # `signOut` below was denylisted for terminating the session, and a reader
    # scanning the list saw the hazard covered. It was covered by NAME. The
    # oauth action calls `sb.auth.signOut()` itself, under a different name in
    # a different file, and was therefore fully exercisable.
    #
    # A namesake list only protects the names somebody happened to write down.
    # So the standing rule is the CALL, not the name: every function in src/
    # that reaches `auth.signOut()` belongs here, and
    # `tests/scripts/qa-sweep-preflight.test.js` derives that set from source
    # and fails if any member is missing. Adding a name here is the fix; the
    # derived test is the control.
    "src/app/session-actions.ts::signOut": (
        "Terminates the session. Not destructive to data, but every subsequent "
        "step in the run silently becomes a test of the login redirect. "
        "KAN-415 moved this out of src/app/(auth)/actions.ts to clear the last "
        "no-cross-segment-app edge; the key is PATH-ANCHORED, so it moved with "
        "the function in the same commit. It stayed in the app tree precisely "
        "so this key still names an inventoried action."
    ),
    "src/app/(auth)/actions.ts::updateRecoveryPassword": (
        "Sets a NEW account password and then calls auth.signOut() to force "
        "re-authentication. Worse than a bare sign-out: the harness cannot sign "
        "the seeded user back in, because the credential it holds is no longer "
        "the account's. Ends the run and breaks the fixture for every run after."
    ),
    "src/app/confirm-age/actions.ts::declineAge": (
        "Records an 18+ decline and bounces the session out of the app. The "
        "seeded user is then unusable for the rest of the run."
    ),
    "src/app/oauth/authorize/actions.ts::switchAccountAndContinue": (
        "Calls auth.signOut() (via @/modules/oauth-as/consent-flow) and "
        "redirects to /login. Reached by clicking a plain 'Switch account' "
        "button on the OAuth consent screen — nothing in the DOM distinguishes "
        "it from any other button, and a click-everything runner turns the rest "
        "of the run into a tour of the login page. "
        "KAN-415 D7 moved the BODY into the module; this key stays here because "
        "this is the entry point the sweep can actually exercise. A denylist key "
        "must name an INVENTORIED action, and only 'use server' functions are "
        "inventoried — so a key on the module file would match nothing and be "
        "dead weight, which qa-sweep-inventory.test.js rejects by design."
    ),
    "src/app/oauth/authorize/page.tsx::inlineAction1": (
        "The inline `action={async () => { 'use server' }}` closure behind the "
        "'Switch account' button; it awaits switchAccountAndContinue, so it is "
        "the same session termination one call frame earlier. Denylisting only "
        "the named action would leave the button that invokes it exercisable."
    ),
    "src/app/oauth/authorize/page.tsx::inlineAction2": (
        "The inline consent-form closure (Allow / Deny). Allow issues an OAuth "
        "authorization code and redirects the browser to a third-party client's "
        "redirect_uri, so the run leaves the application entirely; Deny "
        "redirects off-site too. Either way the sweep does not come back."
    ),
    # --- credential / identity mutation -----------------------------------
    "src/app/dashboard/settings/actions.ts::revokeApiKey": (
        "Revokes an API key. Breaks any MCP connector bound to the seeded "
        "user, and the key cannot be un-revoked."
    ),
    "src/app/dashboard/settings/actions.ts::updateEmail": (
        "Changes the account email and triggers a confirmation send. Moves the "
        "seeded user's identity out from under the harness."
    ),
    # --- publishes to the public internet ---------------------------------
    "src/app/dashboard/profile/actions.ts::publishProfile": (
        "Flips is_published, exposing the profile to public search and the "
        "sitemap. SEC-100 is the ticket about profiles being publicly visible "
        "when they should not have been."
    ),
    # --- sends mail to real humans ----------------------------------------
    "src/app/dashboard/convene/gatherings/[id]/actions.ts::sendInvites": (
        "Emails every invitee on a gathering. Recipients are whatever is in "
        "the seeded contact rows — there is no recipient allowlist."
    ),
    "src/app/dashboard/convene/gatherings/[id]/actions.ts::resendInvite": (
        "Re-sends an invite email to a single invitee. Same absent-allowlist "
        "problem, and trivially loopable by a click-everything runner."
    ),
    "src/app/(legal)/contact/actions.ts::submitContact": (
        "Emails the contact-form message with NO recipient allowlist; the "
        "default destination is the founder's real inbox."
    ),
    # --- state changes that corrupt a fixture ------------------------------
    "src/app/r/[token]/actions.ts::submitRsvp": (
        "Records an RSVP against a shared gathering token, mutating a fixture "
        "other tests read. Also fires host notifications."
    ),
    "src/app/dashboard/convene/gatherings/[id]/actions.ts::cancelGathering": (
        "Cancels a gathering and notifies attendees. Destroys the fixture the "
        "gathering-detail surfaces need in order to be exercisable at all."
    ),
    "src/app/dashboard/convene/gatherings/[id]/actions.ts::cancelInvite": (
        "Withdraws an invitee. Same fixture-destruction problem as above, at "
        "row granularity."
    ),
    "src/app/dashboard/convene/gatherings/[id]/actions.ts::addToHostCalendar": (
        "Writes an event into the host's REAL connected Google/Microsoft "
        "calendar via a stored OAuth token. The blast radius is outside Lyra."
    ),
    "src/app/verify-age/actions.ts::startAgeVerification": (
        "Starts a third-party age-verification session. Billable per start, "
        "and leaves the account mid-flow if abandoned."
    ),
    # --- admin moderation, declared inline in a page.tsx --------------------
    #
    # These eight are the ONLY representation of their mutations anywhere in
    # the estate: there is no admin `actions.ts` that also exposes them. Until
    # 2026-08-04 the inventory scanned `.ts` only and required `export`, so all
    # eight were absent from the denominator — which means they could not be
    # reported as uncovered AND could not be denylisted, because a denylist
    # entry for a pair the inventory never emits matches nothing.
    #
    # /admin is already `inventory-only` by founder decision, so these are
    # belt-and-braces. That is the point: `inventory-only` is a scoping choice
    # that a later decision could reverse in one line, and these three classes
    # (suspend, unpublish, delete) are the same classes as bulkUserAction,
    # publishProfile and deleteAccount, which are denylisted on their own merits.
    "src/app/admin/users/[slug]/page.tsx::actionSuspend": (
        "Suspends a member: sets is_suspended and hides the profile from every "
        "public surface. Same class as bulkUserAction, at row granularity."
    ),
    "src/app/admin/users/[slug]/page.tsx::actionUnsuspend": (
        "Reverses a suspension. Not destructive to data, but it silently "
        "un-does the moderation state that the suspended-user fixtures encode, "
        "so the SEC-100 regression tests would then be asserting on a member "
        "who is no longer suspended."
    ),
    "src/app/admin/users/[slug]/page.tsx::actionUnpublish": (
        "Clears is_published on someone else's profile. Same class as "
        "publishProfile, in the opposite direction — it removes a member from "
        "public search and the sitemap without their involvement."
    ),
    "src/app/admin/users/[slug]/page.tsx::actionRepublish": (
        "Sets is_published on someone else's profile, exposing it to public "
        "search and the sitemap. This is the SEC-100 shape exactly, reached "
        "from an admin screen rather than the owner's own settings."
    ),
    "src/app/admin/users/[slug]/page.tsx::actionDeleteItem": (
        "Hard-deletes a row from profile_items — a real member's content, with "
        "no undo and no confirmation the server checks. Same class as "
        "deleteAccount at item granularity."
    ),
    "src/app/admin/reports/[id]/page.tsx::actionDismissReport": (
        "Closes a moderation report as dismissed and writes a moderation-log "
        "entry attributed to the acting admin. Irreversible from the UI, and it "
        "empties the moderation queue the report fixtures depend on."
    ),
    "src/app/admin/reports/[id]/page.tsx::actionResolveReport": (
        "Closes a moderation report as actioned, with the same audit write and "
        "the same fixture destruction as dismissal."
    ),
    "src/app/admin/reports/[id]/page.tsx::actionSuspendProfile": (
        "Suspends the reported member straight from the report screen. Same "
        "blast radius as actionSuspend, reached by a different button."
    ),
}

# --------------------------------------------------------------------------
# Environment variables that must be UNSET on a target.
#
# These are compensating controls, not preferences: each one converts a real
# external side effect into a no-op, and each was chosen because the code path
# behind it has NO allowlist of its own.
# --------------------------------------------------------------------------

REQUIRED_UNSET_ENV: Dict[str, str] = {
    "RESEND_API_KEY": (
        "sendBetaApprovedEmail / sendBetaQueueNotice (src/lib/beta-access/"
        "email.ts) and submitContact have NO recipient allowlist, and the "
        "contact default is the founder's real inbox. Unset makes all three a "
        "console.warn no-op — the only recipient filter that actually exists."
    ),
    "GOOGLE_PLACES_API_KEY": (
        "The city and school type-aheads call Google Places per keystroke. "
        "Billed per request and rate-limited NOWHERE in our code. Unset "
        "degrades cleanly to manual text entry."
    ),
}

# --------------------------------------------------------------------------
# Throttle classification.
#
# The single most likely way this sweep produces a worthless report is by
# filing forty "bugs" that are all one rate limiter doing its job. Worse, most
# of these return a FRIENDLY STRING rather than an HTTP status, so a runner
# that only checks response codes sees a 200 and records a functional failure.
# Match on the user-visible text, quoted from source.
# --------------------------------------------------------------------------

THROTTLE_PATTERNS: List[Dict[str, object]] = [
    {
        "id": "profile-write-user",
        "match": "You are saving too quickly.",
        "kind": "friendly-string",
        "source": "src/modules/guards/profile-rate-limit.ts",
        "limit": "30 writes / 60s per user",
        "reason": (
            "Per-user profile-write limiter. Returns an ActionResult string, "
            "NOT a 429 — a status-code-only classifier will read this as a "
            "failed save."
        ),
    },
    {
        "id": "profile-write-ip",
        "match": "Too many requests from your network.",
        "kind": "friendly-string",
        "source": "src/modules/guards/profile-rate-limit.ts",
        "limit": "30 writes / 60s per IP",
        "reason": (
            "The IP key is SHARED ACROSS ALL SEEDED USERS, so this is the "
            "budget for the whole run, not per account. Hitting it means the "
            "sweep is going too fast — it is never a product defect."
        ),
    },
    {
        "id": "auth-post",
        "match": "Too many attempts. Please try again later.",
        "kind": "http-429",
        "source": "src/middleware.ts",
        "limit": "10 POSTs / 15 min per IP",
        "reason": (
            "Middleware limiter on POSTs to /login, /signup and /auth/*. "
            "Returns HTTP 429 with Retry-After; honour the header."
        ),
    },
    {
        "id": "discoverability-search",
        "match": "Too many lookups. Try again in",
        "kind": "friendly-string",
        "source": "src/app/dashboard/settings/discoverability-actions.ts",
        "limit": "10 lookups / hour per user",
        "reason": (
            "Anti-enumeration limiter on hashed contact search. One hour is "
            "longer than any sweep, so treat exhaustion as terminal for this "
            "surface rather than retrying."
        ),
    },
    {
        "id": "directory-search",
        "match": "Too many searches. Please try again in",
        "kind": "friendly-string",
        "source": "src/app/dashboard/convene/contacts/actions.ts",
        "limit": "20 searches / hour per user",
        "reason": "Convene contact-directory search limiter.",
    },
    {
        "id": "duplicate-report",
        "match": "already_reported",
        "kind": "http-429",
        "source": "src/app/api/reports/route.ts",
        "limit": "1 report per (reporter, target) per 24h",
        "reason": (
            "Not a rate limiter in the usual sense — an idempotency guard. A "
            "second report of the same profile is CORRECT behaviour returning "
            "429, and the 24h window outlives the run."
        ),
    },
]

# --------------------------------------------------------------------------
# Hostile / fuzz input budget (founder decision, 2026-08-04).
#
# In scope for Phase 3, seeded users only, and BUDGETED — an unbounded fuzzer
# against a shared-IP rate limiter spends the whole run's throttle allowance in
# the first minute and produces a report full of limiter strings.
# --------------------------------------------------------------------------

HOSTILE_INPUT_BUDGET: Dict[str, object] = {
    "max_payloads_per_run": 200,
    "max_payloads_per_field": 5,
    "max_submits_per_minute": 20,
    "seeded_users_only": True,
    "reason": (
        "Founder decision 2026-08-04: hostile input is in scope for Phase 3 "
        "but must not consume the shared per-IP profile-write budget (30/60s) "
        "that the whole run draws on. 5 payloads per field keeps the class "
        "represented without turning one textarea into the entire run."
    ),
}

# --------------------------------------------------------------------------
# Scope flags.
# --------------------------------------------------------------------------

#: Route prefixes that are INVENTORIED and COVERAGE-DIFFED but never exercised.
#: Modelled as an explicit flag rather than by omitting the routes, because a
#: surface missing from the inventory is indistinguishable from a surface that
#: does not exist — and the denominator is what makes every coverage number
#: downstream mean anything.
INVENTORY_ONLY_PREFIXES: Dict[str, str] = {
    "/admin": (
        "Founder decision 2026-08-04: the 11 /admin pages are inventoried and "
        "coverage-diffed, but never clicked. Their actions are environment-"
        "wide (setGlobalFeature) or bulk (bulkUserAction), and the surface "
        "sits behind Cloudflare Access, so an exerciser would be testing the "
        "edge rather than the app."
    ),
}

#: Env vars carrying the Cloudflare bypass. Absent => the run cannot reach a
#: proxied origin from CI, which is a STATE TO SURFACE, not a failure to hide.
CF_BYPASS_ENV_VARS: Tuple[str, ...] = ("E2E_CF_BYPASS_HEADER", "E2E_CF_BYPASS_SECRET")

#: Why the bypass may legitimately be missing today.
CF_BYPASS_PENDING_TICKET = "SEC-125"


def project_ref_from_url(url: str) -> str:
    """Parse the Supabase project ref from `https://<ref>.supabase.co`.

    Mirrors `projectRefFromUrl` in tests/e2e/support/supabase-admin.ts: parse
    the host to an exact ref rather than substring-matching the raw URL. A
    substring check like `url.includes('checklyra')` is both unreliable and
    flagged by CodeQL, and — more to the point — `not-prod-llzkgprqewuwkiwclowi
    .example.com` would sail through one.
    """
    try:
        # urlsplit is stricter than a regex and handles the scheme-less case.
        from urllib.parse import urlsplit

        parsed = urlsplit(url if "//" in url else "//" + url)
        host = parsed.hostname or ""
    except (ValueError, AttributeError):
        return ""
    if not host:
        return ""
    return host.split(".")[0]


def normalise_host(target: str) -> str:
    """Reduce a target (URL or bare host) to the `host[:port]` we key on."""
    raw = target.strip()
    if not raw:
        return ""
    try:
        from urllib.parse import urlsplit

        parsed = urlsplit(raw if "//" in raw else "//" + raw)
        host = parsed.hostname or ""
        port = parsed.port
    except (ValueError, AttributeError):
        return ""
    if not host:
        return ""
    # Keep the port only where it distinguishes a target (localhost:3000).
    if port and port not in (80, 443):
        return "{0}:{1}".format(host, port)
    return host


def denylist_names() -> Dict[str, List[str]]:
    """`{functionName: [file, ...]}` — the denylist indexed for lookup."""
    out = {}  # type: Dict[str, List[str]]
    for key in DESTRUCTIVE_DENYLIST:
        path, _, name = key.partition("::")
        out.setdefault(name, []).append(path)
    return out


def is_denylisted(file_path: str, function_name: str) -> bool:
    """True if this exact (file, function) pair is denylisted."""
    return "{0}::{1}".format(file_path, function_name) in DESTRUCTIVE_DENYLIST


def is_inventory_only(route_path: str) -> Optional[str]:
    """Return the reason a route is inventory-only, or None if exercisable."""
    for prefix, reason in INVENTORY_ONLY_PREFIXES.items():
        if route_path == prefix or route_path.startswith(prefix + "/"):
            return reason
    return None


def as_dict() -> Dict[str, object]:
    """The whole envelope, for `--show` and for the test suite to assert on."""
    return {
        "refs": {
            "prod": PROD_REF,
            "dev": DEV_REF,
            "staging": STAGING_REF,
            "allowed": list(ALLOWED_REFS),
        },
        "refused_refs": REFUSED_REFS,
        "target_allowlist": TARGET_ALLOWLIST,
        "refused_hosts": REFUSED_HOSTS,
        "destructive_denylist": DESTRUCTIVE_DENYLIST,
        "required_unset_env": REQUIRED_UNSET_ENV,
        "throttle_patterns": THROTTLE_PATTERNS,
        "hostile_input_budget": HOSTILE_INPUT_BUDGET,
        "inventory_only_prefixes": INVENTORY_ONLY_PREFIXES,
        "cf_bypass_env_vars": list(CF_BYPASS_ENV_VARS),
        "cf_bypass_pending_ticket": CF_BYPASS_PENDING_TICKET,
    }


def self_test() -> int:
    """Internal-consistency checks on the envelope itself.

    These are not tests of the app. They are the invariants that make the
    envelope trustworthy — chiefly that no allowlisted target resolves to prod,
    which is the one mistake that would make every other control irrelevant.
    """
    checks = []  # type: List[Tuple[str, bool, str]]

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    # 1. No allowlisted target may resolve to a refused ref. This is the
    #    invariant; everything else is hygiene.
    bad = [h for h, m in TARGET_ALLOWLIST.items() if m["ref"] in REFUSED_REFS]
    check("no allowlisted target resolves to a refused ref", not bad, str(bad))

    # 2. Every allowlisted target's ref must be positively allowed.
    unlisted = [h for h, m in TARGET_ALLOWLIST.items() if m["ref"] not in ALLOWED_REFS]
    check("every allowlisted target ref is in ALLOWED_REFS", not unlisted, str(unlisted))

    # 3. Allowlist and refusal list must not intersect — an ambiguous host is
    #    a host somebody will argue about at exactly the wrong moment.
    overlap = sorted(set(TARGET_ALLOWLIST) & set(REFUSED_HOSTS))
    check("allowlist and refused-host list are disjoint", not overlap, str(overlap))

    # 4. PROD_REF must be refused, not merely absent from the allowlist.
    check("PROD_REF is explicitly refused", PROD_REF in REFUSED_REFS)

    # 5. Every refused host is refused by NAME as well as by ref lookup.
    check("known prod hosts are enumerated", "beta.checklyra.com" in REFUSED_HOSTS)

    # 6. Reasons everywhere. An entry without one is an entry that will be
    #    deleted or frozen by the next reader; both are failures.
    for label, mapping in (
        ("denylist", DESTRUCTIVE_DENYLIST),
        ("required-unset env", REQUIRED_UNSET_ENV),
        ("refused refs", REFUSED_REFS),
        ("refused hosts", REFUSED_HOSTS),
        ("inventory-only prefixes", INVENTORY_ONLY_PREFIXES),
    ):
        empty = [k for k, v in mapping.items() if not str(v).strip()]
        check("every {0} entry has a reason".format(label), not empty, str(empty))

    missing_reason = [t["id"] for t in THROTTLE_PATTERNS if not str(t.get("reason", "")).strip()]
    check("every throttle pattern has a reason", not missing_reason, str(missing_reason))
    check(
        "every allowlisted target has a reason",
        all(str(m.get("reason", "")).strip() for m in TARGET_ALLOWLIST.values()),
    )

    # 7. Denylist keys must be `path::name`, or lookups silently never match —
    #    a denylist that cannot match is worse than none, because it reassures.
    malformed = [k for k in DESTRUCTIVE_DENYLIST if "::" not in k or not k.split("::")[1]]
    check("every denylist key is `file::functionName`", not malformed, str(malformed))
    nonsrc = [k for k in DESTRUCTIVE_DENYLIST if not k.startswith("src/")]
    check("every denylist key names a src/ path", not nonsrc, str(nonsrc))

    # 8. The denylist must be non-empty. An empty one passes every "is this
    #    action allowed?" check by vacuous truth.
    check("denylist is non-empty", len(DESTRUCTIVE_DENYLIST) > 0)
    check("required-unset env is non-empty", len(REQUIRED_UNSET_ENV) > 0)

    # 9. Ref parsing behaves — including the near-miss that a substring match
    #    would wave through.
    check(
        "project ref parses from a Supabase URL",
        project_ref_from_url("https://{0}.supabase.co".format(PROD_REF)) == PROD_REF,
    )
    check(
        "a lookalike host does NOT parse to the prod ref",
        project_ref_from_url("https://not-prod-{0}.example.com".format(PROD_REF)) != PROD_REF,
    )
    check("an unparseable URL yields an empty ref", project_ref_from_url("") == "")

    # 10. Host normalisation keeps the port only where it disambiguates.
    check("host normalises from a URL", normalise_host("https://checklyra.com/x") == "checklyra.com")
    check("local port is preserved", normalise_host("http://localhost:3000") == "localhost:3000")

    # 11. Scope + denylist helpers agree with their tables.
    check("/admin is inventory-only", is_inventory_only("/admin/users") is not None)
    check("/dashboard is NOT inventory-only", is_inventory_only("/dashboard") is None)
    check(
        "a denylisted pair is recognised",
        is_denylisted("src/app/dashboard/settings/actions.ts", "deleteAccount"),
    )
    check(
        "the same name in another file is NOT denylisted",
        not is_denylisted("src/app/other/actions.ts", "deleteAccount"),
    )

    # 12. The hostile-input budget must actually bound something.
    check(
        "hostile-input budget is bounded",
        int(HOSTILE_INPUT_BUDGET["max_payloads_per_run"]) > 0
        and int(HOSTILE_INPUT_BUDGET["max_payloads_per_field"]) > 0,
    )

    passed = sum(1 for _, ok, _ in checks if ok)
    for name, ok, detail in checks:
        if not ok:
            print("  FAIL  {0}{1}".format(name, (" -> " + detail) if detail else ""))
    print("config self-test: {0}/{1} passed".format(passed, len(checks)))
    return 0 if passed == len(checks) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="KAN-467 QA sweep safety envelope.")
    parser.add_argument("--show", action="store_true", help="print the envelope as JSON")
    parser.add_argument("--self-test", action="store_true", help="internal consistency checks")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if args.show:
        print(json.dumps(as_dict(), indent=2, sort_keys=True))
        return 0

    print("KAN-467 QA sweep safety envelope")
    print("  allowlisted targets : {0}".format(len(TARGET_ALLOWLIST)))
    print("  refused hosts       : {0}".format(len(REFUSED_HOSTS)))
    print("  denylisted actions  : {0}".format(len(DESTRUCTIVE_DENYLIST)))
    print("  env vars to unset   : {0}".format(len(REQUIRED_UNSET_ENV)))
    print("  throttle patterns   : {0}".format(len(THROTTLE_PATTERNS)))
    print("  inventory-only      : {0}".format(", ".join(sorted(INVENTORY_ONLY_PREFIXES))))
    print("")
    print("Run with --show for the full envelope, --self-test to validate it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
