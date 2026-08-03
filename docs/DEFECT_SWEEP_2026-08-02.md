# Defect sweep — 2026-08-02

Adversarially-verified hunt across six failure classes this codebase has actually
repeated. Run against `develop` @ `5d768d73`. Every finding faced a skeptic
instructed to default to refuting; the triage agent then re-derived every
load-bearing fact itself rather than trusting the reporters.

**22 raised → 10 refuted → 3 confirmed.** All three medium severity. Tickets:
**SEC-117** (SAR export), **SEC-118** (admin self-suspend + CTL-028),
**SEC-119** (CTL-026 comment-satisfied wiring check).

## Coverage — every lens enumerated rather than sampled

| Lens | Files examined | Raised |
|---|---:|---:|
| self-referential-oracle | 284 | 4 |
| declared-not-wired | 278 | 4 |
| sibling-drift | 274 | 3 |
| guard-scope | 128 | 4 |
| fails-open | 96 | 3 |
| control-cannot-fire | 74 | 4 |

## Two registry claims found false in one sweep

Worth acting on beyond the individual tickets:

- **CTL-028** lists SEC-47 and SEC-84 in `prevents` — both *"mutators could
  self-escalate or grief peer admins"* — but only matches `is_published` **read**
  chains. It stayed green with the self-moderation guard deleted.
- **CTL-001** declares `wired_in: promote-to-production.yml`, where the only
  mentions are inside `#` comments. The workflow never executes it.

**Audit the whole `prevents` column**, not just these two. A control claiming to
prevent something it cannot see is worse than one claiming nothing.

## Known gap in this run

The triage agent's input was **truncated mid-record**, and it said so rather than
inventing the missing entries. One guard-scope survivor and the
self-referential-oracle counts did not reach it. The oracle lens separately
reported a credible null (249 test files, five detectors, 0 same-file source-text
oracles) — plausible because BUGS-86's siblings had landed hours earlier.

**The fails-open lens produced no coverage data in the triage input.** Treat
"no fails-open findings" as *not reported*, not as *none exist* — that is the
lens most worth re-running against a personal-data service.

## Process note

A verifier hit a red suite caused by a **concurrent session** editing
`src/app/(legal)/contact/actions.ts` mid-run, and correctly left it alone.
**Mutation testing and parallel sessions in the same checkout do not mix** — per
the worktree policy in CLAUDE.md, this kind of pass should run in its own
worktree.

---

# Triage brief — defect hunt on `lyra` @ develop (5d768d73)

