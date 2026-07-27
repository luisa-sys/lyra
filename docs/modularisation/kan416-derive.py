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
    ("src/lib/supabase-browser.ts", "platform"),
    ("src/lib/supabase-server.ts", "platform"),
    ("src/lib/supabase-service.ts", "platform"),
    ("src/lib/env.ts", "platform"),
    ("src/lib/deploy-env.ts", "platform"),
    ("src/lib/cookie-domain.ts", "platform"),
    # --- Layer 0: guards (request/output guarding utilities) JUDGEMENT ---
    ("src/lib/rate-limit.ts", "guards"),
    ("src/lib/rate-limit-shared.ts", "guards"),
    ("src/lib/profile-rate-limit.ts", "guards"),
    ("src/lib/turnstile.ts", "guards"),
    ("src/lib/sanitise.ts", "guards"),
    ("src/lib/file-magic-bytes.ts", "guards"),
    ("src/lib/security-headers.ts", "guards"),
    ("src/lib/cf-access.ts", "guards"),
    ("src/lib/json-ld.ts", "guards"),  # JUDGEMENT: output-encoding defence (SEC-08)
    # --- Layer 0: observability ---
    ("src/lib/metrics.ts", "observability"),
    ("src/lib/sentry-scrub.ts", "observability"),
    ("src/app/api/health/", "observability"),
    ("src/app/status/", "observability"),  # JUDGEMENT: live-probe status page (SEC-4)
    # --- Layer 0: ui-kit (to be BUILT; today exactly one file) ---
    ("src/components/", "ui-kit"),
    # --- Layer 1: access core ---
    ("src/lib/beta-access/", "access"),
    ("src/lib/account-status.ts", "access"),
    ("src/app/waitlist/", "access"),
    ("src/app/suspended/", "access"),
    ("src/app/join/", "access"),
    ("src/middleware.ts", "access"),  # JUDGEMENT: composition root; KAN-415 pairs "access + middleware decomposition"
    ("src/lib/features/", "features"),
    ("src/lib/age/", "age"),
    ("src/app/verify-age/", "age"),
    ("src/app/confirm-age/", "age"),
    ("src/app/how-we-check-your-age/", "age"),
    ("src/app/api/age/", "age"),
    # --- Layer 2: domains ---
    ("src/lib/oauth/", "oauth-as"),
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
    ("src/lib/convene/", "convene"),
    ("src/app/dashboard/convene/", "convene"),
    ("src/app/api/convene/", "convene"),
    ("src/app/r/", "convene"),  # public RSVP page (KAN-209 P5)
    ("src/lib/recommend/", "recommendations"),  # includes recommend/convene — JUDGEEMENT flagged in artefact
    ("src/lib/recommender/", "recommendations"),
    ("src/app/api/recommendations/", "recommendations"),
    ("src/lib/affiliate/", "affiliate"),
    ("src/lib/content-moderation.ts", "trust-safety"),  # seeds @lyra/contracts (KAN-415)
    ("src/lib/moderation-audit.ts", "trust-safety"),
    ("src/lib/moderation-policy.ts", "trust-safety"),
    ("src/app/api/reports/", "trust-safety"),
    ("src/lib/retention/", "trust-safety"),  # JUDGEMENT: GDPR retention enforcement (SEC-74)
    ("src/app/api/retention/", "trust-safety"),
    ("src/app/(legal)/", "marketing-legal"),
    ("src/app/_marketing/", "marketing-legal"),
    ("src/app/examples/", "marketing-legal"),  # JUDGEMENT: homepage example-profiles showcase
    ("src/lib/compliance/", "marketing-legal"),  # JUDGEMENT: feature-gated legal disclosures (KAN-408)
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

# contracts has no src/ presence yet: it is bootstrapped later from a
# byte-identical copy of src/lib/content-moderation.ts (KAN-415).
ALL_MODULES = [
    "platform", "guards", "observability", "ui-kit", "contracts",
    "access", "features", "age",
    "oauth-as", "auth", "profile", "public-profile", "dashboard", "account",
    "convene", "recommendations", "affiliate", "trust-safety", "marketing-legal",
    "admin",
]

