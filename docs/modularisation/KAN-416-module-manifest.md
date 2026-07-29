# KAN-416 — Module manifest & dependency matrix (R1b — re-derivation)

**Spike · research artefact · read-only · epic KAN-414**
**Produced:** 2026-07-28 · **Base:** `develop@1d6cb5f` · **Files in `src/`:** 274

> **R1b supersedes R1** (2026-07-27, `develop@a42ad84`). R1 was derived with no
> access to `LYRA_MODULARISATION_PLAN_2026-07-26.md`, which existed only on the
> founder's machine; PR #593 has since committed it to `docs/modularisation/`.
> R1 also carried a **verified defect** that made the `profiles` table-ownership
> baseline read zero. Both are fixed here. §1 is the honest before/after.
>
> **What this is.** The machine-readable declaration of the module
> architecture: what each module owns (files, tables, `profiles` columns), its
> **measured** public API, its allowed and violating dependencies, its
> **change process** (plan §5), and the seed of the shrink-only
> `.boundaries-allowlist.json`.
>
> **Deliverables:**
> - `modules.json` (repo root) — the v1 manifest. `enforced: false` everywhere;
>   read by nothing (`.dependency-cruiser.cjs` mentions it only in a comment —
>   its six modules.json-dependent rules are deferred to KAN-415 C2).
> - `docs/modularisation/KAN-416-boundaries-allowlist.seed.json` — every
>   currently-violating edge **and** the `profiles` column baseline.
> - `docs/modularisation/kan416-derive.py` — the derivation script.
>
> **Reproduce everything with:**
> ```bash
> python3 docs/modularisation/kan416-derive.py   # regenerates modules.json + seed + report
> ```

---

## 0. Headline

| Measure | Value |
|---|---|
| Modules | **21** — the plan's 20, plus founder-approved **`audit`** |
| `src/` files claimed by exactly one module | **274 / 274** (0 unclaimed, 0 double-claimed) |
| Internal TS import edges (parser) | **527** (315 intra-module, 212 cross-module) |
| Measured public-API entries | **105** across 21 modules, each justified by a real import edge |
| Declared (target, not yet measurable) API entries | **3** — all in `audit` (§3.2) |
| **Import-edge violations → allowlist seed** | **14 edges across 12 module pairs** (1 type-only), of which **4 are upward edges, forbidden absolutely** |
| **`profiles` cross-module COLUMN accesses** | **103**, over **47 (module, column) pairs** — *this was `0` in R1* |
| **`profiles` sites with an unbounded column set** | **19** of 77 (`select('*')`, bare `select()`, variable write payload, object spread) |
| Whole-table cross-module access | **55 sites over 39 (module, table) pairs** |
| `.from()` / `.rpc()` sites / distinct tables | **77 on `profiles`** + the rest; 33 tables, 14 rpcs, every one owned |
| `createServiceRoleClient` importer files (RLS-bypass register) | **39** across 13 modules |
| `profiles` columns assigned an owner | **41 / 41**, no duplicates, **0** columns touched that are outside the map |
| Measured blast radius of `platform` | **140** transitive dependant files — **exactly** the plan §5 figure |

**The honest ratchet starting number is not 34.** It is three numbers that must
each shrink independently:

```
 14  import-edge violations          (was 34 — see §1.3 for the full reconciliation)
 55  whole-table cross-module reads/writes
103  cross-module COLUMN accesses on profiles   ← was silently 0
---
172  total boundary violations, plus 19 unbounded-column sites to resolve
```

---

## 1. What changed since R1, and why

### 1.1 The defect: `profiles` was exempt from its own baseline

`kan416-derive.py:430` read:

```python
if mod not in owner and not owner.startswith("db/schema"):
```

with `TABLE_OWNER["profiles"] = "db/schema (shared kernel — column ownership below)"`.
The second clause was **always true** for `profiles`, so the condition was
always false and **no** cross-module access to the god-table was ever recorded:
77 `.from('profiles')` sites → **0** seed entries.

That is worse than a miscount. The ratchet is shrink-only and is meant to start
from an honest number; starting with the one table that most needs a baseline
invisible would have made it dishonest from commit one — and would have pushed
**KAN-421** (the `profiles` ADR) toward "column ownership looks fine" on
evidence never gathered.

