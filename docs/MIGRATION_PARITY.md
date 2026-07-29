# Migration Parity & Promotion Discipline (SEC-8 / OPS-04)

> **2026-07-27 update (KAN-420): the prod leg and the git↔DB reconciliation are now measured.**
> The four-way matrix (git ↔ dev ↔ staging ↔ prod), a full live-schema fingerprint
> diff of all three projects, captured DDL for the three out-of-band objects, and
> the monotonicity-check specification live in
> `docs/modularisation/KAN-420-migration-parity.md` (+ `data/kan420-*.json`,
> regenerable via `docs/modularisation/kan420-parity.py`). Headlines: staging ≡ prod
> on every function; **no semantic function drift anywhere**; real schema drift is
> exactly two legs — **prod is missing KAN-143 + KAN-153** (SEC-107: breaks the
> `search_by_contact_hash` SECURITY DEFINER RPC on prod and the `'draft'`
> visibility value on beta/prod) and **dev is missing BUGS-62** (`claimed_at`).
> The "SQUASH — verify DDL at next promote" items in §1 below are now verified
> DDL-equal (formatting-only text drift). The prod leg of "Deferred to Luisa"
> below is superseded by the KAN-420 artefact; the OAuth promote/quarantine
> decision (criterion 2) remains open — `oauth_2_1_server` is confirmed applied
> on all three environments with fingerprint-equal tables, so the remaining
> decision is product-level, not schema-level.

**Status:** dev↔staging baseline established 2026-07-12 (autopilot, SEC-8).
**Owner:** SEC-8 (`https://checklyra.atlassian.net/browse/SEC-8`), risk-register OPS-04.
**Scope of this doc:** the dev↔staging leg of SEC-8 acceptance criterion 1 (schema-diff, differences catalogued) and criterion 3 (the written promotion rule). The **prod** leg of the three-way diff and the **dev-only OAuth-server promote/quarantine decision** (criterion 2) are deliberately **out of scope here** — they require prod DB access and a Luisa decision (see "Deferred to Luisa" below).

---

## Why this exists

Migration **version-ids diverge per environment** because each env has been squashed/renamed independently, so id-matching is unreliable. The reliable key for cross-env comparison is the migration **name**. As of 2026-07-12 the applied-migration counts were:

| Environment | Supabase project | Applied migrations | In autopilot bounds? |
|---|---|---|---|
| dev-lyra | `ilprytcrnqyrsbsrfujj` | 73 | yes (read+write) |
| stage-lyra | `uobmlkzrjkptwhttzmmi` | 61 | yes (read+write) |
| prod-lyra | `llzkgprqewuwkiwclowi` | (not queried) | **no — read-only-by-Luisa** |

The `supabase/migrations/` git directory currently holds **63** `.sql` files, which matches neither live count — so there is also a **git↔DB** divergence (see "Follow-ups").

## Method

`list_migrations` was run against dev and staging (read-only). Names were diffed. Each difference is classified as one of:

- **SQUASH** — expected; the same DDL exists on both sides but under a different granularity/name (one env applied a squashed promote-batch, the other the granular originals). Verify DDL-equal at the next promote; not a defect on its own.
- **DEV-AHEAD** — a migration on dev not yet promoted to staging. Expected *only if* it is newer than staging's tip; a defect if older migrations are missing while newer ones are present (non-monotonic promotion).
- **STAGING-ONLY** — a name present on staging but absent on dev; verify the resulting columns/objects also exist on dev under some other migration.
- **HISTORY-ARTIFACT** — a migration-history row that does not reflect live DDL (e.g. a reverted change), needing history cleanup.

---

## Catalogue (dev↔staging, 2026-07-12)

### 1. SQUASH — expected, verify DDL at next promote

| dev name(s) | staging name | Note |
|---|---|---|
| `create_lyra_schema` | *(folded into staging baseline; staging history starts at `fix_security_advisories_and_rls_performance`)* | Initial-schema baseline differs; verify base tables identical. |
| `profile_redesign_favourite_categories`, `affiliation_description`, `kan263_about_me_fields`, `kan263_affiliation_show_on_profile`, `kan263_favourites_categories` | `kan263_profile_redesign` | Dev applied the KAN-263 redesign granularly; staging as one squash. |
| `convene_spike_oauth` + `drop_convene_spike` | `convene_vault_helpers` | Divergent Convene-vault bootstrap. Dev spiked then dropped; staging used vault helpers. Verify `convene_vault` objects match. |
| *(granular KAN-349/404 originals on dev)* | `kan349_404_promote_batch_staging` | Staging carries the promote-batch squash; dev the originals. See §2 — the squash does **not** cover everything dev has. |

