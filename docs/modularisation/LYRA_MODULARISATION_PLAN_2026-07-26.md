# Lyra Modularisation Programme — Target Architecture, Boundaries & Staged Refactor Plan

**Date:** 2026-07-26
**Baseline surveyed:** `lyra` @ `origin/develop` `ee647e6`, `lyra-mcp-server` @ `main` `9bebfa4`, `lyra-admin-mcp-server` @ `main` `435f28f`
**Method:** 8 parallel read-only code surveys + 2 competing architecture proposals, synthesised. Every number below is re-derivable from the repos.
**Relationship to existing work:** this is the successor programme to **KAN-350** Phase 3. It absorbs, re-scopes or depends on KAN-353, KAN-355, KAN-356, KAN-358 (see §7).

> ## 🔴 SUPERSEDED — the deferral below was REVERSED on 2026-08-04. READ THIS FIRST.
>
> **The extraction programme is RE-OPENED and IN FLIGHT.** As of 2026-08-10, `src/modules/`
> holds live code on `main`: `access` (16 files), `oauth-as` (10), `guards` (10),
> `platform` (6), `observability` (2), plus `features`, `age` and `auth` in flight.
> **D1, D2, D3 and D4 are DONE.** Verify with `git ls-files src/modules/`, not with this
> document.
>
> Two paragraphs below still read *"the extraction programme D1–D15 is DEFERRED"* and
> *"No file moves into `src/modules/` under the current scope"*, and the Workstream D
> section repeats it. **Both were true on 2026-07-28 and are false now.** They are left
> in place rather than deleted because this is a dated plan and rewriting a founder
> ruling would destroy the record of what was decided when — but a session acting on
> them today would refuse work that is already approved, already merged, and already in
> production.
>
> **Authoritative current state:** [`RE-DECISION-2026-08-09.md`](./RE-DECISION-2026-08-09.md)
> for the ruling, `modules.json` for module ownership, and the KAN-415 section of the
> repo-root `CLAUDE.md` for the live sequencing table. Convene is **permanently out**
> ([`CONVENE-DEFERRED.md`](./CONVENE-DEFERRED.md), KAN-470) unless Convene itself is
> turned back on.

> **⚠️ Baseline re-validated 2026-07-28 against `674f0a7`** — see [`PLAN-REVALIDATION-2026-07-28.md`](./PLAN-REVALIDATION-2026-07-28.md) (KAN-432). Unless a figure is explicitly marked *re-validated*, every number below is **as-surveyed 2026-07-26** and should be re-derived before it is relied on.
>
> **🔴 REVERSED 2026-08-04 — see the banner at the top of this file. The ruling below is a dated record, not current instruction.**
>
> **⚠️ SCOPE RULING — founder decision, 2026-07-28 (KAN-432 §5, option A): the extraction programme D1–D15 is DEFERRED.** The adopted scope is **Phase 0 in full + `@lyra/contracts` + the data boundary (C3) + the `profiles` ADR**. D1–D15 are not cancelled — they are re-decided after Phase 0, on evidence measured against a decoupled test estate and a typed schema, rather than on the 2026-07-26 survey. The reasoning is in §2.2 and §6. **No file moves into `src/modules/` under the current scope.**

---

## 1. What the survey actually found (and why it changes the plan)

The instinct behind this request — "the code is tangled, break it into modules" — turns out to be **half right, and the wrong half is the expensive one.**

### 1.1 The code is already horizontally modular

The static import graph of `src/` is 273 nodes and 525 edges (**re-validated 2026-07-28: 274 nodes / 527 edges**). Of those:

| Measure | 2026-07-26 | Re-validated 2026-07-28 | Meaning |
|---|---|---|---|
| `lib` → `app` edges (wrong-direction) | **1** | **0** ✅ | Was `lib/beta-access/flow.ts` → `app/admin/users/users-actions-shared.ts`. **Fixed by KAN-424 / PR #596.** |
| `app` segment → `app` segment edges | **5** | **3** ⚠️ | 14 → **16** of 19 route segments have **zero** fan-in. Partially fixed; see §7-P-6 and BUGS-80 |
| Import cycles | **1** | **1** ❌ | type-only, inside `app/dashboard/convene/organise`, one line to fix — **still open**, see BUGS-80 |
| Cross-group edges | 328 | **336** | of which **145 (44%)** → **142 (42.3%)** are deep imports into another area's internals |
| `index.ts` barrels in 272 files | **4** | **5** | mediating just **9 of 328** → **10 of 336** cross-group edges |

**Definition — "deep import":** an edge into a file *inside* another group's directory that does not go via that group's barrel, where a group is `src/<area>/<segment>`. Stated explicitly because two other plausible readings of the same phrase give 24 (7.1%) and 326 (97%); the figure above is not meaningful without this definition, and a headline whose definition has to be reverse-engineered is not "re-derivable from the repos".

524 of 525 edges already pointed the right way; **re-validated, 527 of 527 do.** **There is no monolith to break apart.** A "decompose the tangle" refactor would spend its budget on a problem that does not exist.

### 1.2 The coupling that *does* exist is vertical — into an unnamed kernel and into the database

| Coupling | Evidence |
|---|---|
| Unnamed kernel | `lib/supabase-server.ts` fan-in 46 · `lib/supabase-service.ts` 39 · `lib/env.ts` 17 (140 transitive dependants) · `lib/admin.ts` 17 |
| No repository layer | **280 `.from('table')` call sites over 33 tables**; 199 (71%) sit inside route/page/action files. Exactly one file in the codebase is named as a repository (`lib/convene/invites/repository.ts`) |
| RLS bypassed everywhere | `createServiceRoleClient()` imported in **40 files** in `src/`; **both MCP servers use the service-role key for 100% of traffic** |
| `profiles` is a god-table | touched by **15 module groups over 75 call sites** — **re-validated 2026-07-28: 17 groups over 77 call sites, i.e. WORSENING** — carrying identity + access model + admin flags + suspension + age + discovery hashes + delivery country + recommender attributes + section-visibility JSON + dashboard widget state |
| No typed schema | **No generated `Database` type in any of the three repos.** Every row is `any`, every column a string literal — **re-validated 2026-07-28: still none** |

**Re-validated 2026-07-28.** The four kernel fan-in figures reproduce **exactly** (`supabase-server` 46, `supabase-service` 39, `env.ts` 17, `admin.ts` 17) under an independent graph rebuild — that exactness is the calibration check for every other number in this section. `.from()` sites 280 → 277 over the same 33 tables, service-role importers 40 → 39, `auth.getUser()` files 37 → **41** (worsening): all unchanged in substance. **The vertical coupling this section identifies is flat or getting worse, while the horizontal structure in §1.1 improved.** That asymmetry is the central input to the 2026-07-28 scope ruling — see §2.2.

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

| | Web app (2026-07-26) | Web app — re-validated 2026-07-28 | lyra-mcp-server | admin-mcp |
|---|---|---|---|---|
| Test files | 213 (`tests/unit` 197 + `tests/scripts` 16) | **220** | 44 | 7 |
| Using `readFileSync` on source text | **98** | **116 (+18%)** ⚠️ | **44 (100%)** | **7 (100%)** |
| Hard-coded `src/**` path literals | **112 distinct** | **125** ⚠️ | all | all |
| Pure source-text scans (never import the code) | **70** | **92 (+31%)** ⚠️ | 44 | 7 |

