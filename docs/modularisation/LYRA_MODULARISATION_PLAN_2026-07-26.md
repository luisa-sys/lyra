# Lyra Modularisation Programme — Target Architecture, Boundaries & Staged Refactor Plan

**Date:** 2026-07-26
**Baseline surveyed:** `lyra` @ `origin/develop` `ee647e6`, `lyra-mcp-server` @ `main` `9bebfa4`, `lyra-admin-mcp-server` @ `main` `435f28f`
**Method:** 8 parallel read-only code surveys + 2 competing architecture proposals, synthesised. Every number below is re-derivable from the repos.
**Relationship to existing work:** this is the successor programme to **KAN-350** Phase 3. It absorbs, re-scopes or depends on KAN-353, KAN-355, KAN-356, KAN-358 (see §7).

---

## 1. What the survey actually found (and why it changes the plan)

The instinct behind this request — "the code is tangled, break it into modules" — turns out to be **half right, and the wrong half is the expensive one.**

### 1.1 The code is already horizontally modular

The static import graph of `src/` is 273 nodes and 525 edges. Of those:

| Measure | Value | Meaning |
|---|---|---|
| `lib` → `app` edges (wrong-direction) | **1** | `lib/beta-access/flow.ts` → `app/admin/users/users-actions-shared.ts` |
| `app` segment → `app` segment edges | **5** | 14 of 19 route segments have **zero** fan-in |
| Import cycles | **1** | type-only, inside `app/dashboard/convene/organise`, one line to fix |
| Cross-group edges | 328 | of which **145 (44%) are deep imports** into another area's internals |
| `index.ts` barrels in 272 files | **4** | mediating just **9 of 328** cross-group edges |

524 of 525 edges already point the right way. **There is no monolith to break apart.** A "decompose the tangle" refactor would spend its budget on a problem that does not exist.

### 1.2 The coupling that *does* exist is vertical — into an unnamed kernel and into the database

| Coupling | Evidence |
|---|---|
| Unnamed kernel | `lib/supabase-server.ts` fan-in 46 · `lib/supabase-service.ts` 39 · `lib/env.ts` 17 (140 transitive dependants) · `lib/admin.ts` 17 |
| No repository layer | **280 `.from('table')` call sites over 33 tables**; 199 (71%) sit inside route/page/action files. Exactly one file in the codebase is named as a repository (`lib/convene/invites/repository.ts`) |
| RLS bypassed everywhere | `createServiceRoleClient()` imported in **40 files** in `src/`; **both MCP servers use the service-role key for 100% of traffic** |
| `profiles` is a god-table | touched by **15 module groups over 75 call sites**, carrying identity + access model + admin flags + suspension + age + discovery hashes + delivery country + recommender attributes + section-visibility JSON + dashboard widget state |
| No typed schema | **No generated `Database` type in any of the three repos.** Every row is `any`, every column a string literal |

### 1.3 The rules have no home, so they are re-implemented per call site and per repo

| Duplicated rule | Where |
|---|---|
| Suspension decision | 6 places, **4 different failure postures** — `middleware.ts:177-198` fails **open**, `lib/account-status.ts` fails **closed**, RLS fails closed, `lyra-mcp-server/src/feature-entitlements.ts` degrades to not-suspended |
| Convene feature gate | re-checked at **16 distinct call sites** |
| Auth check | 37 files call `supabase.auth.getUser()` directly; `redirect('/login')` in 8 files |
| Feature registry | exists **3 times across 2 repos**, with 2 different tier spellings, plus a **4th copy inside a SQL function body** (`fe.feature_key in ('media_uploads','discovery')` in `admin_list_users`) |
| Convene scoring | `lib/recommend/convene/**` is **verbatim-copied** into `lyra-mcp-server/src/convene-recommend-scoring.ts`, under a header that literally says *"DRIFT RISK … manual lockstep"* |
| Content moderation | byte-identical across repos (md5 `b07eac8ed85ae3cc5669522f0afad395`) |
| Publish rule | web has an age gate; `lyra_publish_profile` has an **empty `if` block** where the gate should be — and an inverted test pins the divergence in place |

**This has already caused a production defect:** `admin_approve_beta` in the admin MCP server writes two columns that a `lyra`-repo migration dropped. It has been broken for weeks. That is the business case for this programme in one line.

### 1.4 Unenforced boundaries erode — proven, in this repo

`src/lib/deploy-env.ts` was created specifically to be the single environment resolver. It is pure, fail-safe, fully unit-tested and self-documenting. **All six of the ad-hoc derivations it was meant to replace are still inline**, and it has 5 importers. Creating a canonical module is ~10% of the work. Retiring the call sites and preventing new ones is the other 90% — and only a CI gate does the 90%.

### 1.5 The single biggest tax: the test suite pins file paths, not behaviour

| | Web app | lyra-mcp-server | admin-mcp |
|---|---|---|---|
| Test files | 213 (`tests/unit` 197 + `tests/scripts` 16) | 44 | 7 |
| Using `readFileSync` on source text | **98** | **44 (100%)** | **7 (100%)** |
| Hard-coded `src/**` path literals | **112 distinct** | all | all |
| Pure source-text scans (never import the code) | **70** | 44 | 7 |

**Moving any file breaks tests with `ENOENT` — a failure that carries no information — while providing zero behavioural safety net.** Under the standing Test Integrity Policy every one of those breaks forces a stop-and-get-sign-off judgement call. This is the hard prerequisite that determines whether this programme succeeds or stalls.

Compounding it: the enforced test floors in `tests/unit/test-regression-guard.test.js` are **29 files / 320 tests** against an actual **213 files / ~2,401 test blocks**, and every `jest.config.js` coverage threshold is **0**. Test-loss protection is nominal.

### 1.6 Five CI policy gates classify by hard-coded path and fail *silently* when a file moves

`scripts/check-ui-copy-ownership.sh` (the founder UI/copy gate) · `.github/signup-surface.paths` (the un-skippable signup E2E gate) · `.github/CODEOWNERS` · `scripts/check-service-role-client.sh` · `stryker.config.mjs`.

A glob that matches nothing simply protects nothing. **Without a drift detector landing first, this programme's own first PR is also the PR that quietly disarms the founder UI gate and the signup gate.**

---

## 2. The decision: Enforced Modular Monolith + a minimal cross-repo contracts package

Two architectures were designed and evaluated.

| Approach | Verdict |
|---|---|
| **Published Hexagon** — pure `@lyra/core` + `@lyra/adapters` in a new 4th repo, consumed by all three deployables | **Right about the cross-repo problem, wrong as the vehicle.** Requires a private registry with read tokens on Vercel + 3 Railway services + 3 CI repos, a zod-free core (`zod` is in both MCP repos and absent from the web app), and a dual ESM/NodeNext build (web is `moduleResolution: bundler`, MCP repos are `type: module` + NodeNext with `.js` extensions). All that cost, and it does not touch the top risk — 280 untyped `.from()` sites and the `profiles` god-table. |
| **Enforced Modular Monolith** — `src/modules/<name>/` behind compile-time-only entry points, a machine-checked dependency matrix, a shrink-only legacy allowlist | **Correct vehicle.** Move files without rewriting them; make each move irreversible by construction; keep one Next build, one deploy, one release chain. |

**Decision — hybrid, and it is not a compromise:**

> **Use the Enforced Modular Monolith for the web app. Carve out exactly one published package — `@lyra/contracts` — containing only the pure, zero-dependency, zero-I/O rules that the three deployables must agree on.** Nothing else crosses the repo boundary.

