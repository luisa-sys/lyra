# KAN-417 — R2 Spike: test-decoupling strategy & cost

**Epic:** KAN-414 (modularisation scoping) · **Scopes:** F4 (test decoupling), F5 (floor re-anchoring), KAN-429 (F12 verification ownership) · **Inputs to:** KAN-423 (R8 MCP harness), KAN-428 (F11 extraction DoD)
**Date:** 2026-07-27 · **Measured at:** `lyra@2f330f1`, `lyra-mcp-server@31c114b`, `lyra-admin-mcp-server@6b8dfb3`
**Status: research artefact — no test was modified, weakened, skipped or deleted in this spike.**

## Reproduction

Every number below is produced by one committed, zero-dependency script:

```bash
node docs/modularisation/kan417-classify-tests.mjs \
  /path/to/lyra /path/to/lyra-mcp-server /path/to/lyra-admin-mcp-server \
  > kan417-report.json   # summary counts printed to stderr
```

The ticket's figures (264 Jest files, 47 E2E blocks) were measured at `lyra@ee647e6`; the estate has since grown to **271 Jest files** (217 + 44 + 10 — the admin repo gained 3 files). The script counts **31 E2E test blocks** using a strict `test(`/`it(` line-start match; the ticket's 47 included `test.describe`/hook callables. Both methods are stated so neither number is unverifiable.

## 1. Jest-layer classification — all 271 files

Classes: **(a)** behavioural (imports + executes code) · **(b)** convertible single-file text scan · **(c)** genuinely structural (tree-walks, multi-file sweeps, import-direction rules, repo-metadata reads — keep as text, route paths through a manifest) · **(d)** guard test (`tests/scripts/**`, executes the CI shell guards; path-coupled by design).

| Repo | Files | (a) | (b) | (c) | (d) | Never import source |
|---|---|---|---|---|---|---|
| lyra (`tests/unit` + `tests/scripts`) | 217 | 99 | 48 | 54 | 16 | 95 |
| lyra-mcp-server | 44 | **0** | 6 | 38 | 0 | **44 (100%)** |
| lyra-admin-mcp-server | 10 | **0** | 0 | 10 | 0 | **10 (100%)** |
| **Total** | **271** | **99** | **54** | **102** | **16** | **149** |

Classification rules (encoded in the script, deterministic): `tests/scripts/**` → (d); tree-walk APIs (`readdirSync`/glob) over source → (c); single-file `readFileSync` of `src/**` → (b), demoted to (c) when it sweeps >3 source files or asserts on import statements (structural by nature); imports source with no text scan → (a); reads only repo metadata (workflows, docs, package.json) → (c). The (b)/(c) boundary is heuristic; the per-file JSON carries the raw signals so any file's class can be re-judged in review. Security-critical files were hand-checked (below).

**Confirmations of the ticket's premises:** both MCP repos have **zero** behavioural tests — every file is a source-text scan (44 + 10 = 54 files, 100%). In lyra, 95 of 217 files never import the code they assert on.

### Security-critical files, hand-verified

| File | Class | Note |
|---|---|---|
| `tests/unit/visibility.test.ts`, `profile-ownership.test.ts`, `sec82-reports-item-ownership.test.ts`, `middleware-suspension.test.ts`, `convene/dispatch-suspension-guard.test.ts`, `set-feature-entitlement.test.ts` | (a) | already behavioural — **no action, no sign-off needed** |
| `tests/unit/feature-entitlements.test.ts` | (b)-hybrid | behavioural half + text-scan half; PoC target (§6) |
| `tests/unit/sec57-issuance-suspension.test.ts`, `section-visibility.test.ts` | (b) | convertible, high value |
| `tests/unit/route-config.test.ts`, `kan342-gift-visibility.test.ts`, `homepage-content.test.js`, `partial-write-safety.test.ts`, `sec43-admin-rpc-acl-guard.test.js`, `sec80-contact-hash-suspended-guard.test.js`, `bugs66-dashboard-loading-guard.test.js`, `test-regression-guard.test.js` | (c) | structural sweeps / migration-content or copy pins — **stay text, manifest-routed**. `homepage-content` pins user-facing copy: founder-gated, untouchable by agents |
| `lyra-mcp-server`: `mcp-visibility-guard`, `mcp-ownership-guard`, `mcp-entitlement-guard`, `mcp-suspension-guard`, `sec61-db-error-leak-guard`, `sec83-suspension-flag-independent` (all `.test.cjs`) | (c) | text scans of the *only* isolation controls on that surface — **cannot convert until KAN-423's behavioural harness exists**; until then they must survive any file move byte-for-byte |
| `lyra-admin-mcp-server`: `admin-authz-guards`, `admin-guards` | (c) | same, on the highest-privilege surface |

