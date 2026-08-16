# KAN-422 (R7) — Dead-but-tested exports: disposition register

**Status:** research artefact · read-only · no code changed
**Date:** 2026-07-28
**Epic:** KAN-414 · **Plan:** `LYRA_MODULARISATION_PLAN_2026-07-26.md` §6 Workstream A, discovery D-11
**Derivation script:** `docs/modularisation/kan422-dead-exports.py`
**Machine-readable output:** `docs/modularisation/data/kan422-dead-exports.json`

Reproduce with:

```bash
python3 docs/modularisation/kan422-dead-exports.py
```

---

## 1. Headline

> **The premise needs correcting in two places, and the spike found two live defects
> that have nothing to do with modularisation.**

| Measure | Figure |
|---|---|
| `src/**` files scanned (`.ts`/`.tsx`, non-test) | **274** |
| Exported symbols enumerated | **829** |
| — of which Next.js/tooling framework contracts (not imports; excluded) | **147** |
| **Zero-importer exports** | **219** |
| — **OVER-EXPORTED** (live code, over-wide `export`) | **160** (1,463 LOC) |
| — **DEAD-TESTED** (no reference anywhere; has tests) | **36** (588 LOC) |
| — **DEAD-ISOLATED** (no reference anywhere; no tests) | **23** (542 LOC) |
| **Genuinely dead LOC** | **1,130** |

**Correction 1 — the raw count is nearly 3× too pessimistic.** The ticket's framing
("exports with zero production consumers") is satisfied by 219 symbols, but **160 of
them are not dead code**. They are symbols used *inside their own file*, exported only
so a unit test can reach them. Deleting them would break live behaviour. Their defect
is the `export` keyword, not the code, and the fix is to narrow the export at
extraction time — a completely different disposition from deletion, with no Test
Integrity Policy exposure. Any run that reported "219 dead exports" would have been
wrong by 1,463 LOC.

The discriminator is now measured, not assumed: `internalUses` counts references to the
symbol elsewhere in its own file (`kan422-dead-exports.py::internal_uses`).

**Correction 2 — the two files the ticket names for deletion must NOT be deleted.**
`src/modules/recommendations/recommender/inputs.ts` and `src/modules/recommendations/recommender/events.ts` are the scaffolding
for **KAN-198** (Rec-Engine 01 — recommender input audit) and **KAN-202** (Rec-Engine 05
— feedback/learning loop). Both tickets are **In Progress today**. They are unconsumed
because their consumers are not built yet, which is exactly the KEEP AS CONTRACT case.
The ticket asked for this check explicitly; the answer is *keep*.

The ~650 LOC estimate in the ticket is close to the real DEAD-TESTED figure (**588 LOC /
36 symbols**) — but it is a different 588 LOC from the one the ticket assumed.

**Two live defects found.** Both are cases where the "dead" export turned out to be the
*correct* implementation that a live surface bypasses. Raised as SEC tickets, not
cleanup items (§4).

---

## 2. Method

1. **Export enumeration** — line-oriented scan of every export form used in this repo
   (`export const|function|class|type|interface|enum`, `export {…}`, `export * as`,
   `export default`, destructured `export const {…}`), comments stripped first.
2. **Import graph** — every file under `src/`, `tests/`, `scripts/`, `.github/`,
   `supabase/`, `controls/` plus root configs (523 files). Resolves the single tsconfig
   alias `@/* → ./src/*`, relative specifiers, and directory `index.*`. Counts static
   `import`, `import type`, re-export `export … from`, side-effect `import '…'`, dynamic
   `import()`/`require()`, and `jest.mock()`/`requireActual()` specifiers. Namespace
   imports (`import * as ns`) mark the whole target as consumed — deliberately
   conservative, so a namespace importer can never produce a false "dead".
3. **Framework contracts excluded** — Next.js consumes `page`/`layout`/`route`/
   `middleware`/`sitemap`/… exports by convention with no import statement anywhere.
   147 such symbols are reported separately rather than counted as dead.
4. **Internal-use discriminator** — for each zero-importer symbol, count references in
   its own file outside the declaration line. `>0` ⇒ OVER-EXPORTED, not dead.
