#!/usr/bin/env python3
"""KAN-416 (epic KAN-414) — module manifest & dependency matrix derivation.

Read-only. Walks src/, parses every static/dynamic import, resolves it to a
repo file, maps files to the 20 proposed modules, and derives:

  * the measured public API of each module (exactly the symbols other
    modules import today — nothing invented, nothing "tidied");
  * the module dependency matrix (measured edge counts);
  * every edge the proposed layer policy would forbid — the seed of
    .boundaries-allowlist.json;
  * every .from()/.rpc() call site mapped to (module, table) and checked
    against the declared table-ownership map;
  * a provisional per-module test floor (test files mapped by the src/
    paths they reference — crude, superseded by KAN-417).

Outputs (all deterministic):
  modules.json                                        (repo root, v0 draft)
  docs/modularisation/KAN-416-boundaries-allowlist.seed.json
  stdout: human-readable report (redirect into the artefact as needed)

Usage:  python3 docs/modularisation/kan416-derive.py [--json]

The module set is the one adopted in epic KAN-415 ("The module set (20 + 2
meta)"). LYRA_MODULARISATION_PLAN_2026-07-26.md §3 was NOT accessible to the
session that wrote this (it exists only in the founder's working folder), so
path assignments marked JUDGEMENT below are this script's proposal and must
be diffed against the plan before KAN-415 C1 consumes modules.json.
"""

import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "src")

# ---------------------------------------------------------------------------
# 1. Module mapping — ordered rules, first match wins. A rule is either an
#    exact file path or a directory prefix (trailing '/'). Exact rules come
#    first so a loose file inside a claimed directory can be re-homed.
#    "JUDGEMENT" marks assignments not directly dictated by the KAN-415 epic
#    text; each is explained in the KAN-416 artefact.
# ---------------------------------------------------------------------------
MODULE_RULES = [
    # --- Layer 0: platform (leaf kernel) ---
    ("src/modules/platform/supabase-browser.ts", "platform"),
    ("src/modules/platform/supabase-server.ts", "platform"),
    ("src/modules/platform/supabase-service.ts", "platform"),
    ("src/modules/platform/env.ts", "platform"),
    ("src/modules/platform/deploy-env.ts", "platform"),
    ("src/modules/platform/cookie-domain.ts", "platform"),
    # --- Layer 0: contracts (pure rule-sets; zero deps, zero I/O; plan §3 P5) ---
    # DERIVED, flagged for founder confirmation: the `audit` module (layer 1)
    # cannot legally import a layer-3 module, so the pure moderation rules it
    # depends on must sit at layer 0. Both files are import-free / I/O-free and
    # plan §3 P5 lists "content moderation" among the six contracts rule-sets;
    # KAN-416 comment 2026-07-27 settled this as option (a).
    ("src/lib/content-moderation.ts", "contracts"),
    ("src/lib/moderation-policy.ts", "contracts"),
    # --- Layer 0: guards (request/output guarding utilities) JUDGEMENT ---
    ("src/modules/guards/rate-limit.ts", "guards"),
    ("src/modules/guards/rate-limit-shared.ts", "guards"),
    ("src/modules/guards/profile-rate-limit.ts", "guards"),
    ("src/modules/guards/turnstile.ts", "guards"),
    ("src/modules/guards/sanitise.ts", "guards"),
    ("src/modules/guards/file-magic-bytes.ts", "guards"),
    ("src/modules/guards/security-headers.ts", "guards"),
    ("src/modules/guards/cf-access.ts", "guards"),
    ("src/modules/guards/json-ld.ts", "guards"),  # JUDGEMENT: output-encoding defence (SEC-08)
    # --- Layer 0: observability ---
    ("src/lib/metrics.ts", "observability"),
    ("src/lib/sentry-scrub.ts", "observability"),
    ("src/app/api/health/", "observability"),
    ("src/app/status/", "observability"),  # JUDGEMENT: live-probe status page (SEC-4)
    # --- Layer 0: ui-kit (to be BUILT; today exactly one file) ---
    ("src/components/", "ui-kit"),
    # --- Layer 1: audit (moderation write path) — FOUNDER-APPROVED, KAN-416 R1b ---
    # Resolves the moderation write-path deadlock: trust-safety cannot drop to
    # layer 1 (it also owns api/reports + retention routes) and the writer
    # cannot go in guards (guards must stay edge-safe).
    ("src/lib/moderation-audit.ts", "audit"),
    # --- Layer 2: access core ---
    ("src/lib/beta-access/", "access"),
    ("src/lib/account-status.ts", "access"),
    ("src/lib/access-model/", "access"),  # computeAccessTransition, moved out of the admin tree (plan §3 A1)
    ("src/app/waitlist/", "access"),      # FOUNDER-RULED (manifest over plan D2)
    ("src/app/suspended/", "access"),     # FOUNDER-RULED (manifest over plan D11)
    ("src/app/join/", "access"),          # FOUNDER-RULED (manifest over plan D2)
    ("src/middleware.ts", "access"),      # compositionRoot: stays at its Next-required path
    ("src/lib/features/", "features"),
    ("src/lib/age/", "age"),
    ("src/app/verify-age/", "age"),
    ("src/app/confirm-age/", "age"),
    ("src/app/api/age/", "age"),
    # --- Layer 2: domains ---
    ("src/modules/oauth-as/lib/", "oauth-as"),
    ("src/app/oauth/", "oauth-as"),
    ("src/app/api/well-known/", "oauth-as"),
    ("src/app/(auth)/", "auth"),
    ("src/app/auth/", "auth"),
    ("src/lib/auth/", "auth"),
    ("src/app/dashboard/profile/", "profile"),
    ("src/lib/geo/", "profile"),  # JUDGEMENT: postcode->city for profile location (KAN-341)
    ("src/app/[slug]/", "public-profile"),
    ("src/app/search/", "public-profile"),  # JUDGEMENT: public profile search
    ("src/app/dashboard/page.tsx", "dashboard"),
    ("src/app/dashboard/share-beta.tsx", "dashboard"),
    ("src/app/dashboard/share-profile.tsx", "dashboard"),
    ("src/app/dashboard/widgets/", "dashboard"),
    ("src/lib/dashboard/", "dashboard"),
    ("src/lib/invite-text.ts", "dashboard"),  # JUDGEMENT: consumed by dashboard page + share button
    ("src/app/dashboard/settings/", "account"),
    ("src/lib/retention/", "account"),      # FOUNDER-RULED (plan D6 over manifest); per-module retentionSweep() delegation
    ("src/app/api/retention/", "account"),  # FOUNDER-RULED (plan D6 over manifest)
    ("src/lib/recommend/convene/", "convene"),  # FOUNDER-RULED (plan D7 over manifest); KAN-353 turns on this
    ("src/lib/convene/", "convene"),
    ("src/app/dashboard/convene/", "convene"),
    ("src/app/api/convene/", "convene"),
    ("src/app/r/", "convene"),  # public RSVP page (KAN-209 P5)
    ("src/lib/recommend/", "recommendations"),
    ("src/lib/recommender/", "recommendations"),
    ("src/app/api/recommendations/", "recommendations"),  # FOUNDER-RULED (manifest over plan D4)
    ("src/lib/affiliate/", "affiliate"),
    ("src/app/api/reports/", "trust-safety"),
    ("src/app/(legal)/", "marketing-legal"),
    ("src/app/_marketing/", "marketing-legal"),
    ("src/app/examples/", "marketing-legal"),  # FOUNDER-RULED (manifest over plan D4); MUST consume public-profile's read API
    ("src/app/how-we-check-your-age/", "marketing-legal"),  # FOUNDER-RULED (plan D11 over manifest)
    ("src/lib/compliance/", "marketing-legal"),  # FOUNDER-RULED (manifest over plan D6)
    ("src/app/page.tsx", "marketing-legal"),
    ("src/app/layout.tsx", "marketing-legal"),
    ("src/app/error.tsx", "marketing-legal"),
    ("src/app/global-error.tsx", "marketing-legal"),
    ("src/app/not-found.tsx", "marketing-legal"),
    ("src/app/footer.tsx", "marketing-legal"),
    ("src/app/sitemap.ts", "marketing-legal"),
    ("src/app/cookie-consent.tsx", "marketing-legal"),
    ("src/app/consent-state.ts", "marketing-legal"),
    ("src/app/consented-analytics.tsx", "marketing-legal"),
    ("src/app/install-prompt.tsx", "marketing-legal"),
    ("src/app/service-worker-register.tsx", "marketing-legal"),
    # --- Layer 3: leaf consumer ---
    ("src/app/admin/", "admin"),
    ("src/lib/admin.ts", "admin"),
]