## 2. Category-(b) conversion ranking

54 files. Order of value:

1. **Security gates (lyra)** — `feature-entitlements` (PoC done), `sec57-issuance-suspension`, `section-visibility`, `bugs70-manual-of-me-persist`, `bugs74-manual-of-me-field-coverage`, `convene/cron-auth`, `convene/dispatch-atomic-claim`, `auth-confirm-route`. ~8–10 files. Every one converts under the mutation rule in §8.
2. **Write-path/UI-action scans (lyra)** — the `convene/*-ui`, `drain-route`, `dispatch` family and similar (~38 files). Mechanical once the pattern is set.
3. **lyra-mcp-server's 6 (b) files** — **deferred to after KAN-423**; there is no execution harness to convert into.

## 3. Path-manifest design (for the 102 (c) + 16 (d) files)

**One generated file, `tests/support/source-paths.ts`** (mirrored as `.json` for `.cjs`/shell consumers):

```ts
// GENERATED — regenerate with: npm run gen:test-paths
export const SRC = {
  profileActions:   'src/app/dashboard/profile/actions.ts',
  filesActions:     'src/app/dashboard/profile/files-actions.ts',
  supabaseServer:   'src/lib/supabase-server.ts',
  // ... one symbolic name per file referenced by any (c)/(d) test
} as const;
```

- Structural tests import `SRC.xyz` instead of hard-coding `resolve(ROOT, 'src/...')`. A module move updates **one generated file** (or nothing, if generation derives from tsconfig aliases) instead of N tests.
- A companion guard test asserts every manifest entry exists on disk **and** every `readFileSync` path literal remaining in `tests/**` is manifest-routed (ratchet: the count of raw literals may only shrink — same pattern as `migration-privileges-baseline.json`).
- The generator seed is the `srcPathLiterals` field of this spike's JSON: the exact literal inventory per file, 112+ distinct paths.
- `.cjs` MCP tests read the JSON mirror; `scripts/staging-soak.sh` needs nothing (no repo path literals — verified §5).
- **Introducing the manifest changes no assertion** — it re-points where the path string comes from. Classified as test *infrastructure*, but it edits existing test files, so it is included in the sign-off request (§8, group 1) rather than assumed exempt.

## 4. `jest.mock()` inventory and re-pointing plan

Measured: **133 `jest.mock()` calls across 53 files** (full per-file list in the JSON: `.jestMockInventory`). Breakdown by target kind:

| Target kind | Count | Move risk | Plan |
|---|---|---|---|
| `@/…` alias (e.g. `@/lib/supabase-server` ×28, `@/lib/env` ×14, `@/lib/admin` ×7) | **90** | re-points **automatically** if `jest.config.js` `moduleNameMapper` is updated in lockstep with `tsconfig` paths on every extraction | one config edit per new module alias — add to KAN-428 extraction DoD |
| npm packages (`next/cache` ×18, `@supabase/supabase-js` ×10, …) | 43 | none — package names don't move | none |
| relative paths | **0** | — | nothing to fix; keep it that way (lint rule candidate) |