5. **Cross-repo string reachability** — literal grep for each candidate name across
   `.github/`, `scripts/`, `supabase/`, `controls/`, `docs/` **and both sibling repos**
   (`lyra-mcp-server`, `lyra-admin-mcp-server`, both present on disk and confirmed
   readable), so a string-keyed or RPC-name reference is visible before anything is
   proposed for deletion. Recorded in `stringReachability` in the JSON.

### Known limits (stated so the number is honest)

- A regex scan, not a TypeScript program graph. It cannot see a symbol reached through
  a re-exported barrel under an alias rename, or through `eval`/computed member access.
  Mitigated by (2)'s conservative namespace handling and (5)'s string sweep, but a
  DELETE decision on any individual symbol still needs the human read that §3 records.
- `loc` is a brace-balance span, adequate for sizing, not a compiler measurement.
- The 147 framework-contract exclusions are matched by filename + symbol name. A
  conventional symbol name in a non-conventional file is *not* excluded (correctly), but
  a genuinely dead `default` export in a `page.tsx` would be (conservatively) kept.

---

## 3. Disposition register

### 3a. DELETE — genuinely dead, no in-flight ticket, no live consumer

| # | File | Symbols | LOC | Tests to delete with it | Evidence |
|---|---|---|---|---|---|
| D1 | `src/app/_marketing/sections.tsx` | `Hero`, `ProfilePreview`, `HowItWorks`, `Sections`, `UseCases`, `WhatLyraIsNot`, `AboutLyra`, `ParentTeacherCallout`, `WishKnowFindFirstHand`, `CTA` | **376** | *none* | Only `AboutTrio` is imported (`src/app/(legal)/about/page.tsx:4`). The homepage inlines its own markup. Every other name's remaining repo hits are comments or unrelated identifiers. **Keep the file, keep `AboutTrio`.** |
| D2 | `src/app/dashboard/share-profile.tsx` | `default` | **81** | *none* | KAN-154-B "Share your invite" client card. No importer; the only repo reference is a comment in `src/modules/dashboard/invite-text.ts:7`. |
| D3 | `src/lib/convene/google/calendar.ts` | `getFreeBusy` | **29** | *none* | Superseded by `src/lib/convene/calendar/google.ts::googleCalendarAdapter.getFreeBusy`, which is the one `adapterFor('google')` returns and `organise/actions.ts:188` calls. |
| D4 | `src/lib/convene/google/oauth.ts` | `exchangeCodeForTokens` | 23 | `tests/unit/convene/google-oauth.test.ts` (**partial — see note**) | The Google callback route reimplemented this inline as `exchangeCodeForTokensVerbose` (`src/app/api/convene/oauth/google/callback/route.ts:61`). Sibling exports `buildAuthorizeUrl` + `refreshAccessToken` in the same file **are live** — so this test file covers live code and **cannot be deleted**, only the `exchangeCodeForTokens` describe-block. |
| D5 | `src/lib/convene/invites/repository.ts` | `markInviteSent`, `markInviteFailed` | 21 | `tests/unit/…/invites-actions.test.ts`, `rsvp-submit-validation.test.ts` (**partial**) | No caller in any of the three repos; the dispatcher writes the same columns inline. Both test files also cover live code. |
| D6 | `src/lib/oauth/config.ts` | `wwwAuthenticateHeader` | 6 | `tests/unit/…/metadata.test.ts` (**partial**) | No route emits a `WWW-Authenticate` header via this helper. |
| D7 | *small dead constants & types* — `ContactMethodKind`, `RateLimitGate`, `PROD_SITE_URL`, `INVITE_COOKIE`, `INVITE_COOKIE_MAX_AGE`, `SupportedDeliveryCountry`, `RecommendationEventRow`, `sections/index.ts` re-exports (`useAutoSave`, `SectionSaveBar`) | 9 symbols | 14 | *none* | Type/constant declarations with no importer and no internal use. Zero runtime risk. |

**DELETE subtotal: ~550 LOC across 7 groups.** Note that **only D1, D2, D3 and D7 are
clean deletions with no test impact at all** (486 LOC). D4–D6 require editing shared test
files rather than deleting them, which is a *narrower* ask than the ticket anticipated.

### 3b. KEEP AS CONTRACT — intentionally unconsumed