# 21 modules: the plan's 20 + `audit` (founder-approved, KAN-416 R1b).
# `contracts` seeds from src/lib/content-moderation.ts + moderation-policy.ts
# (both already import-free and I/O-free) before being published (KAN-415/418).
ALL_MODULES = [
    "platform", "contracts",
    "guards", "observability", "ui-kit", "audit",
    "access", "features", "age",
    "oauth-as", "auth", "profile", "public-profile", "dashboard", "account",
    "convene", "recommendations", "affiliate", "trust-safety", "marketing-legal",
    "admin",
]

# Numeric layers. AMENDED POLICY (KAN-416 R1b):
#   edge src->dst is ALLOWED iff  layer(dst) < layer(src)
#                             OR  dst in DECLARED_SAME_LAYER[src]  (needs a reason)
# UPWARD edges (layer(dst) > layer(src)) are forbidden ABSOLUTELY — no
# declaration can legalise one; they only ever go in the shrink-only allowlist.
LAYERS = {
    "platform": 0, "contracts": 0,
    "guards": 1, "observability": 1, "ui-kit": 1, "audit": 1,
    "access": 2, "features": 2, "age": 2,
    "oauth-as": 3, "auth": 3, "profile": 3, "public-profile": 3,
    "dashboard": 3, "account": 3, "convene": 3, "recommendations": 3,
    "affiliate": 3, "trust-safety": 3, "marketing-legal": 3,
    "admin": 4,
}

# Declared same-layer edges. Each is a deliberate sub-layer inside a layer and
# MUST carry a reason traceable to the plan or a founder ruling. This list is
# additive-with-review, not a convenience: an entry here is architecture, an
# entry in the allowlist is debt.
DECLARED_SAME_LAYER = {
    ("recommendations", "affiliate"):
        "plan §3 D8 `may_depend_on: affiliate (through MonetisationPort only)` — "
        "a declared sub-layer, not an allowlist entry. Constraint: only through "
        "the MonetisationPort interface; affiliate/backoffice stays unreachable "
        "from the request path (plan §5 affiliate row).",
    ("public-profile", "recommendations"):
        "Consequence of the founder ruling that splits `api/recommendations/` out "
        "of public-profile (plan §3 D4 listed it inside public-profile). The read "
        "path that was one module is now two; the edge is the seam, not drift.",
}

RISK_TIER = {
    # critical: RLS bypass surface, minors' PII gates, credential issuance,
    # backoffice, edge bundle, cross-deployable contracts, audit chain.
    # Raised to match plan §5 blast radius (KAN-416 R1b): guards, contracts.
    "platform": "critical", "access": "critical", "age": "critical",
    "oauth-as": "critical", "trust-safety": "critical", "admin": "critical",
    "guards": "critical", "contracts": "critical", "audit": "critical",
    # Raised to match plan §5 blast radius: public-profile (SEC-44/45 leak
    # surface), ui-kit (every PR founder-gated).
    "public-profile": "high", "ui-kit": "high",
    "auth": "high", "profile": "high",
    "convene": "high", "features": "high", "account": "high",
    "dashboard": "medium", "recommendations": "medium",
    "affiliate": "medium", "observability": "medium", "marketing-legal": "medium",
}

# ---------------------------------------------------------------------------
# 2. Declared table ownership. Tables not listed here are reported as
#    UNOWNED findings. profiles is shared-kernel with column ownership.
# ---------------------------------------------------------------------------
# SHARED_KERNEL tables are NOT exempt from the ownership baseline — they are
# enumerated at COLUMN granularity instead (see column_access pass below).
# The KAN-416 defect fixed here (kan416-derive.py:430, 2026-07-27) was that
# `owner.startswith("db/schema")` short-circuited the whole check, so all 77
# `.from('profiles')` sites recorded ZERO violations.
SHARED_KERNEL = {"profiles"}

TABLE_OWNER = {
    "profiles": "db/schema:shared-kernel",
    "profile_items": "profile", "profile_files": "profile",
    "profile_manual_of_me": "profile", "profile_conversation_starters": "profile",
    "conversation_starter_prompts": "profile", "external_links": "profile",
    "school_affiliations": "profile",
    "gatherings": "convene", "gathering_invitees": "convene",
    "gathering_invite_messages": "convene", "gathering_events_log": "convene",
    "gathering_proposed_slots": "convene", "contacts": "convene",
    "contact_methods": "convene", "venues": "convene",
    "oauth_connections": "convene",  # calendar-provider OAuth, NOT the oauth-as AS
    "oauth_connect_state": "convene",
    "oauth_clients": "oauth-as", "oauth_authorization_codes": "oauth-as",
    "oauth_access_tokens": "oauth-as", "oauth_refresh_tokens": "oauth-as",
    "oauth_consents": "oauth-as",
    "reports": "trust-safety",
    # FOUNDER-RULED (KAN-416 R1b): the moderation write path owns its own tables.
    "content_moderation_flags": "audit", "moderation_logs": "audit",
    "api_keys": "account",
    "global_feature_switches": "features", "feature_entitlements": "features",
    "affiliate_clicks": "affiliate", "affiliate_merchant_eligibility": "affiliate",
    "consent_log": "marketing-legal",  # JUDGEMENT: cookie/analytics consent audit
    "recommender_catalogue": "recommendations",
}