# Numeric layers: an edge src->dst is ALLOWED iff layer(dst) < layer(src).
# Same-layer and upward edges are policy violations -> allowlist seed.
LAYERS = {
    "platform": 0, "contracts": 0,
    "guards": 1, "observability": 1, "ui-kit": 1,
    "access": 2, "features": 2, "age": 2,
    "oauth-as": 3, "auth": 3, "profile": 3, "public-profile": 3,
    "dashboard": 3, "account": 3, "convene": 3, "recommendations": 3,
    "affiliate": 3, "trust-safety": 3, "marketing-legal": 3,
    "admin": 4,
}

RISK_TIER = {
    # critical: RLS bypass surface, minors' PII gates, credential issuance, backoffice
    "platform": "critical", "access": "critical", "age": "critical",
    "oauth-as": "critical", "trust-safety": "critical", "admin": "critical",
    "guards": "high", "contracts": "high", "auth": "high", "profile": "high",
    "convene": "high", "features": "high", "account": "high",
    "public-profile": "medium", "dashboard": "medium", "recommendations": "medium",
    "affiliate": "medium", "observability": "medium", "marketing-legal": "medium",
    "ui-kit": "low",
}

# ---------------------------------------------------------------------------
# 2. Declared table ownership. Tables not listed here are reported as
#    UNOWNED findings. profiles is shared-kernel with column ownership.
# ---------------------------------------------------------------------------
TABLE_OWNER = {
    "profiles": "db/schema (shared kernel — column ownership below)",
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
    "reports": "trust-safety", "content_moderation_flags": "trust-safety",
    "moderation_logs": "trust-safety",
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
            db_sites.append({"file": f, "mod": file_mod.get(f),
                             "kind": m.group(1), "name": m.group(2)})

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
    violations = []
    for e in cross:
        if LAYERS[e["dstMod"]] >= LAYERS[e["srcMod"]]:
            violations.append(e)
    vio_pairs = defaultdict(list)
    for e in violations:
        vio_pairs[(e["srcMod"], e["dstMod"])].append(e)

    # measured deps split into allowed (mayDependOn) vs violating (candidates)
    may_depend = defaultdict(set)
    candidates = defaultdict(set)
    for (a, b), _n in matrix.items():
        (may_depend if LAYERS[b] < LAYERS[a] else candidates)[a].add(b)

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
        for mod, n in mods.items():
            if mod not in owner and not owner.startswith("db/schema"):
                cross_table.append({"kind": kind, "name": name, "owner": owner,
                                    "accessor": mod, "sites": n})

    # service-role privilege register
    service_files = sorted({e["src"] for e in edges if e["dst"] == "src/lib/supabase-service.ts"})
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
            "KAN-416 v0 DRAFT — derived from measured imports on develop; "
            "enforced=false everywhere. Module set per epic KAN-415. Path "
            "assignments marked JUDGEMENT in docs/modularisation/kan416-derive.py "
            "must be diffed against LYRA_MODULARISATION_PLAN_2026-07-26.md §3/§5 "
            "(not accessible to the deriving session). Regenerate with: "
            "python3 docs/modularisation/kan416-derive.py"
        ),
        "version": 0,
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
            "mayDependOn": sorted(may_depend.get(mod, set())),
            "mayDependOnCandidatesPendingDecision": sorted(candidates.get(mod, set())),
            "mustNot": sorted(m for m in ALL_MODULES
                              if m != mod and LAYERS[m] >= LAYERS[mod]
                              and m not in may_depend.get(mod, set())),
            "riskTier": RISK_TIER[mod],
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
        "policy": "edge src->dst allowed iff layer(dst) < layer(src)",
        "totalViolatingEdges": len(violations),
        "pairs": [
            {"from": a, "to": b, "edges": len(es),
             "files": sorted({(e["src"] + " -> " + e["dst"]) for e in es}),
             "typeOnly": all(e["typeOnly"] for e in es)}
            for (a, b), es in sorted(vio_pairs.items(), key=lambda kv: -len(kv[1]))
        ],
        "crossModuleTableAccess": sorted(cross_table, key=lambda c: (-c["sites"], c["name"])),
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
        flag = "" if LAYERS[b] < LAYERS[a] else "  << VIOLATES policy"
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
