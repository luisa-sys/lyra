#!/usr/bin/env python3
"""KAN-420 — four-way migration parity matrix: git <-> dev <-> staging <-> prod.

Deterministic: reads the committed capture in data/kan420-applied-migrations.json
(produced 2026-07-27 via the Supabase MCP `list_migrations` tool, read-only) and
the checked-in supabase/migrations/ directory, and regenerates
data/kan420-parity-matrix.md.

Re-run:
    python3 docs/modularisation/kan420-parity.py

To refresh the capture itself, re-run `list_migrations` against the three
projects (dev ilprytcrnqyrsbsrfujj, staging uobmlkzrjkptwhttzmmi, prod
llzkgprqewuwkiwclowi) and update the JSON. Version-ids are per-env and
meaningless across envs (docs/MIGRATION_PARITY.md); NAME is the identity key.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data", "kan420-applied-migrations.json")
OUT = os.path.join(HERE, "data", "kan420-parity-matrix.md")
MIG_DIR = os.path.join(REPO, "supabase", "migrations")

# Curated alias map: git filename stem -> applied-history name.
# Sources: name proximity + same-day version timestamps + DDL fingerprint
# equality (see KAN-420 artefact §3). Every non-identity alias is listed
# explicitly so a reviewer can veto any single line.
ALIASES = {
    "add_missing_item_categories": "add_missing_profile_item_categories",
    "add_avatar_url_and_storage": "add_avatar_url_and_storage_rls",
    "profile_items_visibility": "kan_143_profile_items_visibility",
    "phone_postcode_search": "kan_153_phone_postcode_search",
    "manual_of_me": "kan_154_manual_of_me",
    "admin_and_moderation": "kan_141_admin_and_moderation",
    "add_current_problems_category": "kan_182_add_current_problems_category",
    "profile_files": "kan_142_profile_files",
    "conversation_starters": "kan_181_conversation_starters",
    "metrics_window_fn": "kan_63a_metrics_window_fn",
    "affiliation_type": "kan220_affiliation_type",
    "section_visibility": "kan221_section_visibility",
    "about_me_fields": "kan263_about_me_fields",
    "affiliation_show_on_profile": "kan263_affiliation_show_on_profile",
    "favourites_categories": "kan263_favourites_categories",
    "security_audit_lockdown_anon_exposed_surface": "security_audit_20260621_lockdown_anon_exposed_surface",
    "security_audit_restrict_authenticated_suspended_profiles": "security_audit_20260621_restrict_authenticated_suspended_profiles",
    "security_audit_fn_searchpath_and_view_invoker": "security_audit_20260621_fn_searchpath_and_view_invoker",
    "security_audit_contact_hash_authn_only": "security_audit_20260621_contact_hash_authn_only",
    "security_audit_residual_definer_fn_public_revoke": "security_audit_20260621_residual_definer_fn_public_revoke",
    "e2e_fix_auth_tokens_fn": "e2e_fix_auth_tokens_fn",  # no history row anywhere
}

# Names whose absence/presence is explained by a squash or a known event.
# classification -> set of names. Everything else falls out arithmetically.
NOTES = {
    # dev granular <-> staging/prod squashes (DDL-equality verified by the
    # KAN-420 schema fingerprints, artefact §4)
    "kan263_profile_redesign": "SQUASH (staging) of profile_redesign_favourite_categories + affiliation_description + kan263_* granulars; DDL parity verified",
    "kan154_kan263_manual_of_me_and_affiliation_cols": "SQUASH (prod) covering kan_154 + kan263 about-me/affiliation cols; DDL parity verified except column ORDER in profile_manual_of_me (benign)",
    "kan349_404_promote_batch_staging": "SQUASH (staging) — KAN-349/404 promote batch",
    "kan349_404_promote_batch_prod": "SQUASH (prod) — KAN-349/404 promote batch; covers kan345 + kan339 + age_self_declaration-adjacent cols (profiles DDL fingerprint-equal to dev EXCEPT the four kan_153 columns; see artefact §5.1)",
    "sec56_revoke_oauth_connections_direct_writes": "prod-only granular; dev/staging got the same revokes via sec54_sec56_bugs65_secdef_rls_grant_batch; fn/table ACL fingerprints equal",
    "sec54_sec56_bugs65_secdef_rls_grant_batch": "dev-only history; prod covered by sec56_revoke_oauth_connections_direct_writes + sec45; ACL fingerprints equal",
    "sec75_moderation_actor_anonymise": "HISTORY-ARTIFACT (dev): DDL was reverted 2026-07-12 but the history row persists (docs/MIGRATION_PARITY.md §4). Do not propagate",
    "convene_vault_helpers": "staging/prod convene-vault bootstrap; dev used convene_spike_oauth + drop_convene_spike instead (docs/MIGRATION_PARITY.md §1); vault fn fingerprints equal (whitespace-only text drift)",
    "convene_spike_oauth": "dev-only spike, net-zero with drop_convene_spike",
    "drop_convene_spike": "dev-only spike teardown",
    "fix_security_advisories_and_rls_performance": "applied on all 3 envs; NO git file — pre-dates the repo migration discipline",
    "sec_01_bugs24_revoke_convene_vault_anon_grants": "applied on all 3 envs; NO git file",
    "sec_03_bugs25_stop_anon_enumeration_storage_buckets": "applied on all 3 envs; NO git file",
    "revoke_secdef_exec_bugs44_v2_public": "applied on all 3 envs; NO git file",
    "kan_232_mcp_tool_call_log": "applied on all 3 envs; NO git file — out-of-band object #2 (mcp_tool_call_log). Draft reconstruction: drafts/kan420_reconstruct_mcp_tool_call_log.sql",
    "kan_245_mcp_tool_call_log_retention": "applied on all 3 envs; NO git file — retention companion of kan_232",
    "kan_244_content_moderation_flags": "applied on all 3 envs; NO git file — out-of-band object #1 (content_moderation_flags). Draft: drafts/kan420_reconstruct_content_moderation_flags.sql",
    "profile_redesign_favourite_categories": "dev granular, squashed on staging/prod (kan263_profile_redesign / kan154_kan263_*)",
    "affiliation_description": "dev granular, squashed on staging/prod",
    "create_lyra_schema": "dev-only baseline; staging/prod histories start later, base tables verified equal by fingerprints",
}


def load():
    with open(DATA) as f:
        d = json.load(f)
    envs = {e: {m["name"] for m in v["migrations"]} for e, v in d["environments"].items()}
    dupes = {}
    for e, v in d["environments"].items():
        seen, dd = set(), []
        for m in v["migrations"]:
            if m["name"] in seen:
                dd.append(m["name"])
            seen.add(m["name"])
        if dd:
            dupes[e] = dd
    git = {}
    for fn in sorted(os.listdir(MIG_DIR)):
        if fn.endswith(".sql"):
            stem = fn[15:-4] if fn[:14].isdigit() else fn[:-4]
            git[ALIASES.get(stem, stem)] = fn
    return d, envs, git, dupes


def main():
    d, envs, git, dupes = load()
    dev, stg, prod = envs["dev"], envs["staging"], envs["prod"]
    all_names = sorted(set(git) | dev | stg | prod)
    rows, counts = [], {"full": 0, "explained": 0, "drift": 0}
    for n in all_names:
        g = "✓" if n in git else "—"
        dv = "✓" if n in dev else "—"
        st = "✓" if n in stg else "—"
        pr = "✓" if n in prod else "—"
        note = NOTES.get(n, "")
        if g == dv == st == pr == "✓" and not note:
            counts["full"] += 1
            cls = "OK"
        elif note:
            counts["explained"] += 1
            cls = "EXPLAINED"
        else:
            counts["drift"] += 1
            cls = "DRIFT"
        rows.append((n, g, dv, st, pr, cls, note))
    with open(OUT, "w") as f:
        f.write("# KAN-420 four-way migration parity matrix\n\n")
        f.write("Generated by `docs/modularisation/kan420-parity.py` from the 2026-07-27 capture ")
        f.write(f"(git HEAD `{d['git_head'][:12]}`). Identity key = migration NAME.\n\n")
        f.write(f"Counts: git files {len(git)} · dev {len(dev)} · staging {len(stg)} · prod {len(prod)} unique names · ")
        f.write(f"union {len(all_names)} · in-parity {counts['full']} · explained {counts['explained']} · **unexplained DRIFT {counts['drift']}**\n\n")
        if dupes:
            f.write(f"Duplicate history rows: `{dupes}`\n\n")
        f.write("| migration name | git | dev | staging | prod | class | note |\n|---|---|---|---|---|---|---|\n")
        for r in rows:
            f.write("| `{}` | {} | {} | {} | {} | {} | {} |\n".format(*r))
        f.write("\nDRIFT rows are enumerated and classified in docs/modularisation/KAN-420-migration-parity.md §5.\n")
    print(f"wrote {OUT}: union={len(all_names)} ok={counts['full']} explained={counts['explained']} drift={counts['drift']}")
    for r in rows:
        if r[5] == "DRIFT":
            print("DRIFT:", r[0], "git", r[1], "dev", r[2], "stg", r[3], "prod", r[4])


if __name__ == "__main__":
    sys.exit(main())