RPC_OWNER = {
    "get_metrics_for_window": "observability",
    "rate_limit_hit": "guards",
    "search_by_contact_hash": "convene",
    "convene_vault_store_secret": "convene", "convene_vault_read_secret": "convene",
    "convene_vault_revoke_secret": "convene", "gatherings_purge_expired": "convene",
    "affiliate_clicks_purge_expired": "affiliate",
    "refresh_relationship_signals": "recommendations",
    "record_erasure_obligation": "trust-safety",
    "admin_list_users": "admin", "admin_filter_profile_ids": "admin",
}

# profiles column ownership (dev schema 2026-07-27, 41 columns).
# Security-load-bearing assignments per KAN-416 §4: access-model columns ->
# access; age-verification columns -> age.
PROFILES_COLUMNS = {
    "db/schema (identity kernel)": ["id", "user_id", "created_at", "updated_at"],
    "access": ["user_status", "access_tier", "is_suspended", "is_admin",
                "suspended_at", "suspension_reason",
                "beta_requested_at", "beta_approved_at"],
    "age": ["age_status", "age_checked_at", "age_provider", "age_provider_ref",
             "age_declared_18_at"],
    "profile": ["display_name", "slug", "headline", "bio_short", "city", "region",
                 "postcode_prefix", "country", "avatar_url", "is_published",
                 "onboarding_complete", "completion_score", "section_visibility",
                 "age_range"],
    "convene": ["phone_search_hash", "postcode_search_hash",
                 "discoverable_by_phone", "discoverable_by_postcode",
                 "share_availability_with_contacts"],
    "dashboard": ["dashboard_widget_state"],
    "recommendations": ["recipient_attributes"],
    "affiliate": ["delivery_country_code"],
    "marketing-legal": ["is_homepage_example", "homepage_example_order"],
}

