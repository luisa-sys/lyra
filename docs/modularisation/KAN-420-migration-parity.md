# KAN-420 — R5 Spike: migration parity + out-of-band DDL

**Epic:** KAN-414 (modularisation scoping) · **Feeds:** F6 (generated `Database` types), F7 (reconciliation), KAN-415 C3 (table-ownership gate), KAN-421/R6 (profiles ADR)
**Run:** 2026-07-27, Modularisation Scoping routine · read-only (`list_migrations`, `list_tables`, `get_advisors`, SELECT-only `execute_sql`). **Zero writes were made to any environment.**
**Measured at:** lyra `55cb77609fbb` (develop) · dev `ilprytcrnqyrsbsrfujj` · staging `uobmlkzrjkptwhttzmmi` · prod `llzkgprqewuwkiwclowi`

---

## 1. Executive summary

1. **The live schemas are far closer to parity than the migration histories suggest.** A full object-level fingerprint diff (columns, RLS state, policies, indexes, function bodies + ACLs, triggers, view definitions, enums — §4) shows staging ≡ prod on every function, and **all 21 apparent function differences across the three environments collapse to formatting/whitespace or error-message text** introduced by same-name-different-text migration applications. There is **no semantic function drift** anywhere.
2. **Two real schema-drift legs exist, one of them security-relevant:**
   - **Prod is missing KAN-143 + KAN-153 entirely**: no `draft` label in `visibility_level`, and no `phone_search_hash` / `postcode_search_hash` / `discoverable_by_phone` / `discoverable_by_postcode` columns (nor their two indexes) on `profiles`. Consequence: the SECURITY DEFINER RPC `public.search_by_contact_hash` — present and `authenticated`-executable on prod with a body **identical to dev's** — references columns that do not exist on prod, so every prod invocation errors; and the profile wizard's default/fail-closed visibility value `'draft'` (`src/app/dashboard/profile/visibility.ts`) is not a valid enum label on prod's database, which `beta.checklyra.com` shares. Raised as **SEC-107** (see §8).
   - **Dev is missing BUGS-62** (`gathering_invite_messages.claimed_at` + its index): the migration file is in git and applied on staging + prod, never on dev — promotion ran *backwards* past dev.
3. **The three "out-of-band" objects are not out-of-band to the databases — only to git.** `content_moderation_flags`, `mcp_tool_call_log` and `mcp_per_ip_recent_count` were applied to **all three** environments as tracked migrations (`kan_244`, `kan_232`, `kan_245`) that were never committed to `supabase/migrations/`. Their live DDL is **byte-identical across all three environments** (fingerprint-equal on columns, constraints, indexes, policies, ACLs and view definition). Draft reconstruction migrations, including RLS and grants, are in `docs/modularisation/drafts/` (§6).
4. **The four-way parity matrix** (git ↔ dev ↔ staging ↔ prod, §5) has 91 distinct migration names: 55 in full parity, 20 explained (squashes, known artifacts, uncommitted-but-applied-everywhere), and 16 needing classification — of which only the two legs above are real schema drift; the other 14 are **history hygiene** (DDL provably present, history row absent or vice versa).
5. **Monotonicity check** specified with test cases (§7) — implementable now for F7; it would have caught every drift leg found here before it reached an environment.

## 2. Reproduction commands

Every number in this artefact is reproducible:

| What | How |
| --- | --- |
| Applied migrations per env | Supabase MCP `list_migrations` on each project id; capture committed at `data/kan420-applied-migrations.json` |
| Parity matrix | `python3 docs/modularisation/kan420-parity.py` → regenerates `data/kan420-parity-matrix.md` from the capture + `supabase/migrations/` |
| Schema fingerprints | The single aggregated SQL in §4.1, run via SELECT-only `execute_sql` on each project; dev capture committed at `data/kan420-fingerprint-dev.json` |
| Function semantic diff | §4.2 whitespace-normalised md5 (`md5(regexp_replace(lower(pg_get_functiondef(oid)), '\s', '', 'g'))`) over the 21 raw-differing functions |
| Out-of-band DDL | §6 queries (information_schema + pg_constraint/pg_indexes/pg_policies/pg_class/pg_get_viewdef) |
| Advisors | `get_advisors(type: security)` on all three projects, 2026-07-27 (§8.2) |

