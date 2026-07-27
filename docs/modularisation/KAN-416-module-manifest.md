# KAN-416 — Module manifest & dependency matrix (R1)

**Spike · research artefact · read-only · epic KAN-414**
**Produced:** 2026-07-27 · **Base:** `develop@a42ad84` · **Files in `src/`:** 272

> **What this is.** The first machine-readable declaration of the 20-module
> architecture adopted in epic KAN-415: what each module owns (files, tables,
> `profiles` columns), its **measured** public API, its measured and allowed
> dependencies, and the seed of the shrink-only `.boundaries-allowlist.json`.
>
> **Deliverables:**
> - `modules.json` (repo root) — the v0 manifest, input to KAN-415 C1–C5.
> - `docs/modularisation/KAN-416-boundaries-allowlist.seed.json` — every
>   currently-violating edge, with counts. This is the number the ratchet
>   drives to zero.
> - `docs/modularisation/kan416-derive.py` — the derivation script. Every
>   number in this artefact is reproduced by re-running it.
>
> **Reproduce everything with:**
> ```bash
> python3 docs/modularisation/kan416-derive.py       # regenerates modules.json + seed + report
> npx madge --json --extensions ts,tsx --ts-config tsconfig.json src   # canonical graph
> ```

---

## 0. Headline

| Measure | Value |
|---|---:|
| `src/` files claimed by exactly one module | **272 / 272** (0 unclaimed, 0 double-claimed) |
| Internal TS import edges (parser) | **524** — reconciles exactly with madge's 525 (the extra madge edge is `layout.tsx → globals.css`, a CSS node) |
| madge graph at this base | **273 nodes / 525 edges** (identical to the 2026-07-26 survey) |
| Cross-module edges | **213** (311 intra-module) |
| Measured public-API entries (symbols consumed across a module boundary) | **104** |
| **Policy-violating edges → allowlist seed** | **34 edges across 17 module pairs** (8 type-only) |
| `.from()` sites / `.rpc()` sites / distinct tables | **277 / 14 / 33** — every table and rpc has exactly one declared owner |
| Cross-module table-access sites (data-boundary seed) | **55 sites over 39 (module, table) pairs** |
| `createServiceRoleClient` importer files (RLS bypass register) | **39**, enumerated per module in `modules.json → serviceRoleClient` |
| `profiles` columns assigned an owner (dev schema) | **41 / 41**, no duplicates |
| Unit suite on this branch | **216 suites / 2552 tests green** (floor 172 / 2118) via `npm run test:unit` |

Only **34 of 213** cross-module edges violate the proposed layer policy — the
matrix is near-green, confirming the survey's "already horizontally modular"
finding at manifest granularity.

---

## 1. ⚠️ Provenance caveat — the plan document was not accessible

`LYRA_MODULARISATION_PLAN_2026-07-26.md` (§3 module definitions, §5
change-process table) exists only in the founder's working folder. It is in
none of the three repos, not on Confluence, and not attached to any KAN-414
ticket (verified by repo find, GitHub org-wide code search, Confluence CQL and
Jira attachment check, 2026-07-27).

Consequences, handled as follows:

1. **Module set and layering** were taken from the epic KAN-415 description
   ("The module set (20 + 2 meta)"), which is authoritative Jira text.
2. **Path→module assignments** are this spike's proposal. Every assignment not
   directly dictated by the epic text is marked `JUDGEMENT` in
   `kan416-derive.py` and listed in §6 below.