**Input integrity, read this first.** The CONFIRMED array I was handed is **truncated mid-record** (it stops inside finding 3's `verifierNote`, at `` `grep -n check-workflow-integrity .github/workflows/pr-checks.yml` t ``). The COVERAGE block says sibling-drift survived **2** and guard-scope survived **2** — four survivors — and I received three. The COVERAGE block is also truncated inside the self-referential-oracle entry, before its `raised`/`survived` counts. **One guard-scope survivor and the entire self-referential-oracle verdict are missing from my input.** I have not invented them. Everything below covers the three findings I actually received, each of which I independently re-verified against the working tree before writing this.

I re-derived every load-bearing fact myself (reads and greps listed per finding). I did not re-run the mutations — the tree is clean (`git status` shows only an untracked `.claude/`), and re-running them would risk leaving a mutated repo behind in a session another agent is sharing.

---

## 1. Findings, ranked by severity × confidence

### F1 — SAR export omits person-keyed tables the deletion cascade erases; its "completeness" test hard-codes the answer
`/Users/admin/Documents/2026 Lyra/lyra/src/app/dashboard/settings/actions.ts:34` (control: `/Users/admin/Documents/2026 Lyra/lyra/tests/unit/sar-export-completeness.test.js:34`)
**Medium severity · high confidence · defect not mutation-proven (it is an omission); the control's vacuousness IS mutation-proven, both directions.**

**Claim.** `exportUserData()` queries 18 tables. `deleteAccount()` hard-deletes the auth user and relies on FK cascade to erase *every* person-keyed table. The two have drifted, and the test that exists to stop exactly that drift is a copy of the export's own list.

**Failure scenario.** A member who has authorised an MCP client, connected a Google/Microsoft calendar, or created contact groups clicks "Download all your Lyra data" (`settings-client.tsx:236`). The JSON comes back with no `tribes`, `tribe_members`, `consent_log`, `oauth_consents` or `feature_entitlements` section. No query failed, so no `export_incomplete_errors` key is emitted either — the incomplete response is **indistinguishable from a complete one**. `deleteAccount()` then erases exactly those rows. Result: an incomplete UK-GDPR Art.15/20 response, on a service holding minors' data, that neither the member nor the operator can tell is incomplete.

**Verified by me just now.** `grep -n "from('" src/app/dashboard/settings/actions.ts` → exactly the 18 tables. `grep -c "tribes\|consent_log\|oauth_consents\|venue_ratings\|feature_entitlements"` → **0**. `deleteAccount`'s own comment says the cascade "removes ALL of the person's data in one step". `tests/unit/sar-export-completeness.test.js:33` comments *"Every table the deletion cascade removes must also be exported"* and line 34 then hard-codes an 18-entry `requiredTables` array identical to what the export already does — it discovers nothing from the schema, and `test.each` asserts `exportBody` contains `from('<table>')`.

**Reporter's mutation, as relayed:** adding `from('tribes')` to the export → still 24/24 green (control has no opinion in the additive direction); renaming `from('contacts')` → 1 failed. So it is a regression lock over its own copied list, not a completeness check.

**Two corrections carried from the verifier, both of which I accept:** `venue_ratings` has **no writer anywhere** in any of the three repos (SELECT-only at `lyra-mcp-server/src/convene-suggest-venues-tool.ts:155`), so the live gap is 5 tables, not 6. And the gap is **larger** than reported — `affiliate_clicks`, `recommendation_events`, `venue_visits`, `oauth_scopes_granted` are also person-keyed and unexported. Defensibly excluded by contrast: the four live-credential `oauth_*` token tables (SEC-71 redacts deliberately), `moderation_logs` (ON DELETE RESTRICT + documented Art.17(3)(b) retention), `erasure_obligations`.

This is **not** later drift. `tribes`/`tribe_members`/`consent_log` ship in the 2026-05-16 migrations, `feature_entitlements` 2026-06-22 — all predate SEC-71 (#495, 2026-07-22). The guard was born narrower than its own header claim. That is the SEC-115 shape.

---

### F2 — Report-page admin suspend is the only suspend path with no self-moderation guard, and it trusts a client-supplied target id
`/Users/admin/Documents/2026 Lyra/lyra/src/app/admin/reports/[id]/page.tsx:64`
**Medium severity · high confidence · mutation-proven.**

**Claim.** Of the code paths that set `profiles.is_suspended = true`, three carry a self-moderation guard and one does not — and the one that does not also uses the form's `profileId` verbatim instead of re-deriving it from the report row, which its own sibling function in the same file does.

**Failure scenario.** No forging is even required for the common case: `src/app/api/reports/route.ts:111` blocks only *self*-reports, so any authenticated user can report an admin's profile. The suspend form renders on `report.profile && !report.profile.is_suspended` with **no `isSelf` check** (`reports/[id]/page.tsx:255`), where the users page hides the same buttons behind `!isSelf` (`users/[slug]/page.tsx:312`, `:475`). An admin reviewing a report filed against their own profile is shown a live red "Suspend profile" button with nothing behind it. One click and: on dev/staging (`ADMIN_HOST_ENFORCED` unset) the middleware suspension gate at `src/middleware.ts:177` redirects them to `/suspended` on every path, and there is **no self-unsuspend path anywhere** — `setSuspendState:94` blocks unsuspend too, `bulkUserAction` filters the admin out (`admin/users/actions.ts:92`). Recovery needs a second admin or direct SQL. Separately and in every environment, `logModerationAction` stamps `metadata: { reportId }` against the client-supplied `profileId`, so a rogue admin can write a `moderation_logs` row tying a suspension to an unrelated report.

**Verified by me just now.** `actionSuspendProfile` reads `const profileId = String(formData.get('profileId') ?? '')` and passes it straight to `logModerationAction` and `.eq('id', profileId)` — no `admin.profileId` comparison anywhere in the file. Its siblings both carry the guard *with explicit prose asserting the opposite invariant*: "action handlers must be self-defending" (`users/[slug]/page.tsx:91-93`) and "Self-moderation guard (mirror setSuspendState)" (`:135`). `dismissOrResolveReport` (same file, line 108) re-reads `profile_id` from the `reports` row server-side; `actionSuspendProfile` does not.

**Mutation result, as relayed:** deleting the 6-line guard from `setSuspendState` left `npx jest tests/unit` fully green — the invariant is invisible to CI. The verifier reproduced this and correctly flagged that the reporter's post-mutation count (2455 vs a 2453 baseline) is arithmetically impossible; the one suite that went red in the verifier's run (`redesign-fidelity.test.js:188`) was collateral from a concurrent session editing `(legal)/contact/actions.ts`, not the mutation.

**Three scope corrections I am carrying forward, because they change what the ticket should say:**
1. The missing guard does **not** enable privilege escalation. The sibling guard only blocks *self*-targeting, so admin A can already suspend admin B through the sanctioned UI. The only capability added is **self**-targeting. Do not write this up as cross-admin escalation.
2. The lockout side effect is **dev/staging only**. On prod, `middleware.ts:156` returns before the suspension gate when `ADMIN_HOST_ENFORCED`/CF Access are set, and `getCurrentAdmin` (`src/lib/admin.ts:85-91`) never selects `is_suspended`.
3. The DB backstop cannot help. `supabase/migrations/20260622170000_block_admin_suspended_self_set.sql:32` opens `if auth.uid() is null then return new;` and its own header says service-role callers bypass by design. It is an anti-self-*unsuspend* trigger.

---

### F3 — CTL-026, the meta-control built for SEC-79, accepts a mention inside a comment as proof a control is invoked
`/Users/admin/Documents/2026 Lyra/lyra/scripts/check-control-registry.py:132`
**Medium severity · very high confidence · mutation-proven. Latent today, but one declared wiring is already false.**

**Claim.** The wiring check is a bare substring test over whole file text, and satisfaction is ANY-of across `wired_in` targets. A `#` comment counts.

**Verified by me just now, line for line.** Line 132 is `elif impl_basename and impl_basename in content: referenced_anywhere = True`. `referenced_anywhere` is set once per control and tested once after the target loop. CTL-001 declares `wired_in: [pr-checks.yml, promote-to-production.yml]`. `grep -n 'check-workflow-integrity' .github/workflows/promote-to-production.yml` → **only lines 165 and 176, both inside `#` comment blocks**; that workflow never executes the script. `pr-checks.yml` has exactly one hit: line 34, `run: bash scripts/check-workflow-integrity.sh`.

**Failure scenario.** A PR deletes or renames that single `run:` line — a step consolidation, an agent tidying the gate list. CTL-001 (the BUGS-4/KAN-167 false-green-CI scanner that catches `GITHUB_TOKEN` pushes, `--limit 1` deploy verification and rollback steps that never roll back) is now invoked by nothing. `check-control-registry.py` still exits 0 and prints "Every registered control exists, is invoked", because the two explanatory comments in `promote-to-production.yml` satisfy the substring test. The control built to detect precisely this — its own registry summary names "the SEC-79 'silently disabled for weeks' failure mode" — reports clean. **Mutation-proven:** replacing the `run:` line with `run: echo 'guard removed'` left both `check-control-registry.py` and `check-guard-path-drift.py` green at exit 0.

**Live today, not just hypothetical:** CTL-001's declared wiring into `promote-to-production.yml` is already inaccurate, and the registry integrity check cannot see it. This is CTL-039's own defect class ("a scan satisfied by a comment") landing on the meta-control — and CTL-039 does not scan workflow YAML.

**Bonus finding embedded in the F2 verification, worth its own line:** `controls/registry.json` CTL-028 lists SEC-47 and SEC-84 in `prevents` — both described as "mutators could self-escalate or grief peer admins" — but its implementation (`scripts/check-suspension-guard-coverage.py`, `PUBLISHED_RE`) only matches `.eq('is_published', true)` **read** chains. The one registered control naming F2's defect class cannot fire on a write-path self-guard; it stayed green with the guard deleted.

---

## 2. Security / data-integrity vs hygiene

| | Class | Why |
|---|---|---|
| **F1** | **Data-integrity + regulatory.** Not security. | No unauthorised access and no data loss — the cascade *does* erase these rows correctly. The defect is a UK-GDPR Art.15/20 completeness failure that presents as success. |
| **F2** | **Security-adjacent + audit-integrity.** | Actor must already be a trusted admin and gains no authority over other users, so it is not a privilege boundary break. It is above hygiene because of `moderation_logs` — the tamper-evident audit trail (SEC-64) for a service holding minors' data — and because self-lockout is unrecoverable in-app. |
| **F3** | **Control integrity.** | No live consequence today; it is the mechanism by which a *future* live consequence goes unnoticed. Same class as SEC-79. |

None of the three is high severity. I would not tell the founder to stop a release for any of them.

---

## 3. Smallest fix, and can a control make recurrence impossible (SEC-101)

**F1 — smallest fix:** add the five missing `.from()` blocks (`tribes`, `tribe_members`, `consent_log`, `oauth_consents`, `feature_entitlements`) plus the four the verifier found (`affiliate_clicks`, `recommendation_events`, `venue_visits`, `oauth_scopes_granted`). Skip `venue_ratings` — nothing writes it.
**Prevention — make it impossible, not detected:** export a single `PERSON_KEYED_TABLES` manifest and have `exportUserData()` *iterate* it rather than hand-write 18 blocks. Then the test asserts the manifest against a schema-derived list (the cascade closure from `auth.users`/`profiles`, computable from the migrations or `prod.ts`) with an explicit, commented `DELIBERATELY_EXCLUDED` set for the credential tables. Adding a table to a migration without exporting it becomes a red test rather than a silent gap. Note the current test would have to be rewritten, not extended — a hard-coded list can never become a completeness check, and enlarging it just re-creates the same defect one table later. Consider making that the registered SAR control; there is currently **no** SAR/GDPR entry in `controls/registry.json` at all.

**F2 — smallest fix:** two lines in `actionSuspendProfile` — mirror `users/[slug]/page.tsx:94` (`if (profileId === admin.profileId) redirect(...)`), and re-derive `profileId` from the `reports` row exactly as `dismissOrResolveReport` at `:108` already does. Also add `!isSelf` to the form render at `:255` so the button stops appearing.
**Prevention — make it impossible:** extract one `moderateProfile({ admin, targetProfileId, action, reason, metadata })` helper that performs the self-check, the audit write and the mutation together, and make it the **only** writer of `profiles.is_suspended` / `is_published`. Then the control is a one-line grep: no `.from('profiles').update(` containing `is_suspended` outside that helper. That is structurally stronger than the three-sites-must-remember-a-guard arrangement that produced this and, per CLAUDE.md, eight prior tickets. Extending `check-suspension-guard-coverage.py` to write chains would be detection; the single-writer refactor is impossibility.

**F3 — smallest fix, and it doubles as the prevention:** two changes in `check-control-registry.py`. (a) Strip `#` comments from YAML before the substring test, or require the basename on a `run:`/`uses:` line — the comment-stripping helper already exists in `scripts/check-comment-only-assertions.py` (CTL-039); reuse it rather than write a second one. (b) Make `referenced_anywhere` **per-target** rather than ANY-of, so a stale `wired_in` entry is reported by name. **Warn the founder:** (b) will immediately go red on CTL-001, because its `promote-to-production.yml` wiring is already false. That red is correct and is the whole point — resolving it is a one-line registry edit (drop the stale target) or actually wiring the script into that workflow. Someone has to decide which; do not merge (b) without that decision or CI blocks.

---

## 4. Lenses that found nothing — stated plainly

**sibling-drift** (274 files: every `.ts`/`.tsx` under `src/` excluding generated DB types; 277 supabase chains extracted, 75 mutating, all 75 classified, 11 hand-reviewed; every call site of 12 guard helpers enumerated and diffed). Raised 3, survived 2 — one died under the skeptic. **Explicitly ruled out with the guard present at every site:** busy-time consent (`assertBusyTimeConsent`, both sites), `media_uploads` entitlement, magic-byte upload preflight, the 18+ declaration chokepoint, `is_published`/`is_suspended` public-read chains (**8 of 8**), conversation-starter sanitise+moderate in both add and update, the admin gate on every action under `src/app/admin`, and Google-vs-Microsoft OAuth **callback** symmetry line by line. That last one is a meaningful null given SEC-115.

**guard-scope** (128 files: all 38 registry controls × every `wired_in` target classified EXEC/COMMENT-ONLY/ABSENT; all 41 workflows; all 31 `scripts/check-*` guards read for whether they *discover* or *name* their targets; all 16 `is_published` migrations checked for unguarded RLS/RPC siblings — all guarded). Raised 4, survived 2, **and I only received one of the two.** Ruled out and deliberately not reported: the OAuth *initiate*-route raw-error leak (already tracked as SEC-115, not a new finding); `scripts/reconcile-affiliate-clicks.ts` and `seed-affiliate-merchant-eligibility.ts` building service-role clients outside the CTL-004 factory (outside that guard's declared `src/` scope, ops-only scripts); the retention cron route absent from `cron-auth.test.ts`'s list (a second test covers it).

**self-referential-oracle** — **enumerated 249 test files, found nothing new, and that null is real.** All 249 machine-classified with five detectors: import-mapping (131 import from the subject tree), iteration-over-an-imported-collection (39 hits), balanced-paren extraction of every `expect(X).matcher(Y)` where Y references a subject import (53), expected values bound to a prior call of the subject (11), and same-file source-text oracles (**0 hits**). All 24 iterated imported CAPS collections were then hand-verified as pinned against a literal — `MANUAL_OF_ME_FIELDS`, `ALLOWED_AFFILIATION_TYPES`, `GA_`/`TEST_FEATURE_KEYS`, `GLOBAL_FEATURE_KEYS`, `AGE_RANGE_BUCKETS`, `RECOMMENDATION_EVENT_TYPES`, `LYRA_MONITORS`, `BULK_ACTIONS`, `ITEM_CATEGORY_TO_SECTION` all pin correctly. Confirmed legitimate and not reported: `sec18-hmac-hash.test.ts` (recomputes the HMAC independently with node `crypto`), `discoverability-helpers.test.ts`, `consented-analytics.test.ts` (pins `CONSENT_STORAGE_KEY` to a literal *before* using it as a needle), `security-headers.test.ts` (CSP directives as literals). **Context that makes this null credible rather than suspicious:** the known instance of this class was fixed hours ago — HEAD is `5d768d73` "test(KAN-414 F4): Microsoft OAuth scopes — and three survivors that should not have survived (#672)", which added `tests/unit/convene/microsoft-oauth-behaviour.test.ts`. The lens ran on a tree where BUGS-86's siblings had just landed. Its `raised`/`survived` counts were truncated out of my input; no self-ref-oracle finding reached me, and I am reporting that as a null rather than as silence.

**Lenses with no coverage data in my input at all:** *declared-but-not-wired*, *fails-open*, and *control-that-cannot-fire* as standalone passes. F3 and the CTL-028 bonus are control-that-cannot-fire findings that arrived filed under guard-scope, so the class was touched — but I received no enumeration for the fails-open lens, which is the one I would most want run against a personal-data service. **Treat "no fails-open findings" as "not reported to me", not as "none exist."**

---

## 5. Confidence, and what a human should re-check before a ticket is raised

**High confidence, all three.** I re-derived every structural fact myself against the working tree: the missing guard and its two commented siblings, the 18-table export list and the zero-hit grep, the hard-coded `requiredTables` at line 34, the substring test at `check-control-registry.py:132`, and the two comment-only hits in `promote-to-production.yml`. None of it depends on trusting the reporter's prose. The verifier notes are unusually good — they corrected the reporter on severity, on scope, and on an impossible test count, and each correction narrowed the claim rather than inflating it, which is the right direction of travel.

**Re-check before raising tickets:**

1. **Which of F1's tables actually hold prod rows.** The whole severity argument turns on volume. `venue_ratings` was already shown to be empty by construction; someone should count rows in `tribes`, `tribe_members`, `consent_log`, `oauth_consents`, `feature_entitlements` on **prod** before the ticket asserts real members are affected. Cheap query, changes the framing.
2. **Whether privacy@ already backfills F1 by hand.** `docs/compliance/DSAR_BREACH_COMPLAINTS.md:63` points the operator at the ROPA as a locate-checklist — and `docs/compliance/ROPA.md` names none of these tables either, per the verifier. If the human-handled DSAR path has its own list, that list needs the same fix and the ticket should cover both.
3. **F3's ANY-of semantics may be intentional.** The error string is literally "none of its wired_in targets reference" — someone wrote ANY-of deliberately. The comment-stripping half of the fix is unambiguously right; the per-target half is a design change and needs a moment's thought about whether `wired_in` is meant as "runs here" or "relevant here". Both readings are defensible; the current code lets them be silently confused.
4. **The two missing results.** Before this brief is treated as the complete picture, re-request the truncated tail: the second guard-scope survivor and the self-referential-oracle counts. Three findings is a plausible result for this tree; four was what the coverage block promised.

**One process note.** The verifier hit a red suite (`redesign-fidelity.test.js:188`) caused by a *concurrent session* editing `src/app/(legal)/contact/actions.ts` mid-run, and correctly left it alone. Mutation testing and parallel sessions in the same checkout do not mix — per the worktree policy in CLAUDE.md, this kind of pass should run in a dedicated worktree, or a collateral red will eventually be mistaken for a finding.