**Fixed** by enumerating shared-kernel tables at **column** granularity instead
of skipping them (§4). `SHARED_KERNEL = {"profiles"}` is now an explicit set;
the whole-table loop `continue`s past it and a dedicated pass attributes every
site to the module owning each column it touches.

**Second defect, same line:** `mod not in owner` was a **substring** test
against a string, not set membership. It did not misfire on today's names, but
it is the wrong operator — and `src/lib/access-model/` landing on develop this
week is exactly the kind of near-collision that would eventually bite it. Now
`if mod != owner`.

### 1.2 The `audit` module — founder-approved, 21st module

`audit` · **layer 1** · **riskTier critical**.

| | |
|---|---|
| Owns | `src/lib/moderation-audit.ts`; tables `moderation_logs`, `content_moderation_flags` |
| Public API (declared) | `recordModerationFlag()`, `logModerationAction()`, `auditedMutation()` |
| Implemented today by | `moderateAndAudit()` — the single export of `moderation-audit.ts` |

This resolves the moderation write-path deadlock: `trust-safety` cannot drop to
layer 1 (it also owns `api/reports` and, formerly, the retention routes), and
the writer cannot go in `guards` (guards must stay edge-safe — nothing
reachable from `middleware.ts` may import `@supabase/supabase-js`).

**Consequence that needs founder confirmation (§7-A).** A layer-1 module may
not import a layer-3 one. `moderation-audit.ts` imports `content-moderation.ts`
and `moderation-policy.ts`, so those two must sit at layer 0 or the new module
is illegal by construction. Both are already **import-free and I/O-free**, plan
§3 P5 lists content moderation among the six `@lyra/contracts` rule-sets, and
KAN-416's 2026-07-27 comment settled this as option (a). They are therefore
assigned to **`contracts`**, which stops being an empty module and gains its
in-repo seed (2 files, 4 measured public symbols, 19 transitive dependants).

**What it buys:** 4 measured import edges (`profile → audit` ×3,
`convene → audit` ×1) and 2 more via `contracts` become *legal architecture*
instead of permanent allowlist entries.

### 1.3 Reconciling 34 → 14 import-edge violations

Every removed edge is accounted for. None was suppressed.

