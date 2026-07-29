# KAN-421 — R6 Spike: the fate of the `profiles` god-table

**Epic:** KAN-414 (modularisation scoping) · **Depends on:** KAN-416 (R1 module manifest), KAN-420 (R5 schema baseline)
**Feeds:** the ADR (`docs/ADR.md` → ADR-008), KAN-415 C3 (table-ownership gate), `modules.json` `owns` entries
**Run:** 2026-07-28, Modularisation Scoping routine · **read-only.** Database access was `execute_sql` with `SELECT` only, against `information_schema`, `pg_policies`, `pg_class`, `pg_proc`, `pg_trigger` and one application table (`global_feature_switches`). **Zero writes were made to any environment.**
**Measured at:** lyra `develop` @ `1cadd57` · lyra-mcp-server `main` @ `31c114b` · lyra-admin-mcp-server `main` @ `6b8dfb3` · dev `ilprytcrnqyrsbsrfujj` · prod `llzkgprqewuwkiwclowi`

---

## 1. Executive summary

1. **The table is smaller than feared and the call surface is bigger.** `profiles` carries **41 columns** (dev/staging; prod has 37 — SEC-107). It is touched by **96 production call sites across all three repos** — lyra 77, lyra-mcp-server 15, lyra-admin-mcp-server 4 — plus **9 test-harness sites**. The ticket's estimate of "~75 call sites" undercounted by 28%: it was the lyra figure, not the estate figure.
2. **100% of columns are attributed.** Every one of the 41 live columns maps to exactly one owning module under the KAN-416 manifest; no column is unowned, and no owned column is absent from the live schema. All 96 sites map to a module — none unattributed.
3. **Genuine multi-writer columns: 2, not 15.** Only `is_published` (written by `profile` **and** `admin`) and `user_status` (written by `access` **and** `admin`) have more than one writing module. A further 6 columns are written by exactly one module that is **not** their declared owner — all six are `access`-owned columns written by `admin`. §4 argues these 8 are one pattern, not eight problems.
4. **Option (A)'s gate is blind on 38% of writes — and that is the ceiling, not a bug to fix.** A column-granularity grep gate can bound the column set of 82 of 96 sites (85%), but only **13 of 21 write sites**. The other **8 writes pass a variable** (`.update(sanitised)`, `.update(transition.update)`, `.update(updates)`) whose keys are not knowable from source at all. Those 8 include the two most security-relevant write paths in the estate.
5. **The database already enforces column ownership — with triggers, not with grep.** Three `BEFORE UPDATE` triggers on `profiles` (SEC-27, KAN-273/309/319) make `is_admin`, `is_suspended`, `user_status`, `access_tier`, `beta_*` and `age_status` un-writable by any caller holding an end-user JWT. This is the decisive finding: **real column-level ownership enforcement is already in production and does not require splitting the table.** It reframes the choice.
6. **Recommendation: option (A+) — adopt column ownership, and close the gate's blind spot with triggers rather than with a better parser.** Defer option (B). Full reasoning and trigger conditions in ADR-008 (`docs/ADR.md`).
7. **One security finding, raised as its own ticket.** `is_published` is **not** covered by any guard trigger, and `authenticated` holds a direct `UPDATE` grant on it plus an RLS policy permitting self-update. A user can therefore self-publish straight against PostgREST and bypass the KAN-408 provider age gate in `publishProfile()`. The gate is **currently inactive on prod** (no `age_verification` switch row), so this is a **latent** bypass of the child-safety control, not a live breach. Raised as **SEC-112**; see §7.
8. **A defect in the committed KAN-416 seed.** Its `unboundedSites: 19` figure is inflated: `IDENT_KEY_RE` is line-anchored (`(?m)^\s*<key>:`), so every **single-line** object literal is misread as an unbounded write. Re-running kan416's logic reproduces its 19 exactly, of which **8 are false positives** — the true lyra figure is 11 (three-repo: 23 → 14). §6.

