# KAN-432 (R10) — Modularisation plan re-validation

**Status:** research artefact · read-only · no code, schema or config changed
**Date:** 2026-07-28
**Plan under review:** `LYRA_MODULARISATION_PLAN_2026-07-26.md` (surveyed `develop @ ee647e6`, 2026-07-26)
**Re-derived against:** `develop @ 674f0a7`, 2026-07-28
**Script:** `docs/modularisation/kan432-revalidate.py` · **Data:** `docs/modularisation/data/kan432-revalidation.json`

Reproduce with:

```bash
python3 docs/modularisation/kan432-revalidate.py
```

---

## 0. Verdict in three lines

1. **The plan's diagnosis survives re-derivation.** Every load-bearing number is within drift of its original value, and the four kernel fan-in figures reproduce **exactly**. The plan is not built on sand.
2. **Two of its premises are false, and both were asserted as true in this ticket.** F2 (KAN-424) is marked Done but only **one of its three** sub-items landed. And the plan's §4.2 blocking dependency gate is now in direct tension with **SEC-105**, which says that gate caused six pipeline outages over code that never ships.
3. **The thesis holds but the vehicle is now over-specified.** The horizontal wins arrived from cheap gates without a single extraction, while the vertical coupling the plan named as the real problem is flat or worsening. That argues for doing Phase 0 and *deferring* the 15-module extraction programme — see §5.

---

## 1. Re-derived numbers

Method is stated in `methodNotes` in the JSON. `node_modules` is absent in the cloud environment so `dependency-cruiser` could not be re-run; the graph is rebuilt independently by regex scan resolving the `@/* → ./src/*` alias, relative specifiers and directory `index` files. **This is stronger evidence than a re-run, not weaker** — an independent method landing on the same number is corroboration.

That the independent method reproduces `supabase-server` = 46, `supabase-service` = 39, `env.ts` = 17, `admin.ts` = 17 and `deploy-env.ts` = 5 **exactly** is the calibration check for everything else in this table.

| Plan claim | Plan | Now | Verdict |
|---|---|---|---|
| Graph nodes | 273 | **274** | Drift (+1 file) |
| Graph edges | 525 | **527** | Drift |
| `lib` → `app` edges | 1 | **0** | ✅ **FIXED** — KAN-424 |
| `app` segment → `app` segment edges | 5 | **3** | ⚠️ **PARTIAL** — see §2 |
| Import cycles | 1 | **1** | ❌ **NOT FIXED** — see §2 |
| Cross-group edges | 328 | **336** | Drift |
| Deep imports | 145 (44%) | **142 (42.3%)** | Unchanged in substance |
| `index.ts` barrels | 4 | **5** | +1 (`src/lib/access-model/index.ts`, from KAN-424) |
| Cross-group edges via a barrel | 9 | **10** | Unchanged in substance |
| App route segments | 19 | **19** | Unchanged |
| — with zero fan-in | 14 | **16** | ✅ Improved |
| `supabase-server.ts` fan-in | 46 | **46** | Exact |
| `supabase-service.ts` fan-in | 39 | **39** | Exact |
| `env.ts` fan-in | 17 | **17** | Exact |
| `env.ts` transitive dependants | 140 | **142** | Drift |
| `admin.ts` fan-in | 17 | **17** | Exact |
| `deploy-env.ts` importers | 5 | **5** | Exact — §1.4's erosion argument still stands verbatim |
| `.from()` call sites | 280 | **277** | Unchanged in substance |
| Distinct tables | 33 | **33** | Unchanged |
| — inside route/page/action files | 199 (71%) | **194 (70%)** | Unchanged in substance |
| `createServiceRoleClient` importers | 40 | **39** | Unchanged in substance |
| `profiles` call sites | 75 | **77** | ⚠️ **WORSE** |
| `profiles` module groups | 15 | **17** | ⚠️ **WORSE** |
| Generated `Database` type exists | No | **No** | Unchanged — P-3 stands |
| `auth.getUser()` files | 37 | **41** | ⚠️ **WORSE** |
| `redirect('/login')` files | 8 | **8** | Unchanged |
| Test files | 213 | **220** | ⚠️ Growing |
| — using `readFileSync` | 98 | **116** | ⚠️ **WORSE — +18% in 2 days** |
| — distinct `src/**` path literals | 112 | **125** | ⚠️ **WORSE** |
| — pure source-text scans | 70 | **92** | ⚠️ **WORSE — +31%** |
| Test blocks | ~2,401 | **2,439** | Growing |
| Regression-guard floors | 29 files / 320 tests | **29 / 320** | Unchanged — P-7 stands |
| Coverage thresholds | all 0 | **all 0** | Unchanged — P-7 stands |
| Path-coupled CI gates | 5 | **5**, all present | Unchanged — P-1 stands |
| Env vars read in `src/` | 58 | **49** | Method difference (plan counted a wider tree); not treated as drift |