| Pair (R1) | Edges | Why it is no longer a violation |
|---|---|---|
| `public-profile → recommendations` | 6 | **Declared same-layer** — consequence of the founder ruling splitting `api/recommendations/` out of public-profile (§1.4 #6) |
| `recommendations → affiliate` | 4 | **Declared same-layer** — plan §3 D8 `may_depend_on: affiliate (through MonetisationPort only)` |
| `convene → recommendations` | 4 | `lib/recommend/convene/` → **convene** (founder ruling #1); now intra-module |
| `profile → trust-safety` | 3 | Target is `moderation-audit.ts` → now **`audit`** at layer 1 |
| `convene → trust-safety` | 2 | 1 → `audit` (layer 1), 1 → `contracts` (layer 0) |
| `access → admin` | 2 → 1 | One edge disappeared **on develop**, not here: `lib/access-model/` landed, moving `computeAccessTransition` out of the admin route tree (plan §3 A1). The surviving edge is type-only. |
| `trust-safety → convene` | 1 | `lib/retention/` → **account** (founder ruling #3); reappears as `account → convene` |
| — | **20** | 34 − 20 = **14** ✓ |

The 14 that remain:

| From → To | Edges | Direction | Disposition |
|---|---|---|---|
| `public-profile → profile` | 2 | same-layer, undeclared | KAN-424 / F2 cross-segment |
| `profile → affiliate` | 2 | same-layer, undeclared | KAN-424 / F2 |
| `public-profile → affiliate` | 1 | same-layer, undeclared | KAN-424 / F2 |
| **`trust-safety → admin`** | 1 | **UPWARD** | the `api/reports` public route reaching into `admin` — this is the edge that makes the graph lie about privilege (plan D-9) |
| `account → convene` | 1 | same-layer, undeclared | GDPR erasure reaching Convene tables — needs the `retentionSweep()` delegation (§7-C) |
| **`age → auth`** | 1 | **UPWARD** | the type-only half of the `age ↔ auth` cycle (KAN-424 / F2) |
| `dashboard → auth` | 1 | same-layer, undeclared | KAN-424 / F2 |
| `dashboard → convene` | 1 | same-layer, undeclared | KAN-424 / F2 |
| `profile → convene` | 1 | same-layer, undeclared | KAN-424 / F2 |
| **`account → admin`** | 1 | **UPWARD** | KAN-424 / F2 |
| **`access → admin`** | 1 (type-only) | **UPWARD** | the one group-level cycle the plan says must never come back |
| `age → features` | 1 | same-layer, undeclared | KAN-424 / F2 |

### 1.4 The 10 founder-ruled path conflicts, applied

Decided; not re-litigated here.

| # | Path | Ruled to | Source | Note recorded in `modules.json` |
|---|---|---|---|---|
| 1 | `lib/recommend/convene/` | **convene** | PLAN (D7) | recommendations `must_not` host Convene scoring — KAN-353 turns on this |
| 2 | `app/examples/` | **marketing-legal** | MANIFEST | `frozenContracts`: must consume public-profile's **read API**, never its own service-role read |
| 3 | `lib/retention/` + `api/retention/` | **account** | PLAN (D6) | with per-module `retentionSweep()` delegation |
| 4 | `lib/compliance/` | **marketing-legal** | MANIFEST | |
| 5 | `app/status/` | **observability** | MANIFEST | |
| 6 | `api/recommendations/` | **recommendations** | MANIFEST | creates the declared `public-profile → recommendations` seam |
| 7 | `app/waitlist/` + `app/join/` | **access** | MANIFEST | |
| 8 | `app/suspended/` | **access** | MANIFEST | |
| 9 | `how-we-check-your-age/` | **marketing-legal** | PLAN (D11) | |
| 10 | `lib/cookie-domain.ts` | **platform** | MANIFEST | |
| — | `src/middleware.ts` | **access**, `compositionRoot: true` | | stays at its Next-required path as a thin composition root |

### 1.5 The amended layer policy

```
edge src→dst ALLOWED iff  layer(dst) < layer(src)
                      OR  dst ∈ declaredSameLayer[src]     ← needs a `reason`
UPWARD edges (layer(dst) > layer(src)) are FORBIDDEN ABSOLUTELY.
No declaration legalises one; they only ever go in the shrink-only allowlist.
```

Two same-layer edges are declared today, both with a reason traceable to the
plan or a founder ruling (`modules.json → layerPolicy.declaredSameLayer`):

| From → To | Reason |
|---|---|
| `recommendations → affiliate` | plan §3 D8, *through the MonetisationPort only*; `affiliate/backoffice/` stays unreachable from the request path |
| `public-profile → recommendations` | the founder ruling split `api/recommendations/` out of public-profile — the edge **is** the seam, not drift |

An entry in `declaredSameLayer` is architecture. An entry in the allowlist is
debt. The distinction only holds if the first list stays short and reviewed.

### 1.6 Risk tiers raised to match plan §5 blast radius

`guards` high → **critical** · `contracts` high → **critical** ·
`public-profile` medium → **high** · `ui-kit` low → **high** ·
`audit` (new) → **critical**.

Where `modules.json` was already *higher* than the plan (`age`, `trust-safety`,
`admin`, `observability`), the conservative call is kept.

---

## 2. The 21 modules — measured summary

`Dep.` = MEASURED transitive dependant files. `SR` = files importing
`supabase-service.ts`. `Same-L` = declared same-layer deps.

| Module | L | Files | API | May depend on | Same-L | Violating | Risk | Blast (plan §5) | Dep. | SR | Tests (prov.) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `platform` | 0 | 6 | 9 | — | — | — | critical | Critical | **140** | 0 | 0f/0t |
| `contracts` | 0 | 2 | 4 | — | — | — | critical | Critical | 19 | 0 | 0f/0t |
| `guards` | 1 | 9 | 20 | platform | — | — | critical | Critical | 35 | 1 | 3f/59t |
| `observability` | 1 | 4 | 3 | platform | — | — | medium | Low | 1 | 1 | 1f/3t |
| `ui-kit` | 1 | 1 | 1 | — | — | — | high | High (visual) | 2 | 0 | 1f/9t |
| **`audit`** | 1 | 1 | 1 (+3 declared) | contracts | — | — | critical | High (audit) | 15 | 0 | **0f/0t** |
| `access` | 2 | 12 | 12 | guards, platform | — | **admin** | critical | Critical | 33 | 2 | **0f/0t** |
| `features` | 2 | 5 | 17 | platform | — | — | high | High | 44 | 2 | **0f/0t** |
| `age` | 2 | 11 | 10 | platform | — | auth, features | critical | High (compliance) | 20 | 2 | **0f/0t** |
| `oauth-as` | 3 | 18 | 0 | access, guards, platform | — | — | critical | Critical (frozen) | 0 | 5 | 4f/41t |
| `auth` | 3 | 11 | 2 | access, age, platform | — | — | high | High | 3 | 0 | 5f/51t |
| `profile` | 3 | 35 | 4 | age, audit, features, guards, platform | — | affiliate, convene | high | High | 1 | 0 | 22f/309t |
| `public-profile` | 3 | 8 | 0 | guards, platform, recommendations, ui-kit | recommendations | affiliate, profile | high | High (privacy) | 0 | 2 | 9f/60t |
| `dashboard` | 3 | 9 | 0 | access, platform | — | auth, convene | medium | Medium | 0 | 0 | 4f/30t |
| `account` | 3 | 11 | 0 | access, features, guards, platform | — | admin, convene | high | High (GDPR) | 0 | 2 | 4f/51t |
| `convene` | 3 | 55 | 2 | access, audit, contracts, features, guards, platform | — | — | high | High — *and not safe* | 3 | **14** | 11f/164t |
| `recommendations` | 3 | 17 | 5 | affiliate, features, platform | affiliate | — | medium | Medium | 4 | 3 | 2f/3t |
| `affiliate` | 3 | 8 | 13 | features, platform | — | — | medium | Medium | 19 | 1 | **0f/0t** |
| `trust-safety` | 3 | **1** | 0 | platform | — | admin | critical | High (audit) | 0 | 0 | **0f/0t** |
| `marketing-legal` | 3 | 29 | 0 | access, features, guards, platform | — | — | medium | Low / High (legal) | 0 | 3 | 14f/216t |
| `admin` | 4 | 21 | 2 | access, affiliate, features, observability, platform | — | — | critical | High (privilege) | 19 | 1 | 1f/8t |

**`platform` measures 140 transitive dependant files — the plan §5 figure
exactly.** Two independent derivations (the survey's and this parser's)
agreeing to the unit is the strongest available evidence that the graph is
being read correctly.

Test-floor figures are the R1 path-vote heuristic and remain **provisional**
(superseded by KAN-417); 149 test files / 1,500 blocks vote for no module at
all. `0f/0t` therefore means "not attributable by path", not "untested" — but
`access`, `age`, `features` and the new `audit` are four **critical/high** tier
modules with no attributable tests, and that gap is real work for KAN-417 and
KAN-429 whichever way the heuristic is refined.

---

## 3. The public API

### 3.1 Measured (105 entries)

Every `publicApi` entry in `modules.json` is a symbol **actually imported
across a module boundary today**, with its evidence attached: `file`,
`importingFiles`, `consumingModules`, `typeOnly`. Nothing is designed by taste
— that is the whole point of deriving the barrel from the graph rather than
from a tidy-looking list.

Five modules still have a measured public API of **zero** — `oauth-as`,
`public-profile`, `dashboard`, `account`, `marketing-legal`. Nothing outside
them imports them at all, so extraction carries no barrel-design risk. This
continues to strengthen the `oauth-as` pilot choice (plan §3 D1).

### 3.2 Declared (3 entries, all in `audit`)

`recordModerationFlag()`, `logModerationAction()`, `auditedMutation()` do not
exist under those names; `moderation-audit.ts` exports a single
`moderateAndAudit()`. They are carried in a separate `declaredApi` field, never
mixed into `publicApi`, each recording `todayImplementedBy`. **A declared
symbol is a design commitment, not a measurement** — keeping the two fields
apart is what stops the manifest quietly becoming aspirational.

---

## 4. The data boundary

### 4.1 `profiles` at column granularity — the baseline R1 skipped

77 `.from('profiles')` sites. 103 accesses to a column owned by another module,
over 47 (module, column) pairs:

| Accessor | Accesses | Columns owned elsewhere |
|---|---|---|
| `admin` | 41 | `access_tier`, `age_declared_18_at`, `beta_approved_at`, `bio_short`, `display_name`, `headline`, `is_admin`, `is_published`, `is_suspended`, `slug`, `suspended_at`, `suspension_reason`, `user_status` |
| `public-profile` | 18 | `avatar_url`, `bio_short`, `city`, `country`, `display_name`, `headline`, `is_homepage_example`, `is_published`, `is_suspended`, `slug` |
| `marketing-legal` | 17 | `avatar_url`, `city`, `country`, `display_name`, `headline`, `is_published`, `is_suspended`, `slug` |
| `recommendations` | 13 | `bio_short`, `delivery_country_code`, `display_name`, `headline`, `is_published`, `is_suspended`, `slug` |
| `convene` | 8 | `city`, `display_name`, `is_published`, `is_suspended`, `slug` |
| `profile` | 2 | `age_status` |
| `account` | 2 | `discoverable_by_phone` |
| `access` | 1 | `display_name` |
| `trust-safety` | 1 | `slug` |

Plus **19 sites whose column set cannot be bounded from source** — `select('*')`,
a bare `select()`, a variable write payload, or an object spread. Each must be
read as a potential access to **all 41 columns**. They are listed file-and-line
in the seed (`sharedKernelColumnAccess.unboundedSites`); the heaviest are
`profile` (7), `admin` (3), `dashboard`/`account`/`access` (2 each).

**Extraction method, stated plainly.** The script reads the chained PostgREST
expression starting at each `.from('profiles')` — `.select()` argument,
`.eq/.neq/.gt/.in/.order/...` first arguments, and `.update/.insert/.upsert`
object keys — bounded by the next `.from(`, a blank line, or 1,400 characters.
It is a documented heuristic, **not** a TypeScript parser. Its failure mode is
deliberately loud: anything it cannot bound is reported as an unbounded site
rather than dropped. Two sites were verified by hand against source
(`src/app/[slug]/page.tsx:185` — `select('*')` + the SEC-44 filter pair;
`src/app/admin/users/actions.ts:114` — `.update(transition.update).in('id', …)`)
and both matched.

Zero columns were touched that are outside the 41-column ownership map, which
is a useful independent check that the map is complete for the code as it is.

### 4.2 What this hands KAN-421

KAN-421 must choose between column-ownership-plus-gate and satellite tables.
It now has evidence, and the evidence points at three specific things:

1. **`is_published` (owner `profile`) and `is_suspended` (owner `access`) are
   read together by five different modules.** Plan §5 requires the
   `.eq('is_published',true).eq('is_suspended',false)` pair to stay **one
   tested unit** (SEC-44). Under column ownership that pair straddles a module
   boundary at every call site — the strongest argument in the data for a
   shared read *contract* rather than raw column access.
2. **`admin` reads or writes 13 columns owned by four other modules.** A
   backoffice legitimately sees everything; the question is whether it goes
   through owners' APIs or keeps a declared whole-row exemption.
3. **19 unbounded sites must be bounded before any column-level gate can be
   enforced at all.** A gate cannot rule on `select('*')`.

### 4.3 Whole-table access, and the rest of the schema

**55 sites over 39 (module, table) pairs**, unchanged in total from R1 but
re-attributed by the founder rulings — `account` now carries the GDPR
export/erasure reach that `trust-safety` carried before (12 of the 39 pairs),
which is precisely why plan §5 pairs `account` with a `retentionSweep()`
delegation instead of direct reach.

33 tables and 14 rpcs, every one with exactly one declared owner, 0 unowned.
`moderation_logs` and `content_moderation_flags` now belong to `audit`.

### 4.4 Service-role register (RLS bypass)

**39 files across 13 modules**, enumerated per module in
`modules.json → serviceRoleClient` and mirrored into each module's
`changeProcess.serviceRole`. `convene` holds 14 of them — over a third of the
entire RLS-bypass surface in the module whose MCP write tools are, per plan
§7-D5, **live in production against the production database** while its web
flag is off.

---

## 5. `changeProcess` — plan §5, encoded

Every module now carries a `changeProcess` block, so KAN-428's extraction
Definition-of-Done can reference per-module answers instead of re-deriving
them:

| Field | Source |
|---|---|
| `uiApprovalGated` (`never`/`sometimes`/`always`), `uiApprovalPaths` | plan §5 col. 1 |
| `mcpLockstep` (`none`/`contract`/`tools`) | plan §5 col. 2 |
| `migrationEnvs`, `migrationFrequency` | plan §5 col. 3 |
| `blastRadius` | plan §5 col. 4, verbatim |
| `frozenContracts`, `notes` | plan §5 col. 5 |
| `signupSurface` | plan §5 `auth` row |
| `edgeSafe` | plan §3 P2 hard rule |
| `extraGates` | **joined to `controls/registry.json` by CTL id** |
| `transitiveDependants`, `edgeReachableFiles`, `serviceRole` | **MEASURED at derivation time** |

Ten modules join to a registered control: CTL-004 (`platform`), CTL-030
(`guards`), CTL-009 (`ui-kit`, `marketing-legal`), CTL-028 + CTL-013
(`access`), CTL-013 (`auth`), CTL-021/022/020 (`profile`), CTL-028
(`public-profile`, `admin`), CTL-019 (`dashboard`). Eleven join to none —
including `contracts`, `audit`, `age`, `account`, `convene` and
`oauth-as`, four of which are critical-tier. **That gap is the honest reading
of `extraGates`: the modules with the most frozen contracts have the fewest
automated controls holding them.** It is material to KAN-428/429 and to the
SEC-101 feedback loop.

---

## 6. Findings

**F1 — `trust-safety` is now a one-file module.** After the founder rulings
(`retention` → `account`) and the `audit`/`contracts` split, `trust-safety`
owns exactly one file: `src/app/api/reports/`. It has 0 measured public API, 0
transitive dependants, 0 attributable tests, and its only outbound violation is
the upward `trust-safety → admin` edge. `app/admin/moderation` — which plan §3
D10 assigns to it — is claimed by `admin` under the longest-prefix rule.
**Recommendation: KAN-415 should decide whether `trust-safety` survives as a
module or dissolves into `audit` (rules + write path) and `admin` (moderation
console), leaving `api/reports` as a route.** This is a genuine consequence of
decisions already taken, not a derivation artefact — but it changes the module
count, so it is the founder's call, not this spike's.

**F2 — Four critical/high modules have no attributable tests.** `access`,
`age`, `features`, `audit`. See §2.

**F3 — `account`'s GDPR reach is now explicit and larger.** It touches 12
(module, table) pairs it does not own plus a same-layer `account → convene`
edge. The table-ownership gate cannot ship without the data-subject-rights
contract; the `retentionSweep()` delegation named in ruling #3 is the shape of
that contract. Carried forward to KAN-421 and KAN-415 design.

**F4 — `access → admin` is down to one type-only edge, without anyone doing
KAN-424 work.** `lib/access-model/` landing on develop removed the runtime half.
Worth noting in KAN-424: the remaining edge is a type import, which is cheaper
to break than the ticket assumes.

**No SEC ticket raised.** This run found no inert gate, no schema/RLS
discrepancy, and no privacy defect. The `profiles` baseline defect is a
research-artefact accuracy problem in an unenforced manifest (`enforced:
false`, read by nothing), corrected here before anything consumed it — it did
not weaken a live control. §4.4 and §5's control-coverage gap are inputs to
KAN-428/429, not findings of a live vulnerability.

---

## 7. Open items for the founder

**A. Confirm `content-moderation.ts` + `moderation-policy.ts` → `contracts`
(layer 0).** Derived, not ruled. It is *required* for `audit` at layer 1 to be
legal, both files are already import-free and I/O-free, plan §3 P5 lists content
moderation among the contracts rule-sets, and KAN-416's 2026-07-27 comment
settled the write-path question as option (a). But it moves two files into a
module you have not explicitly assigned them to, and it is the reason
`contracts` stops being empty. If you disagree, `audit` needs a different layer.

**B. Rule on F1 — does `trust-safety` survive as a module?**

**C. `retentionSweep()` delegation** (ruling #3) is recorded as a `note` on
`account`, not implemented. The `account → convene` edge stays a violation
until it exists.

---

## 8. Reproducibility

| Number | Command |
|---|---|
| Everything in §0, §2, §4, §5 | `python3 docs/modularisation/kan416-derive.py` |
| Canonical graph cross-check | `npx madge --json --extensions ts,tsx --ts-config tsconfig.json src` |
| Base commit | `develop@1d6cb5f` (merged into this branch) |

The script is deterministic: same tree in, same `modules.json` and same seed
out. Module assignment, layer policy, declared same-layer edges, table and
column ownership, and the change-process table are all data at the top of the
file, so a disagreement with any of them is a one-line diff and a re-run — not
an argument about what the code "really" does.
