# Extraction re-decision (KAN-432 §2.2 trigger) — 2026-08-09

**Instrument:** `docs/modularisation/kan432-revalidate.py`, the same script that
produced the 2026-07-28 re-validation. Raw output:
`docs/modularisation/data/kan432-revalidation.json`.

**Ruling: the extraction programme is RE-OPENED.**

---

## 1. What the trigger actually says

From §2.2, quoted rather than paraphrased because the wording is the whole test:

> **Re-decision trigger — this is binding, so that "deferred" cannot decay into
> "abandoned".** When Phase 0 closes, re-derive §1.1 and §1.2 against a
> decoupled test estate and a generated `Database` type, and re-take this
> decision on that evidence. Extraction should be re-opened **if the vertical
> coupling has *not* materially improved under Phase 0 alone**.

Note the polarity. The trigger does **not** ask "did Phase 0 work?" — it asks
whether Phase 0 *by itself* closed the vertical-coupling gap. A **negative**
result re-opens extraction. This is deliberately the opposite of the usual
reading, and getting it backwards would invert the decision.

## 2. Preconditions

| Precondition | State | Evidence |
|---|---|---|
| Generated `Database` type | **MET** | `src/types/database/{dev,staging,prod}.ts` exist and are load-bearing — `tests/unit/sar-export-schema-completeness.test.ts` derives the person-keyed table set from `prod.ts`, which is what caught SEC-117's 14 missing SAR tables. |
| Decoupled test estate | **PARTIAL** | See §4. The path-literal half landed decisively; the behavioural-conversion half did not. |
| Phase 0 closed | **NO — partial** | F4 is materially advanced but not closed; pure source-text scans **rose** 70 → 110. |

Phase 0 is not closed, so this is a re-decision taken **early**, and that is
stated rather than glossed. It is taken now because the substantive question the
trigger poses is already answerable with high confidence, and because the answer
does not depend on the unfinished part — see §5.

## 3. The measurement — vertical coupling (§1.2)

| Measure | Plan (2026-07-26) | Re-val (2026-07-28) | **Now (2026-08-09)** | Direction |
|---|---|---|---|---|
| `.from()` sites | 280 | 277 | **296** | ↑ worse |
| distinct tables touched | 33 | 33 | **41** | ↑ wider surface |
| `.from()` inside route/page/action | 199 | — | **213** | ↑ worse |
| service-role importers | 40 | 39 | **39** | flat |
| `profiles` call sites | 75 | 77 | **77** | flat, above plan |
| `profiles` module groups | 15 | 17 | **17** | flat, above plan |
| `auth.getUser()` files | 37 | 41 | **42** | ↑ worse |

**Every vertical measure is flat or worse than the July baseline.** Not one
improved. `.from()` sites are up 16 on the plan figure and up 19 on the
re-validation figure, and the growth is concentrated in exactly the wrong place
— inside routes, pages and server actions (199 → 213), which is the coupling
C3 exists to remove.

Some of that growth is honest and mine: SEC-117 added 11 `.from()` blocks to the
SAR export because the export was incomplete under UK-GDPR Art.15. That is a
defect fixed, not debt added — **and it is also the point**. The correct fix for
a compliance gap currently *requires* adding eleven more direct table reads to a
server action, because there is no data layer to add them to. The metric
worsening as a direct consequence of doing the right thing is the strongest
possible evidence that the structure, not the discipline, is the constraint.

## 4. The measurement — horizontal structure and Phase 0 (§1.1)

Phase 0 and the control programme delivered, and the numbers say so plainly:

| Measure | Plan | **Now** | |
|---|---|---|---|
| import cycles | 1 | **0** | fixed |
| `lib` → `app` edges | 1 | **0** | fixed |
| app-segment → app-segment edges | 5 | **3** | improved |
| distinct `src` path literals in tests | 112 | **21** | **−81%** — F4's manifest working |
| registered controls | 11 | **39** | control estate transformed |

But two Phase 0 measures moved the wrong way:

| Measure | Plan | **Now** | |
|---|---|---|---|
| pure source-text scans in tests | 70 | **110** | ↑ — F4's *behavioural* half unfinished |
| `readFileSync` test files | 98 | **136** | ↑ (against 213 → 259 test files) |
| cross-group edges | 328 | **349** | ↑ |
| deep imports | 145 | **149** | ↑ |

The estate also simply grew: 213 → 259 test files, 2,401 → 2,963 test blocks,
273 → 289 graph nodes. Growth is not by itself a regression, but it does mean
the per-file ratios matter more than the totals, and the ratio that matters —
scans per test file — went from 0.33 to 0.42.

## 5. Why the ruling does not wait for Phase 0 to close

The unfinished part of Phase 0 is the conversion of source-text scans into
behavioural tests. That work makes the *test estate* survive a file move. It has
no mechanism by which it could reduce `.from()` sites, `auth.getUser()` fan-out,
or `profiles` fan-in — those are properties of application code, not of tests.

So finishing it cannot change this ruling's input. Waiting would delay the
decision without improving the evidence, which is the failure mode the trigger's
own "deferred must not decay into abandoned" clause was written to prevent.

**What finishing Phase 0 *does* still gate is the extraction's safety, not its
justification.** 110 pure source-text scans and 136 `readFileSync` test files
are exactly what turns a file move into a wall of information-free failures.
That is a sequencing constraint on *how* to extract, recorded in §7 below — not
a reason to keep the programme deferred.

## 6. ⚠️ Naming collision — "D1" means two different things

This must be settled before anyone acts on a ticket that says "do D1", because
the two readings produce different work:

| Table | ID | Meaning |
|---|---|---|
| §3 "Layer 2 — Domains" (the **module inventory**) | **D1** | the `oauth-as` **module** |
| §8 sequencing (the **story order**) | **D1** | extract **`platform` + `guards` + `observability`** |
| §8 sequencing | **D2** | extract **`oauth-as`** — "the pilot", *depends on D1* |

So **"the D1 oauth extraction" conflates an inventory ID with a sequencing ID.**
In sequencing terms the oauth work is **D2**, and the plan puts the kernel
(`platform`/`guards`/`observability`) ahead of it on the grounds that "naming the
kernel is what makes every later rule expressible".

**Recommendation:** retire the inventory-side D-numbers in favour of module
names, and let D1–D15 mean sequencing only. Until that is done, always write
`oauth-as` rather than a D-number.

## 7. Sequencing constraints that survive this ruling

Carried forward from §8 and confirmed against the current tree:

1. **`oauth-as` must pin its external HTTP contract with tests FIRST.** Its
   consumers — claude.ai, Claude Desktop, `lyra-mcp-server` and
   `lyra-admin-mcp-server` — are all outside this repo's CI. A move that changes
   a route path, status code, header or error body breaks live integrations with
   no failing test anywhere in this repo.
2. **D9 (`public-profile`) remains gated on SEC-104.**
3. **D8 absorbs the two residual `app/[slug]` → `app/dashboard/profile` edges**
   (the D-4 privacy finding).
4. **The 110 remaining source-text scans are a live hazard to any move.** Each
   is a test that asserts on file *contents* and will either fail
   uninformatively or — worse — keep passing while asserting nothing.

## 8. Provenance

- Trigger: §2.2 of `LYRA_MODULARISATION_PLAN_2026-07-26.md` (KAN-432 option A,
  founder decision 2026-07-28).
- Founder direction, 2026-08-04, in session: extraction may proceed now; the
  deferral was not the founder's preference.
- Evidence: `kan432-revalidate.py` run 2026-08-09 against
  `feat/kan-457-design-baseline-gate` (tree equal to `develop` for all measured
  paths).