### The one number that could not be reproduced from the plan's wording

"145 deep imports (44%)" is only reproducible under one of several readings of *deep import*. The reading that reproduces it — **an edge into a file inside another group's directory, not via that group's barrel, where a group is `src/<area>/<segment>`** — was recovered empirically (142/336 = 42.3%). Two other plausible readings give 24 (7.1%) and 326 (97%). All three are recorded in the JSON so the headline cannot be quietly redefined later.

**Recommendation:** the plan should state the definition inline. A number whose definition has to be reverse-engineered is not, in practice, "re-derivable from the repos" as §0 of the plan claims.

---

## 2. FINDING 1 — F2 is marked Done but is one-third complete

This ticket's own "known-stale" table asserts: *"F2 — **DONE.** KAN-424, PR #596. The only `lib`→`app` edge and the only group-level cycle are gone."* **KAN-424 is Done in Jira.** F2's stated scope was three items:

| F2 sub-item | Status | Evidence |
|---|---|---|
| Move `computeAccessTransition` out of the admin route tree | ✅ **DONE** | `lib`→`app` edges = **0**. New `src/lib/access-model/{index,access-transitions}.ts`; `lib/beta-access/flow.ts` and `app/waitlist/actions.ts` now import from `lib/`. |
| Move `WizardContact` into `organise-fields.ts` | ❌ **NOT DONE** | The cycle is still there: `app/dashboard/convene/organise/page.tsx:6` imports `OrganiseWizard from './organise-wizard'`, and `organise-wizard.tsx:25` imports `type { WizardContact } from './page'`. Still type-only, still the one-line fix the plan described. |
| Relocate the 5 `app`→`app` shared symbols | ⚠️ **PARTIAL (5 → 3)** | Remaining: `(legal)/about/page.tsx → _marketing/sections.tsx`; `[slug]/page.tsx → dashboard/profile/manual-of-me-fields.ts`; `[slug]/page.tsx → dashboard/profile/section-visibility.ts`; `dashboard/page.tsx → (auth)/actions.ts`. |

Two of the three residual app→app edges are the **D-4 privacy finding** — the public profile page depending on the *editor's* domain model — which is legitimately D8's job, not F2's. The `(legal)/about → _marketing` edge is now also implicated in KAN-422's DELETE list (10 of 11 exports in `_marketing/sections.tsx` are dead).

**But the cycle is a one-line fix that simply did not happen, and the ticket asserts it did.** This is the exact failure mode KAN-432 exists to catch, occurring inside KAN-432's own premises. Raised as **BUGS-80**.

**Edit the plan needs:** F2 must not be struck through. Re-scope it to the residual cycle only, and move the two `[slug] → profile` edges explicitly into D8's acceptance criteria where they belong.

---

## 3. FINDING 2 — the plan's blocking dependency gate collides with SEC-105

The plan's §4.2 and story **C2** specify: *"Add `dependency-cruiser` with all 9 rules as a blocking `Module boundary gate` step."* Success criterion 2 requires *"all 9 rules at severity `error`"*. F3/KAN-425 landed the first three as CTL-030.

**SEC-105 (To Do) says:** *"Redesign the dependency gate: prod tree is clean and always was — 6 pipeline outages were over dev-only code that never ships."*