**The fail-open trap is real but boundable.** A stale mock path doesn't error — the mock silently stops applying and the test runs against real code. Mitigation (new control, category (c) by design): a guard test that extracts every `jest.mock('...')` literal in `tests/**` and asserts each resolves through the *current* `moduleNameMapper` to an existing file. Fails loud on the first stale mock. Should land **before** the first file move (Phase 0, §7), and belongs in `controls/registry.json` once built.

## 5. E2E + soak layer — the preliminary finding is CONFIRMED, per file

**No spec file references any repo source path. Zero of 7.** Per-file evidence (from `.e2e` in the JSON):

| Spec | Blocks | Coupling | goto URLs | Copy/selector assertions |
|---|---|---|---|---|
| `accessibility.spec.ts` | 1 | URL | (crawls routes) | 0 |
| `homepage.spec.ts` | 1 | URL | `/` | 0 |
| `public-pages.spec.ts` | 6 | URL + selector/content | 6 | 12 ⚠️ copy |
| `profile-redesign.spec.ts` | 10 | URL + selector/content | 5 | 7 ⚠️ copy |
| `authed/journey.authed.spec.ts` | 7 | URL + selector/content | 3 | 3 |
| `signup/signup.e2e.spec.ts` | 1 | URL | 2 | 0 |
| `soak/journey.soak.spec.ts` | 5 | URL + selector/content | 3 | 3 |