---

## 2. Reproduction

Every number below is reproducible from the repo:

| What | How |
| --- | --- |
| Column inventory, multi-writers, gate PoC | `python3 docs/modularisation/kan421-profiles-inventory.py` |
| Full machine-readable output | `docs/modularisation/data/kan421-profiles-inventory.json` |
| Live column capture (dev, read-only) | `docs/modularisation/data/kan421-profiles-columns-dev.json` |
| RLS policies / grants / triggers | the four `SELECT`s quoted verbatim in §5 and §7 |

The script imports `kan416-derive.py` as a library — the module path map (`MODULE_RULES`), the column-ownership map (`PROFILES_COLUMNS`) and the chain window are **shared, not copied**, so the two artefacts cannot silently disagree. The two MCP repos have no path map in KAN-416, so one is declared explicitly at the top of the script (8 rules); a file matching none is reported as `UNATTRIBUTED`, never folded into a module. Today none are.

---

## 3. The column inventory

41 live columns, grouped by owning module. "Sites" counts bounded references only.

| Owner | n | Columns |
| --- | --- | --- |
| `profile` | 14 | `display_name`, `slug`, `headline`, `bio_short`, `city`, `region`, `postcode_prefix`, `country`, `avatar_url`, `is_published`, `onboarding_complete`, `completion_score`, `section_visibility`, `age_range` |
| `access` | 8 | `user_status`, `access_tier`, `is_suspended`, `is_admin`, `suspended_at`, `suspension_reason`, `beta_requested_at`, `beta_approved_at` |
| `convene` | 5 | `phone_search_hash`, `postcode_search_hash`, `discoverable_by_phone`, `discoverable_by_postcode`, `share_availability_with_contacts` |
| `age` | 5 | `age_status`, `age_checked_at`, `age_provider`, `age_provider_ref`, `age_declared_18_at` |
| `db/schema` (identity kernel) | 4 | `id`, `user_id`, `created_at`, `updated_at` |
| `marketing-legal` | 2 | `is_homepage_example`, `homepage_example_order` |
| `affiliate` | 1 | `delivery_country_code` |
| `recommendations` | 1 | `recipient_attributes` |
| `dashboard` | 1 | `dashboard_widget_state` |

**Call sites by module** (96 production): `admin` 28, `profile` 16, `public-profile` 10, `convene` 9, `access` 8, `age` 6, `account` 5, `features` 5, `dashboard` 3, `marketing-legal` 3, `recommendations` 2, `trust-safety` 1.

**Write sites by module** (21): `profile` 7, `admin` 6, `access` 3, `age` 2, `convene` 1, `account` 1, `dashboard` 1.

Eight columns are never referenced by a *bounded* site — `region`, `postcode_prefix`, `completion_score`, `phone_search_hash`, `postcode_search_hash`, `discoverable_by_postcode`, `age_range`, `recipient_attributes`. They are not dead: they are reached through `select('*')` and variable payloads, which is precisely the blind spot of §5.

### 3.1 One ownership correction

`delivery_country_code` is declared `affiliate`-owned but is written only by `profile` (`src/app/dashboard/profile/delivery-country-actions.ts:58`) — it is set on the profile page and *consumed* by affiliate link-building. Either the manifest's owner is wrong, or the write belongs behind an `affiliate` API. **Recommendation: reassign the column to `profile` in `PROFILES_COLUMNS` and let `affiliate` read it.** Ownership should follow the writer. This is a manifest correction, not a code change, and is listed for KAN-415 C3 rather than actioned here.

---

## 4. Multi-writer columns — the named list

The ticket asks for the columns more than one module legitimately writes, because those are what make option (A) fragile.

**Genuinely multi-writer (2):**