`@lyra/contracts` is the hexagon's genuinely essential idea, scoped to the ~6 rule-sets that are already provably duplicated. It is bootstrapped with the one file that is **byte-identical across repos** (`content-moderation.ts`), so the first cross-repo PR tests the packaging — private publish, dual module resolution, Railway and Vercel build paths — with a diff that is provably a no-op.

### 2.1 What this explicitly does *not* deliver

State this plainly, now, so nobody is surprised in six months:

- **No independent deployability.** One Next build, one Vercel deploy, one `develop → staging → beta → main` chain verified by whole-branch SHA. A module's change still traverses four whole-repo pipelines. **What changes is blast radius and reviewability, not release cadence.**
- **CI gets slower before it gets faster.** Every PR already runs 11 blocking static guards + lint + tsc + ~2,401 tests + `npm audit` + a full build with no path filters. This adds three more gates. Path-filtered per-module CI only becomes *safe* after the test-decoupling phase — because today a source-text test for module A can live in a file named after module B.
- **`profiles` stays a shared table.** Column-level ownership recorded in a manifest and enforced by a grep gate is a real improvement over nothing, but it is a convention enforced by a script, not by the database. Splitting `profiles` into satellite tables is a larger, riskier migration programme across three Supabase projects that already have documented parity drift — **deliberately deferred, and named as deferred.**

---

## 3. The module set

Twenty code modules in four layers, plus two meta-modules. Every module is grounded in code that exists today; none is speculative.

### Layer 0 — Platform (leaf; importable by everyone; imports nothing from `src/`)

| # | Module | Owns | Public API (the hand-off) | Size |
|---|---|---|---|---|
| P1 | **`platform`** | `lib/env.ts`, `lib/deploy-env.ts`, `lib/supabase-{browser,server,service}.ts`, generated `Database` types | `getConfig()`, `getDeployEnv()`, `createBrowserClient()`, `createServerClient()` · **`@mod/platform/service`** as a separate, greppable entry for `createServiceRoleClient()` | M |
| P2 | **`guards`** | `sanitise.ts`, `rate-limit*.ts` (×3), `security-headers.ts`, `turnstile.ts`, `cf-access.ts`, `file-magic-bytes.ts`, `cookie-domain.ts`, `ActionResult` type, plus the two misfiled helpers `timingSafeStrEqual` (cron auth) and `authenticateBearerApiKey` — both currently living inside Convene | `sanitiseText/Url/SearchTerm`, `checkRateLimit`, `buildCsp`, `verifyTurnstile`, `verifyCfAccessJwt`, `sniffMagicBytes` | M |
| P3 | **`observability`** | `instrumentation*.ts`, `sentry-scrub.ts`, `metrics.ts` | `scrubEvent()`, `recordMetric()` | S |
| P4 | **`ui-kit`** | design tokens, root shell, the three de-facto primitives (`Field`, the sage button, the card surface), de-duplicated `StatCard`, `AffiliateBadge` | token exports + primitive components | **L — must be BUILT, not extracted** |
| P5 | **`@lyra/contracts`** *(published package)* | content moderation, feature registry, publish rule, gathering state machine, visibility resolution, Convene scoring weights, token claim shape | one subpath export per rule-set. Zero dependencies. Zero I/O. Runs unchanged on Vercel Edge, Vercel Node and Railway Node | M |

> **`guards` hard rule:** nothing reachable from `src/middleware.ts` may import `node:crypto`, `next/headers` or `@supabase/supabase-js`. The middleware bundle breaks at **deploy time**, not at type-check — so this needs its own CI rule.

### Layer 1 — Access core (everything downstream depends on these three)

| # | Module | Owns | Public API | Size |
|---|---|---|---|---|
| A1 | **`access`** | the access model (`user_status` × `access_tier`, `is_suspended`, `is_admin`), `computeAccessTransition` (**moved out of the admin route tree**), `account-status.ts`, `beta-access/**`, and a decomposed edge-gate pipeline replacing `middleware.ts` | `resolveStanding()`, `computeAccessTransition()`, `canPublish()`, `betaRedirectUrl()`, `edgeGatePipeline` | L |
| A2 | **`features`** | `lib/features/**` — `feature_entitlements` (per-user) + `global_feature_switches` (per-env) | frozen 16-symbol `index.ts`; split between the **pure registry** (goes to `@lyra/contracts`) and the **DB-reading service** | M |
| A3 | **`age`** | `lib/age/**` — the live 18+ self-declaration **and** the dormant Didit provider path, kept deliberately separate | `recordAgeDeclaration()`, `hasDeclared18()` | S |

> **`access` must-not:** import from `admin`. The current `lib/beta-access/flow.ts:18` → `@/app/admin/users/users-actions-shared` import is the only group-level cycle in a 525-edge graph, and it is the edge that must never come back.
>
> **`age` must-not:** promote `age_declared_18_at` into a hard or fail-closed gate — `lib/age/self-declaration.ts` states explicitly that it is an attestation, not a security control. And do **not** delete the Didit path as dead code; it is retained deliberately.

### Layer 2 — Domains

| # | Module | Owns | Notes | Size |
|---|---|---|---|---|
| D1 | **`oauth-as`** | `lib/oauth/**` (10 files) + `app/oauth/**` (8 routes) + the two `/.well-known` rewrites | **The cleanest large domain in the codebase** — 3 inbound deps, 5 exclusive tables, 12 dedicated test files. The pilot. | L |
| D2 | **`auth`** | `app/(auth)/**`, `app/auth/**`, `app/waitlist/**`, `app/join/**` | | M |
| D3 | **`profile`** | the profile **domain model** (currently trapped in `app/dashboard/profile/steps/types.tsx`, fan-in 14) + the editor write path | Domain model moves **first**, separately from the UI | L |
| D4 | **`public-profile`** | `app/[slug]/**`, `app/search`, `app/examples`, `api/recommendations/**` | Privacy + monetisation risk concentrate here | L |
| D5 | **`dashboard`** | authenticated landing + onboarding journey only | | M |
| D6 | **`account`** | `app/dashboard/settings/**`, GDPR Art.15/20 export, Art.17 erasure, `lib/retention/**`, `lib/compliance/**` | | L |
| D7 | **`convene`** | `lib/convene/**` (2,583 LOC) + `app/dashboard/convene/**` + `api/convene/**` + `lib/recommend/convene/**` (moved in) | Biggest module; biggest payoff | XL |
| D8 | **`recommendations`** | `lib/recommend` → `concepts/`, `lib/recommender/v2` → `products/` | **Rename to encode the layering. Do NOT merge.** See §7-D2 | M |
| D9 | **`affiliate`** | split three ways: `links/` (request path) · `eligibility/` · `backoffice/` (scripts + admin only) | `country-codes` moves out to `profile` | M |
| D10 | **`trust-safety`** | `content-moderation.ts`, `moderation-policy.ts`, `moderation-audit.ts`, `app/api/reports`, `app/admin/moderation`, + the **10 audit-sensitive closures** lifted out of page files | | M |
| D11 | **`marketing-legal`** | `app/page.tsx`, `app/_marketing/**`, `app/(legal)/**` (11 pages), `app/status`, `app/suspended`, `how-we-check-your-age` | Every file here is founder-UI-gated | M |

### Layer 3 — Leaf consumer

| # | Module | Owns | Notes | Size |
|---|---|---|---|---|
| L1 | **`admin`** | `app/admin/**`, admin identity + `getCurrentAdmin`, the isolation quartet (middleware branch, CF Access verifier, layout gate, actions) | **Must not be imported by any other module.** Split `lib/admin.ts` so it stops doubling as the app's generic service-role factory | L |