### 2. DEV-AHEAD — **non-monotonic promotion (genuine drift, needs attention)**

Staging is **missing** these dev migrations even though staging has *newer* migrations applied — i.e. promotion has not been a clean cutline:

| Missing on staging | dev version | Age vs staging tip |
|---|---|---|
| `kan339_scrub_postcode` | 20260630 | **older** than staging's newest (20260712) |
| `kan345_dashboard_widget_state` | 20260630 | **older** |
| `sec45_profile_items_public_read_visibility` | 20260704 | **older** |
| `sec54_sec56_bugs65_secdef_rls_grant_batch` | 20260704 | **older** |
| `sec64_moderation_logs_hash_chain` | 20260707 | **older** |

…while staging **does** already have `sec62_oauth_rate_limit_store` (20260708), `sec74_affiliate_clicks_retention_purge` (20260712), `sec75_erasure_obligations` (20260712) and `sec76_oauth_clients_is_first_party` (20260707). **Finding:** migrations reached staging out of order / selectively. This is exactly the OPS-04 risk — an env-only or skipped promotion leaves staging schema neither equal to dev nor a clean prefix of it. Most of the missing set is the KAN-349/404 + security batch tracked by **queue row #11** (blocked promote); reconciling it is part of that promote, but the presence of *newer* migrations on staging means the batch must be applied carefully (idempotent / ordered) rather than assumed to be a tail-append.

### 3. STAGING-ONLY — verify dev parity

| Staging name | dev equivalent? |
|---|---|
| `homepage_example_profiles` | No migration of this name on dev. Dev references `is_homepage_example` (KAN-334) — verify the column/objects exist on dev under another migration; if not, this is real drift to reconcile. |

### 4. HISTORY-ARTIFACT — dev history-vs-DDL cleanup

| dev name | Issue |
|---|---|
| `sec75_moderation_actor_anonymise` (20260712112824) | The 2026-07-12 09:3x SEC-75 anonymisation attempt was **reverted** at the DDL level (see SEC-75 / ledger), but the migration-history row persists on dev. Dev's applied-migration history therefore lists a migration whose DDL is no longer present. Clean up the dev migration-history entry (or re-baseline) so history reflects live schema; do **not** propagate this name to staging/prod. |

---

## The written rule (SEC-8 acceptance criterion 3)

**Every schema change promotes dev → staging → prod with a consistent migration identity, in order. No env-only or out-of-order changes.**

1. A schema change is authored once, as a migration file in `supabase/migrations/`, and applied to **dev first**.
2. It reaches **staging** only via the normal promote path, and **prod** only via `promote-to-production.yml` — never by a direct `apply_migration` that skips an upstream env.
3. Promotion is **monotonic**: do not apply a newer migration to staging/prod while an older one is still unapplied there. If a squash is used for a promote batch, the squash must be DDL-equivalent to the full set of granular migrations it replaces.
4. A reverted migration must have its **history row removed on every env it touched** (or be superseded by an explicit down-migration), so applied-history always reflects live DDL.
5. New migrations are **named** descriptively (`<ticket>_<what>`); the name — not the timestamp — is the cross-env identity used for parity checks.
6. Re-run this dev↔staging parity check (and, when Luisa is available, the prod leg) **before any promote wave** and record the result on SEC-8.

---

## Deferred to Luisa / out of autopilot bounds

- **Prod three-way DDL diff.** The autopilot must not query or write the prod DB. Luisa (or a supervised session) should run `list_migrations` + a DDL diff against `prod-lyra` and fold the result into §1–§4 to complete SEC-8 criterion 1.
- **Dev-only OAuth 2.1 server — promote or quarantine (criterion 2).** `oauth_2_1_server` exists on dev (20260517) and staging (20260628) but its prod status is unverified; the decision to promote the full OAuth token-table set to prod (or quarantine it) is a release/architecture call, coordinated with SEC-01/SEC-46. Not an autopilot decision.

## Follow-ups (not blocking)

- **git↔DB reconciliation.** 63 git migration files vs 73 dev-applied vs 61 staging-applied. Some git files (e.g. `add_plays_category`, `raise_pcs_cap_to_10`, `e2e_fix_auth_tokens_fn`) and some dev-applied names do not line up 1:1. A separate reconciliation of `supabase/migrations/` git vs each live DB would close the audit loop; scope it as its own slice.
- Consider a lightweight CI/script parity check that fails when a migration name is applied to a downstream env while an older name is still unapplied there (encodes rule §3).