| Column | Owner | Writers | Sites |
| --- | --- | --- | --- |
| `is_published` | `profile` | `profile`, `admin` | `dashboard/profile/actions.ts:643` (user publishes), `lyra-mcp-server/write-tools.ts:542` (agent publishes), `admin/users/[slug]/page.tsx:150` (admin unpublishes) |
| `user_status` | `access` | `access`, `admin` | `lib/beta-access/flow.ts:146` (self-service beta flow), `admin/beta-queue/actions.ts:30` (admin approves) |

**Written by a single non-owner module (6):** `is_suspended`, `suspended_at`, `suspension_reason`, `beta_approved_at`, `user_status`, `access_tier` — every one owned by `access`, every one written by `admin`.

**These 8 are one pattern.** Both multi-writer columns, and all six non-owner writes, are the same shape: *a user-initiated write to a column, plus an administrative override of that same column.* `admin` is not trespassing — an admin console whose entire purpose is to change access state must write access state.

Two ways to record this honestly, and the ADR must pick one:

- **(i) Admin override is a first-class same-layer edge.** `admin` declares `mayDependOn: ['access', 'profile']` with a `reason`, exactly as KAN-416's amended layer policy now permits for code edges. The write stays in `admin`.
- **(ii) `access` exposes `suspendUser()` / `approveBeta()` / `setUserStatus()` and `admin` calls them.** One writer per column, genuinely. Costs 6 call-site changes in one repo plus 1 in lyra-admin-mcp-server.

**Recommendation: (ii) for the access-model columns, (i) for `is_published`.** The access-model columns are the ones the ticket names as needing exactly one writer, and routing them through an `access` API is cheap (7 sites) and puts the suspension/approval logic where the suspension guard already lives. `is_published` is different: the admin unpublish is a moderation action with different semantics from a user publish, and collapsing them into one function would obscure that. Record it as a declared edge instead.

Under (ii), the ticket's acceptance criterion is satisfiable: **`is_suspended`, `user_status`, `access_tier` and the `beta_*` columns get exactly one writer module (`access`); `is_published` keeps two writers by explicit, reasoned declaration.**

---

## 5. Option (A) enforceability — the proof-of-concept gate run

The gate is implemented in `kan421-profiles-inventory.py` (`unbounded_reasons()`) and run against current `develop` + both MCP `main`s.

| Measure | Result |
| --- | --- |
| Production sites | 96 |
| Sites whose column set the gate can bound | **82 (85%)** |
| Sites the gate cannot bound | **14** |
| Write sites | 21 |
| **Write sites the gate cannot bound** | **8 (38%)** |

**Blind-spot taxonomy** (site counts):

| Reason code | n | What it is |
| --- | --- | --- |
| `write-variable-payload` | 8 | `.update(x)` where `x` is a variable — key set unknowable from source |
| `select-star` | 6 | `select('*')` — reads an unbounded column set |

The 8 blind writes:

```
lyra/src/app/admin/users/[slug]/page.tsx:107                     admin
lyra/src/app/admin/users/actions.ts:114                          admin     .update(transition.update)
lyra/src/app/dashboard/profile/actions.ts:132                    profile   .update(sanitised)
lyra/src/app/dashboard/settings/discoverability-actions.ts:114   account
lyra/src/app/waitlist/actions.ts:61                              access
lyra/src/lib/beta-access/flow.ts:134                             access    .update(update)
lyra-mcp-server/src/write-tools.ts:109                           profile   .update(updates)
lyra-admin-mcp-server/src/admin-tools.ts:94                       admin
```

**This is a ceiling, not a defect.** Three of these — `profile/actions.ts:132`, `write-tools.ts:109`, `admin/users/actions.ts:114` — are the *generic* mutation paths: a caller-supplied record filtered through an allowlist (`ALLOWED_PROFILE_FIELDS`) and written wholesale. Their column set is genuinely dynamic; it is a function of runtime input, not of source text. **No amount of parser sophistication makes a grep gate see them** — a full TypeScript type-checker would be needed, and even then the allowlist is a runtime array. These same paths are the ones BUGS-74 and the SEC-101 partial-write guard already had to special-case.