| Symbols | Reason | Reference |
|---|---|---|
| `_internal` × 5 (`convene/invites/dispatch.ts`, `email.ts`, `twilio.ts`, `recommend/convene/score-attendee.ts`, `score-venue.ts`), `__resetCfAccessJwksCacheForTests`, `_clearFxCacheForTests`, `MERCHANT_RULES_INTERNAL` | Deliberate, named test seams. Their naming convention already declares the intent. | — |
| `src/modules/recommendations/recommender/inputs.ts` (4 symbols, 55 LOC) | **KAN-198 In Progress** — recommender input coercion; consumers not built yet. | KAN-198 |
| `src/modules/recommendations/recommender/events.ts` (3 symbols, 36 LOC) | **KAN-202 In Progress** — feedback/learning loop; `recommendation_events` consumers not built yet. | KAN-202 |
| `filterCandidatesByEligibility` (60 LOC) + `src/modules/affiliate/eligibility.ts` (3 symbols, 35 LOC) + `affiliate/types.ts` `parseSubId`/`isCountryCode` | The V2 pipeline comment says the eligibility filter is "built into the candidate sourcing buyer-country filter". **That is true today and only today**: Tier 1 (curated catalogue) does check `is_active` + `buyer_countries`, and Tiers 2–3 are stubbed (`candidate-sourcing.ts:152` — `TODO(KAN-184)`). The filter's own docblock explains it exists precisely to cover Tier 2/3. **It becomes load-bearing the moment KAN-184 lands `SOVRN_API_KEY`.** | KAN-190; **blocks KAN-184** |
| `microsoftCalendarAdapter` (102 LOC) | Phase-7 scaffolding. `calendar/index.ts` registers `google` only, and the connections UI states "More providers coming in Phase 7 (Microsoft, Apple, CalDAV)" — so no user can connect Outlook. Not a live gap. | — |
| `verifyAccessToken` (36 LOC) | Its docblock: *"AS-side self-check verifier (the load-bearing verification is the MCP resource server's)"*. Intentionally unconsumed by design. | KAN-88 |
| `approveBetaUser` (44 LOC) | `beta-queue/page.tsx` docblock: *"The single-row `approveBetaUser` action is retained — it remains a valid one-off approve path and is covered by its unit test"*. | KAN-277 → KAN-311 |
| `updateSectionVisibility` (42 LOC) | Documented as retained after the June-2026 editor redesign; `tests/unit/phase3-ui-integration.test.ts:233` **asserts the editor does not reference it**. Deleting it would contradict a live test. | KAN-221 |
| `getAnomalyWindow`, `getMetricsForWindow` (30 LOC) | Docblock: *"the same metrics surface is useful in the admin dashboard (eventual KAN-63-D operator observability work)"*. | KAN-63-D |
| `canTransition`, `isFieldEditable`, `isEvergreenFallback`, `disconnectConnection`¹ | Gathering state-machine predicates and evergreen fallback — small, cheap, semantically part of their module's declared contract. | — |

¹ `disconnectConnection` is listed here for completeness but is **actually a WIRE UP** — see §4.1.

### 3c. OVER-EXPORTED — 160 symbols, 1,463 LOC

Live code reached from inside its own file, exported solely for test access. **Not
dead; do not delete.** Full list in the JSON (`bucket == "OVER-EXPORTED"`). Largest
concentrations: `src/modules/contracts/content-moderation.ts` (8), `dashboard/settings/discoverability-helpers.ts` (6),
`dashboard/profile/visibility.ts` (5), `lib/oauth/jwt.ts` (5), `lib/oauth/refresh.ts` (5).

**Recommended disposition — none, for now.** Narrowing these is a per-module decision to
be taken *during* each extraction (KAN-415), because the alternative to an over-wide
export is usually restructuring the test, which is sign-off territory. What matters for
this epic is the negative result: **they must not be written into `modules.json`
`publicApi`.** KAN-416's manifest should mark a module's public API from the
`CONSUMED` bucket only.

---

## 4. Security findings — raised separately

Both were found because a "dead" export turned out to be the *correct* implementation
that a live surface bypasses. Neither is a modularisation issue; both are live defects.

### 4.1 `disconnectConnection` is dead because the UI bypasses it — the vaulted refresh token is never revoked

`src/lib/convene/oauth-connections.ts:152` soft-deletes the connection **and** calls
`vaultRevokeRefreshToken(conn.refresh_token_secret_id)`. Nothing calls it.