3. **Ticket step 5 (sanity-check against the plan's §5 change-process table)
   could not be performed.** This is the one implementation step not done.
4. **Founder action requested:** commit the plan into `docs/modularisation/`
   (it is the source of truth for two epics and currently has no backup,
   no CI visibility, and no agent access), then diff `modules.json` against
   §3/§5 before KAN-415 C1 consumes it.

---

## 2. The 20 modules — measured summary

Full detail (per-symbol public API with consumer counts, table lists, column
lists): `modules.json`. Provisional test floors are path-vote based and will be
superseded by KAN-417.

| Module | Layer | Files | Public-API symbols | May depend on (measured, policy-clean) | Violating deps (→ §4) | Risk tier | Tests (prov.) |
|---|---:|---:|---:|---|---|---|---|
| platform | 0 | 6 | 9 | — | — | critical | 0f/0t |
| contracts | 0 | 0 | 0 | — (bootstraps from `content-moderation.ts`) | — | high | 0f/0t |
| guards | 1 | 9 | 20 | platform | — | high | 3f/59t |
| observability | 1 | 4 | 3 | platform | — | medium | 1f/3t |
| ui-kit | 1 | 1 | 1 | — | — | low | 1f/9t |
| access | 2 | 10 | 10 | guards, platform | **admin** | critical | 0f/0t |
| features | 2 | 5 | 17 | platform | — | high | 0f/0t |
| age | 2 | 12 | 10 | platform | auth, features | critical | 0f/0t |
| oauth-as | 3 | 18 | 0 | access, guards, platform | — | critical | 4f/41t |
| auth | 3 | 11 | 2 | access, age, platform | — | high | 5f/51t |
| profile | 3 | 35 | 4 | age, features, guards, platform | affiliate, convene, trust-safety | high | 21f/296t |
| public-profile | 3 | 8 | 0 | guards, platform, ui-kit | affiliate, profile, recommendations | medium | 8f/50t |
| dashboard | 3 | 9 | 0 | access, platform | auth, convene | medium | 4f/30t |
| account | 3 | 6 | 0 | access, features, guards, platform | admin | high | 2f/24t |
| convene | 3 | 52 | 2 | access, features, guards, platform | recommendations, trust-safety | high | 11f/164t |
| recommendations | 3 | 20 | 9 | features, platform | affiliate | medium | 2f/3t |
| affiliate | 3 | 8 | 13 | features, platform | — | medium | 0f/0t |
| trust-safety | 3 | 9 | 2 | platform | admin, convene | critical | 2f/27t |
| marketing-legal | 3 | 28 | 0 | access, features, guards, platform | — | medium | 14f/216t |
| admin | 4 | 21 | 2 | access, affiliate, features, observability, platform | — | critical | 1f/8t |

Observations that matter for extraction sequencing:

- **Five modules have a measured public API of zero** — `oauth-as`,
  `public-profile`, `dashboard`, `account`, `marketing-legal`. Nothing outside
  them imports their code. They are pure leaf segments and their extraction
  carries no barrel-design risk at all. (This strengthens the KAN-415 choice of
  `oauth-as` as the pilot.)
- **`guards` (20) and `features` (17) have the largest consumed surfaces** —
  their `index.ts` design is where the "export exactly what is measured"
  discipline matters most.
- **`convene` is the largest module (52 files)**; `profile` second (35).
- `admin`'s public API of 2 is exactly the defect: nothing should import from
  admin (see §4).

---

## 3. The measured public API

`modules.json → modules.<name>.publicApi` lists, for every module, each
symbol another module imports today: the symbol, its defining file, the
number of importing files, the consuming modules, and whether every consuming
import is type-only. 104 entries total. Per the ticket's constraint, this list
was **derived, not designed** — an `index.ts` that exports exactly these
symbols changes zero semantics.

Notable: 8 of the 34 violating edges are **type-only** (e.g. most of the
`convene → recommendations` venue-scoring types) — those can be cleared by
moving type declarations, with no runtime change.

---

## 4. Dependency matrix, policy, and the allowlist seed

Policy encoded: numeric layers (platform/contracts 0 · guards/observability/
ui-kit 1 · access/features/age 2 · domains 3 · admin 4); an edge is allowed iff
its target sits on a **strictly lower** layer. Same-layer and upward edges are
violations. The full matrix (59 measured module pairs) is in the derivation
report; the 17 violating pairs with per-file edge lists are in
`KAN-416-boundaries-allowlist.seed.json`.

**The seed = 34 edges.** The known survey defects fall out of the data
mechanically, which validates the pipeline:

| Seed entry | Corresponds to |
|---|---|
| `access → admin` (2 edges: `lib/beta-access/flow.ts`, `app/waitlist/actions.ts` → `app/admin/users/users-actions-shared.ts`) | **The** wrong-direction lib→app edge + one cross-segment edge (KAN-424 / F2) |
| `age → auth` (1) against `auth → age` (4) | The single group-level type-only cycle (KAN-424 / F2) |
| `public-profile → profile` (2), `dashboard → auth` (1) | The remaining cross-segment app→app edges (KAN-424 / F2) |

Beyond the known defects, the seed surfaces **four design decisions** the
plan/founder must make (each currently generates violations that may instead be
legitimised as `mayDependOn`):

1. **`lib/admin.ts` may be mis-homed.** It is claimed by `admin` (name-based),
   but `trust-safety` (`api/reports`) and `account` (settings actions) import
   it — producing 2 upward edges. If `lib/admin.ts` is really an
   *admin-privilege check* (not admin UI), it belongs in `access`, which clears
   both violations and matches its survey fan-in of 17.
2. **Moderation write-path coupling is structural, not accidental.**
   `profile → trust-safety` (3) and `convene → trust-safety` (2) are content
   modules calling `moderation-audit`/`moderation-policy` on write. Options:
   demote trust-safety's *pure rule* part into `@lyra/contracts` (it already
   seeds it via `content-moderation.ts`), or place trust-safety on the access
   core layer. Leaving it as an allowlist entry forever would be wrong.
3. **The recommendations/affiliate chain.**
   `public-profile → recommendations` (6), `recommendations → affiliate` (4),
   `profile/public-profile → affiliate` (3) form a coherent one-way chain
   (render profile → recommend → monetise links). A plausible fix is declaring
   `affiliate` a dependency of `recommendations` (sub-layer), and exposing
   recommendations to `public-profile` via its index — i.e. legitimise the
   chain rather than allowlist it.
4. **`lib/convene/flags-user.ts` is consumed by dashboard and profile** (the
   "is Convene enabled for this user" check). That belongs in `features`
   (per-user entitlement), not convene internals.