So option (A) enforced by static analysis alone has a permanent, irreducible hole covering **38% of writes, including the profile mutation path and the admin bulk-transition path.** Any claim that a column-ownership gate "enforces" the boundary would be false for exactly the sites that matter most. That is the finding the ticket asked for.

### 5.1 What already closes the hole

`profiles` carries four `BEFORE UPDATE` triggers on prod:

| Trigger | Function | Columns protected |
| --- | --- | --- |
| `profiles_block_admin_is_suspended_self_set` | `block_admin_is_suspended_self_set` | `is_admin`, `is_suspended` |
| `profiles_prevent_beta_self_elevation` | `prevent_beta_self_elevation` | `beta_requested_at`, `beta_approved_at`, `user_status`, `access_tier`, `age_status` |
| `trg_enforce_homepage_example_seed_only` | `enforce_homepage_example_seed_only` | `is_homepage_example` |
| `on_profile_updated` | `handle_updated_at` | (housekeeping) |

Both guard functions open with `if auth.uid() is null then return new; end if;` — so a service-role connection (which has no `auth.uid()`) passes, and any caller holding an end-user JWT is refused with `42501`. That is **column-level ownership enforced by the database**, immune to variable payloads, and it already covers 8 of the 41 columns — including every column the ticket names as security-load-bearing except one.

The exception is `is_published`. See §7.

---

## 6. A defect in the committed KAN-416 seed

`KAN-416-boundaries-allowlist.seed.json` reports `sharedKernelColumnAccess.unboundedSites.count = 19`. That figure is **too high**.

`kan416-derive.py`'s `IDENT_KEY_RE` is line-anchored:

```python
IDENT_KEY_RE = re.compile(r"""(?m)^\s*(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+))\s*:""")
```

It only matches an object key that starts a line. A single-line literal —

```ts
await supabase.from('profiles').update({ dashboard_widget_state: next }).eq('id', profile.id);
```

— yields zero keys, so `chain_columns` sets `found = False`, concludes "spread-only / variable payload", and marks the site unbounded.

**The emulation is validated against the committed seed.** Running kan416's logic over the lyra repo alone reproduces its published figures exactly — **77 sites, 19 unbounded**, matching `sharedKernelColumnAccess.totalSites` and `unboundedSites.count` byte for byte. Of those 19, **8 are false positives**; the correct lyra figure is **11**. Across the full three-repo set the same comparison is **23 → 14, 9 false positives**. Among them `lib/age/record-declaration.ts:40` and `dashboard/widgets/actions.ts:43`, both of which have perfectly readable literal payloads.

The direction of the error is benign (it over-reports blindness, so no cross-module access was missed) but it materially overstates how blind the gate is — and R6 is precisely the decision that turns on that number. `kan421-profiles-inventory.py` implements `object_keys()`, which matches keys after `{` or `,` at nesting depth 1 and handles single-line and multi-line literals identically; it also detects object spread and computed `[expr]:` keys as genuine unboundedness. Both figures are emitted side by side (`kan416UnboundedSites`, `kan416FalsePositives`) so the discrepancy stays visible.

**Action:** logged as a comment on KAN-416 (Done). It does not invalidate that ticket's conclusions — the violating-edge counts and the ownership baseline are unaffected — but `kan416-derive.py` should adopt `object_keys()` when KAN-415 C3 productionises the gate. No test is changed by this artefact.

---

## 7. Security finding — `is_published` self-write bypasses the age gate (SEC-112)

**Measured on production, read-only.**