The Disconnect button (`src/app/dashboard/convene/connections/connections-client.tsx:50`)
instead performs a **client-side PostgREST update** setting `deleted_at` + `status='revoked'`
— and stops there. `vaultRevokeRefreshToken` has exactly two call sites in the entire
codebase (`oauth-connections.ts:117` re-connect, `:162` inside the dead function); there
is no DB trigger on `oauth_connections` and no retention sweep that touches it.

The user is told, in the confirm dialog: *"Lyra will forget your tokens and any draft
gatherings using this calendar will need a new connection"*, and on the page: *"You can
disconnect at any time; we'll forget your tokens immediately."* **The Google Calendar
refresh token remains live in the Supabase vault indefinitely.**

Severity: **High** — a stated consent withdrawal is not honoured; a long-lived
calendar-scope OAuth token is retained after the user asked for it to be deleted, on a
service holding minors' data.

### 4.2 `search_by_contact_hash` is a privileged, RLS-bypassing RPC with no product consumer

`searchByPhone` (`discoverability-actions.ts:150`) is the **only** caller of the
SECURITY DEFINER RPC `search_by_contact_hash` — and `searchByPhone` itself has no caller.
The settings UI imports `setDiscoverability` and `getDiscoverability` only; there is no
search box, no API route, and no MCP tool in either sibling repo (verified by
`org:luisa-sys` code search). Its sibling `searchByPostcode` was already removed under
KAN-339, leaving the file's own docblock stale.

So: users are invited to toggle "Allow discovery by phone number" — which hashes and
stores their phone number — for a lookup feature that **has no entry point**. Meanwhile
the RPC stays `EXECUTE`-granted to `authenticated`, bypasses RLS, and is directly
callable via PostgREST. It has already cost three findings (**BUGS-45** anon-callable,
**SEC-80** returned suspended profiles, and it is one of the four named R2 root-cause
entries in `supabase/migration-privileges-baseline.json`).

Severity: **Medium** — unreachable-from-product privileged surface, plus personal data
(phone hash) collected for a purpose that cannot currently be delivered.

---

## 5. Batched sign-off request (Test Integrity Policy)

Per CLAUDE.md, deleting a test file requires explicit founder sign-off. **Nothing has
been deleted.** The single batched decision, when the deletions execute inside KAN-415:

**(a) Test files that may be deleted whole — none.** Every DELETE candidate with tests
shares its test file with live code.

**(b) Test files needing a partial edit** (remove only the block covering the deleted
symbol; every other block in the file covers live code and stays):

| Test file | Block to remove | Covers dead symbol |
|---|---|---|
| `tests/unit/convene/google-oauth.test.ts` | `exchangeCodeForTokens` describe | D4 |
| `tests/unit/…/invites-actions.test.ts`, `…/rsvp-submit-validation.test.ts` | `markInviteSent` / `markInviteFailed` assertions | D5 |
| `tests/unit/…/metadata.test.ts` | `wwwAuthenticateHeader` assertions | D6 |

**(c) Test-floor impact.** D1, D2, D3 and D7 (486 LOC, the bulk of the deletion) carry
**zero tests** — the floor of 2118 does not move for them. Only (b) reduces the count,
by the number of assertions removed. The exact delta must be measured on the branch that
executes the deletion and reconciled with the F5 floors, not estimated here.

---

## 6. Feeds into

- **KAN-416 (R1 manifest)** — `modules.json` `publicApi` must be drawn from the
  `CONSUMED` bucket only. Writing the 219 zero-importer symbols into module public APIs
  would freeze 1,463 LOC of test-only surface plus 1,130 LOC of dead code into
  permanent contracts. This is the D-11 risk the epic exists to avoid, now quantified.
- **KAN-415 (extraction)** — §3a is the execution list; §3c is a per-module judgement
  call at extraction time.
- **KAN-421 (profiles ADR)** — no interaction; `profiles` access is column-level, not
  export-level.
- **KAN-184** — must wire `filterCandidatesByEligibility` into the V2 pipeline before
  Sovrn Tier 2 goes live, or ineligible/deactivated merchants reach users.
- **KAN-353** — `lib/recommend/convene/` `_internal` seams confirmed as KEEP.