These cannot both be right. The plan treats the blocking graph gate as the programme's central enforcement mechanism; SEC-105 says that mechanism has already produced six outages while the production tree it was protecting was never dirty. **Enacting C2 as written would scale a control that a live SEC ticket says is mis-scoped.**

This matters more than it looks, because the plan's whole §1.4 argument — *"only a CI gate does the 90%"* — is the justification for the extraction programme's cost. If the gate's scoping is wrong, the argument needs re-stating, not just the gate re-tuning.

**Edit the plan needs:** §4.2 and C2 must be made explicitly dependent on SEC-105's redesign. C2 should not start before SEC-105 is resolved.

---

## 4. Control-estate reconciliation (§1.6 and §5)

> **Correction, 2026-08-17 (KAN-359 weekly second pass) — the "until SEC-106 lands" caveat below is now partly stale.** Jira SEC-106 is **In Progress**, not Done, but as of this run 4 of its 5 acceptance criteria are verified landed: branch-protection required checks on `develop`/`staging`/`beta`/`main` and the `production` Environment required-reviewer gate (both 2026-07-30, per `CLAUDE.md`), and **CTL-066** (`scripts/check-required-checks.py`, PR #819, merged 2026-08-16), which schedules a live-vs-committed branch-protection drift check. AC4 (`actionlint`/`zizmor` in `pr-checks.yml`) is verified still open. The specific structural gap this section names — **`controls/registry.json` has no field expressing blocking-vs-advisory** — is separately verified still true this run (same schema keys quoted below); CTL-066 did not add one. So: the acute risk in SEC-106's title now has a detector, but the general registry-schema complaint in this section stands.

The plan was written against **11 blocking static gates**. The ticket assumes **31 controls**. SEC-106's title says **29**. `controls/registry.json` today holds **32** (CTL-001…CTL-032). Four numbers, all from the last few days.

More significant than the count: **the registry schema has no field expressing blocking-vs-advisory at all.**

```
schema keys: added, defect_class, escape_hatch, id, implementation,
             kind, name, notes, prevents, self_test, summary, wired_in
```

`kind` is `ci-gate` (22) / `scheduled` (6) / `test` (4) — a taxonomy of *what the control is*, not of *whether failing it stops a merge*. So SEC-106's finding is confirmed and is structurally worse than its title states: the registry cannot represent the property, which means no check can assert it. 22 of the 32 controls also have no `self_test`.

**Consequence for the plan:** §5's per-module change-process table lists "extra gates" per module, and KAN-416 was directed to join `changeProcess.extraGates` to `controls/registry.json`. That join currently cannot answer "is this gate blocking?" — so a module's declared change process will read stronger than it is. **Edit the plan needs:** §5 must cite the real registry and note the advisory caveat until SEC-106 lands.

---

## 5. Does the Enforced Modular Monolith still earn its cost?

The ticket asks this directly and it deserves a direct answer.

**The diagnosis is more strongly supported than when it was written.** Split the evidence in two:

**Horizontal structure — improving, without any extraction.**
`lib`→`app` 1 → **0**. Cross-segment edges 5 → **3**. Segments with zero fan-in 14 → **16**. All of that came from one targeted PR (KAN-424) and one cheap gate (CTL-030). Not one file moved into `src/modules/`.

**Vertical coupling — flat or worsening.**
`profiles` call sites 75 → **77**, spread over 15 → **17** module groups. `auth.getUser()` 37 → **41** files. Service-role importers 39, `.from()` sites 277, no `Database` type, coverage thresholds still 0, test floors still 29/320. And the path-coupling tax is **accelerating**: `readFileSync` test files 98 → **116** (+18%), pure source-text scans 70 → **92** (+31%), distinct `src/**` path literals 112 → **125** — in two days.

**So the honest reading is that the plan correctly identified where the problem is, and the last 48 hours have shown the cheap half of the fix works.** What it has *not* shown is that the expensive half — fifteen module extractions, D1 through D15 — is what closes the remaining gap. Every worsening metric above is closed by **Phase 0 foundations** (F4 test decoupling, F5 floors, F6 `Database` types, F7 migration parity, F8 config) plus the data boundary (C3) and `@lyra/contracts`. **None of them requires moving a single file into `src/modules/`.**

**Recommendation — a lighter programme, and it is a scope change, not a cancellation:**

1. **Do Phase 0 in full.** It is where every worsening number lives, and F4 is getting more expensive every week the test estate grows. This is now urgent on its own merits, independent of modularisation.
2. **Do `@lyra/contracts` (D3/E3).** The cross-repo duplication is the one problem the monolith genuinely cannot solve, and X-1 (`admin_approve_beta`) is still the live worked example.
3. **Do the data boundary (C3) and the `profiles` ADR (R6/KAN-421).** This is the plan's own "load-bearing decision".
4. **Defer D1–D15 and re-decide after Phase 0.** By then the residual coupling will be measurable against a decoupled test estate and a typed schema, and the extraction case can be made on evidence rather than on the 2026-07-26 survey.

This is not the plan failing. It is the plan's §1.4 thesis being *right* — cheap enforced gates do the heavy lifting — applied to the plan's own scope.

**This is a founder decision. Nothing here should be enacted on my say-so.**

---

## 6. SEC-104 reconciliation (`public_profiles` view vs the `public-profile` module)

**SEC-104 (To Do):** replace the suspension-guard *detector* with a `public_profiles` **view**, because the checker cannot see a query that has no guard at all, and every new visibility predicate needs a new guard.

The plan's §5 requires: *"the `.eq('is_published',true).eq('is_suspended',false)` pair must stay one tested unit (SEC-44)"*, and D9 repeats it. **SEC-104 makes that requirement obsolete in the good way.** A predicate in a view body applies even to service-role reads — unlike RLS, which service-role bypasses, which is precisely how **SEC-100** (suspended profiles exposed at five service-role query sites, In Progress) happened.

**These are complementary, and the ordering matters:**

- If SEC-104 lands **first**, the `public-profile` module boundary gets materially simpler: the module owns *"read from `public_profiles`"* rather than *"remember to apply two predicates at every call site"*. The invariant moves from code convention to database object.
- If D9 lands first, the module freezes a call-site convention into a public API, and SEC-104 then has to unpick it.

**Edit the plan needs:** §5's `public-profile` row and D9 must both be made dependent on SEC-104, and the "one tested unit" requirement re-expressed as "reads go through `public_profiles`" once the view exists. **D9 should not start before SEC-104 is decided.**

---

## 7. Discoveries register — triage

**Closed or materially changed:**

| # | Was | Now |
|---|---|---|
| **P-6** | Only `lib`→`app` edge + only cycle | **Half closed.** Edge gone (KAN-424). Cycle remains — §2, BUGS-80. |
| **D-1** | 524/525 edges correct, 14/19 segments zero fan-in | **Strengthened.** 527/527 correct; 16/19 zero fan-in. |
| **D-2** | KAN-353's premise wrong | **Still valid.** KAN-353 re-scoped, To Do. R7 fed it its dead-export list. |
| **D-8** | Browser writes `oauth_connections`; "the server/client boundary is not a security boundary" | ⚠️ **UPGRADE TO SECURITY.** Confirmed 2026-07-28 and it is worse than structural: the same client-side write means `vaultRevokeRefreshToken` never runs, so a user's OAuth refresh token survives their disconnect. Filed **SEC-109 (High)**. **It must not wait for D13** — that is the last-but-two extraction. |
| **D-11** | "~650 LOC of exported code has zero production consumers but is fully tested" | **Superseded by KAN-422 (Done, PR #620).** Real figures: 219 zero-importer exports, of which **160 are live code with an over-wide `export`** (1,463 LOC) and only **59 genuinely dead** (1,130 LOC; 36 tested / 588 LOC). The two files D-11 named for deletion — `recommender/inputs.ts`, `events.ts` — **must be kept** (KAN-198 and KAN-202 both In Progress). |
| **P-1 / P-3 / P-4 / P-5 / P-7 / P-8 / P-9** | Prerequisites | **All still open, all re-verified.** No prerequisite has been closed by the last 48 hours' work. |
| **E-3 / KAN-427** | Design-system third source of truth | **Still valid and still cloud-impossible.** Local session only. |
| **X-1** | `admin_approve_beta` broken | **Not re-verified this run** — out of scope for a read-only web-repo spike. Flagged as unverified rather than assumed. |

**New, not in the register:**

| # | Discovery | Implication |
|---|---|---|
| **N-1** | The control registry cannot express blocking-vs-advisory (§4) | §5's per-module gate table overstates enforcement until SEC-106 lands |
| **N-2** | The plan's blocking dependency gate collides with SEC-105 (§3) | C2 must not start before SEC-105 |
| **N-3** | Test path-coupling is growing ~18–31% per 2 days (§1) | F4's cost is a function of *when* it starts. This is the strongest argument in the whole revalidation for doing Phase 0 now. |
| **N-4** | Production had never been backed up (2026-03-27 → 2026-07-27) | The plan's risk model assumed a working restore path during extraction. Fixed and drilled (#613), but the plan's risk section should say so explicitly rather than silently assume it. |
| **N-5** | `search_by_contact_hash` has no product consumer (**SEC-110**) | A `profiles`-reading RPC with no caller is a column-ownership question for R6/KAN-421 as well as a security one |

---

## 8. Precise edit list for the plan

**Not applied.** The ticket says the plan should "carry the agreed edits" — these are proposed, and edit 9 is a scope decision that is the founder's alone.

| # | Location | Edit |
|---|---|---|
| 1 | §1 header | Add: *"Baseline re-validated 2026-07-28 against `674f0a7` — see `PLAN-REVALIDATION-2026-07-28.md`. Figures below are as-surveyed 2026-07-26."* |
| 2 | §1.1 | Update: `lib`→`app` **0**; app-seg edges **3**; segments with zero fan-in **16/19**. State the *deep import* definition inline. |
| 3 | §1.2 | Update `profiles` to **17 groups / 77 call sites** and mark the trend as worsening. |
| 4 | §1.5 | Update to **220 files / 116 `readFileSync` / 125 path literals / 92 pure scans / 2,439 blocks**, and add the growth rate. |
| 5 | §1.6 | Replace "11 blocking static gates" with **32 registered controls**, plus the SEC-106 caveat that none is provably blocking. |
| 6 | §4.1 | Amend or defend the index-only-tsconfig claim; the adversarial review found enforcement is graph-rule + lint, not compile-time. |
| 7 | §4.2 + C2 | Add a hard dependency on **SEC-105**. |
| 8 | §5 | `public-profile` row: make dependent on **SEC-104**; re-express the SEC-44 pair as a view read. Add the SEC-106 advisory caveat to the table preamble. |
| 9 | §6 / §8 | **Founder decision** — adopt the lighter scope in §5 of this document (Phase 0 + contracts + data boundary; defer D1–D15), or reaffirm the full programme. |
| 10 | §7 D-8 | Move to a new "Security" class; cite **SEC-109**; remove the D13 dependency. |
| 11 | §7 D-11 | Replace with KAN-422's measured figures; strike the `recommender/inputs.ts`/`events.ts` deletion. |
| 12 | §7 P-6 | Split: edge closed, cycle open (**BUGS-80**). |
| 13 | §7 | Append N-1…N-5. |
| 14 | §6 F2 row | Re-scope to the residual cycle; move the two `[slug] → profile` edges into D8. |

---

## 9. What this run did not verify

Stated so the next run does not mistake silence for a pass.

- **X-1 `admin_approve_beta`** — needs the admin-MCP repo and a live schema read; not attempted.
- **The MCP repos' test counts** (44 / 7 source-text files) — not re-derived; this run scanned `lyra` only.
- **SEC-105's "6 pipeline outages"** — taken from the ticket, not independently confirmed.
- **§1.3's duplicated-rule counts** (suspension in 6 places / 4 failure postures; Convene gate at 16 sites; feature registry ×3) — the Convene-gate grep is env-var-shaped and not comparable to the plan's method, so it is omitted from §1 rather than reported misleadingly.
- **Env var count** — 49 in `src/` vs the plan's 58; the plan counted a wider tree. Treated as method, not drift, and not chased.