- `authenticated` holds a column `UPDATE` grant on **all 41** columns of `profiles`, `is_published` among them.
- RLS is enabled (`relrowsecurity = true`, 4 policies). Policy `Update own profile` (`{authenticated}`, `UPDATE`) has `qual = (auth.uid() = user_id)` and **`with_check = null`** — so a user may update any column of their own row.
- **No trigger protects `is_published`.**
- `publishProfile()` (`src/app/dashboard/profile/actions.ts:624`) enforces the KAN-408 age gate: when the `age_verification` global switch is on, publishing requires `age_status = 'passed'`.
- Policy `Anyone can read published non-suspended profiles` (`{public}`, `SELECT`) exposes any row with `is_published = true AND is_suspended = false` to anonymous readers.

**Therefore** any authenticated user can `PATCH /rest/v1/profiles?user_id=eq.<own-uid>` with `{"is_published": true}`, using the browser-available publishable key and their own session JWT, and publish their profile without passing `publishProfile()` — bypassing the provider age check. The published row is then anon-readable.

**Current exposure is latent, not live.** `public.global_feature_switches` on prod holds only `convene` and `paid_gift_links` rows (both `false`) for `prod` and `beta` — there is no `age_verification` row, so `isProviderAgeCheckActive()` is false and the gate is not currently enforcing anything for anyone. The bypass therefore grants nothing a user cannot already do through the UI **today**. It matters because the control is **silently ineffective the moment the switch is turned on** — the exact SEC-101 failure mode of a control that has never been observed to fail.

No exploitation was attempted; the finding rests entirely on schema, policy, grant and trigger inspection, plus the application source.

Raised as **SEC-112** (labelled `modularisation`), not fixed here — this run is scoping-only. The obvious fix is to add `is_published` to `prevent_beta_self_elevation`'s protected set (or a sibling trigger), which both closes the bypass and makes `profile` the enforced sole user-facing writer.

---

## 8. Option (B) costed — the satellite-table split

The split falls out of §3: **8 satellite tables** plus the retained identity kernel.

| Satellite | Cols | Write sites to move | Notes |
| --- | --- | --- | --- |
| `profile_core` (stays in `profiles`) | 14 | 7 | the identity/presentation body |
| `profile_access` | 8 | 9 (`access` 3 + `admin` 6) | carries every guard trigger |
| `profile_discovery` | 5 | 1 | prod is missing 4 of these 5 columns (SEC-107) |
| `profile_age` | 5 | 2 | child-safety surface |
| `profile_marketing` | 2 | 0 | seed-only |
| `profile_affiliate` | 1 | 1 | |
| `profile_recommender` | 1 | 0 | |
| `profile_dashboard` | 1 | 1 | |
| identity kernel (`id`, `user_id`, `created_at`, `updated_at`) | 4 | — | FK anchor for all satellites |

**Cost, measured not estimated:**

- **Call sites to rewrite: 105** — 96 production (lyra 77, lyra-mcp-server 15, lyra-admin-mcp-server 4) + 9 test-harness sites (`tests/e2e/support/seed-user.ts`, `soak-user.ts`, and 7 unit tests). Every `select('*')` (6 sites) becomes an explicit join. Every one of the 8 variable-payload writes must be split by destination table — and since their key sets are runtime values, each needs a *routing* function, not a mechanical edit. Those 8 are the expensive ones.
- **Migrations: 8 creates + 8 backfills + 8 RLS policy sets + 4 trigger relocations + 8 drops**, sequenced dev → staging → prod, with beta sharing prod's database.
- **RLS restructure: 4 policies become ~24** (SELECT/INSERT/UPDATE per satellite). This is the one genuine *security* gain: today one wide policy governs 41 columns of wildly different sensitivity; per-table policies would let `profile_access` be `service_role`-only at the policy level rather than by trigger. Against that, 24 hand-written policies are 24 chances to write `USING (true)`.
- **Cross-repo compatibility window (§8.1) — the real cost.**

### 8.1 Why the compatibility window is the blocker