## 3. Migration identity: name, not version — and the alias problem

Version-ids are per-environment (each env re-timestamps on apply), so identity is the migration **name** (as `docs/MIGRATION_PARITY.md` established). This spike found a second identity wrinkle: **git filenames and applied names disagree** for 21 early migrations (e.g. git `20260514054350_profile_items_visibility.sql` ↔ applied `kan_143_profile_items_visibility`). The curated alias map lives in `kan420-parity.py` (`ALIASES`), one reviewable line per pairing, justified by same-day timestamps + DDL fingerprint equality.

**Rule going forward (input to F7):** the git filename stem after the timestamp must *be* the applied migration name, verbatim. Any rename breaks the only cross-env identity we have.

## 4. Live-schema diff (the ground truth)

### 4.1 Method

One aggregated fingerprint query per environment producing `~238` rows of `(object-key, md5)` pairs over: `information_schema.columns` per table; `pg_class` relkind+RLS-flag+ACL per relation; `pg_policies` per table; `pg_indexes` per table; `pg_get_functiondef` + `proacl` per function; `pg_get_triggerdef` per table; `pg_get_viewdef` per view; `pg_enum` labels per enum. Dev capture: `data/kan420-fingerprint-dev.json` (the exact SQL is embedded in that file's sibling — see git history of this PR for the query text; it is also reproduced in the PR description).

### 4.2 Results

**Identical across all three environments** (fingerprint-equal): every table's columns *except* the three below; every RLS enable-flag and table ACL; every RLS **policy** on every table (including `profiles`, `profile_items`, `moderation_logs`); every index set except the two below; all enums except `visibility_level`; both view definitions; all trigger sets.

**Real differences:**

| Object | dev | staging | prod | Verdict |
| --- | --- | --- | --- | --- |
| `profiles` columns | 41 cols | ≡ dev | **37 cols — missing `phone_search_hash`, `postcode_search_hash`, `discoverable_by_phone`, `discoverable_by_postcode`** | **DRIFT (prod)** — KAN-153 never applied. SEC-107 |
| `profiles` indexes | 9 | ≡ dev | **7 — missing the two `*_search_hash_idx`** | same root cause |
| `enum visibility_level` | `public,members_only,private,draft,tribe_only` | ≡ dev | **no `draft`** | **DRIFT (prod)** — KAN-143 never applied. SEC-107 |
| `gathering_invite_messages` | 10 cols | 11 cols (`+claimed_at`) | ≡ staging | **DRIFT (dev)** — BUGS-62 in git, applied stg+prod, never dev |
| `profile_manual_of_me` | 9 cols, BUGS-74 order | ≡ dev | same 9 cols, **different column order** | benign — prod created via `kan154_kan263` squash; types/nullability identical |
| `fn e2e_fix_auth_tokens` | present | present | **absent** | intentional (E2E helper); no history row anywhere (§5) |

**Function bodies.** 21 functions differ by raw `pg_get_functiondef` md5 somewhere. After whitespace-normalisation: staging ≡ prod on all 21; dev differs from staging/prod on 7. After full whitespace-stripping: dev differs on **2**. Manual inspection of both:

- `tribe_members_enforce_same_owner` — same enforcement logic; dev's exception messages include the offending ids, staging/prod's don't. **Semantically equivalent control.**
- `oauth_clients_set_updated_at` — identical body; `search_path=''` on dev vs `search_path='public'` on staging/prod (dev is the stricter setting; non-SECURITY-DEFINER trigger).

So the moderation hash-chain family (SEC-64: `moderation_log_row_hash`, `moderation_logs_hash_chain`, `moderation_logs_forbid_mutation`, `verify_moderation_log_chain`), `record_erasure_obligation` (SEC-75), `security_invariants_report`, the convene-vault trio, and every other raw-differing function are **formatting-only** divergences. Root cause: the same logical migration was applied to different envs from different text (granular vs squash, re-typed SQL) — proof that *same name ≠ same DDL text* today, which the monotonicity check (§7) must close.

**ACL/grant diff: none.** Every function ACL and every table ACL is identical across the three environments (this includes the 21-item grandfathered `EXECUTE`-to-PUBLIC baseline of gotcha #26 — equally present everywhere, no new instances).

## 5. Four-way parity matrix

Generated table: `data/kan420-parity-matrix.md` (91 names; 55 OK, 20 EXPLAINED, 16 DRIFT). The 16 DRIFT rows, classified against the live-schema evidence in §4:

### 5.1 Real schema drift (2)

| Name | Situation | Reconciliation (F7) |
| --- | --- | --- |
| `kan_143_profile_items_visibility` + `kan_153_phone_postcode_search` | git+dev+staging ✓, **prod ✗ — history AND DDL absent** | Apply both to prod (additive: enum value + 4 columns + 2 partial indexes). Until then, promoting current app code to prod ships broken `'draft'` writes; `search_by_contact_hash` is already broken on prod. **SEC-107** |
| `bugs62_convene_invite_atomic_claim` | git+staging+prod ✓, **dev ✗ — history AND DDL absent** | Apply to dev (file already in git). Dev is currently *behind* prod here, inverting every assumption the pipeline makes |

### 5.2 History gaps — DDL present, history row missing (11)

DDL presence proven by the §4 fingerprints in every case:

- **Applied everywhere, no history row in any env, git file exists:** `add_api_keys`, `add_plays_category` (enum `plays` present in all 3), `bugs60_grant_admin_rpc_authenticated` (admin fn ACLs identical everywhere), `raise_pcs_cap_to_10` (`enforce_pcs_cap` identical everywhere), `e2e_fix_auth_tokens_fn` (present dev+staging, intentionally absent prod). These were applied via `execute_sql`/SQL-editor rather than `apply_migration` — the SEC-42 pathway.
- **Dev missing the history row but has the DDL:** `homepage_example_profiles` (cols+fn+trigger identical on dev — and note it reached staging/prod *first*, violating dev-first).
- **Staging missing history rows but has the DDL via its `kan349_404_promote_batch_staging` squash:** `kan263_about_me_fields`, `kan263_affiliation_show_on_profile`, `kan339_scrub_postcode`, `kan345_dashboard_widget_state`, `sec45_profile_items_public_read_visibility` (staging `profiles` cols and `profile_items` policies are fingerprint-equal to dev).

### 5.3 Squash-covered (3)

`kan263_favourites_categories` (staging squash), `kan_154_manual_of_me` (prod `kan154_kan263` squash; column-order-only residue). Both verified DDL-equal.

### 5.4 Other history findings

- **Prod applied `bugs69_revoke_global_feature_switch_trigger_exec` twice** (2026-07-24 and 2026-07-25) — idempotent so harmless, but double-apply means the promote process re-ran a migration it had already recorded.
- `sec75_moderation_actor_anonymise` remains a dev **HISTORY-ARTIFACT** (reverted DDL, surviving history row) — unchanged from `docs/MIGRATION_PARITY.md` §4.
- Names applied on all three envs with **no git file at all**: `fix_security_advisories_and_rls_performance`, `sec_01_bugs24_*`, `sec_03_bugs25_*`, `revoke_secdef_exec_bugs44_v2_public`, plus the out-of-band trio (§6). The git directory describes **75** of the **91** names that exist in the world.

## 6. Out-of-band objects: captured DDL + draft reconstructions

`kan_244_content_moderation_flags`, `kan_232_mcp_tool_call_log`, `kan_245_mcp_tool_call_log_retention` are applied-and-tracked in all three environments but have no git file. Captured DDL (2026-07-27, dev; **fingerprint-identical on staging and prod** for every component — cols `e3faa989`/`5135c8f6`, idx `d2ed5ab4`/`e4ec7b17`, pol `2de1d5e2`/—, ACL `b94ca830`, viewdef `5af567fd` in all three):

- `content_moderation_flags` — 8 cols, FK→profiles ON DELETE CASCADE, severity/source CHECKs, 200-char snippet CHECK, 2 secondary indexes, RLS **enabled** with one SELECT policy (`own_flags_select`, owner-scoped via `auth.uid()`), full-table grants to anon/authenticated/service_role (RLS is the actual gate).
- `mcp_tool_call_log` — 7 cols, PK only, 2 secondary indexes (`ip,ts desc` / `tool,ts desc`), RLS **enabled with zero policies** (deny-all; service_role bypasses), same grant pattern.
- `mcp_per_ip_recent_count` — 1-hour rolling per-IP count view over `mcp_tool_call_log`, **`security_invoker=on`**, grants to postgres+service_role only (no anon/authenticated).

Draft idempotent reconstruction migrations — **including RLS and grants** — are committed under `docs/modularisation/drafts/` (deliberately NOT `supabase/migrations/`, so nothing auto-applies them):

- `drafts/kan420_reconstruct_content_moderation_flags.sql`
- `drafts/kan420_reconstruct_mcp_tool_call_log.sql` (table + retention comment)
- `drafts/kan420_reconstruct_mcp_per_ip_recent_count.sql`

**Verification protocol (F7, not performed in this read-only spike):** apply each draft to a fresh Supabase **branch** of dev, then run the §4.1 fingerprint query on branch vs dev and require md5 equality on every row for the three objects. This spike could not create branches (read-only mandate); the drafts are evidence-derived but **unproven by schema diff** until F7 runs that step. This is the one acceptance criterion left open — flagged in the Jira comment.

## 7. Monotonicity check — specification (for F7)

**Name:** `scripts/check-migration-monotonicity.py` (+ `.github/workflows/db-invariants.yml` step alongside `check-db-invariants.py`).

**Inputs:** `supabase/migrations/` (git); `list_migrations` output per env (dev, staging, prod), fetched by the workflow via the Supabase management API with read-only credentials.

**Asserts, per environment:**
1. **Prefix rule** — the env's applied names, restricted to names that exist in git, must form a *contiguous prefix* of git's timestamp-ordered list (staging/prod may lag dev; nothing may be skipped). A name applied while an older git name is unapplied in that env → FAIL.
2. **Chain rule** — `applied(prod) ⊆ applied(staging) ⊆ applied(dev)` (modulo an explicit, reviewed allowlist for env-intentional items, seeded with `e2e_fix_auth_tokens_fn`; shrink-only, same ratchet pattern as `migration-privileges-baseline.json`).
3. **Identity rule** — every git filename stem equals its applied name (kills the alias problem, §3).
4. **Text rule** — store `md5(file_text)` at apply time (a `migration_checksums` note table or workflow artifact); a same-name-different-text application → FAIL. Closes the §4.2 formatting-drift generator.
5. **History honesty** — a name applied in any env with no git file → FAIL (forces the §5.2/§5.4 backlog to zero and keeps it there).

**Failure mode:** exit 1 with a per-env, per-name report; never a silent pass — an unreachable env is `UNVERIFIED` (exit 1), per the Workflow & Backup Integrity Policy.

**Test cases (`tests/scripts/check-migration-monotonicity.test.js`), all against fixture JSON, no live DB:**
- in-order applied set == git prefix → PASS
- git gains a migration timestamped *before* an already-applied one, env applies it → FAIL (out-of-order insert)
- env missing a middle migration while having a later one → FAIL (the kan_143/kan_153 prod case — regression fixture taken verbatim from `data/kan420-applied-migrations.json`)
- downstream env has a name upstream lacks → FAIL (the bugs62 dev case, likewise a real fixture)
- name in env history absent from git → FAIL (the `kan_232` case)
- allowlisted env-intentional name → PASS with notice
- fetch failure for one env → UNVERIFIED exit 1, other envs still reported

Prevention linkage (SEC-101): this check is the control for SEC-107 and should be registered in `controls/registry.json` with SEC-107 in its `prevents` list when F7 lands it, with a mutation proof (temporarily hide `kan_153` from a fixture env → check must go red).

## 8. Security review

### 8.1 Findings

- **SEC-107 (raised by this spike): prod schema lacks KAN-143/KAN-153 while prod code-objects and app code reference them.** Details in the ticket; evidence is §4.2 + §5.1. Severity: High (broken `authenticated`-callable SECURITY DEFINER RPC on prod; `'draft'` visibility writes will fail on beta/prod once current app code promotes — and `beta.checklyra.com` already runs against this database).
- **No cross-env grant/ACL/RLS-policy drift found** — an explicitly good result: the nine-times-regressed EXECUTE-grant class (gotcha #26) is currently *uniform* across environments.
- **Advisor sweep (2026-07-27):** dev = staging = 7 INFO (`rls_enabled_no_policy` on service-role-only tables: `erasure_obligations`, `mcp_tool_call_log`, 4× oauth, `rate_limits`) + 3 WARN (`authenticated`-executable SECURITY DEFINER: `admin_filter_profile_ids`, `admin_list_users` — both known-intentional in-body-auth, BUGS-60 — and `search_by_contact_hash`). Prod = same 7 INFO + only the 2 admin WARNs: **the advisor does not flag `search_by_contact_hash` on prod despite an identical ACL** (function+ACL fingerprint `3939d087…` equal in all three envs). Advisor blind spot worth knowing about; recorded here rather than ticketed.
- No secrets, keys or user data were read; all queries were catalog-level.

### 8.2 Threats introduced by this artefact

None to the running system (docs + data + drafts only; drafts live outside `supabase/migrations/`). The committed capture contains schema metadata only.

## 9. Recommended reconciliation sequence for F7 (additive-first, prod last)

1. **Dev:** apply `bugs62_convene_invite_atomic_claim` from git (additive column+index). Clean the `sec75_moderation_actor_anonymise` history artifact. Backfill dev's missing `homepage_example_profiles` history row (or re-record the squash equivalence in the allowlist).
2. **Git:** commit the three reconstruction migrations (from `drafts/`, after branch-verification per §6), plus files for the four no-file-anywhere names (§5.4) or record them in the seed allowlist; rename nothing — adopt the identity rule (§3).
3. **Staging:** no schema action required (fingerprint-parity with dev except items riding normal promotion); backfill or allowlist the five §5.2 staging history rows.
4. **Prod (last, each step additive and separately reviewed):** apply `kan_143` (enum value — irreversible-by-design, note rollback limitation in the migration comment), then `kan_153` (4 columns + 2 indexes). Re-run the §4.1 fingerprint to confirm `profiles`/`visibility_level` equality, which also un-breaks `search_by_contact_hash` (SEC-107's acceptance evidence).
5. **Land the monotonicity check (§7)** and register it as the SEC-107 prevention control. Only after it is green across all three envs should KAN-415's table-ownership gate (C3) trust `supabase/migrations/` as a source of truth.
6. **F6 (generated `Database` types)** must generate from **dev after step 1**, not from git, until step 2 closes the gap.

## 10. Architecture impact

- `docs/MIGRATION_PARITY.md` updated (prod leg + git↔DB reconciliation follow-up now measured; pointer here).
- No env vars, no dependencies, no schema change (read-only spike).
- Wiki: the Confluence *Data Model & Security* page should gain a pointer to this artefact when F7 lands (deferred with the epic's Documentation DoD; no service/table/route changed by this PR).