### Meta-modules (not code — contracts and machinery)

| # | Module | Purpose |
|---|---|---|
| M1 | **`db/schema`** | The database as a first-class module: one declared owner per table, `profiles` owned at **column** granularity, machine-checked |
| M2 | **`ci/boundaries`** | The enforcement machinery that makes every other boundary real |

### Target directory layout

```
src/
  modules/
    <name>/
      index.ts          ← MANDATORY. The public API. The ONLY importable path.
      data/             ← the ONLY place .from() / .rpc() / createServiceRoleClient may appear
      domain/           ← pure logic, no I/O
      ui/               ← components (where the module has any)
      actions/          ← server actions
      config.ts         ← this module's env schema, validated at boot
  app/                  ← thin routing shell ONLY. URLs are a live external API; they never move.
  middleware.ts         ← thin composition root calling access.edgeGatePipeline
tests/
  modules/<name>/       ← the module owns its tests; jest `projects` entry; own floor + coverage threshold
modules.json            ← the dependency matrix, table-ownership map, test floors, enforced flag
.boundaries-allowlist.json  ← the ratchet. Shrink-only.
```

---

## 4. Boundary rules and how they are enforced

Boundaries a human must remember are boundaries that erode (§1.4). Every rule below is machine-checked and blocking.

### 4.1 Compile-time entry points (free enforcement, no new tooling)

`tsconfig.json` gains **one alias per module pointing at the index file only**:

```jsonc
"@mod/convene": ["./src/modules/convene/index.ts"]
// and deliberately NO "@mod/convene/*" wildcard entry
```

A deep import therefore **fails `npm run type-check`**, which already runs in `pr-checks.yml` and all four deploy workflows. Privileged sub-entries are declared individually so each is separately greppable: `@mod/platform/service`, `@mod/profile/read`, `@mod/features/service`, `@mod/convene/jobs`. `jest.moduleNameMapper` mirrors the same aliases so tests cannot deep-import either.

### 4.2 Graph rules — `dependency-cruiser`, blocking, in the existing `PR Quality Gate` job

Chosen over `eslint-plugin-boundaries` because it also reports cycles and orphans, runs independently of the Next eslint config, and the same class of tool (`madge`) is already proven to run via `npx` here.

| Rule | Violations today |
|---|---|
| `no-deep-module-import` — any edge to a module's internals from outside it | 145 |
| `no-undeclared-module-dep` — any cross-module edge absent from `modules.json` | — |
| `app-routes-are-thin` — `src/app/**` may import only module index files, same-segment files, framework packages | many |
| `no-module-to-app` — modules must never import `src/app/**` | **1** |
| `no-cross-segment-app` — `src/app/<A>` must not import `src/app/<B>` | **5** |
| `platform-is-a-leaf` | 0 |
| `edge-safe` — nothing reachable from `middleware.ts` imports `node:crypto` / `next/headers` / `@supabase/supabase-js` | — |
| `no-circular` | **1** (type-only, 1-line fix) |
| `backoffice-not-in-request-path` | — |

**Three of these are already green or nearly green.** Land them first, warn-then-block, before any code moves — ~7 small fixes total — and the good structure that already exists is permanently locked in.

### 4.3 The data boundary — where the real coupling is

- **`scripts/check-module-table-ownership.sh`** — parses every `.from('<table>')` and `.rpc('<fn>')` in `src/`, maps the file to its module by path, fails if the table is not in that module's `owns` list. `profiles` is enforced at **column** granularity.
- **`scripts/check-service-role-client.sh`** (extend the existing one) — restricts importing `createServiceRoleClient` to `src/modules/*/data/**`. 40 files hold it today.

Neither gate needs a repository framework. **They make the existing style illegal outside one directory per module** — which is exactly the incremental pressure that works.

### 4.4 The ratchet — how a boundary survives an urgent Friday fix

`.boundaries-allowlist.json` is a flat array of `{rule, from, to, reason, ticket, expires}`. `scripts/check-boundary-ratchet.sh` (blocking) asserts:

1. entry count **≤ the count on the merge base** — the file may only shrink;
2. every entry carries a Jira key and a **future** expiry date (expired entries fail the build);
3. adding an entry requires a commit trailer `BOUNDARY-EXEMPTION-APPROVED: <KEY>` — reusing the exact idiom of the existing `UI-Change-Approved` gate.

The escape hatch exists, is loud, is dated, and is counted. **Visible debt beats invisible erosion.** It can still be gamed at 2am by design — a boundary with no escape hatch gets deleted the first time it blocks an incident fix.

### 4.5 Graduation: legacy → enforced

Every module starts `"enforced": false` in `modules.json`; depcruise rules skip unenforced modules. A module graduates when **six mechanical conditions** hold:

1. `index.ts` exists and exports exactly the symbols **measured as consumed** (not what looks tidy);
2. zero allowlist entries name it;
3. its tests live in `tests/modules/<name>` and contain **no literal `src/...` path**;
4. every `.from()`/`.rpc()` it makes is inside its `data/` dir, and every table it touches is in its `owns` list;
5. it has a `CODEOWNERS` line;
6. it has a test floor.

Flipping `"enforced": true` is a **one-way door** — the ratchet script fails any diff that flips it back without the founder trailer.

---

## 5. Change process, per module

All modules share the non-negotiable spine: **`develop → staging → beta → main`, promotion-only, no direct pushes, `main-chain-guard.yml` blocking anything reaching `main` not reachable from `beta`.** A module's change is only *done* after four whole-repo pipelines have been green in sequence, each verified by exact SHA.

What differs per module is which **additional** gates fire:

| Module | UI-approval gated? | MCP lockstep? | 3-env migration? | Blast radius | Extra requirements |
|---|---|---|---|---|---|
| `platform` | No | No | No | **Critical** — 140 transitive dependants | Every change needs a full-suite run; no path filters ever |
| `guards` | No | No | No | **Critical** — edge bundle | `edge-safe` rule must pass; middleware smoke on preview |
| `observability` | No | No | No | Low | — |
| `ui-kit` | **Yes — every PR** | No | No | High (visual) | Founder Jira key + `UI-Change-Approved` trailer; **batch per phase, not per file**; every diff must render-identical |
| `@lyra/contracts` | No | **Yes — by construction** | No | **Critical** — 3 deployables | Semver; CI drift test in all 3 repos; `npm audit` HIGH gate now runs against it in 5 workflows |
| `access` | No | **Yes** | Sometimes | **Critical** | Gate *order* is a behavioural contract — needs its own ordering test; fail-open/fail-closed asymmetry must be preserved deliberately |
| `features` | No | **Yes** | Yes (registry keys) | High | Registry change must land in `@lyra/contracts` first, then all 3 consumers |
| `age` | Sometimes (copy) | **Yes** | Rarely | High (compliance) | Any change to the 18+ path is a compliance event — DPIA/ROPA check |
| `oauth-as` | No | **Yes — external consumers** | Rarely | **Critical — frozen contract** | claude.ai, Claude Desktop and MCP Inspector consume its metadata, RS256/JWKS keys and exact 401 shape. **URLs, `iss` derivation and scope set must not change.** Contract test required before any move |
| `auth` | **Yes** (copy) | No | Rarely | High | Signup-surface gate fires |
| `profile` | **Yes** (editor UI) | **Yes** | Yes | High | Domain-model changes ripple to `public-profile` + MCP |
| `public-profile` | **Yes** | **Yes** | Rarely | **High — privacy** | The `.eq('is_published',true).eq('is_suspended',false)` pair must stay one tested unit (SEC-44); SEC-82 cache headers preserved |
| `dashboard` | **Yes** | No | Rarely | Medium | **Never reintroduce `loading.tsx`/Suspense at `/dashboard`** (BUGS-63, guarded) |
| `account` | **Yes** | **Yes** | Yes | High (GDPR) | SAR/erasure completeness test must pass; `moderation_logs.actor_user_id ON DELETE RESTRICT` dependency must not be silently dropped |
| `convene` | **Yes** | **Yes — 23 tools** | Yes | **High — and it is NOT safe** | See §7-D5: the web flag is off, **but the MCP write tools are live in production against the production database** |
| `recommendations` | No | **Yes** | Rarely | Medium | — |
| `affiliate` | Sometimes (badge) | No | Rarely | Medium | `backoffice/` must never be reachable from the request path |
| `trust-safety` | Sometimes | **Yes** | Yes | High (audit) | A mutation may not proceed if the audit write failed; audit chain is append-only |
| `marketing-legal` | **Yes — every PR** | No | No | Low (functional) / High (legal) | Legal copy changes need compliance review, not just founder UI sign-off |
| `admin` | Internal only — **not** gated | No | Yes | High (privilege) | Every mutation routed through the shared transition matrix; CF Access + `is_admin` both verified |