- Since the extraction plan freezes URLs as a live external API, **every spec survives modularisation untouched.** The ⚠️ copy assertions are resilient to file moves but are **founder-gated content pins** — flagged here per the ticket; no changes proposed.
- `scripts/staging-soak.sh`: **zero repo path literals**; asserts against `https://stage.checklyra.com` / `https://checklyra.com` URLs only. Confirmed resilient (matches KAN-419's finding — confirmed, not re-derived).

### The Playwright wiring itself

| File | Coupling | Verdict / specified fix |
|---|---|---|
| `playwright.config.ts` | `testDir: './tests/e2e'`; `AUTHED_MATCH`/`SOAK_MATCH`/`SIGNUP_MATCH` regex **spec filenames**; `require.resolve('./tests/e2e/global-setup')` | couples only to `tests/e2e/**` — **inert to any `src/` move**. Constraint to record in KAN-428: the three spec filenames are CI wiring; renaming a spec silently empties its Playwright project. Add a guard asserting each MATCH pattern matches exactly one existing file. |
| `tests/e2e/global-setup.ts` | imports `./support/*` + node builtins only | inert to `src/` moves; no fix needed |
| `support/mint-session.ts`, `seed-user.ts`, `soak-user.ts`, `supabase-admin.ts` | import each other + `@supabase/supabase-js`; `src/` appears **in comments only** | inert to `src/` moves. **Semantic coupling:** `seed-user.ts` mirrors the state model of `src/lib/dashboard/resolve-widgets.ts` — a module move keeps it green, but a state-model change must update it. Record as a KAN-429 ownership line (dashboard module owns this helper's fidelity), not a path fix. |
| `signup-e2e` gate `.github/signup-surface.paths` | 100% path globs | **out of this spike's scope — owned by KAN-419** (module-terms rewrite). Consistency requirement stands: the spec itself is URL-coupled and untouched; only the *trigger* file moves with KAN-419's spec. Nothing in this plan reduces signup coverage. |

## 6. Worked proof-of-concept conversion (evidence for §8)

**Target:** the text-scan half of `tests/unit/feature-entitlements.test.ts` — asserts by regex that `uploadProfileFile` calls `getMyFeatureEntitlements` and checks `media_uploads` before storage upload.

**Invariant stated in words first:** *an authenticated caller whose `media_uploads` entitlement is false is refused by `uploadProfileFile` before any storage interaction; a caller with the entitlement proceeds past the gate.*

**Conversion:** `tests/unit/kan417-poc-media-uploads-gate.test.ts` (this branch — additive; the original text test is untouched). Mocks `supabase-server`, entitlements, rate-limit; asserts the exact refusal message with `storage.from` never called, plus the gate-open path reaching the next check (proving the refusal came from the gate, not elsewhere).

**Positive run:** both files green — `Test Suites: 2 passed · Tests: 9 passed`.

**Negative proof (mutation, never committed):** with the gate locally disabled (`if (!features.media_uploads)` block removed), the behavioural test **fails**:

```
✕ refuses when media_uploads is revoked, before touching storage
  expect(received).toEqual(expected)  // got { success: false, error: 'No file supplied' }
Tests: 1 failed, 1 passed, 2 total
```

Source reverted (`git diff` clean) immediately after. A conversion that cannot demonstrate this stays category (c) — that is the rule, proven workable here.

## 7. Effort estimate & phased order

| Phase | Work | Est. | Gate |
|---|---|---|---|
| **0 — before any file move** | Path manifest + generator; `jest.mock` resolution guard; Playwright MATCH guard | 1–2 days | none — pure additions |
| **1 — per extraction (KAN-415)** | tsconfig alias + `moduleNameMapper` lockstep edit; regenerate manifest | ~zero marginal | KAN-428 DoD checklist item |
| **2 — security-critical (b) conversions** | ~8–10 lyra files, each with worded invariant + mutation proof, PoC pattern | 3–5 days | **sign-off §8 group 2** |
| **3 — bulk (b) conversions** | ~38 lyra files, mechanical | 1–2 weeks, parallelisable | sign-off §8 group 3 |
| **4 — MCP repos** | 54 text files | **blocked on KAN-423** (no harness exists) | founder-gated |

Floor note for **F5**: conversions are one-for-one-or-more (text block → ≥1 behavioural test), so the 2118/91 floors only ratchet up; the floor re-anchor is needed when text *blocks* are finally deleted post-sign-off.

## 8. DRAFT SIGN-OFF REQUEST (single decision, grouped)

> **To Luisa — one approval covering F4's whole assertion-change scope.** Nothing below is executed until you approve; groups are severable.
>
> **Group 1 — path-manifest routing (102 (c) + 16 (d) files).** Change: `readFileSync(resolve(ROOT, 'src/…'))` literals become `readFileSync(SRC.xyz)` via the generated manifest. **Old expected value = new expected value for every assertion** — only the path *source* changes. Includes the manifest generator, its existence-guard, the `jest.mock` resolution guard, and the Playwright MATCH guard.
> **Group 2 — security-critical (b) conversions (~8–10 files, §2 list).** Pattern per file, exactly as the PoC: (1) invariant written in words; (2) behavioural test added; (3) mutation proof attached showing it fails when the invariant is broken; (4) **only then** the redundant text block deleted *in the same PR*. Old: regex over source text (e.g. `expect(src).toMatch(/getMyFeatureEntitlements/)`). New: behavioural refusal assertion (e.g. exact error + storage never touched). The deletion in step 4 is what needs your sign-off.
> **Group 3 — bulk (b) conversions (~38 files).** Same pattern, non-security files; batch PRs.
> **Group 4 — explicitly out of scope, no approval sought:** all E2E copy/content assertions (`public-pages`, `profile-redesign`, `homepage-content.test.js`) — founder-gated content pins, untouched. MCP-repo tests — untouched until KAN-423.
>
> Approving groups 1–3 pre-authorises F4's PRs to make exactly these changes; any deviation comes back as a fresh request.

## Acceptance-criteria status

Met: 271/271 Jest files classified with committed script · E2E blocks + soak classified with per-file evidence · Playwright config/global-setup/support classified with fixes · all 133 `jest.mock` literals inventoried with plan · manifest designed · PoC + negative proof on this branch · sign-off request drafted and sent (Jira + run report) · effort/phasing recorded.
**Outstanding: founder approval of §8** (“documented and *agreed*”) — the ticket stays In Progress until that decision; no further routine work is pending on it.