**Recommendation:** treat the 34-edge seed as the ratchet starting number, but
resolve decisions 1–4 *before* freezing `mayDependOn` — each converts several
allowlist entries into intended architecture.

---

## 5. The data boundary

- **277 `.from()` + 14 `.rpc()` sites; 33 distinct tables; every table and rpc
  has exactly one declared owner** (`modules.json → meta."db/schema"`).
  Naming trap made explicit: `oauth_connections` / `oauth_connect_state`
  belong to **convene** (calendar-provider OAuth), *not* `oauth-as`.
- **`profiles` at column granularity: all 41 dev-schema columns assigned**,
  with the security-load-bearing set placed per the ticket: access-model
  columns (`user_status`, `access_tier`, `is_suspended`, `is_admin`,
  `suspended_at`, `suspension_reason`, `beta_*`) → `access`; verification
  columns (`age_status`, `age_checked_at`, `age_provider`, `age_provider_ref`,
  `age_declared_18_at`) → `age`. Note `age_range` is assigned to **profile**
  deliberately — it is a display attribute, not a verification datum.
- **55 cross-module table-access sites over 39 pairs** (the data-boundary
  analogue of the allowlist seed; enumerated in the seed JSON). Two dominant
  patterns:
  - `admin` reading trust-safety/features/profile tables (17 sites) — expected
    for a backoffice; the KAN-415 data gate will need an explicit admin read
    posture rather than 17 exemptions.
  - **`account` touches 15 tables across five modules** — this is the GDPR
    export/erasure path in settings. A module-per-table gate cannot ship
    without deciding how data-subject-rights code enumerates other modules'
    data (candidate: each module exposes an `exportForUser`/`eraseForUser`
    contract; `account` orchestrates). Flagged for the KAN-415 design and for
    KAN-421 (profiles ADR).
- **Service-role register (ticket §4):** 39 files across 13 modules import
  `createServiceRoleClient` today; the full per-module file list is embedded in
  `modules.json → serviceRoleClient.measuredImporters` so later gates diff
  against a recorded baseline instead of re-deriving privilege. (Survey said
  40 at `ee647e6`; 39 is the measured value at this base.)

---

## 6. JUDGEMENT assignments needing a plan-§3 diff

Marked in `kan416-derive.py`; the significant ones:

| Assignment | Rationale | Alternative |
|---|---|---|
| `json-ld.ts` → guards | output-encoding defence (SEC-08) | public-profile |
| `app/status/` → observability | live-probe status page (SEC-4) | marketing-legal |
| `middleware.ts` → access | KAN-415 pairs "access + middleware decomposition" | composition root outside any module |
| `lib/geo/` → profile | postcode→city for profile location (KAN-341) | platform |
| `lib/invite-text.ts` → dashboard | consumed by dashboard page + share button | access (beta invites) |
| `app/search/` → public-profile | public profile search | own module |
| `lib/retention/` + `api/retention/` → trust-safety | GDPR retention enforcement (SEC-74) | account |
| `lib/compliance/` → marketing-legal | drives legal-page disclosures (KAN-408) | trust-safety |
| `app/examples/` → marketing-legal | homepage showcase | public-profile |
| `lib/recommend/convene/` → recommendations | keeps scoring in one module (MCP drift-parity, KAN-426) | convene |
| `consent_log` table → marketing-legal | cookie/analytics consent audit | trust-safety |

---

## 7. Estate impact (KAN-428 / KAN-429 cross-reference)

- `modules.json` is **itself a new path-coupled artefact**: its `paths` globs
  break silently when files move. The KAN-419 drift detector (F1) must add
  `modules.json` to its scan targets the moment the manifest is adopted —
  extend `docs/modularisation/kan419-scan.py`'s artefact list accordingly.
- No CI gate, workflow, test, or doc was modified by this spike. The only
  repo-root addition is `modules.json` (inert data, `enforced: false`
  everywhere, read by nothing). Unit suite verified green after its addition.
- Test-floor provisionality: 149 test files (1500 blocks) carry no `src/` path
  votes and are unmapped — most are workflow/doc/policy guards. **KAN-417 owns
  the real test↔module mapping**; the floors here are deliberately labelled
  `provisional: true`.

---

## 8. Acceptance criteria — status

| Criterion | Status |
|---|---|
| `modules.json` v0 exists, all 20 modules, every field populated | ✅ (testFloor populated but explicitly provisional) |
| Every `publicApi` entry justified by a measured import edge; script committed | ✅ `kan416-derive.py`; 104 entries, all edge-derived |
| 100% of `src/` claimed exactly once; unclaimed files listed | ✅ 272/272, none unclaimed |
| Every table owned or explicitly shared-kernel with column ownership | ✅ 33/33 tables + 14 rpcs; `profiles` at 41/41 columns |
| Seeded allowlist enumerates every currently-violating edge with a count | ✅ 34 edges / 17 pairs, per-file lists |
| *(step 5)* sanity-check vs plan §5 change-process table | ❌ **not performable** — plan file inaccessible (§1); founder diff requested |