# ---------------------------------------------------------------------------
# 2b. Change process, per module — encodes LYRA_MODULARISATION_PLAN_2026-07-26
#     §5 verbatim (one dict entry per table row), plus the measured fields that
#     are filled in at derivation time (transitiveDependants, serviceRole,
#     edgeReachableFiles). `extraGates` joins to controls/registry.json by id.
#
#     uiApprovalGated : never | sometimes | always
#     mcpLockstep     : none | contract | tools
#     migrationEnvs   : envs a schema change must traverse ([] when §5 says No)
#     blastRadius     : plan §5 column, verbatim
# ---------------------------------------------------------------------------
THREE_ENV = ["dev", "staging", "production"]
CHANGE_PROCESS = {
    "platform": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="none",
        migrationEnvs=[], migrationFrequency="no", signupSurface=False,
        blastRadius="critical", edgeSafe=True, frozenContracts=[],
        extraGates=["CTL-004"],
        notes="Every change needs a full-suite run; no path filters ever."),
    "guards": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="none",
        migrationEnvs=[], migrationFrequency="no", signupSurface=False,
        blastRadius="critical", edgeSafe=True,
        frozenContracts=["nothing reachable from src/middleware.ts may import "
                         "node:crypto, next/headers or @supabase/supabase-js"],
        extraGates=["CTL-030"],
        notes="edge-safe rule must pass; middleware smoke on preview. The edge "
              "bundle breaks at DEPLOY time, not type-check."),
    "observability": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="none",
        migrationEnvs=[], migrationFrequency="no", signupSurface=False,
        blastRadius="low", edgeSafe=False, frozenContracts=[],
        extraGates=[], notes=""),
    "ui-kit": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/components/**"],
        mcpLockstep="none", migrationEnvs=[], migrationFrequency="no",
        signupSurface=False, blastRadius="high (visual)", edgeSafe=False,
        frozenContracts=["every diff must render-identical"],
        extraGates=["CTL-009"],
        notes="Founder Jira key + UI-Change-Approved trailer; batch per phase, "
              "not per file."),
    "contracts": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="contract",
        migrationEnvs=[], migrationFrequency="no", signupSurface=False,
        blastRadius="critical", edgeSafe=True,
        frozenContracts=["semver", "zero dependencies", "zero I/O",
                         "runs unchanged on Vercel Edge, Vercel Node, Railway Node"],
        extraGates=[],
        notes="MCP lockstep by construction — 3 deployables. CI drift test in "
              "all 3 repos; npm audit HIGH gate runs against it in 5 workflows."),
    "audit": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="contract",
        migrationEnvs=THREE_ENV, migrationFrequency="yes", signupSurface=False,
        blastRadius="high (audit)", edgeSafe=False,
        frozenContracts=["audit chain is append-only",
                         "a mutation may not proceed if the audit write failed",
                         "moderation_logs.actor_user_id ON DELETE RESTRICT"],
        extraGates=[],
        notes="NEW module (KAN-416 R1b, founder-approved). Inherits plan §5's "
              "trust-safety audit obligations because it now owns the write path."),
    "access": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="tools",
        migrationEnvs=THREE_ENV, migrationFrequency="sometimes",
        signupSurface=False, blastRadius="critical", edgeSafe=True,
        frozenContracts=["gate ORDER is a behavioural contract",
                         "fail-open/fail-closed asymmetry must be preserved deliberately"],
        extraGates=["CTL-028", "CTL-013"],
        notes="Needs its own gate-ordering test. must-not: import from admin "
              "(the only group-level cycle in the graph)."),
    "features": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="tools",
        migrationEnvs=THREE_ENV, migrationFrequency="yes", signupSurface=False,
        blastRadius="high", edgeSafe=False, frozenContracts=["16-symbol index.ts"],
        extraGates=[],
        notes="Registry change must land in @lyra/contracts first, then all 3 consumers."),
    "age": dict(
        uiApprovalGated="sometimes", uiApprovalPaths=["copy on the 18+ path"],
        mcpLockstep="tools", migrationEnvs=THREE_ENV, migrationFrequency="rarely",
        signupSurface=False, blastRadius="high (compliance)", edgeSafe=False,
        frozenContracts=["age_declared_18_at is an attestation, NOT a fail-closed gate",
                         "the dormant Didit provider path is retained deliberately"],
        extraGates=[],
        notes="Any change to the 18+ path is a compliance event — DPIA/ROPA check."),
    "oauth-as": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="tools",
        migrationEnvs=THREE_ENV, migrationFrequency="rarely", signupSurface=False,
        blastRadius="critical (frozen contract)", edgeSafe=False,
        frozenContracts=["URLs", "iss derivation", "scope set", "RS256/JWKS keys",
                         "exact 401 shape"],
        extraGates=[],
        notes="claude.ai, Claude Desktop and MCP Inspector are external consumers. "
              "Contract test required BEFORE any move."),
    "auth": dict(
        uiApprovalGated="always", uiApprovalPaths=["copy"], mcpLockstep="none",
        migrationEnvs=THREE_ENV, migrationFrequency="rarely", signupSurface=True,
        blastRadius="high", edgeSafe=False, frozenContracts=[],
        extraGates=["CTL-013"], notes="Signup-surface gate fires."),
    "profile": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/app/dashboard/profile/**"],
        mcpLockstep="tools", migrationEnvs=THREE_ENV, migrationFrequency="yes",
        signupSurface=False, blastRadius="high", edgeSafe=False,
        frozenContracts=["partial-write contract: undefined omits, null clears (BUGS-74)"],
        extraGates=["CTL-021", "CTL-022", "CTL-020"],
        notes="Domain-model changes ripple to public-profile + MCP."),
    "public-profile": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/app/[slug]/**", "src/app/search/**"],
        mcpLockstep="tools", migrationEnvs=THREE_ENV, migrationFrequency="rarely",
        signupSurface=False, blastRadius="high (privacy)", edgeSafe=False,
        frozenContracts=[".eq('is_published',true).eq('is_suspended',false) must stay "
                         "ONE tested unit (SEC-44)",
                         "SEC-82 cache headers preserved"],
        extraGates=["CTL-028"], notes=""),
    "dashboard": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/app/dashboard/**"],
        mcpLockstep="none", migrationEnvs=THREE_ENV, migrationFrequency="rarely",
        signupSurface=False, blastRadius="medium", edgeSafe=False,
        frozenContracts=["never reintroduce loading.tsx / Suspense at /dashboard (BUGS-63)"],
        extraGates=["CTL-019"], notes=""),
    "account": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/app/dashboard/settings/**"],
        mcpLockstep="tools", migrationEnvs=THREE_ENV, migrationFrequency="yes",
        signupSurface=False, blastRadius="high (GDPR)", edgeSafe=False,
        frozenContracts=["SAR/erasure completeness test must pass",
                         "moderation_logs.actor_user_id ON DELETE RESTRICT must not be "
                         "silently dropped"],
        extraGates=[],
        notes="Owns lib/retention + api/retention (founder-ruled); per-module "
              "retentionSweep() delegation, so account never reaches into another "
              "module's tables directly."),
    "convene": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/app/dashboard/convene/**", "src/app/r/**"],
        mcpLockstep="tools", migrationEnvs=THREE_ENV, migrationFrequency="yes",
        signupSurface=False, blastRadius="high — and it is NOT safe", edgeSafe=False,
        frozenContracts=["23 live MCP tools"],
        extraGates=[],
        notes="Plan §7-D5: the web flag is off, but the MCP write tools are LIVE in "
              "production against the production database."),
    "recommendations": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="tools",
        migrationEnvs=THREE_ENV, migrationFrequency="rarely", signupSurface=False,
        blastRadius="medium", edgeSafe=False, frozenContracts=[],
        extraGates=[],
        notes="must-not host Convene scoring (plan D8; KAN-353 turns on this)."),
    "affiliate": dict(
        uiApprovalGated="sometimes", uiApprovalPaths=["AffiliateBadge"],
        mcpLockstep="none", migrationEnvs=THREE_ENV, migrationFrequency="rarely",
        signupSurface=False, blastRadius="medium", edgeSafe=False,
        frozenContracts=["backoffice/ must never be reachable from the request path"],
        extraGates=[], notes=""),
    "trust-safety": dict(
        uiApprovalGated="sometimes", uiApprovalPaths=[], mcpLockstep="tools",
        migrationEnvs=THREE_ENV, migrationFrequency="yes", signupSurface=False,
        blastRadius="high (audit)", edgeSafe=False,
        frozenContracts=["a mutation may not proceed if the audit write failed"],
        extraGates=[],
        notes="Write path + audit tables moved to `audit` (layer 1). trust-safety "
              "keeps api/reports and app/admin/moderation."),
    "marketing-legal": dict(
        uiApprovalGated="always", uiApprovalPaths=["src/app/(legal)/**", "src/app/_marketing/**",
                                                   "src/app/page.tsx", "src/app/examples/**",
                                                   "src/app/how-we-check-your-age/**"],
        mcpLockstep="none", migrationEnvs=[], migrationFrequency="no",
        signupSurface=False, blastRadius="low (functional) / high (legal)",
        edgeSafe=False,
        frozenContracts=["app/examples must consume public-profile's READ API — never "
                         "its own service-role read"],
        extraGates=["CTL-009"],
        notes="Legal copy changes need compliance review, not just founder UI sign-off."),
    "admin": dict(
        uiApprovalGated="never", uiApprovalPaths=[], mcpLockstep="none",
        migrationEnvs=THREE_ENV, migrationFrequency="yes", signupSurface=False,
        blastRadius="high (privilege)", edgeSafe=False,
        frozenContracts=["must not be imported by ANY other module"],
        extraGates=["CTL-028"],
        notes="Internal only — not UI-gated. Every mutation routed through the shared "
              "transition matrix; CF Access + is_admin both verified."),
}

# Public API declared (not measured) for modules whose target surface does not
# exist under that name yet. Everything else is measured from the import graph.
DECLARED_API = {
    "audit": [
        {"symbol": "recordModerationFlag", "status": "declared",
         "todayImplementedBy": "moderateAndAudit() in src/lib/moderation-audit.ts"},
        {"symbol": "logModerationAction", "status": "declared",
         "todayImplementedBy": "moderateAndAudit() in src/lib/moderation-audit.ts"},
        {"symbol": "auditedMutation", "status": "declared",
         "todayImplementedBy": "moderateAndAudit() in src/lib/moderation-audit.ts"},
    ],
}


def edge_allowed(a, b):
    """Amended layer policy (KAN-416 R1b).

    ALLOWED iff layer(dst) < layer(src) OR dst is a DECLARED same-layer edge.
    Upward edges are forbidden absolutely — no declaration legalises one.
    """
    if LAYERS[b] < LAYERS[a]:
        return True
    if LAYERS[b] == LAYERS[a] and (a, b) in DECLARED_SAME_LAYER:
        return True
    return False


# ---------------------------------------------------------------------------
# 3. File walk + module assignment
# ---------------------------------------------------------------------------

def walk_src():
    out = []
    for dirpath, _dirs, files in os.walk(SRC):
        for f in files:
            if f.endswith((".ts", ".tsx")):
                out.append(os.path.relpath(os.path.join(dirpath, f), ROOT).replace(os.sep, "/"))
    return sorted(out)


def module_of(path):
    matches = []
    for rule, mod in MODULE_RULES:
        if rule.endswith("/"):
            if path.startswith(rule):
                matches.append((rule, mod))
        elif path == rule:
            matches.append((rule, mod))
    if not matches:
        return None, None
    # longest (most specific) rule wins; report multi-claims at equal length
    matches.sort(key=lambda m: len(m[0]), reverse=True)
    return matches[0][1], matches


# ---------------------------------------------------------------------------
# 4. Import parsing & resolution
# ---------------------------------------------------------------------------
IMPORT_RE = re.compile(
    r"""(?m)^\s*(import|export)\s+   # keyword at line start (avoids strings)
        (type\s+)?                    # optional type-only
        (?P<clause>[^'";]*?)\s*
        from\s*['"](?P<spec>[^'"]+)['"]""",
    re.VERBOSE,
)
BARE_IMPORT_RE = re.compile(r"""(?m)^\s*import\s*['"](?P<spec>[^'"]+)['"]""")
DYNAMIC_RE = re.compile(r"""import\(\s*['"](?P<spec>[^'"]+)['"]\s*\)""")
FROM_RPC_RE = re.compile(r"""\.(from|rpc)\(\s*['"]([A-Za-z0-9_]+)['"]""")

# --- shared-kernel column extraction (KAN-416 R1b) --------------------------
# For a shared-kernel table (profiles) we must know WHICH COLUMNS each call
# site touches, because ownership is declared per column. We take the chained
# PostgREST expression starting at `.from('profiles')` and read the columns out
# of it. The window ends at the first statement boundary: another `.from(`, a
# blank line, or CHAIN_WINDOW characters — whichever comes first. This is a
# documented heuristic, not a TS parser; every site that yields no columns is
# reported as `unresolved` rather than silently dropped.
CHAIN_WINDOW = 1400
SELECT_RE = re.compile(r"""\.select\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)""", re.S)
FILTER_RE = re.compile(
    r"""\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps|"""
    r"""order|not|filter|match|textSearch)\(\s*['"]([A-Za-z0-9_]+)['"]"""
)
WRITE_RE = re.compile(r"""\.(?:update|insert|upsert)\(\s*(\{)""")
IDENT_KEY_RE = re.compile(r"""(?m)^\s*(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+))\s*:""")


def _balanced_object(text, open_idx):
    """Return the source of the {...} starting at open_idx, or '' if unbalanced."""
    depth = 0
    for i in range(open_idx, min(len(text), open_idx + CHAIN_WINDOW)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx: i + 1]
    return ""


def chain_columns(text, start):
    """Columns touched by the PostgREST chain beginning at `start`.

    Returns (columns:set, kinds:set, star:bool). `star` means select('*') or a
    non-literal argument — the site touches an unbounded column set.
    """
    end = min(len(text), start + CHAIN_WINDOW)
    nxt = text.find(".from(", start + 6)
    if 0 < nxt < end:
        end = nxt
    blank = text.find("\n\n", start)
    if 0 < blank < end:
        end = blank
    window = text[start:end]

    cols, kinds, star = set(), set(), False

    for m in SELECT_RE.finditer(window):
        kinds.add("read")
        raw = m.group(1) or m.group(2) or m.group(3) or ""
        if "${" in raw:            # template interpolation — unbounded
            star = True
            continue
        depth = 0
        cur = ""
        for ch in raw:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                cols.add(cur.strip()) if cur.strip() else None
                cur = ""
            else:
                cur += ch
        if cur.strip():
            cols.add(cur.strip())
    # a bare .select() with no argument also means "everything"
    if re.search(r"\.select\(\s*\)", window):
        kinds.add("read")
        star = True

    for m in FILTER_RE.finditer(window):
        kinds.add("filter")
        cols.add(m.group(1))

    for m in WRITE_RE.finditer(window):
        kinds.add("write")
        obj = _balanced_object(window, m.start(1))
        if not obj:
            star = True
            continue
        found = False
        for km in IDENT_KEY_RE.finditer(obj):
            cols.add(km.group(1) or km.group(2) or km.group(3))
            found = True
        if not found:
            star = True            # spread-only / variable payload
        if "..." in obj:
            star = True            # object spread — unbounded key set
    if re.search(r"\.(?:update|insert|upsert)\(\s*[A-Za-z_$]", window):
        kinds.add("write")
        star = True                # payload is a variable

    clean = set()
    for c in cols:
        c = c.strip()
        if c == "*" or not c:
            star = star or c == "*"
            continue
        c = re.split(r"[(:!]", c)[0].strip()   # foo(bar) / alias:foo / foo!inner
        if re.fullmatch(r"[A-Za-z0-9_]+", c):
            clean.add(c)
    return clean, kinds, star


def parse_symbols(clause):
    """'D, { a, b as c, type X }' -> ['default:D', 'a', 'b', 'type:X']"""
    clause = clause.strip()
    syms = []
    if not clause:
        return syms
    star = re.search(r"\*\s+as\s+(\w+)", clause)
    if star:
        syms.append("* (namespace)")
        clause = clause.replace(star.group(0), "")
    if clause.strip() == "*":
        syms.append("* (re-export)")
        clause = ""
    brace = re.search(r"\{([^}]*)\}", clause)
    if brace:
        for part in brace.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            m = re.match(r"(type\s+)?(\w+)(\s+as\s+\w+)?$", part)
            if m:
                syms.append(("type:" if m.group(1) else "") + m.group(2))
        clause = clause[: brace.start()] + clause[brace.end():]
    rest = clause.replace(",", " ").strip()
    if rest and re.match(r"^\w+$", rest):
        syms.append(f"default (as {rest})")
    return syms


def resolve(spec, from_file):
    if spec.startswith("@/"):
        base = "src/" + spec[2:]
    elif spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(from_file), spec)).replace(os.sep, "/")
    else:
        return None  # external package
    for suffix in ("", ".ts", ".tsx", "/index.ts", "/index.tsx"):
        cand = base + suffix
        if os.path.isfile(os.path.join(ROOT, cand)) and cand.endswith((".ts", ".tsx")):
            return cand
    return None


# ---------------------------------------------------------------------------
# 5. Main derivation
# ---------------------------------------------------------------------------

def main():
    files = walk_src()
    file_mod = {}
    unclaimed = []
    rule_hits = defaultdict(int)
    for f in files:
        mod, matches = module_of(f)
        if mod is None:
            unclaimed.append(f)
        else:
            file_mod[f] = mod
            rule_hits[matches[0][0]] += 1

    dead_rules = [r for r, _ in MODULE_RULES if rule_hits[r] == 0]

    edges = []          # dicts: src, dst, srcMod, dstMod, symbols, typeOnly
    db_sites = []       # dicts: file, mod, kind, name
    for f in files:
        text = open(os.path.join(ROOT, f), encoding="utf-8").read()
        seen_specs = set()
        for m in IMPORT_RE.finditer(text):
            spec = m.group("spec")
            dst = resolve(spec, f)
            if dst:
                seen_specs.add(spec)
                edges.append({
                    "src": f, "dst": dst,
                    "srcMod": file_mod.get(f), "dstMod": file_mod.get(dst),
                    "symbols": parse_symbols(m.group("clause")),
                    "typeOnly": bool(m.group(2)),
                })
        for m in BARE_IMPORT_RE.finditer(text):
            dst = resolve(m.group("spec"), f)
            if dst:
                edges.append({"src": f, "dst": dst, "srcMod": file_mod.get(f),
                              "dstMod": file_mod.get(dst), "symbols": ["(side-effect)"],
                              "typeOnly": False})
        for m in DYNAMIC_RE.finditer(text):
            if m.group("spec") in seen_specs:
                continue
            dst = resolve(m.group("spec"), f)
            if dst:
                edges.append({"src": f, "dst": dst, "srcMod": file_mod.get(f),
                              "dstMod": file_mod.get(dst), "symbols": ["* (dynamic)"],
                              "typeOnly": False})
        for m in FROM_RPC_RE.finditer(text):
            site = {"file": f, "mod": file_mod.get(f),
                    "kind": m.group(1), "name": m.group(2)}
            if m.group(1) == "from" and m.group(2) in SHARED_KERNEL:
                cols, kinds, star = chain_columns(text, m.start())
                site["columns"] = sorted(cols)
                site["ops"] = sorted(kinds)
                site["unbounded"] = star
                site["line"] = text.count("\n", 0, m.start()) + 1
            db_sites.append(site)

    # de-duplicate identical (src,dst) rows produced by multiple import stmts
    merged = {}
    for e in edges:
        k = (e["src"], e["dst"])
        if k in merged:
            merged[k]["symbols"] = sorted(set(merged[k]["symbols"]) | set(e["symbols"]))
            merged[k]["typeOnly"] = merged[k]["typeOnly"] and e["typeOnly"]
        else:
            e = dict(e, symbols=sorted(set(e["symbols"])))
            merged[k] = e
    edges = list(merged.values())

    cross = [e for e in edges if e["srcMod"] != e["dstMod"]]

    # measured public API per module
    public_api = defaultdict(dict)  # mod -> symbol -> {file, importers, modules, typeOnly}
    for e in cross:
        for s in e["symbols"]:
            rec = public_api[e["dstMod"]].setdefault(
                s + " ← " + e["dst"],
                {"symbol": s, "file": e["dst"], "importers": 0,
                 "consumingModules": set(), "typeOnlyEverywhere": True})
            rec["importers"] += 1
            rec["consumingModules"].add(e["srcMod"])
            if not e["typeOnly"] and not s.startswith("type:"):
                rec["typeOnlyEverywhere"] = False

    # dependency matrix + violations
    matrix = defaultdict(int)
    for e in cross:
        matrix[(e["srcMod"], e["dstMod"])] += 1
    violations = [e for e in cross if not edge_allowed(e["srcMod"], e["dstMod"])]
    vio_pairs = defaultdict(list)
    for e in violations:
        vio_pairs[(e["srcMod"], e["dstMod"])].append(e)

    # measured deps split into allowed (mayDependOn) vs violating (candidates)
    may_depend = defaultdict(set)
    candidates = defaultdict(set)
    for (a, b), _n in matrix.items():
        (may_depend if edge_allowed(a, b) else candidates)[a].add(b)

    # ------------------------------------------------------------------
    # transitive dependants (plan §5 "blast radius", MEASURED) and
    # edge-bundle reachability (plan §3 P2 guards hard rule), both by BFS
    # over the resolved file graph.
    # ------------------------------------------------------------------
    fwd = defaultdict(set)
    rev = defaultdict(set)
    for e in edges:
        fwd[e["src"]].add(e["dst"])
        rev[e["dst"]].add(e["src"])

    def reach(seeds, graph):
        seen, stack = set(seeds), list(seeds)
        while stack:
            for nxt in graph.get(stack.pop(), ()):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    mod_files = defaultdict(list)
    for f, m in file_mod.items():
        mod_files[m].append(f)
    transitive_dependants = {}
    for mod in ALL_MODULES:
        own = set(mod_files.get(mod, []))
        transitive_dependants[mod] = len(reach(own, rev) - own) if own else 0

    edge_reachable = reach({"src/middleware.ts"}, fwd) if os.path.isfile(
        os.path.join(ROOT, "src/middleware.ts")) else set()
    edge_reach_by_mod = defaultdict(int)
    for f in edge_reachable:
        if f in file_mod:
            edge_reach_by_mod[file_mod[f]] += 1

    # DB ownership check
    tables_seen = defaultdict(lambda: defaultdict(int))  # name -> mod -> count
    for s in db_sites:
        tables_seen[(s["kind"], s["name"])][s["mod"]] += 1
    unowned = []
    cross_table = []
    for (kind, name), mods in sorted(tables_seen.items()):
        owner = (TABLE_OWNER if kind == "from" else RPC_OWNER).get(name)
        if owner is None:
            unowned.append((kind, name, dict(mods)))
            continue
        if kind == "from" and name in SHARED_KERNEL:
            continue          # enumerated at column granularity below
        for mod, n in mods.items():
            # SET MEMBERSHIP, not substring containment (the second KAN-416
            # defect: `mod not in owner` compared a module name against an
            # owner STRING, so `access` would have matched `access-model`).
            if mod != owner:
                cross_table.append({"kind": kind, "name": name, "owner": owner,
                                    "accessor": mod, "sites": n})

    # ------------------------------------------------------------------
    # shared-kernel (profiles) COLUMN-granularity baseline — KAN-416 R1b.
    # Every .from('profiles') site is attributed to the modules that own the
    # columns it touches. A site touching a column owned by another module is
    # a cross-module data access, exactly as a whole-table violation would be.
    # ------------------------------------------------------------------
    col_owner = {c: owner for owner, cols in PROFILES_COLUMNS.items() for c in cols}
    kernel_col_access = defaultdict(lambda: {"sites": 0, "files": set(), "ops": set()})
    kernel_unbounded = []       # sites whose column set could not be bounded
    kernel_unknown_cols = defaultdict(set)   # column -> modules touching it
    kernel_site_count = 0
    for s in db_sites:
        if s["kind"] != "from" or s["name"] not in SHARED_KERNEL:
            continue
        kernel_site_count += 1
        mod = s["mod"]
        if s["unbounded"]:
            kernel_unbounded.append({"file": s["file"], "line": s["line"],
                                     "module": mod, "ops": s["ops"],
                                     "columnsSeen": s["columns"]})
        for c in s["columns"]:
            owner = col_owner.get(c)
            if owner is None:
                kernel_unknown_cols[c].add(mod)
                continue
            if owner == mod or owner.startswith("db/schema"):
                continue
            rec = kernel_col_access[(mod, s["name"], c, owner)]
            rec["sites"] += 1
            rec["files"].add(s["file"])
            rec["ops"] |= set(s["ops"])
    kernel_rows = sorted(
        ({"accessor": k[0], "table": k[1], "column": k[2], "owner": k[3],
          "sites": v["sites"], "ops": sorted(v["ops"]), "files": sorted(v["files"])}
         for k, v in kernel_col_access.items()),
        key=lambda r: (-r["sites"], r["column"], r["accessor"]))

    # service-role privilege register
    service_files = sorted({e["src"] for e in edges if e["dst"] == "src/modules/platform/supabase-service.ts"})
    service_mods = defaultdict(list)
    for f in service_files:
        service_mods[file_mod[f]].append(f)

    # provisional test floors
    test_files = []
    tests_dir = os.path.join(ROOT, "tests")
    for dirpath, _d, fs in os.walk(tests_dir):
        for f in fs:
            if f.endswith((".js", ".cjs", ".mjs", ".ts", ".tsx")):
                test_files.append(os.path.relpath(os.path.join(dirpath, f), ROOT).replace(os.sep, "/"))
    src_lit = re.compile(r"src/[A-Za-z0-9_\-./\[\]()@]+")
    test_block = re.compile(r"\b(?:test|it)\s*\(")
    floors = defaultdict(lambda: {"files": 0, "blocks": 0})
    unmapped_tests = []
    for tf in sorted(test_files):
        text = open(os.path.join(ROOT, tf), encoding="utf-8", errors="replace").read()
        votes = defaultdict(int)
        for lit in src_lit.findall(text):
            lit = lit.rstrip(".")
            for cand in (lit, lit + ".ts", lit + ".tsx", lit + "/index.ts"):
                if cand in file_mod:
                    votes[file_mod[cand]] += 1
                    break
            else:
                if lit.rstrip("/") + "/" in [r for r, _ in MODULE_RULES]:
                    votes[dict(MODULE_RULES)[lit.rstrip("/") + "/"]] += 1
        blocks = len(test_block.findall(text))
        if votes:
            mod = max(votes.items(), key=lambda kv: kv[1])[0]
            floors[mod]["files"] += 1
            floors[mod]["blocks"] += blocks
        else:
            unmapped_tests.append((tf, blocks))

    # ------------------------------------------------------------------
    # outputs
    # ------------------------------------------------------------------
    modules_json = {
        "$comment": (
            "KAN-416 v1 DRAFT (R1b re-derivation) — derived from measured imports "
            "on develop; enforced=false everywhere, read by nothing. 21 modules: "
            "the plan's 20 plus founder-approved `audit`. Path assignments are "
            "reconciled against docs/modularisation/"
            "LYRA_MODULARISATION_PLAN_2026-07-26.md §3 and the 10 founder rulings "
            "recorded on KAN-416; changeProcess encodes plan §5. Regenerate with: "
            "python3 docs/modularisation/kan416-derive.py"
        ),
        "version": 1,
        "layerPolicy": {
            "rule": "edge src->dst allowed iff layer(dst) < layer(src) "
                    "OR dst in declaredSameLayer[src]",
            "upwardEdges": "FORBIDDEN ABSOLUTELY — no declaration can legalise one",
            "declaredSameLayer": [
                {"from": a, "to": b, "reason": r}
                for (a, b), r in sorted(DECLARED_SAME_LAYER.items())
            ],
        },
        "modules": {},
        "serviceRoleClient": {
            "$comment": (
                "KAN-416 §4 security output: createServiceRoleClient bypasses "
                "RLS. Measured importers by module at derivation time; the "
                "KAN-415 target restricts it to src/modules/*/data/** via "
                "check-service-role-client.sh. Any module NOT listed here must "
                "not gain the import without security review."
            ),
            "measuredImporters": {mod: sorted(fs) for mod, fs in
                                  sorted(service_mods.items(), key=lambda kv: -len(kv[1]))},
            "totalFiles": len(service_files),
        },
        "meta": {
            "db/schema": {
                "owns": "table-ownership contract; profiles at column granularity",
                "tables": TABLE_OWNER,
                "rpcs": RPC_OWNER,
                "profilesColumns": PROFILES_COLUMNS,
            },
            "ci/boundaries": {
                "owns": "enforcement machinery (dependency-cruiser config, allowlist, gates)",
                "allowlistSeed": "docs/modularisation/KAN-416-boundaries-allowlist.seed.json",
            },
        },
    }
    for mod in ALL_MODULES:
        paths = [r for r, m in MODULE_RULES if m == mod]
        api = sorted(public_api.get(mod, {}).values(),
                     key=lambda r: -r["importers"])
        modules_json["modules"][mod] = {
            "layer": LAYERS[mod],
            "paths": paths,
            "owns": {
                "files": sum(1 for f, m in file_mod.items() if m == mod),
                "tables": sorted(t for t, o in TABLE_OWNER.items() if o == mod),
                "rpcs": sorted(t for t, o in RPC_OWNER.items() if o == mod),
                "profilesColumns": next((cols for owner, cols in PROFILES_COLUMNS.items()
                                         if owner == mod), []),
            },
            "publicApi": [
                {"symbol": r["symbol"], "file": r["file"],
                 "importingFiles": r["importers"],
                 "consumingModules": sorted(r["consumingModules"]),
                 "typeOnly": r["typeOnlyEverywhere"]}
                for r in api
            ],
            "declaredApi": DECLARED_API.get(mod, []),
            "mayDependOn": sorted(may_depend.get(mod, set())),
            "declaredSameLayer": sorted(b for (a, b) in DECLARED_SAME_LAYER if a == mod),
            "mayDependOnCandidatesPendingDecision": sorted(candidates.get(mod, set())),
            "mustNot": sorted(m for m in ALL_MODULES
                              if m != mod and not edge_allowed(mod, m)
                              and m not in may_depend.get(mod, set())),
            "riskTier": RISK_TIER[mod],
            "changeProcess": dict(
                CHANGE_PROCESS[mod],
                transitiveDependants={
                    "$comment": "MEASURED: distinct src/ files outside this module "
                                "that transitively import it (plan §5 blast radius)",
                    "files": transitive_dependants[mod],
                },
                edgeReachableFiles={
                    "$comment": "MEASURED: files of this module reachable from "
                                "src/middleware.ts (the edge bundle)",
                    "files": edge_reach_by_mod.get(mod, 0),
                },
                serviceRole={
                    "$comment": "MEASURED: files importing supabase-service.ts "
                                "(createServiceRoleClient bypasses RLS)",
                    "files": len(service_mods.get(mod, [])),
                },
            ),
            "compositionRoots": [p for p in paths if p == "src/middleware.ts"],
            "testFloor": {
                "provisional": True,
                "note": "path-vote mapping; superseded by KAN-417",
                "testFiles": floors.get(mod, {}).get("files", 0),
                "testBlocks": floors.get(mod, {}).get("blocks", 0),
            },
            "enforced": False,
        }

    allowlist_seed = {
        "$comment": (
            "KAN-416 seed of .boundaries-allowlist.json — every measured edge "
            "the proposed layer policy forbids, at derivation time. Shrink-only "
            "once adopted; every entry then needs a Jira key + expiry."
        ),
        "policy": ("edge src->dst allowed iff layer(dst) < layer(src) "
                   "OR dst in declaredSameLayer[src]; upward edges never allowed"),
        "totalViolatingEdges": len(violations),
        "pairs": [
            {"from": a, "to": b, "edges": len(es),
             "direction": ("upward — FORBIDDEN ABSOLUTELY"
                           if LAYERS[b] > LAYERS[a] else "same-layer, undeclared"),
             "files": sorted({(e["src"] + " -> " + e["dst"]) for e in es}),
             "typeOnly": all(e["typeOnly"] for e in es)}
            for (a, b), es in sorted(vio_pairs.items(), key=lambda kv: -len(kv[1]))
        ],
        "crossModuleTableAccess": sorted(cross_table, key=lambda c: (-c["sites"], c["name"])),
        "sharedKernelColumnAccess": {
            "$comment": (
                "KAN-416 R1b — the baseline that the first derivation silently "
                "skipped. Every .from('profiles') site attributed to the module "
                "owning each column it touches. A row is a cross-module data "
                "access on the god-table and is exactly what KAN-421 must rule on."
            ),
            "table": "profiles",
            "totalSites": kernel_site_count,
            "totalCrossModuleColumnAccesses": sum(r["sites"] for r in kernel_rows),
            "distinctColumnAccessorPairs": len(kernel_rows),
            "rows": kernel_rows,
            "unboundedSites": {
                "$comment": ("sites whose column set could not be bounded from source "
                             "— select('*'), a bare select(), a variable write payload, "
                             "or an object spread. Each touches an UNKNOWN subset of "
                             "all 41 columns and must be read as a potential access to "
                             "every one of them."),
                "count": len(kernel_unbounded),
                "sites": sorted(kernel_unbounded, key=lambda s: (s["file"], s["line"])),
            },
            "columnsNotInOwnershipMap": {
                c: sorted(m for m in mods if m) for c, mods in sorted(kernel_unknown_cols.items())
            },
        },
    }

    with open(os.path.join(ROOT, "modules.json"), "w", encoding="utf-8") as fh:
        json.dump(modules_json, fh, indent=2, sort_keys=False)
        fh.write("\n")
    with open(os.path.join(ROOT, "docs/modularisation/KAN-416-boundaries-allowlist.seed.json"),
              "w", encoding="utf-8") as fh:
        json.dump(allowlist_seed, fh, indent=2)
        fh.write("\n")

    # ------------------------------------------------------------------
    # report
    # ------------------------------------------------------------------
    intra = len(edges) - len(cross)
    print(f"files in src/: {len(files)}  claimed: {len(file_mod)}  UNCLAIMED: {len(unclaimed)}")
    for f in unclaimed:
        print(f"  UNCLAIMED: {f}")
    if dead_rules:
        print(f"rules matching zero files: {dead_rules}")
    print(f"resolved internal import edges: {len(edges)} (intra-module {intra}, cross-module {len(cross)})")
    print(f"policy-violating edges (allowlist seed): {len(violations)} across {len(vio_pairs)} module pairs")
    print(f"type-only violating edges: {sum(1 for e in violations if e['typeOnly'])}")
    print()
    print("module | files | publicApi symbols | deps(allowed) | deps(candidate) | tests(prov)")
    for mod in ALL_MODULES:
        mj = modules_json["modules"][mod]
        print(f"{mod:16} | {mj['owns']['files']:3} | {len(mj['publicApi']):3} | "
              f"{','.join(mj['mayDependOn']) or '-'} | "
              f"{','.join(mj['mayDependOnCandidatesPendingDecision']) or '-'} | "
              f"{mj['testFloor']['testFiles']}f/{mj['testFloor']['testBlocks']}t")
    print()
    print("dependency matrix (measured cross-module edge counts):")
    for (a, b), n in sorted(matrix.items(), key=lambda kv: -kv[1]):
        if edge_allowed(a, b):
            flag = "  (declared same-layer)" if LAYERS[b] == LAYERS[a] else ""
        else:
            flag = ("  << VIOLATES policy (UPWARD)" if LAYERS[b] > LAYERS[a]
                    else "  << VIOLATES policy (undeclared same-layer)")
        print(f"  {a:16} -> {b:16} {n:3}{flag}")
    print()
    db_from = sum(1 for s in db_sites if s["kind"] == "from")
    db_rpc = len(db_sites) - db_from
    print(f".from() sites: {db_from}  .rpc() sites: {db_rpc}  distinct tables: "
          f"{len({n for (k, n) in tables_seen if k == 'from'})}")
    if unowned:
        print("UNOWNED tables/rpcs (finding):")
        for kind, name, mods in unowned:
            print(f"  {kind} {name}: {mods}")
    print(f"cross-module table access sites (data-boundary seed): "
          f"{sum(c['sites'] for c in cross_table)} over {len(cross_table)} (module,table) pairs")
    for c in allowlist_seed["crossModuleTableAccess"]:
        print(f"  {c['accessor']:16} touches {c['name']} (owner: {c['owner']}) at {c['sites']} sites")
    print()
    sk = allowlist_seed["sharedKernelColumnAccess"]
    print(f"SHARED KERNEL profiles: {sk['totalSites']} .from('profiles') sites; "
          f"{sk['totalCrossModuleColumnAccesses']} cross-module column accesses over "
          f"{sk['distinctColumnAccessorPairs']} (module,column) pairs; "
          f"{sk['unboundedSites']['count']} unbounded sites")
    by_acc = defaultdict(int)
    for r in kernel_rows:
        by_acc[r["accessor"]] += r["sites"]
    for acc, n in sorted(by_acc.items(), key=lambda kv: -kv[1]):
        cols = sorted({r["column"] for r in kernel_rows if r["accessor"] == acc})
        print(f"  {acc:16} {n:3} accesses to columns owned elsewhere: {', '.join(cols)}")
    if kernel_unknown_cols:
        print(f"  columns touched but NOT in the ownership map ({len(kernel_unknown_cols)}): "
              f"{', '.join(sorted(kernel_unknown_cols))}")
    print()
    print("blast radius (MEASURED transitive dependant files) | edge-bundle files:")
    for mod in sorted(ALL_MODULES, key=lambda m: -transitive_dependants[m]):
        print(f"  {mod:16} {transitive_dependants[mod]:3} dependants | "
              f"{edge_reach_by_mod.get(mod, 0):2} edge | plan blast: "
              f"{CHANGE_PROCESS[mod]['blastRadius']}")
    print()
    print("service-role client (createServiceRoleClient) importers by module:")
    for mod, fs in sorted(service_mods.items(), key=lambda kv: -len(kv[1])):
        print(f"  {mod:16} {len(fs):3} files")
    print(f"  TOTAL files: {len(service_files)}")
    print()
    print(f"unmapped test files (no src/ path votes): {len(unmapped_tests)} "
          f"({sum(b for _, b in unmapped_tests)} test blocks)")
    profcols = [c for cols in PROFILES_COLUMNS.values() for c in cols]
    print(f"profiles columns assigned: {len(profcols)} (duplicates: "
          f"{len(profcols) - len(set(profcols))})")

    if "--json" in sys.argv:
        json.dump({"edges": edges, "violations": len(violations)},
                  sys.stdout, indent=1, default=list)


if __name__ == "__main__":
    main()