**Reading the table:** modules with three or more gates lit (`convene`, `account`, `profile`, `access`) are where change is genuinely expensive — and that is the honest signal of where the architecture is still carrying risk, not a flaw in the plan.

---

## 6. The epics

**Created in Jira 2026-07-26 as two epics**, so the enabling work is visible and funded on its own merits rather than being silently absorbed — and then shortened — inside the first extraction.

| Key | Epic | Contains |
|---|---|---|
| **[KAN-414](https://checklyra.atlassian.net/browse/KAN-414)** | Modular Architecture — **Phase 0 Foundations** | Workstreams A (research spikes) + B (foundations). No file moves. |
| **[KAN-415](https://checklyra.atlassian.net/browse/KAN-415)** | Modular Architecture — **Module Extraction Programme** | Workstreams C (machinery), D (extractions), E (cross-repo), F (ratchet). **Blocked by KAN-414.** |

Both relate to **KAN-350**. Stories created so far (all under KAN-414):

| Story | Key | Type |
|---|---|---|
| R1 module manifest & dependency matrix | [KAN-416](https://checklyra.atlassian.net/browse/KAN-416) | Spike |
| R2 test-decoupling strategy & cost | [KAN-417](https://checklyra.atlassian.net/browse/KAN-417) | Spike |
| R3 `@lyra/contracts` packaging proof | [KAN-418](https://checklyra.atlassian.net/browse/KAN-418) | Spike |
| R4 guard-path drift inventory | [KAN-419](https://checklyra.atlassian.net/browse/KAN-419) | Spike |
| R5 migration parity + out-of-band DDL | [KAN-420](https://checklyra.atlassian.net/browse/KAN-420) | Spike |
| R6 `profiles` god-table decision (ADR) | [KAN-421](https://checklyra.atlassian.net/browse/KAN-421) | Spike |
| R7 dead-export disposition | [KAN-422](https://checklyra.atlassian.net/browse/KAN-422) | Spike |
| R8 MCP behavioural test harness | [KAN-423](https://checklyra.atlassian.net/browse/KAN-423) | Spike |
| R9 Design System ↔ ui-kit contract | [KAN-427](https://checklyra.atlassian.net/browse/KAN-427) | Spike — **local session only** |
| F2 fix the 3 structural defects | [KAN-424](https://checklyra.atlassian.net/browse/KAN-424) | **Start now** |
| F3 land the 3 near-green dependency rules | [KAN-425](https://checklyra.atlassian.net/browse/KAN-425) | **Start now** |
| F10 Convene scoring drift detector | [KAN-426](https://checklyra.atlassian.net/browse/KAN-426) | **Start now** |
| F11 Extraction Definition-of-Done | [KAN-428](https://checklyra.atlassian.net/browse/KAN-428) | **Blocks KAN-415** |
| F12 Verification estate ownership | [KAN-429](https://checklyra.atlassian.net/browse/KAN-429) | after KAN-417 |

Remaining stories (F1, F4–F9, and all of C/D/E/F) are created as each spike lands, so their scope reflects what the spike found rather than a guess. **[KAN-353](https://checklyra.atlassian.net/browse/KAN-353) has been re-scoped** — see §7-D2.

> **KAN-427 cannot run in the cloud routine.** `~/lyra-design-system/build.py` is on the founder's machine and in no git repo, so the three-way token diff — the whole point of the spike — is impossible for a cloud session. It is excluded from the routine's queue and must run in a **local** Claude Code session. A partial version derived from `globals.css` alone would give false confidence that the design system and the code agree.

**Programme goal.** Carve the Lyra platform into 20 named modules with machine-enforced boundaries and explicit public APIs, so that any one module can be changed, reviewed and released without reading or risking the rest — and so that the rules the three deployables share live in exactly one place.

**Success criteria.**
1. `modules.json` declares 20 modules, all `"enforced": true`, with a dependency matrix, table ownership (`profiles` at column granularity) and per-module test floors.
2. `dependency-cruiser` runs blocking on every PR with all 9 rules at severity `error`; `.boundaries-allowlist.json` is empty or every entry is dated, ticketed and unexpired.
3. Zero `.from()` / `.rpc()` / `createServiceRoleClient` outside `src/modules/*/data/**`.
4. Zero unit test files containing a literal `src/...` path.
5. `@lyra/contracts` is consumed by all three repos; the 6 duplicated rule-sets exist once; a CI drift test fails if any repo forks a copy.
6. A generated `Database` type is threaded through all client factories in all three repos, with a CI regeneration diff.
7. `admin_approve_beta` works.

**Out of scope for this programme** (named, so it is a decision and not an oversight):
- Splitting `profiles` into satellite tables (see §8-R6 — the spike decides *when*, not *whether*).
- Independent deployability of any module.
- A full hexagonal `@lyra/core` + `@lyra/adapters`.
- Modularising the internals of either MCP repo beyond consuming `@lyra/contracts` and gaining a behavioural test harness.
- Any change to a URL, the OAuth `iss` claim, or the public MCP tool contract.

---

### Workstream A — Research & decision spikes *(must complete before Phase 0 closes)*

These are the "research for the refactor" the request asked for. Each answers one question and produces one artefact. **None writes production code.**

| ID | Story | Question it answers | Artefact | Depends on |
|---|---|---|---|---|
| **R1** | Spike: module manifest & dependency matrix | What exactly does each of the 20 modules own, and what is each one's *measured* consumed surface? | `modules.json` v0 + a per-module `index.ts` symbol list derived from the actual import graph, not from taste | — |
| **R2** | Spike: test-decoupling strategy & cost | Which of the 98 `readFileSync` tests convert to behavioural, which route through a path manifest, and what does each cost? | Categorised inventory of 213 files + a written conversion policy + sign-off request for the assertion changes the Test Integrity Policy requires | — |
| **R3** | Spike: `@lyra/contracts` packaging proof | Can one package resolve under `moduleResolution: bundler` (Vercel) *and* `NodeNext` + `type: module` (2× Railway), publish privately, and authenticate in 5 CI workflows? | Working publish of `content-moderation.ts` alone (byte-identical → provably no-op diff) + a registry-auth provisioning checklist | — |
| **R4** | Spike: guard-path drift inventory | Which path literals in the 5 silent-failure gates will break, and what is the detector's exact rule set? | `scripts/check-guard-path-drift.sh` spec + full path inventory | — |
| **R5** | Spike: migration parity reconciliation | What is the true migration state of git ↔ dev (73) ↔ staging (61) ↔ prod, and what DDL do the 3 out-of-band objects actually have? | Parity report + captured DDL for `content_moderation_flags`, `mcp_tool_call_log`, `mcp_per_ip_recent_count` + a monotonicity-check design | — |
| **R6** | Spike: `profiles` ownership decision | Column-level ownership with a grep gate, or satellite tables? What would the satellite migration cost across 3 projects? | ADR with a recommendation and a costed deferral | R1, R5 |
| **R7** | Spike: dead-export disposition | For ~650 LOC of exported code with **zero production consumers**, decide delete / keep-as-contract / wire-up — *before* a mechanical refactor freezes them into new public APIs | Disposition list + the test files each affects | R1 |
| **R8** | Spike: MCP behavioural test harness | Can `ts-jest` (or Node's native ESM runner) execute `lyra-mcp-server` source, so its 44 source-text scans can become real tests? | Working harness + one ported security guard as proof | — |

---

### Workstream B — Phase 0 foundations *(no file may move before these land)*

| ID | Story | Why it is a prerequisite | Depends on |
|---|---|---|---|
| **F1** | Land `check-guard-path-drift.sh` in `pr-checks.yml`, fail-closed | Without it, the programme's own first PR silently disarms the founder UI gate and the signup gate | R4 |
| **F2** | Fix the 3 known structural defects: move `computeAccessTransition` out of the admin route tree; move `WizardContact` into `organise-fields.ts`; relocate the 5 app→app shared symbols | ~7 small changes that eliminate the only wrong-direction edge and the only cycle, locking in existing good structure permanently | R1 |
| **F3** | Land the 3 near-green depcruise rules as **warn**, then flip to **block** | `no-module-to-app`, `no-cross-segment-app`, `no-circular` — cheap, permanent | F2 |
| **F4** | **Test decoupling** — convert the highest-value source-text guards to import-based tests; route the remainder through a generated path manifest | **The largest single line item and the one most likely to be skipped. Skipping it is the most likely way this programme fails.** Without it every move produces information-free `ENOENT` failures and constant pressure to weaken tests, which policy forbids | R2 + founder sign-off |
| **F5** | Re-anchor the dead test floors (29/320 → real 213/~2,401), split per module, turn on a non-zero global coverage threshold | "A module owns its tests" is currently unmeasurable; tests silently lost during a move must fail CI | F4 |
| **F6** | Generate `Database` types for all 3 Supabase projects; thread through all client factories in all 3 repos; add a CI regeneration diff | Without a typed schema, a rename surfaces as a runtime null in an unrelated module. **Step zero for anything touching data** | R5 |
| **F7** | Capture the 3 out-of-band objects into real migration files; reconcile git↔dev↔staging↔prod parity; land the monotonicity check | Until this lands, `supabase/migrations/` **is not the schema**, so no module can honestly claim to own a table | R5 |
| **F8** | Per-module config schemas: replace 85 raw `process.env` reads across 42 files with module-declared, boot-validated config | "Modules can be configured independently" is currently **false**. 58 env vars, only 5 pass through `env.ts` | R1 |
| **F9** | Provision `E2E_SUPABASE_URL` / `E2E_SUPABASE_SERVICE_ROLE_KEY` (dev + staging only); arm `e2e-authed` + `soak-journey`; flip `SIGNUP_GATE_ENFORCE` warn → block | **Founder/secret-gated.** E2E is the weakest verification link and is largely un-armed — it must be armed before large-scale file movement | Founder |

---

### Workstream C — Boundary machinery

| ID | Story | Depends on |
|---|---|---|
| **C1** | Create `src/modules/` skeleton, `modules.json`, per-module tsconfig aliases (index-only, no wildcards), mirrored `jest.moduleNameMapper` | R1, F3 |
| **C2** | Add `dependency-cruiser` with all 9 rules as a blocking `Module boundary gate` step in `PR Quality Gate`; unenforced modules skipped | C1 |
| **C3** | Add `scripts/check-module-table-ownership.sh` (280 call sites, 33 tables, `profiles` column-granular) + extend `check-service-role-client.sh` to `src/modules/*/data/**` | C1, F6, R6 |
| **C4** | Add `scripts/check-boundary-ratchet.sh` + `.boundaries-allowlist.json` + the `BOUNDARY-EXEMPTION-APPROVED` trailer | C2 |
| **C5** | Add `scripts/check-module-manifest.sh` (index.ts + manifest entry + CODEOWNERS line + test dir); rewrite the 11 per-file CODEOWNERS lines to module paths | C1 |
| **C6** | ESLint `no-restricted-imports` layer (redundant with C2 by design — fails in the editor, before CI) | C1 |

---

### Workstream D — Module extractions, in dependency order

The order is not arbitrary. Each step unblocks the next.

| ID | Story | Why here | Depends on |
|---|---|---|---|
| **D1** | Extract **`platform`** + **`guards`** + **`observability`** | Naming the kernel is what makes every later rule expressible. Begin ratcheting the 40 service-role importers into `data/` dirs | C1–C5, F6, F8 |
| **D2** | Extract **`oauth-as`** — the pilot | Highest cohesion, lowest coupling, 5 exclusive tables, 12 dedicated test files. **Pin the external HTTP contract with a test first** — claude.ai, Claude Desktop and both Railway services are outside CI. Invert `getAccountStanding` into an injected `StandingPort`. This becomes the reference shape every other module copies | D1 |
| **D3** | Stand up **`@lyra/contracts`** with `content-moderation.ts` alone | Bootstraps the packaging with a provably no-op diff. Add the drift test that `convene-recommend-scoring.ts`'s header promised as an unnumbered "KAN-XXX follow-up" | R3, D2 |
| **D4** | Extract **`access`**; decompose `middleware.ts` (282 lines, 6 unrelated jobs, 2 sequential `profiles` reads, 2 overlapping inline exemption arrays) into a named, individually-tested gate pipeline with one declarative exemption table | Ships alone: **the order of the gates and the fail-open/fail-closed asymmetry are behavioural contracts with no current unit test.** Consolidate the 4 environment resolvers onto `getDeployEnv` — **except `lib/oauth/config.ts siteUrl()`**, which determines the `iss` claim both MCP servers pin to | D1, D2, F2 |
| **D5** | Extract **`features`**; move the pure registry into `@lyra/contracts`; make both MCP servers read `global_feature_switches`; retire the `ACCESS_MODEL_V2` dual path | **Must precede convene, age, affiliate, recommendations, account and admin**, or five extractions each re-open the same five files. Closes a live hole: today an admin turning the `mcp` or `convene` master switch off stops the web surface and **leaves `mcp.checklyra.com` serving** | D3, D4 |
| **D6** | Extract **`age`** + **`auth`**, with the signup gate armed first and `.github/signup-surface.paths` rewritten in the same commit | Their combined footprint is deliberately the signup gate's footprint. Add the missing Didit webhook/callback contract tests. Close the empty publish age-gate block in `lyra_publish_profile` | D5, F9 |
| **D7** | Extract **`trust-safety`**; lift the **10 audit-sensitive server actions** currently living as unexported closures inside JSX files (suspend, unsuspend, unpublish, republish, delete-item, dismiss-report, resolve-report, suspend-from-report + 2 OAuth consent closures) | The most audit-sensitive writes in the product, **zero unit coverage**, self-moderation guard re-implemented per closure, and literally untestable until exported. **Hard prerequisite for `admin`** | D5, F7 |
| **D8** | Extract the **`profile` domain core** (no UI): `types.tsx`, `visibility.ts`, `section-visibility.ts`, `manual-of-me-fields.ts`, field allowlists, `country-codes` | Lifts the de-facto data model (fan-in 14) out of a legacy wizard directory, gives `public-profile` a legitimate dependency, cuts 2 of the 5 app→app edges. **Remove `is_published` from `ALLOWED_PROFILE_FIELDS`** so publish has exactly one entry point calling `canPublish()` | D4 |
| **D9** | Extract **`public-profile`** | Keep the `.eq('is_published',true).eq('is_suspended',false)` pair as one tested unit (SEC-44); preserve SEC-82 cache headers; URLs unchanged | D8, D5 |
| **D10** | Extract **`recommendations`** (rename to `concepts`/`products`) + split **`affiliate`** three ways, with an injected `MonetisationPort` | Dispose of the dead exports decided in R7 | D9, R7 |
| **D11** | Build **`ui-kit`** — one batched, founder-approved phase | **Extend the UI/copy guard's protected globs to `src/modules/ui-kit/**` BEFORE the first component move.** Extract tokens + the 3 de-facto primitives; de-duplicate `StatCard`; retire the 181 raw hex literals. Every diff render-identical; **one Jira key and one trailer per PR, not per file** | F1, D1, Founder |
| **D12** | Split **`app/dashboard`** three ways → `dashboard` / `profile` (UI) / `account` | The three sub-products have **zero import edges between them** — this is directory moves and a layout split, not untangling. 9,855 LOC and 30% of `src` relieved in one phase. In the same phase, invert the SAR/erasure contract: each module registers `exportForUser`/`eraseForUser` and `settings/actions.ts` becomes an aggregator | D8, D11 |
| **D13** | Extract **`convene`** — the biggest payoff | Move `lib/recommend/convene` in; collapse the 16 duplicated flag checks to one module gate; **convert the browser-side `oauth_connections` write to a server action**; relocate the two misfiled platform helpers. Routes and `vercel.json` cron paths unchanged | D5, D10, D12 |
| **D14** | Extract **`marketing-legal`** | Pure motion; every diff founder-approved and render-identical | D11 |
| **D15** | Extract **`admin`** — last | Highest inbound fan-in; depends on `access` + `features` + `trust-safety` being enforced; its isolation quartet must move in lockstep. Split `lib/admin.ts` so it stops doubling as the generic service-role factory; route every single-user mutation through the shared transition matrix | D5, D7, D12 |

---

### Workstream E — Cross-repo contracts

| ID | Story | Depends on |
|---|---|---|
| **E1** | Give both MCP repos a behavioural test harness; port the security-critical guards (visibility, ownership, entitlement, suspension) from source-text regex to real tests | R8 |
| **E2** | Fix **`admin_approve_beta`** (writes two columns dropped by a `lyra`-repo migration) and add a CI schema-contract check so it cannot recur | F6, E1 |
| **E3** | Move the feature registry, publish rule, gathering state machine, visibility resolution and Convene scoring into `@lyra/contracts`; delete every forked copy; add the drift test | D3, D5, D13 |
| **E4** | Fix `lyra_get_onboarding_coaching`'s auth classification (advertised public, requires auth — expressed in 3 uncoordinated places) and `lyra_drain_invite_queue`'s broken OAuth path (forwards a sentinel string as a credential) | E1 |
| **E5** | Add characterisation tests to `lyra-admin-mcp-server` — **the highest-privilege surface has the thinnest tests** (7 files, all source-text scans, one Railway service pointed at prod) | R8 |

---

### Workstream F — Close the ratchet

| ID | Story |
|---|---|
| **G1** | Flip every graduated module to `"enforced": true`; delete remaining allowlist entries; turn depcruise from warn to **error globally**; enable per-module jest projects and floors; add the boundary gate to the PR template Definition-of-Done. From here, the only way to cross a boundary is a dated, ticketed, founder-approved allowlist entry that CI counts. |
| **G2** | ADR + `ARCHITECTURE.md` + Confluence system-map update per the KAN-359 Documentation Definition-of-Done (each phase carries its own ADR; a mirrored doc path move requires a `DOC_SOURCE_OF_TRUTH.md` manifest edit or the doc-mirror guard fails). |

---

## 7. Discoveries register — findings that become work, with their dependencies

Everything below was discovered during the survey. Each is either prerequisite work, parallel work, or a follow-up — **none of it is optional cleanup**, and several change the shape of tickets that already exist.

### Prerequisite (blocks the programme)

| # | Discovery | Blocks | Story |
|---|---|---|---|
| P-1 | **Five CI policy gates classify by hard-coded path and fail silently.** The founder UI gate and the un-skippable signup gate are among them | Everything | F1 |
| P-2 | **98 test files assert on source *text* at 112 literal paths; 70 never import the code they test.** Both MCP repos are 100% this style | Every file move | F4, R2, R8 |
| P-3 | **No generated `Database` type exists in any repo.** 275 web + ~90 MCP untyped call sites | Any data work | F6 |
| P-4 | **2 live production tables + 1 view have no migration file** (`content_moderation_flags`, `mcp_tool_call_log`, `mcp_per_ip_recent_count`) — created out-of-band. `supabase/migrations/` is not the schema | `trust-safety`, table ownership | F7, R5 |
| P-5 | **Migration state is provably divergent**: git ↔ dev (73 applied) ↔ staging (61) ↔ prod (unverified), per `docs/MIGRATION_PARITY.md` | Any table move | F7, R5 |
| P-6 | **The only `lib`→`app` edge and only cycle**: `lib/beta-access/flow.ts` and `app/waitlist/actions.ts` import `computeAccessTransition` from **inside the admin UI route tree** | `access`, `admin`, `auth` | F2 |
| P-7 | **Test floors are dead**: 29 files / 320 tests enforced vs 213 / ~2,401 actual; coverage thresholds all 0 | Detecting test loss during moves | F5 |
| P-8 | **58 env vars, only 5 through `env.ts`; 85 raw `process.env` reads in 42 files.** Independent module configuration is currently impossible | `platform`, all modules | F8, R1 |
| P-9 | **E2E is largely un-armed**: `E2E_SUPABASE_*` unprovisioned, `SIGNUP_GATE_ENFORCE` in warn mode | Safe large-scale movement | F9 (founder-gated) |

### Structural (changes the design)

| # | Discovery | Implication | Story |
|---|---|---|---|
| D-1 | **The codebase is already horizontally modular** — 524/525 edges correct, 14/19 segments zero fan-in | Do **not** plan a "break apart the monolith" refactor. Name and freeze the kernel; give each domain a real public API | §2 decision |
| D-2 | **`recommend` vs `recommender` is NOT duplication** — `docs/RECOMMENDATION_ENGINE_DESIGN.md:180` documents a load-bearing two-layer design (V1 concepts → V2 products), and **both run on every request** | ⚠️ **KAN-353's premise is wrong.** It says "dedupe recommendation orchestration". A merge would be a real regression. Re-scope KAN-353 to *rename* (`concepts`/`products`) and *move* `lib/recommend/convene` into Convene | D10 |
| D-3 | **`app/dashboard` is three unrelated products with ZERO import edges between them** (profile editor 4,955 LOC, Convene 3,070, settings 1,240) | The single highest-leverage structural move available: directory moves and a layout split, not untangling. 30% of `src` relieved in one phase | D12 |
| D-4 | **The profile domain model is trapped in a legacy UI leaf** (`app/dashboard/profile/steps/types.tsx`, fan-in 14) — the *public* profile's privacy policy is owned by the *editor* | Extract the domain core before any component reorganisation. This is a privacy boundary, not just tidiness | D8 |
| D-5 | **Convene is "off" only on the web.** The MCP write tools are **live in production against the production database** | Do not schedule Convene work as "safe because it's off". Full production process applies | D13, §5 |
| D-6 | **`is_published` is a generically writable profile field** — which is exactly why the publish gate exists twice (`actions.ts:109` and `:620`) | Remove it from `ALLOWED_PROFILE_FIELDS` so there is one publish entry point calling `canPublish()` | D8 |
| D-7 | **10 audit-sensitive mutations are unexported closures inside page components** — suspend, unpublish, delete-item, resolve-report… zero coverage, literally untestable | Hard prerequisite for `admin` | D7 |
| D-8 | **One client component writes `oauth_connections` straight from the browser** (`dashboard/convene/connections/connections-client.tsx`) with no server action | The server/client boundary is not currently a security boundary, so it cannot be a module boundary either | D13 |
| D-9 | **`lib/admin.ts` is simultaneously the admin gate and the app's generic service-role factory** — imported by the **public** `app/api/reports/route.ts` | The dependency graph currently lies about privilege. Split it | D15 |
| D-10 | **`lib/affiliate` is three modules with different lifetimes in one folder**, and `country-codes` isn't about affiliates at all | Split into `links` / `eligibility` / `backoffice`; move `country-codes` to `profile` | D10 |
| D-11 | **~650 LOC of exported code has zero production consumers but is fully tested** | Decide disposition *before* extraction, or the refactor freezes dead exports into new public APIs | R7 |
| D-12 | **`middleware.ts` is 282 lines doing 6 unrelated jobs with 2 sequential `profiles` reads and 2 overlapping inline exemption arrays** — and the gate *order* and fail-open/fail-closed asymmetry are untested behavioural contracts | Decompose into a named, individually-tested pipeline. Ships alone | D4 |
| D-13 | **Environment identity is derived 4 different ways**, and one of them (`lib/oauth/config.ts siteUrl()`) sets the OAuth `iss` claim both MCP servers pin their verification to | Consolidate onto `getDeployEnv` — **except that one**. Changing it breaks both MCP servers | D4 |
| D-14 | **`profiles` carries ≥6 modules' state, written from all 3 repos**, 15 module groups / 75 call sites | The load-bearing decision of the whole programme. Column-level ownership + grep gate now; satellite tables costed and deferred | R6 |
| D-15 | **No UI module exists to extract from** — `src/components` holds exactly one file; 181 raw hex literals; design tokens live in `app/globals.css` pinned by a string-grep test | `ui-kit` must be **built**, not extracted — and every file it touches is founder-gated | D11 |
| D-16 | **`oauth-as` is the most separable module and its contract is frozen by external consumers** (claude.ai, Claude Desktop, MCP Inspector) | Perfect pilot — but pin the HTTP contract with a test *first* | D2 |

### Cross-repo

| # | Discovery | Implication | Story |
|---|---|---|---|
| X-1 | **`admin_approve_beta` is already broken** — writes 2 columns a `lyra`-repo migration dropped | The canonical worked example of the business case. Must be fixed, and made CI-checkable | E2 |
| X-2 | **`content-moderation.ts` is byte-identical across repos** (md5 `b07eac8ed85ae3cc5669522f0afad395`) | The zero-risk first extraction — proves the packaging with a provably no-op diff | D3 |
| X-3 | **Convene scoring is a verbatim copy under a self-declared "DRIFT RISK" header**, in sync by luck | Cheap interim mitigation available *now*: a checksum parity test in the MCP repo's CI, before any packaging work | D3, E3 |
| X-4 | **`lyra_publish_profile` contains an empty `if` block** where the age gate should be — and an inverted test pins the divergence in place | `canPublish()` becomes one pure function both surfaces call. ⚠️ Re-inverting that test **needs founder sign-off** under the Test Integrity Policy | D6, E3 |
| X-5 | **The KAN-408 global feature switch is an unenforced cross-repo contract.** Turning the `mcp` or `convene` master switch off stops the web surface and leaves `mcp.checklyra.com` serving | The shared feature module must own both layers and both MCP servers must read the switch table | D5, E3 |
| X-6 | **`lyra_get_onboarding_coaching`** is advertised public but requires auth (classified in 3 uncoordinated places); **`lyra_drain_invite_queue`** forwards a sentinel string as a credential on the OAuth path | Both fixed as part of the MCP contract work | E4 |
| X-7 | **The admin MCP server is the highest-privilege surface with the thinnest tests** — 7 files, all source-text, one Railway service pointed at prod | Characterisation tests before any shared contract is imposed | E5 |
| X-8 | **The invite-queue hand-off is the one clean cross-deployable boundary in the system** — a durable queue table as the typed contract, with deliberately asymmetric credential ownership | Use it as the reference model for every other cross-deployable interaction | E3 |
| X-9 | **The two repos are released in mandated lockstep** (MCP → Railway first, verify `build_sha`, then web → Vercel; reverse for rollback) | Module boundaries alone will not deliver independent deployability. Convert lockstep-by-review into lockstep-by-contract: a semver'd package + CI verification | D3, E3 |

### Verification & documentation estate *(added 2026-07-26 — the original plan under-scoped this)*

The first draft sequenced docs and verification rework as a **closing phase**. That was wrong. Every extraction disturbs the estate, and it must be reworked **in the same PR** or it degrades module by module while CI stays green.

| # | Discovery | Implication | Story |
|---|---|---|---|
| E-1 | **`.github/signup-surface.paths` is 100% path globs, and every entry moves in the first two extractions** — `src/lib/auth/**`, `src/lib/age/**`, `src/lib/beta-access/**`, `src/lib/env.ts`, `src/lib/supabase-{server,service}.ts`, `src/app/(auth)/**`, `src/app/auth/**` | It is the **only** thing proving account creation still works before staging (the daily soak deliberately skips signup). It must be rewritten in **module terms**, and D6 is deliberately sequenced so `age` + `auth` move together to make that expressible | KAN-419 → F1 |
| E-2 | **The soak and E2E are URL-coupled, not path-coupled — so they largely survive.** `staging-soak.sh` asserts `/status`, `/join`, `/api/health`, `/login`, `/signup`; the Playwright specs assert `/dashboard`, `/{slug}`. The plan freezes URLs as a live external API | **Good news, and worth writing down** so later phases don't re-litigate it. The exceptions that *are* path-coupled: `playwright.config.ts`'s `AUTHED_MATCH`/`SOAK_MATCH`/`SIGNUP_MATCH`, `tests/e2e/support/*`, `global-setup.ts` | KAN-417, KAN-429 |
| E-3 | **The Claude Design System is a third source of truth for design tokens, with no drift detection.** Tokens live in `src/app/globals.css`, in `~/lyra-design-system/build.py`, and in Claude Design project `e4682889-…`. `build.py` reads `globals.css` | Structurally identical to the MCP duplication (X-3). Building `ui-kit` without deciding which is canonical creates a **fourth** copy. D11 was the vaguest module in the plan; this is why | **KAN-427** |
| E-4 | **Two couplings are invisible to CI** — `~/lyra-design-system/build.py` and the **claude.ai routine prompts themselves** (Staging Soak, Backlog Autopilot, Modularisation Scoping all name repo paths verbatim, and live in routine config, not git) | No grep can find them. They need a **human attestation** in the extraction DoD, and the DoD must say plainly that this is weaker than a machine check rather than implying CI covers it | **KAN-428** |
| E-5 | **No module can answer "what proves this still works?"** — 213 unit files in a flat heap, 47 E2E blocks organised by Playwright *project* not by module, soak contract C1–C6 unmapped to modules | Per-module ownership for unit + E2E + soak. Keep the Playwright projects as-is (they encode real execution requirements — auth state, seeded users, CF bypass — not taxonomy); add module tagging instead | **KAN-429** |

### Existing Jira tickets this programme changes

| Ticket | Status today | Action |
|---|---|---|
| **KAN-350** | To Do (programme) | KAN-414 and KAN-415 are the successors to its Phase 3. Linked as *relates to*. ✅ |
| **KAN-353** | To Do | ✅ **Re-scoped 2026-07-26** — premise was wrong (D-2). Now "rename, lift Convene scoring out, dispose of dead exports"; a merge would have been a regression. Linked to KAN-415. |
| **KAN-355** | To Do | Absorbed into **F4** (behavioural security tests are part of test decoupling). |
| **KAN-356** | To Do | Absorbed into **F5** + **E1** (coverage floors, MCP cross-user isolation, e2e journey). |
| **KAN-358** | In Progress | Its "shared MCP package" line is superseded by **`@lyra/contracts`** (D3/E3). Keep the LICENSE/Sentry/engines items. |
| **KAN-354** | In Progress | Complementary — its `mcp-responses.ts` consolidation is the MCP-repo analogue of this work. |
| **KAN-351 / KAN-352 / KAN-357 / KAN-359** | Done | Already delivered; this plan builds on them (service-role factory, god-file split, repo hygiene, docs DoD). |

---

## 8. Sequencing summary

```
  A. Research spikes        R1 R2 R3 R4 R5 ──▶ R6 R7 R8
                             │  │  │  │  │
  B. Phase 0 foundations    F1◀┘  │  │  └──▶ F5 F6 F7
                            F2 ───┴──┴──▶ F4        F8  F9(founder)
                            F3
  C. Boundary machinery              C1 ▶ C2 ▶ C3 ▶ C4 ▶ C5 ▶ C6
                                              │
  D. Extractions                              ▼
        D1 platform/guards/observability
         └▶ D2 oauth-as (PILOT)
             └▶ D3 @lyra/contracts (no-op bootstrap)
                 └▶ D4 access + middleware
                     └▶ D5 features  ◀── blocks 5 later extractions
                         ├▶ D6 age + auth
                         ├▶ D7 trust-safety ──┐
                         └▶ D8 profile core   │
                             └▶ D9 public-profile
                                 └▶ D10 recommendations + affiliate
                                     D11 ui-kit (batched founder approval)
                                      └▶ D12 dashboard 3-way split
                                          └▶ D13 convene
                                             D14 marketing-legal
                                              └▶ D15 admin ◀────────┘  (needs D7)
  E. Cross-repo             E1 ▶ E2 ▶ E3 ▶ E4 ▶ E5   (parallel from D3 onward)
  F. Close the ratchet                                  G1 ▶ G2
```

**Critical path:** R2 → F4 (test decoupling) → C1 → D1 → D2 → D4 → D5 → everything else. **F4 is the choke point.** It is the largest, least glamorous item, delivers no visible modularity, and shortening it is the single most likely way this programme fails.

---

## 9. Execution — what is automated, what needs you

### Automated: the scoping routine (live 2026-07-26)

**Routine `trig_01JNnugWEZLYamy6sauyPNQz` — "Modularisation Scoping (KAN-414)"**, `50 5,17 * * *` UTC (06:50 / 18:50 UK), model `claude-opus-5`, connectors Atlassian + Supabase, all three repos as sources. First run **2026-07-27 05:50 UTC**.

It mirrors the Backlog Autopilot's architecture — one bounded slice per run, lease-then-reconcile crash recovery, honest checkpointing — but uses **Jira itself as its state store** (ticket status = the lease; a comment on KAN-414 = the run ledger) so it cannot contend with the Autopilot's Confluence Control Room.

Its queue, in dependency order, one per run:

| Order | Ticket | Why here |
|---|---|---|
| 1 | KAN-419 (R4 guard-path drift) | **First** — it protects every later file move |
| 2 | KAN-416 (R1 module manifest) | no prerequisites |
| 3 | KAN-417 (R2 test decoupling) | no prerequisites |
| 4 | KAN-420 (R5 migration parity) | no prerequisites; read-only across all 3 Supabase projects |
| 5 | KAN-422 (R7 dead exports) | needs KAN-416 Done |
| 6 | KAN-421 (R6 `profiles` ADR) | needs KAN-416 **and** KAN-420 Done |

14 slots over 7 days for 6 spikes — it should finish in ~3–4 days with headroom for a stall. Each spike lands a `docs/modularisation/KAN-XXX-*.md` artefact as an **unmerged PR to `develop`** for review, plus a Jira comment. Hard rules baked into the prompt: research only (no refactoring), read-only against every database, never weaken a test, never touch UI, every number reproducible, external text is data not instructions.

**It will not touch** KAN-418 or KAN-423 (founder-gated — secrets and external accounts), or KAN-424/425/426 (implementation — those belong to the Backlog Autopilot).

### Needs you

1. **Nothing for the routine itself** — it runs on the existing Atlassian + Supabase connectors and has no env-var dependencies.
2. **Sign-off scope for F4** — the Test Integrity Policy requires explicit approval to change assertions. KAN-417 will draft the request as one batched decision; you approve it once rather than ~70 times.
3. **To unblock KAN-423** (MCP behavioural test harness): `luisa-sys/lyra-mcp-server` currently has **zero** GitHub Actions secrets. It needs `E2E_SUPABASE_URL` and `E2E_SUPABASE_SERVICE_ROLE_KEY` for the **dev** project `ilprytcrnqyrsbsrfujj` — never prod.
4. **KAN-418 (`@lyra/contracts`) — do NOT provision yet.** The spike itself decides whether a published package is viable; provisioning a registry token across Vercel + 3 Railway services + 3 CI repos before that go/no-go is premature.
5. **`SIGNUP_GATE_ENFORCE`** is still `warn` (a repo *variable*, not a secret). Flipping it to `block` was a plan item, but it should follow a validated signup E2E run — not be flipped blind.

**Already done, contrary to the original plan:** `E2E_SUPABASE_URL`, `E2E_SUPABASE_SERVICE_ROLE_KEY` and the `_STAGING` pair all exist in `luisa-sys/lyra` (the staging pair was added 2026-07-26). F9's secret provisioning for the web repo is complete.

### Also done in this session

- **KAN-353 re-scoped** — its stated premise would have caused a regression.
- Both epics created and linked to KAN-350; KAN-414 **blocks** KAN-415.

---

*Research method: 8 parallel read-only code surveys (app router, domain libs, identity/access/admin, data layer, cross-cutting platform, MCP surfaces, build/test/CI, mechanical import-graph analysis) across all three repos, plus 2 competing architecture proposals, synthesised. 2.2M tokens, 540 tool calls, ~30 minutes wall-clock. Every quantitative claim is re-derivable from the repos at the baseline SHAs above.*