A `profiles` split **cannot be atomic**: three services deploy on three different schedules (Vercel on the promotion chain, two Railway services on push-to-`main`), and the MCP-lockstep policy (KAN-222) requires paired PRs, not simultaneous deploys. So every satellite needs the standard expand/contract dance:

1. Create satellite + backfill + dual-write trigger (old column stays authoritative).
2. Deploy all three repos reading the satellite, still writing the old column.
3. Flip authority to the satellite; old column becomes trigger-maintained.
4. Deploy all three repos writing the satellite.
5. Drop the old column — only after all three are confirmed on step 4.

That is **five coordinated steps × 8 satellites** across three repos and four environments. The security hazard is explicit and is the reason to be cautious: during any window where one repo writes the old column and another reads the new table, a stale read of `is_suspended` **un-suspends a suspended user**, and a stale read of `age_status` **un-gates a minor's profile**. Those two columns are also exactly the ones the guard triggers currently protect — and a trigger cannot straddle a table split cleanly, so the protection has to be rebuilt while the data is in motion.

**And the ground under it is not level.** KAN-420 established that prod is already missing 4 of the 5 `profile_discovery` columns and the `draft` enum label (SEC-107). Beginning an 8-table, 40-step migration programme across environments that are *known* to be out of parity is how the SEC-42-class incidents happen.

---

## 9. Recommendation

**Adopt option (A+): column ownership as the declared boundary, `BEFORE UPDATE` triggers as the enforcement for the security-load-bearing subset. Defer option (B).**

The case, in one line: the grep gate is permanently blind on 38% of writes, but **the thing it is blind to is already enforced by the database**, and extending that trigger pattern costs one migration per column rather than forty.

What this means concretely:

1. Record the 41-column ownership map in `modules.json` (already there from KAN-416) and gate it in CI at column granularity — accepting, **and documenting in the gate's own output**, that it cannot see 8 write sites. A gate that reports its blind spots is honest; one that reports "0 violations" over them is the SEC-79 failure mode.
2. Route the access-model writes through an `access` API (§4, option ii) so `is_suspended`, `user_status`, `access_tier` and `beta_*` have exactly one writer module. 7 call sites.
3. Add `is_published` to the guard triggers (SEC-112), giving the trigger set coverage of every security-load-bearing column the ticket names.
4. Leave `profiles` physically intact.

**Trigger conditions that would reopen option (B)** — any one of these, and the calculus changes:

- The estate stops being service-role-only. Today every one of the 96 sites connects as `service_role`, so RLS does no work on writes; per-satellite RLS would be a real control the moment a client-side or `authenticated`-role write path is introduced.
- `profiles` passes ~55 columns, or a tenth module needs to own columns on it.
- A third multi-writer column appears that is *not* an admin-override of a user action — i.e. the pattern of §4 stops holding.
- Column-level GDPR retention diverges — if `profile_age` or `profile_discovery` acquires a materially different erasure schedule from the profile body, satellites become the cheaper way to express it.
- Environment parity is restored **and** an expand/contract migration has been rehearsed end-to-end on a non-production environment. This is a precondition for (B), not a trigger on its own.

Recorded as **ADR-008** in `docs/ADR.md`.

---

## 10. Documentation Definition-of-Done (KAN-359)

- [x] System map — no service, table, env var, route or scheduled job changed. **N/A with reason:** this is a read-only research artefact; it proposes no code or schema change.
- [x] Design decision recorded as an ADR — **ADR-008**, linked from KAN-421 and this epic.
- [x] Jira ↔ wiki cross-linked — KAN-421 cites this artefact; the artefact cites KAN-421, KAN-414, KAN-416, KAN-420, SEC-107, SEC-112.
- [x] `docs/TEST_AUDIT_2026Q2.md` — **N/A:** no test gate, floor or coverage changed. **No test was modified, weakened, skipped or deleted by this run.**
- [x] PR-template "Docs / system map updated" — ticked with the N/A reason above.