> **This tax is compounding, and fast.** Those increases happened in **two days** (2026-07-26 → 2026-07-28), with no modularisation work in flight. **F4's cost is a function of when it starts** — every week of delay makes the largest, least glamorous item on the critical path measurably more expensive. This is the single strongest argument in the re-validation for doing Phase 0 now, and it holds whether or not any module is ever extracted.

**Moving any file breaks tests with `ENOENT` — a failure that carries no information — while providing zero behavioural safety net.** Under the standing Test Integrity Policy every one of those breaks forces a stop-and-get-sign-off judgement call. This is the hard prerequisite that determines whether this programme succeeds or stalls.

Compounding it: the enforced test floors in `tests/unit/test-regression-guard.test.js` are **29 files / 320 tests** against an actual **213 files / ~2,401 test blocks**, and every `jest.config.js` coverage threshold is **0**. Test-loss protection is nominal. **Re-validated 2026-07-28: the floors are still 29 / 320 and every coverage threshold is still 0, against an actual 220 files / 2,439 blocks — the gap is widening.** P-7 stands unchanged.

### 1.6 Five CI policy gates classify by hard-coded path and fail *silently* when a file moves

`scripts/check-ui-copy-ownership.sh` (the founder UI/copy gate) · `.github/signup-surface.paths` (the un-skippable signup E2E gate) · `.github/CODEOWNERS` · `scripts/check-service-role-client.sh` · `stryker.config.mjs`.

A glob that matches nothing simply protects nothing. **Without a drift detector landing first, this programme's own first PR is also the PR that quietly disarms the founder UI gate and the signup gate.**

> **Correction, 2026-08-17 (KAN-359 weekly second pass) — "unverified until SEC-106 lands" is now partly stale.** The paragraph below still reads as though SEC-106 is entirely unstarted. As of this run, Jira SEC-106 is **In Progress**, not Done, but 4 of its 5 acceptance criteria are verified landed: `develop`/`staging`/`beta`/`main` branch-protection required checks were reconfigured 2026-07-30 (`CLAUDE.md` "Deployment Pipeline"), the `production` Environment required-reviewer gate was added the same day, **CTL-066** (`scripts/check-required-checks.py`, PR #819, merged 2026-08-16) now asserts live branch protection against a committed `.github/expected-protection.json` on a schedule, and `CLAUDE.md`'s previously-wrong "add main-chain-guard to required checks" note is corrected. **Still open:** AC4, `actionlint`/`zizmor` wiring into `pr-checks.yml` — verified absent from that workflow as of this run. Separately, and not yet addressed by CTL-066: `controls/registry.json`'s schema **still has no field expressing blocking-vs-advisory** (verified this run — same key set as quoted below), so the specific structural complaint in the paragraph below stands. Read "every claim... is unverified" as **narrowed, not closed**: the acute risk named in SEC-106's title (a renamed required-check job silently un-gating `main`) now has a detector; the general registry-schema gap it also raised does not yet.

> **Re-validated 2026-07-28 — the control estate has grown, but not in the way the plan assumes.** This plan was written against **11 blocking static gates**; `controls/registry.json` today holds **32** (CTL-001…CTL-032), several added since (CTL-029 secret-refs, CTL-030 dependency rules, CTL-031 bash portability). **However — and this matters more than the count — the registry schema has no field expressing blocking-vs-advisory at all.** Its keys are `added, defect_class, escape_hatch, id, implementation, kind, name, notes, prevents, self_test, summary, wired_in`; `kind` classifies *what a control is* (`ci-gate` 22 / `scheduled` 6 / `test` 4), not *whether failing it stops a merge*. The registry therefore **cannot represent** the property, so nothing can assert it — **SEC-106 confirmed, and structurally worse than its title states.** 22 of the 32 controls also have no `self_test`. Every claim in this document about a gate being "blocking" should be read as *unverified* until SEC-106 lands.

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
- **CI gets slower before it gets faster.** Every PR already runs 11 blocking static guards + lint + tsc + ~2,401 tests + `npm audit` + a full build with no path filters (**re-validated 2026-07-28: 32 registered controls — though none provably blocking, see §1.6 — and 2,439 test blocks**). This adds three more gates. Path-filtered per-module CI only becomes *safe* after the test-decoupling phase — because today a source-text test for module A can live in a file named after module B.
- **`profiles` stays a shared table.** Column-level ownership recorded in a manifest and enforced by a grep gate is a real improvement over nothing, but it is a convention enforced by a script, not by the database. Splitting `profiles` into satellite tables is a larger, riskier migration programme across three Supabase projects that already have documented parity drift — **deliberately deferred, and named as deferred.**

### 2.2 Scope ruling, 2026-07-28 — the extraction programme is deferred (KAN-432, option A)

**Founder decision, 2026-07-28.** The re-validation (KAN-432) asked the question this plan's cost rests on — *does the Enforced Modular Monolith still earn its cost?* — and the answer changed the scope, not the diagnosis.

**What the evidence showed.** Split it in two:

- **Horizontal structure improved without a single extraction.** `lib`→`app` 1 → **0**; cross-segment edges 5 → **3**; segments with zero fan-in 14 → **16**. All of it from one targeted PR (KAN-424) and one cheap gate (CTL-030). Not one file moved into `src/modules/`.
- **Vertical coupling — the thing this plan correctly named as the real problem — is flat or worsening.** `profiles` 75 → **77** sites over 15 → **17** groups; `auth.getUser()` 37 → **41** files; test path-coupling **+18% / +31% in two days**; no `Database` type; floors and coverage unmoved.

**The inference.** The plan was right about *where* the problem is, and the last 48 hours demonstrated that the cheap half of its own prescription works. What has **not** been demonstrated is that fifteen module extractions are what closes the remaining gap. **Every worsening metric above is closed by Phase 0 (F4–F8) plus the data boundary (C3) and `@lyra/contracts`. None of them requires moving a file into `src/modules/`.**

**Adopted scope:**

1. **Phase 0 in full** (Workstream B, F1–F9). This is where every worsening number lives, and F4 gets more expensive weekly (§1.5). Urgent on its own merits, independent of modularisation.
2. **`@lyra/contracts`** (R3/D3/E3). The cross-repo duplication is the one problem a monolith genuinely cannot solve; X-1 (`admin_approve_beta`) remains the live worked example.
3. **The data boundary (C3) and the `profiles` ADR** (R6/KAN-421) — this plan's own "load-bearing decision".

**Deferred:** D1–D15, and the machinery that exists only to serve them (C1, C2, C4–C6, G1). **Deferred is not cancelled.**

**Re-decision trigger — this is binding, so that "deferred" cannot decay into "abandoned".** When Phase 0 closes, re-derive §1.1 and §1.2 against a decoupled test estate and a generated `Database` type, and re-take this decision on that evidence. Extraction should be re-opened if the vertical coupling has *not* materially improved under Phase 0 alone — that is the measurement Phase 0 exists to make possible, and it is the measurement this plan could not make in July 2026.

**This is not the plan failing.** It is the plan's own §1.4 thesis — cheap enforced gates do the heavy lifting, and creating a canonical module is ~10% of the work — applied to the plan's own scope.

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

> **⚠️ Amended 2026-07-28 (KAN-432) — this claim was overstated, and the correction matters.** A path alias only governs imports **written in alias form**. `import x from '../../modules/convene/internal/thing'` is an ordinary relative specifier: it resolves, it type-checks, and no absence of a wildcard alias stops it. So "a deep import fails `type-check`" is true only for imports someone chose to write as `@mod/convene/...` — i.e. it catches the honest mistake and misses the shortcut. **Compile-time entry points are a useful first line, not the enforcement mechanism.** Real enforcement is the graph rule (§4.2, `no-deep-module-import`) plus the ESLint layer (C6), both of which see relative specifiers. Read §4.1 as *ergonomics and early feedback*, and §4.2 as *the gate*. Under the 2026-07-28 scope ruling (§2.2) this is deferred work in any case, but the claim must not be carried forward uncorrected.

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

**Re-validated 2026-07-28:** `no-module-to-app` **1 → 0** ✅, `no-cross-segment-app` **5 → 3**, `no-circular` **1 → 1** (still open, BUGS-80), `no-deep-module-import` **145 → 142**. F3/KAN-425 landed the first three as **CTL-030** — but as **warn-only**, which is precisely why the surviving cycle failed nothing.

> **⚠️ HARD DEPENDENCY: C2 must not start before [SEC-105](https://checklyra.atlassian.net/browse/SEC-105) resolves.** This section and story **C2** specify all 9 rules blocking at severity `error`. SEC-105 (open) says that gate has **already caused six pipeline outages over dev-only code that never ships**, while the production tree it was protecting was never dirty. Both cannot be right, and enacting C2 as written would scale a control a live SEC ticket says is mis-scoped. This matters beyond the gate itself: §1.4's *"only a CI gate does the 90%"* is the justification for this programme's cost, so if the gate's **scoping** is wrong, the argument needs re-stating rather than the gate merely re-tuning. Resolve SEC-105 first, then re-derive what C2 should block on.

> **📌 Amended 2026-08-13 (KAN-415, CTL-051) — two of the nine rules have landed, and the hard dependency above STILL STANDS for the other seven.**
>
> **SEC-105 is still `To Do`** (checked 2026-08-13; untouched since 2026-07-27). Read the paragraph above before adding any further rule.
>
> **What landed** — `scripts/check-module-layering.py`, blocking in `pr-checks.yml`:
>
> | rule | source | violations when it landed |
> |---|---|---|
> | the layer rule (incl. `platform-is-a-leaf`, which it subsumes: platform is L0 with an empty `mayDependOn`, so every outgoing edge is upward or undeclared) | `layer` + `layerPolicy.declaredSameLayer` | 12 |
> | `mustNot` | `mustNot` | (overlapping) |
> | `no-undeclared-module-dep` | `mayDependOn` | 1 |
>
> **Why these two do not trip the hard dependency.** SEC-105's defect is not "a gate blocks"; it is three specific properties, and CTL-051 has none of them:
>
> 1. *It is keyed on a third-party feed and can go red overnight on an unchanged repo.* CTL-051 reads Lyra's own import graph and `modules.json`. It can only be tripped by a change in the PR — the property SEC-105 says every other gate in the estate has and the npm-audit gate lacks.
> 2. *It blocks a deploy over code that never ships.* CTL-051 runs in `pr-checks.yml` only, never in a deploy workflow.
> 3. *It has no waiver primitive.* CTL-051 ships **green** against a shrink-only two-way baseline, and the escape route is explicit: declare the dependency in `modules.json`, or record it via `--write-baseline`. The one exception is a manifest self-contradiction, which is deliberately un-waivable — see the script's docstring.
>
> **What is still blocked, and why the line falls where it does.** The two landed rules had **12** and **1** violations. The remaining ones do not:
>
> - `no-deep-module-import` — **142**
> - `app-routes-are-thin` — *"many"*
>
> Making either blocking means shipping either a red build or a ~142-entry suppression list, and *that* is precisely the "scale a control before its scoping is settled" move the hard dependency exists to prevent. A 142-entry baseline is a suppression list wearing a ratchet's clothes. Neither may land until SEC-105 resolves and C2's blocking scope is re-derived.
>
> Two of the remaining seven are also blocked on missing data rather than on SEC-105, and would be even if it closed tomorrow:
>
> - `no-deep-module-import` needs each module's **`declaredApi`**, which is `[]` for all 21. `publicApi` is populated but is *observed* data — enforcing it as policy would freeze today's graph and call it an architecture. Somebody has to decide what each module's public API **is**.
> - `app-routes-are-thin` has no definition of "thin" anywhere in `modules.json`.
>
> `edge-safe` and `backoffice-not-in-request-path` need neither SEC-105 nor new manifest data, but were not landed here: the Next build already fails on a Node-only import reachable from `middleware.ts`, so `edge-safe` would largely duplicate it, and neither was measured. Both remain open.
>
> **Also measured and recorded here so it is not re-derived:** the module graph has **four cycles** — `access↔admin`, `admin↔trust-safety`, `age↔auth`, `profile↔recommendations` — all invisible to depcruise's file-level `no-circular`, which reports zero. Each is one legal downward edge plus one upward edge the layer rule already flags, so no cycle rule was added; driving the upward edges to zero makes them unrepresentable.
>
> ---
>
> **📌 Updated 2026-08-13 — SEC-105 is RESOLVED, and `no-deep-module-import` has landed.**
>
> SEC-105 shipped as CTL-052 (PR #777): the npm-audit gate is prod-tree scoped, blocking in `pr-checks.yml` only, removed from all four deploys, with a dated waiver file. The hard dependency above is therefore **discharged** — but read what it actually argued before treating C2 as open season. Its point was that scoping must be settled before blocking gates are scaled, not that a date had to pass.
>
> **`no-deep-module-import` is done** (CTL-053, `scripts/check-module-api.py`). The 145→142 violation count in the table above was never the real obstacle; the obstacle was that nothing defined a module's public surface. Now measured: **304 files across 21 modules, of which 54 are imported from outside**. `declaredApi` is populated for all 21 from those 54, and the rule is two-way — an undeclared cross-module import fails, and a declared entry nothing imports fails as STALE, so the surface can only shrink without a reviewed line.
>
> Three manifest corrections went with it:
>
> - **`declaredApi` is now POLICY** (file-based, hand-edited, read by CTL-053). It was `[]` for 20 of 21 modules.
> - **`plannedApi` is new**, holding `audit`'s three aspirational symbols — they name symbols that *do not exist yet* (`todayImplementedBy: moderateAndAudit()`), and feeding intent to an enforcement gate makes its input part-real, part-wish.
> - **`publicApi` is DESCRIPTIVE** and was 5 entries short. The gaps were all real files that became externally imported during D1–D9 (`guards/client-ip.ts`, `profile/favourites.ts`, `recommendations/recommend/dismissals.ts`, and both `trust-safety` action files) — the KAN-416 derivation predates those moves.
>
> **Note what this makes true of §4.1.** The alias scheme is not merely "deferred" — it is *unnecessary for enforcement*, which KAN-432's correction already implied without saying. There are no `index.ts` files and none are needed: creating 21 plus their aliases would rewrite every import in the app to buy enforcement CTL-053 provides by reading the resolved graph. Keep §4.1 as ergonomics if someone wants it; do not treat it as blocking.
>
> **📌 C2 CLOSED OUT 2026-08-13. Of the nine rules, six are enforced, one is unimplementable as written, and two need a decision rather than code.**
>
> | rule | state |
> |---|---|
> | `no-module-to-app` | ✅ blocking (CTL-030) |
> | `no-circular` | ✅ blocking (CTL-030) |
> | `platform-is-a-leaf` | ✅ subsumed by CTL-051 — platform is L0 with an empty `mayDependOn`, so every outgoing edge is upward or undeclared |
> | `no-undeclared-module-dep` | ✅ blocking (CTL-051 rule 3) |
> | `no-deep-module-import` | ✅ blocking (CTL-053) |
> | `edge-safe` | ✅ blocking (CTL-054) — measured at **0 violations**: 23 files reachable from `middleware.ts`, importing only `@supabase/ssr`, `jose`, `next/server` |
> | `backoffice-not-in-request-path` | 🚫 **no target exists** — see below |
> | `app-routes-are-thin` | ⏸ needs a decision — see below |
> | `no-cross-segment-app` | ⏸ 2 edges left, 1 unrouted — see below |
>
> **`backoffice-not-in-request-path` cannot be written, and should not be faked.** §5's affiliate row says "affiliate/backoffice stays unreachable from the request path", but `src/modules/affiliate/` contains **seven flat files and no `backoffice/` directory** (`eligibility`, `fx`, `link-service`, `merchant-detector`, `reporting`, `smoke`, `types`). A rule anchored on a path that does not exist matches nothing — it would report CLEAN forever and CTL-035 would correctly flag it as a dead pattern. **Recording the gap is the honest move; a green rule guarding nothing is worse than no rule.** If a backoffice surface is ever built, this rule becomes writable and should be written then.
>
> **`app-routes-are-thin` needs its definition restated, and that is a founder/architect call.** The table above defines thin as *"`src/app/**` may import only module index files, same-segment files, framework packages"*. There are **no index files** and (per the note above) none are needed for enforcement — so the first clause has no referent. The natural restatement is *"only files in some module's `declaredApi`"*, which CTL-053 already computes. That would be a genuine, enforceable rule; it is not landed here because choosing it changes what "thin" means, and the current violation count under that reading has not been measured.
>
> **`no-cross-segment-app` is down to 2** (from 5 → 3 → 2), and one still has no owner:
>
> - `src/app/(legal)/about/page.tsx → src/app/_marketing/sections.tsx` — implicated in KAN-422's DELETE list.
> - `src/app/dashboard/page.tsx → src/app/(auth)/actions.ts` — **routed nowhere**, exactly as the `.dependency-cruiser.cjs` scope note has said since KAN-425. It needs an owner before the rule can flip to `error`.
>
> The rule stays `warn` until both are resolved. Flipping it with two live violations would mean either a red build or a suppression entry, and the second is what the ratchet discipline exists to prevent.


### 4.3 The data boundary — where the real coupling is

- **`scripts/check-module-table-ownership.sh`** — parses every `.from('<table>')` and `.rpc('<fn>')` in `src/`, maps the file to its module by path, fails if the table is not in that module's `owns` list. `profiles` is enforced at **column** granularity.
- **`scripts/check-service-role-client.sh`** (extend the existing one) — restricts importing `createServiceRoleClient` to `src/modules/*/data/**`. 40 files hold it today.

Neither gate needs a repository framework. **They make the existing style illegal outside one directory per module** — which is exactly the incremental pressure that works.

> ✅ **DELIVERED 2026-08-14 as CTL-055 — `scripts/check-module-table-ownership.py`** (Python, not `.sh`; every other KAN-415 gate is Python and the two-way ratchet needs JSON handling). Measured at landing: **242 non-`profiles` call sites, 56 unowned `(module → table)` pairs**, grandfathered in `supabase/table-ownership-baseline.json` as a two-way ratchet, so it ships green and can only shrink.
>
> **Two corrections to the paragraph above, both worth keeping:**
>
> 1. **`profiles` is NOT enforced at column granularity, and cannot honestly be.** The plan assumed static analysis could read a write's column set. It cannot: of 18 `profiles` writes, **6 pass a variable rather than a literal object**. A gate covering the other 12 and silently passing those 6 would report clean over *exactly the shape BUGS-74 was* — a partial write destroying columns the caller never named. `profiles` is therefore excluded from this gate by policy, with the column contract pinned at **runtime** by `tests/unit/partial-write-safety.test.ts`, which is the right instrument for it. Recording the gap is a finding; covering 12 of 18 and calling it column-granular would have been a regression.
>
> 2. **"One directory per module" is not what makes the boundary hold.** The gate keys on the **path assignments in `modules.json`**, not on directory names, which is why it landed without moving a single file — and why relocating Convene into `src/modules/` would buy zero additional enforcement. The incremental pressure comes from the manifest being read, not from the tree being tidy.
>
> **What it catches that nothing else could.** Convene passes CTL-051 and CTL-053 cleanly — 2 declared entry points, every outward import edge legal and downward, both enforced two-way — and still reaches **3 tables owned by other modules** (`api_keys`, `consent_log`, `refresh_relationship_signals`). Enforcement on the **import** graph says nothing about the **data** graph.
>
> ⚠️ **Read `_concentration` before proposing a cleanup.** 29 of the 56 pairs come from one file — the account erasure/export path, which touches every table a user has data in *by definition*. That figure is computed at `--write-baseline`, never typed, so it cannot go stale. Without it the baseline reads as 56 boundary breaks and invites a "fix" that would be wrong.
>
> **UPDATE 2026-08-14 — read vs write, and what that means for criterion 2.**
> The pairs are now classified `read` or `write`, because `owns` means "may
> WRITE": a cross-module READ is legitimate and only a WRITE is a boundary
> break. Measured: **44 read, 12 write**.
>
> That changes what criterion 2 should ask for. Taken literally — "every entry
> is dated, ticketed and unexpired" — it would impose a ticket and a renewal
> date on all 56, i.e. on 44 entries that are fine. A list that must be renewed
> on a schedule is renewed by reflex, which is how a ratchet decays into the
> suppression list it was built to replace. **Only the writes are work**, and
> they are few enough to own individually.
>
> A hard expiry is also the one thing every other control here avoids: a gate
> that can go red with no change to the PR. That is exactly the failure SEC-105
> had just finished removing from the npm-audit gate, which froze the pipeline
> for ~11 days and left twelve tested security fixes unshipped. Do not
> reintroduce it on a clock.
>
> **A third failure mode was added: ESCALATED.** A pair is keyed
> `module -> table`, so a baselined READ that quietly starts WRITING kept its
> key — the pair count did not move and the control stayed green. A module
> beginning to mutate state it does not own, with nothing going red: the BUGS-74
> shape. De-escalation fails as STALE too, so the record follows the code both
> ways.
>
> **An undecidable statement is classified `write`, never `read`.** A write
> misfiled as a read sits in the accepted bucket where it can never be caught
> escalating, because it was already a write. The `basis` field records how each
> verdict was reached, so a conservative flag is visibly conservative: 7 of the
> 12 writes are `mutation-call` (hard evidence), 5 are `rpc-undecidable`, and
> `account -> search_by_contact_hash` is provably `return query select` — a
> deliberate over-flag, labelled rather than hidden.
>
> The `check-service-role-client.sh` half of this section remains as written.

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

> **⚠️ Read this table with the SEC-106 caveat (§1.6).** The "extra requirements" below are written as though each named gate blocks a merge. `controls/registry.json` (32 controls) **has no field expressing blocking-vs-advisory**, so that property cannot currently be asserted by any check — and 22 of the 32 have no `self_test`. Until SEC-106 lands, **every gate claim in this table is unverified**, and a module's declared change process reads stronger than it demonstrably is. KAN-416's `changeProcess.extraGates` join to the registry inherits the same limitation.

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
| `public-profile` | **Yes** | **Yes** | Rarely | **High — privacy** | ⚠️ **Gated on [SEC-104](https://checklyra.atlassian.net/browse/SEC-104) — see note below.** Today: the `.eq('is_published',true).eq('is_suspended',false)` pair must stay one tested unit (SEC-44). After SEC-104: **reads go through the `public_profiles` view**, and that requirement is retired. SEC-82 cache headers preserved either way |
| `dashboard` | **Yes** | No | Rarely | Medium | **Never reintroduce `loading.tsx`/Suspense at `/dashboard`** (BUGS-63, guarded) |
| `account` | **Yes** | **Yes** | Yes | High (GDPR) | SAR/erasure completeness test must pass; `moderation_logs.actor_user_id ON DELETE RESTRICT` dependency must not be silently dropped |
| `convene` | **Yes** | **Yes — 23 tools** | Yes | **High — and it is NOT safe** | See §7-D5: the web flag is off, **but the MCP write tools are live in production against the production database** |
| `recommendations` | No | **Yes** | Rarely | Medium | — |
| `affiliate` | Sometimes (badge) | No | Rarely | Medium | `backoffice/` must never be reachable from the request path |
| `trust-safety` | Sometimes | **Yes** | Yes | High (audit) | A mutation may not proceed if the audit write failed; audit chain is append-only |
| `marketing-legal` | **Yes — every PR** | No | No | Low (functional) / High (legal) | Legal copy changes need compliance review, not just founder UI sign-off |
| `admin` | Internal only — **not** gated | No | Yes | High (privilege) | Every mutation routed through the shared transition matrix; CF Access + `is_admin` both verified |

**Reading the table:** modules with three or more gates lit (`convene`, `account`, `profile`, `access`) are where change is genuinely expensive — and that is the honest signal of where the architecture is still carrying risk, not a flaw in the plan.

#### SEC-104 and the `public-profile` boundary (added 2026-07-28)

[SEC-104](https://checklyra.atlassian.net/browse/SEC-104) proposes replacing the suspension-guard *detector* with a **`public_profiles` view**, on the grounds that a checker cannot see a query that has no guard at all, and every new visibility predicate needs a new guard. **This makes the SEC-44 "one tested unit" requirement obsolete in the good way.**

A predicate in a **view body** binds even **service-role** reads — unlike RLS, which service-role bypasses. That distinction is not academic: it is exactly how **SEC-100** happened (suspended members exposed in public search and the sitemap via five service-role query sites, shipped to production).

**The two are complementary, and the ordering is what matters:**

- **SEC-104 first** → the `public-profile` module boundary gets materially *simpler*. The module owns *"read from `public_profiles`"* instead of *"remember to apply two predicates at every call site"*. The invariant moves from a code convention to a database object.
- **D9 first** → the module freezes a call-site convention into a public API, and SEC-104 then has to unpick it.

**⚠️ D9 must not start before SEC-104 is decided.** (Under the §2.2 scope ruling D9 is deferred regardless; this constraint governs whenever it is re-opened.)

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
>
> ⚠️ **Corrected 2026-08-04 (KAN-441).** The premise above no longer holds. The design system **is** in git — `github.com/luisa-sys/lyra-design-system` — and `check-token-drift.py` in that repo **performs** the token diff against `src/app/globals.css`. So the stated reason KAN-427 is founder-gated has gone. Whether KAN-427 is therefore unblocked is **Luisa's call**, not a conclusion this document should draw for her: the diff still spans two repositories, so a cloud session would need both checked out. See `docs/DESIGN_CHANGE_WORKFLOW.md`; the canonical-home question is KAN-427 / KAN-457.

**Programme goal.** Carve the Lyra platform into 20 named modules with machine-enforced boundaries and explicit public APIs, so that any one module can be changed, reviewed and released without reading or risking the rest — and so that the rules the three deployables share live in exactly one place.

> **⏸️ Re-scoped 2026-07-28 (§2.2).** The goal above remains the *direction*; it is no longer the *current commitment*. The committed scope is **Phase 0 + `@lyra/contracts` + the data boundary + the `profiles` ADR** — everything that closes the worsening vertical-coupling metrics **without moving a file**. Whether the 20-module carve-up is the right way to close whatever remains is re-decided when Phase 0 closes, per the binding trigger in §2.2.
>
> **Spike status, 2026-07-28:** R1/KAN-416 ✅ (manifest re-derived — 21 modules, `profiles` baseline at column granularity, 77 call sites), R2/KAN-417 ✅, R4/KAN-419 ✅, R5/KAN-420 ✅, R6/KAN-421 ✅, R7/KAN-422 ✅, R10/KAN-432 ✅ (this re-validation). **R3/KAN-418, R8/KAN-423 and R9/KAN-427 remain founder-gated** — private registry + tokens, CI Supabase credentials, and a local-only design-system folder respectively. F2/KAN-424 ⚠️ partially delivered (BUGS-80); F3/KAN-425 ✅ landed as CTL-030, **warn-only**.

**Success criteria.** *(Re-scoped 2026-07-28 per §2.2 — ✅ = in scope now, ⏸️ = deferred with D1–D15.)*

1. ⏸️ **Deferred.** `modules.json` declares 20 modules, all `"enforced": true`, with a dependency matrix, table ownership (`profiles` at column granularity) and per-module test floors. *(KAN-416 has already delivered the manifest itself — 21 modules, including the founder-approved `audit` — with `enforced: false` throughout and read by nothing. That artefact stands; only the enforcement flip is deferred.)*
2. ⏸️ **Deferred**, and blocked on **SEC-105** whenever re-opened. `dependency-cruiser` runs blocking on every PR with all 9 rules at severity `error`; `.boundaries-allowlist.json` is empty or every entry is dated, ticketed and unexpired.
3. ✅ **In scope, re-expressed.** Zero `.from()` / `.rpc()` / `createServiceRoleClient` outside each module's **declared data paths** (per KAN-416's `modules.json`) — ~~`src/modules/*/data/**`~~, since no files are moving. This is C3, the data boundary.
4. ✅ **In scope.** Zero unit test files containing a literal `src/...` path. **This is F4 and it is the critical path** (§1.5 — the tax is compounding at 18–31% per two days).
5. ✅ **In scope.** `@lyra/contracts` is consumed by all three repos; the 6 duplicated rule-sets exist once; a CI drift test fails if any repo forks a copy. *(Blocked on R3/KAN-418, which is founder-gated.)*
6. ✅ **In scope.** A generated `Database` type is threaded through all client factories in all three repos, with a CI regeneration diff.
7. ✅ **In scope.** `admin_approve_beta` works. *(X-1 was **not** re-verified on 2026-07-28 — confirm it is still broken before scoping the fix.)*
8. ✅ **In scope, added 2026-07-28.** The `profiles` ADR (R6/KAN-421) is adopted, **and** the re-decision trigger in §2.2 has been executed — §1.1 and §1.2 re-derived against the decoupled test estate and the typed schema, with an explicit ruling on whether D1–D15 re-open.

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
| **F2** | ⚠️ **RE-SCOPED 2026-07-28 — partially delivered, do not strike through.** ✅ `computeAccessTransition` moved out of the admin route tree (KAN-424 / PR #596; `lib`→`app` edges now **0**). ❌ **STILL OPEN:** move `WizardContact` into `organise-fields.ts` — the type-only cycle survives (`app/dashboard/convene/organise/page.tsx:6` ↔ `organise-wizard.tsx:25`), still the one-line fix, tracked as **[BUGS-80](https://checklyra.atlassian.net/browse/BUGS-80)**. ⚠️ app→app edges went **5 → 3**, not 0; **the two `[slug] → dashboard/profile` edges are moved into D8's acceptance criteria** where they belong (they are the D-4 privacy finding, not F2 debt), and the `(legal)/about → _marketing` edge is also implicated in KAN-422's DELETE list. **F2's residual scope is the cycle alone.** | Eliminates the only wrong-direction edge and the only cycle, locking in existing good structure permanently. **Note the failure mode:** KAN-424 was marked Done with two thirds of its scope unlanded, and CTL-030's `no-circular` rule is warn-only, so nothing went red. | R1 |
| **F3** | Land the 3 near-green depcruise rules as **warn**, then flip to **block** | `no-module-to-app`, `no-cross-segment-app`, `no-circular` — cheap, permanent | F2 |
| **F4** | **Test decoupling** — convert the highest-value source-text guards to import-based tests; route the remainder through a generated path manifest | **The largest single line item and the one most likely to be skipped. Skipping it is the most likely way this programme fails.** Without it every move produces information-free `ENOENT` failures and constant pressure to weaken tests, which policy forbids | R2 + founder sign-off |
| **F5** | Re-anchor the dead test floors (29/320 → real 213/~2,401), split per module, turn on a non-zero global coverage threshold | "A module owns its tests" is currently unmeasurable; tests silently lost during a move must fail CI | F4 |
| **F6** | Generate `Database` types for all 3 Supabase projects; thread through all client factories in all 3 repos; add a CI regeneration diff | Without a typed schema, a rename surfaces as a runtime null in an unrelated module. **Step zero for anything touching data** | R5 |
| **F7** | Capture the 3 out-of-band objects into real migration files; reconcile git↔dev↔staging↔prod parity; land the monotonicity check | Until this lands, `supabase/migrations/` **is not the schema**, so no module can honestly claim to own a table | R5 |
| **F8** | Per-module config schemas: replace 85 raw `process.env` reads across 42 files with module-declared, boot-validated config | "Modules can be configured independently" is currently **false**. 58 env vars, only 5 pass through `env.ts` | R1 |
| **F9** | Provision `E2E_SUPABASE_URL` / `E2E_SUPABASE_SERVICE_ROLE_KEY` (dev + staging only); arm `e2e-authed` + `soak-journey`; flip `SIGNUP_GATE_ENFORCE` warn → block | **Founder/secret-gated.** E2E is the weakest verification link and is largely un-armed — it must be armed before large-scale file movement | Founder |

---

### Workstream C — Boundary machinery

> **Scope ruling 2026-07-28 (§2.2): only C3 is in scope.** C1, C2 and C4–C6 exist to serve the D1–D15 extractions and are **deferred with them**. **C3 is retained and re-expressed** — see its row.

| ID | Story | Depends on |
|---|---|---|
| **C1** | ⏸️ **DEFERRED (§2.2).** Create `src/modules/` skeleton, `modules.json`, per-module tsconfig aliases (index-only, no wildcards), mirrored `jest.moduleNameMapper` | R1, F3 |
| **C2** | ⏸️ **DEFERRED (§2.2)** — and ⚠️ **hard-blocked on [SEC-105](https://checklyra.atlassian.net/browse/SEC-105) whenever it is re-opened** (see §4.2). Add `dependency-cruiser` with all 9 rules as a blocking `Module boundary gate` step in `PR Quality Gate`; unenforced modules skipped | C1, **SEC-105** |
| **C3** | ✅ **DONE 2026-08-14 (table-ownership half) — landed as CTL-055 `scripts/check-module-table-ownership.py`.** Add `scripts/check-module-table-ownership.sh` (280 → **277** call sites, 33 tables, `profiles` column-granular) + extend `check-service-role-client.sh`. ⚠️ **Re-expressed 2026-07-28:** since `src/modules/` is not being created, the gate maps each file to its owning module via the **path assignments already in KAN-416's `modules.json`**, and restricts `createServiceRoleClient` to each module's declared data paths rather than to `src/modules/*/data/**`. The data boundary does not require the file moves — that is why it survives the scope ruling | ~~C1~~, F6, R6 |
| **C4** | Add `scripts/check-boundary-ratchet.sh` + `.boundaries-allowlist.json` + the `BOUNDARY-EXEMPTION-APPROVED` trailer | C2 |
| **C5** | Add `scripts/check-module-manifest.sh` (index.ts + manifest entry + CODEOWNERS line + test dir); rewrite the 11 per-file CODEOWNERS lines to module paths | C1 |
| **C6** | ESLint `no-restricted-imports` layer (redundant with C2 by design — fails in the editor, before CI) | C1 |

---

### Workstream D — Module extractions, in dependency order

> **🔴 REVERSED 2026-08-04. Workstream D is IN FLIGHT — D1–D4 are merged. See the banner at the top of this file.**
>
> **⏸️ ALL OF WORKSTREAM D IS DEFERRED — scope ruling 2026-07-28 (§2.2).** D1–D15 are **not cancelled**; they are re-decided after Phase 0 closes, against a decoupled test estate and a generated `Database` type, per the binding re-decision trigger in §2.2. **No file moves into `src/modules/` under the current scope.**
>
> The sequencing below is retained because it is the most expensive artefact in this plan to reconstruct, and because two of its steps carry constraints that survive the deferral: **D9 is gated on SEC-104** and **D8 absorbs two app→app edges from F2**. Two items are also promoted out of D entirely because they are in scope on their own merits: **D3 (`@lyra/contracts`)** and the domain-model half of **D8**'s privacy finding, now tracked as **SEC-109** rather than waiting for D13.

The order is not arbitrary. Each step unblocks the next.

| ID | Story | Why here | Depends on |
|---|---|---|---|
| **D1** | Extract **`platform`** + **`guards`** + **`observability`** | Naming the kernel is what makes every later rule expressible. Begin ratcheting the 40 service-role importers into `data/` dirs | C1–C5, F6, F8 |
| **D2** | Extract **`oauth-as`** — the pilot | Highest cohesion, lowest coupling, 5 exclusive tables, 12 dedicated test files. **Pin the external HTTP contract with a test first** — claude.ai, Claude Desktop and both Railway services are outside CI. Invert `getAccountStanding` into an injected `StandingPort`. This becomes the reference shape every other module copies | D1 |
| **D3** | ✅ **IN SCOPE (§2.2) — promoted out of the deferral.** Stand up **`@lyra/contracts`** with `content-moderation.ts` alone | Bootstraps the packaging with a provably no-op diff. Add the drift test that `convene-recommend-scoring.ts`'s header promised as an unnumbered "KAN-XXX follow-up". **Retained because cross-repo duplication is the one problem a monolith cannot solve** — it does not depend on any extraction. ⚠️ Its blocker is R3/**KAN-418**, which is founder-gated (private registry + tokens on Vercel, 3× Railway, 3× CI) | R3, ~~D2~~ |
| **D4** | Extract **`access`**; decompose `middleware.ts` (282 lines, 6 unrelated jobs, 2 sequential `profiles` reads, 2 overlapping inline exemption arrays) into a named, individually-tested gate pipeline with one declarative exemption table | Ships alone: **the order of the gates and the fail-open/fail-closed asymmetry are behavioural contracts with no current unit test.** Consolidate the 4 environment resolvers onto `getDeployEnv` — **except `lib/oauth/config.ts siteUrl()`**, which determines the `iss` claim both MCP servers pin to | D1, D2, F2 |
| **D5** | Extract **`features`**; move the pure registry into `@lyra/contracts`; make both MCP servers read `global_feature_switches`; retire the `ACCESS_MODEL_V2` dual path | **Must precede convene, age, affiliate, recommendations, account and admin**, or five extractions each re-open the same five files. Closes a live hole: today an admin turning the `mcp` or `convene` master switch off stops the web surface and **leaves `mcp.checklyra.com` serving** | D3, D4 |
| **D6** | Extract **`age`** + **`auth`**, with the signup gate armed first and `.github/signup-surface.paths` rewritten in the same commit | Their combined footprint is deliberately the signup gate's footprint. Add the missing Didit webhook/callback contract tests. Close the empty publish age-gate block in `lyra_publish_profile` | D5, F9 |
> ## 🚫 Convene (inventory D7 / `convene`) is OUT OF SCOPE — [KAN-470](https://checklyra.atlassian.net/browse/KAN-470)
>
> **Decided 2026-08-09 by Luisa.** The `convene` extraction is BLOCKED and must not be started
> unless **Convene is turned back on**. It is dark today — every `src/app/api/convene` route 404s
> behind `CONVENE_ENABLED` — so extracting 55 files / ~7,000 LOC buys nothing and, with no E2E or
> soak coverage behind a disabled feature, would be the least verifiable large change in the
> programme. Scope, traps and the re-entry checklist: `docs/modularisation/CONVENE-DEFERRED.md`.
>
> This does **not** deregister the module: `convene` stays in `modules.json` and CTL-041 keeps
> asserting its file count and paths against the tree.

| **D7** | Extract **`trust-safety`**; lift the **10 audit-sensitive server actions** currently living as unexported closures inside JSX files (suspend, unsuspend, unpublish, republish, delete-item, dismiss-report, resolve-report, suspend-from-report + 2 OAuth consent closures) | The most audit-sensitive writes in the product, **zero unit coverage**, self-moderation guard re-implemented per closure, and literally untestable until exported. **Hard prerequisite for `admin`** | D5, F7 |
| **D8** | Extract the **`profile` domain core** (no UI): `types.tsx`, `visibility.ts`, `section-visibility.ts`, `manual-of-me-fields.ts`, field allowlists, `country-codes` | Lifts the de-facto data model (fan-in 14) out of a legacy wizard directory, gives `public-profile` a legitimate dependency, cuts 2 of the 5 app→app edges. **Remove `is_published` from `ALLOWED_PROFILE_FIELDS`** so publish has exactly one entry point calling `canPublish()`. ⚠️ **Added to acceptance criteria 2026-07-28:** the two residual `app/[slug] → app/dashboard/profile` edges (`manual-of-me-fields.ts`, `section-visibility.ts`) move here from F2 — they are the **D-4 privacy finding** (the public profile depending on the *editor's* domain model), not generic structural debt | D4 |
| **D9** | Extract **`public-profile`** | ⚠️ **GATED ON [SEC-104](https://checklyra.atlassian.net/browse/SEC-104) — must not start until SEC-104 is decided** (see §5). If SEC-104 lands first this module simply reads the `public_profiles` view and the SEC-44 pair requirement retires; if D9 lands first it freezes a call-site convention SEC-104 then unpicks. Preserve SEC-82 cache headers; URLs unchanged | D8, D5, **SEC-104** |
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
| P-6a | ✅ **CLOSED 2026-07-28.** ~~The only `lib`→`app` edge~~: `lib/beta-access/flow.ts` and `app/waitlist/actions.ts` imported `computeAccessTransition` from **inside the admin UI route tree**. Moved to `src/lib/access-model/` by **KAN-424 / PR #596**; `lib`→`app` edges re-derived as **0** | — | F2 ✅ |
| P-6b | ⚠️ **STILL OPEN.** The only **cycle** — type-only, `app/dashboard/convene/organise/page.tsx:6` ↔ `organise-wizard.tsx:25` (`WizardContact`). Still the one-line fix described in July. Survived because F2 was marked Done without it and CTL-030's `no-circular` is **warn-only** | `convene` | **[BUGS-80](https://checklyra.atlassian.net/browse/BUGS-80)** |
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
| ~~D-8~~ | **Reclassified 2026-07-28 — moved to the new "Security" class below.** | | **SEC-109** |
| D-9 | **`lib/admin.ts` is simultaneously the admin gate and the app's generic service-role factory** — imported by the **public** `app/api/reports/route.ts` | The dependency graph currently lies about privilege. Split it | D15 |
| D-10 | **`lib/affiliate` is three modules with different lifetimes in one folder**, and `country-codes` isn't about affiliates at all | Split into `links` / `eligibility` / `backoffice`; move `country-codes` to `profile` | D10 |
| D-11 | ✅ **SUPERSEDED 2026-07-28 by KAN-422 (Done, PR #620) — the original "~650 LOC" estimate was wrong in both directions.** Measured: **219 zero-importer exports**, of which **160 are live code carrying an over-wide `export`** (1,463 LOC — the fix is narrowing visibility, not deleting) and only **59 are genuinely dead** (1,130 LOC; 36 tested / 588 LOC). ⚠️ **The two files this row originally named for deletion — `recommender/inputs.ts` and `events.ts` — MUST BE KEPT** (KAN-198 and KAN-202 are both In Progress and consume them). Use KAN-422's disposition list, never this row's estimate | Decide disposition *before* extraction, or the refactor freezes dead exports into new public APIs | R7 ✅ |
| D-12 | **`middleware.ts` is 282 lines doing 6 unrelated jobs with 2 sequential `profiles` reads and 2 overlapping inline exemption arrays** — and the gate *order* and fail-open/fail-closed asymmetry are untested behavioural contracts | Decompose into a named, individually-tested pipeline. Ships alone | D4 |
| D-13 | **Environment identity is derived 4 different ways**, and one of them (`lib/oauth/config.ts siteUrl()`) sets the OAuth `iss` claim both MCP servers pin their verification to | Consolidate onto `getDeployEnv` — **except that one**. Changing it breaks both MCP servers | D4 |
| D-14 | **`profiles` carries ≥6 modules' state, written from all 3 repos**, 15 module groups / 75 call sites | The load-bearing decision of the whole programme. Column-level ownership + grep gate now; satellite tables costed and deferred | R6 |
| D-15 | **No UI module exists to extract from** — `src/components` holds exactly one file; 181 raw hex literals; design tokens live in `app/globals.css` pinned by a string-grep test | `ui-kit` must be **built**, not extracted — and every file it touches is founder-gated | D11 |
| D-16 | **`oauth-as` is the most separable module and its contract is frozen by external consumers** (claude.ai, Claude Desktop, MCP Inspector) | Perfect pilot — but pin the HTTP contract with a test *first* | D2 |

### Security *(added 2026-07-28 — reclassified out of "Structural")*

| # | Discovery | Implication | Story |
|---|---|---|---|
| **D-8** | ⚠️ **UPGRADED STRUCTURAL → SECURITY, 2026-07-28.** One client component writes `oauth_connections` straight from the browser (`dashboard/convene/connections/connections-client.tsx`) with no server action. **Confirmed worse than structural:** the same client-side write means **`vaultRevokeRefreshToken` never runs**, so a user's OAuth **refresh token survives their disconnect** — the user believes they have revoked access and they have not | The server/client boundary is not currently a security boundary, so it cannot be a module boundary either — **but the token-revocation defect must be fixed on its own merits and MUST NOT wait for D13**, which was the last-but-two extraction and is now deferred entirely (§2.2) | **[SEC-109](https://checklyra.atlassian.net/browse/SEC-109)** (High) — ~~D13~~ |
| **N-5** | **`search_by_contact_hash` has no product consumer.** A `profiles`-reading RPC with no caller | A column-ownership question for R6/KAN-421 as much as a security one — an unused RPC that reads a god-table is exactly the surface a column-ownership manifest is supposed to make visible | **[SEC-110](https://checklyra.atlassian.net/browse/SEC-110)** |

### Cross-repo

| # | Discovery | Implication | Story |
|---|---|---|---|
| X-1 | ⚠️ **NOT re-verified 2026-07-28** (needs the admin-MCP repo + a live schema read; out of scope for a read-only web-repo spike — flagged unverified rather than assumed). **`admin_approve_beta` is already broken** — writes 2 columns a `lyra`-repo migration dropped | The canonical worked example of the business case. Must be fixed, and made CI-checkable | E2 |
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
| E-3 | **The Claude Design System is a third source of truth for design tokens, with no drift detection.** Tokens live in `src/app/globals.css`, in `~/lyra-design-system/build.py`, and in Claude Design project `e4682889-…`. `build.py` reads `globals.css` — ⚠️ **partly corrected 2026-08-04 (KAN-441):** the design system is now in git and **drift detection exists** (`check-token-drift.py` diffs the Claude Design tokens against `globals.css` and can emit the fixes for an auto-PR), and `foundations/tokens.css` mirrors `globals.css` 1:1. The *"three copies"* observation stands; *"no drift detection"* does not | Structurally identical to the MCP duplication (X-3). Building `ui-kit` without deciding which is canonical creates a **fourth** copy. D11 was the vaguest module in the plan; this is why | **KAN-427** |
| E-4 | **Two couplings are invisible to CI** — `~/lyra-design-system/build.py` and the **claude.ai routine prompts themselves** (Staging Soak, Backlog Autopilot, Modularisation Scoping all name repo paths verbatim, and live in routine config, not git) | No grep can find them. They need a **human attestation** in the extraction DoD, and the DoD must say plainly that this is weaker than a machine check rather than implying CI covers it | **KAN-428** |
| E-5 | **No module can answer "what proves this still works?"** — 213 unit files in a flat heap, 47 E2E blocks organised by Playwright *project* not by module, soak contract C1–C6 unmapped to modules | Per-module ownership for unit + E2E + soak. Keep the Playwright projects as-is (they encode real execution requirements — auth state, seeded users, CF bypass — not taxonomy); add module tagging instead | **KAN-429** |

### New discoveries *(added 2026-07-28 by the KAN-432 re-validation)*

| # | Discovery | Implication |
|---|---|---|
| **N-1** | **The control registry cannot express blocking-vs-advisory** (§1.6). `controls/registry.json` has no such field, so no check can assert the property; 22 of 32 controls have no `self_test` | §5's per-module gate table **overstates enforcement** until **SEC-106** lands. Every "blocking" claim in this document is unverified |
| **N-2** | **The plan's blocking dependency gate collides with SEC-105** (§4.2). SEC-105 says that gate already caused six pipeline outages over dev-only code that never ships | **C2 must not start before SEC-105.** And because §1.4's *"only a CI gate does the 90%"* is this programme's cost justification, a mis-scoped gate weakens the argument, not just the tooling |
| **N-3** | **Test path-coupling is growing ~18–31% per two days** (§1.5) | **F4's cost is a function of when it starts.** The strongest single argument for doing Phase 0 now, and the load-bearing input to the §2.2 scope ruling |
| **N-4** | **Production had never been backed up** — `SUPABASE_DB_URL` pointed at dev from 2026-03-27 to 2026-07-27 while every run reported green. Fixed, restore-drilled and guarded (#613) | This plan's risk model **silently assumed a working restore path** during extraction. It should say so explicitly. Note the shape: a control reporting green for four months while doing nothing is the same failure class as N-1 |
| **N-5** | `search_by_contact_hash` has no product consumer | Recorded in the **Security** table above — **SEC-110** |

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

**Critical path (as planned 2026-07-26):** R2 → F4 (test decoupling) → C1 → D1 → D2 → D4 → D5 → everything else. **F4 is the choke point.** It is the largest, least glamorous item, delivers no visible modularity, and shortening it is the single most likely way this programme fails.

> **🔴 REVERSED 2026-08-04 — see the banner at the top of this file.**
>
> **⏸️ Re-scoped 2026-07-28 (§2.2).** Everything below the `C1 ▶ C2 ▶ …` line in the diagram above — Workstreams C (except C3), D and G — is **deferred**. The **current critical path is `R2 → F4 → F5`**, with `F6 → F7` and `C3` in parallel, plus `@lyra/contracts` (R3/D3, founder-gated on KAN-418) and the `profiles` ADR.
>
> **F4 remains the choke point, and the re-validation strengthened that claim rather than weakening it:** the path-coupling tax grew 18–31% in the two days between the survey and the re-validation, with no modularisation work in flight. F4 is now urgent on its own merits — it is the prerequisite for per-module CI, for honest test floors, and for the measurement that the §2.2 re-decision trigger depends on.
>
> **Also still live regardless of the deferral:** BUGS-80 (the residual cycle), SEC-109 (OAuth refresh-token revocation — must not wait for D13), SEC-104 (gates D9), SEC-105 (gates C2), SEC-106 (makes every "blocking gate" claim unverifiable), SEC-110.

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
