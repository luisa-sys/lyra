# KAN-349 UX epic — local build for review (not yet pushed to dev)

**Branch:** `feature/kan-349-ux-dashboard-widgets` (local only — nothing promoted).
**Built:** 2026-06-30 overnight, autonomously, per "code up everything you can and have it ready locally so we can review questions before finalising and pushing to dev."

The epic was raised from a chat session **without code access**, so several of its
"unresolved questions" are answered here directly from the codebase.

---

## 1. What's coded vs documented vs blocked

| Ticket | Type | Status tonight | Notes |
|---|---|---|---|
| **KAN-340** dashboard widget journey | proposal | **CODED to a proposed spec** (§3 below) | "no build before sign-off" — spec + build done together for review; defaults flagged. |
| **KAN-343** audit/reconcile | discovery | **DONE** (§4) | I had the repo access the chat session lacked. |
| **KAN-344** state resolver | build | **CODED + 15 tests** | `src/lib/dashboard/resolve-widgets.ts` (pure). |
| **KAN-345** dismissal persistence | build | **CODED + 5 tests + migration** | `dismissal.ts`, `widgets/actions.ts`, migration `20260630010000_…`. |
| **KAN-346** widget framework | build | **CODED** | `widgets/dashboard-widgets.tsx` registry + shell; dashboard refit. |
| **KAN-347** widgets W1–W6 | build | **CODED** (copy = PROPOSED) | all six render + gate; copy needs your confirm. |
| **KAN-348** E2E | build | **NOT yet** | needs the dev migration applied + a live user; spec ready. |
| **KAN-339** postcode removal | build | **documented, not coded** (§5) | needs KAN-153 test sign-off + privacy-policy edit; affiliate-safe (verified). |
| **KAN-341** city via postcode lookup | build | **documented, buildable** (§6) | reuses the existing `GOOGLE_PLACES_API_KEY` — **no new secret**. |
| **KAN-342** gifts de-gate | build | **documented** (§7) | rec engine already built on the profile; gating tweak. |
| **KAN-338** establishment autocomplete | spike | **design recommendation** (§8) | reuse Places (existing key) vs UK-gov data — your call. |

**Test status:** 1794/1795 unit pass + 20 new. The **1 failure is intentional** and needs your sign-off — see §9 Q1.

---

## 2. Key codebase facts (answers to the epic's open questions)

- **Google Places is already integrated** (`lyra-mcp-server/src/convene-places-adapter.ts`, `lyra_suggest_venues`) and **`GOOGLE_PLACES_API_KEY` is set on dev + prod**. So KAN-341 (postcode→city) and KAN-338 (autocomplete) can reuse it via Places `searchText` (region=GB) — **no Geocoding key needed** unless you want true reverse-geocoding.
- **`profiles.city` already exists** (so KAN-341 needs no schema add for the city field). Postcode is in **`profiles.postcode_prefix`**.
- **Affiliate geo-signal uses `profiles.delivery_country_code`, NOT postcode** → KAN-339's postcode scrub is safe (epic Q6 ✓).
- **Rec engine is built** and renders gift recommendations on the **public profile** (`[slug]/v2-recommendations-section.tsx`, `/api/recommendations`). KAN-342 is a gating tweak, not a new build.
- **Completeness:** `profiles.completion_score` (%) + `onboarding_complete` (set on publish) already exist.

---

## 3. KAN-340 — the widget journey (built to this proposed spec)

**State axes** (deliberately NOT `user_status`/access lifecycle): driven by `is_published` + `completion_score` + content signals; entitlements decide which widgets exist.

| State | Trigger | Widget(s) shown (in order) |
|---|---|---|
| **empty** | not published, `completion_score < 40` | W1 Complete profile (primary, not dismissible) |
| **drafted** | not published, `completion_score ≥ 40` | W2 Publish (primary; routes to /verify-age if age not passed) |
| **published_activate** | published, missing gifts or affiliations | W3 Add gifts · W4 Add affiliations · W5 Share |
| **published_grow** | published, has gifts + affiliations | W5 Share · W6 Convene (if `convene` entitled) |

**Dismissal:** only secondary widgets (W3–W6) are dismissible; a dismissal is recorded with the state it happened in and **re-surfaces when the state changes**. Stored in `profiles.dashboard_widget_state` JSONB (KAN-345).

**Layout:** one primary CTA in empty/drafted; a stack in published states. The registry in `widgets/dashboard-widgets.tsx` is the single place a future feature adds its widget (id in the resolver + a case here) — this is the "codify a widget when we add a feature" pattern you asked for.

---

## 4. KAN-343 — dashboard audit (reuse vs build-new)

Current `/dashboard` hub (KAN-326): inline next-steps hub, profile-summary card, `ShareProfile`, `ShareBeta` (KAN-337), Convene card. No widget registry.

- **Reused:** `ShareProfile` (now W5, added a `bare` prop), `ShareBeta` (kept standalone — a standing action), the profile-summary card (kept), the Convene CTA (now W6).
- **Built-new:** the resolver, the registry/shell, dismissal.
- **Removed:** the inline next-steps hub (→ W1/W2), the inline profile-share (→ W5), the standalone Convene card (→ W6).
- **People-recommendations decision (epic Q2):** keep the logged-in dashboard a clean status hub; do NOT add a people-recommendations feed — route "discover people" to `/search`. (KAN-139 = gift recs on the *public* profile; KAN-334 = *logged-out* homepage demos. Neither belongs on the logged-in dashboard.)

---

## 5. KAN-339 — postcode removal (approach; not coded tonight)

Surfaces: `profiles.postcode_prefix`; inputs in `dashboard/profile/profile-fields.ts` + `steps/types.tsx`; **discovery** in `dashboard/settings/discoverability-*`. **Phone search is separate and stays.** **Affiliate geo-signal uses country, not postcode (verified)** so the scrub is safe.
Plan: remove the input + the postcode discovery query/UI, scrub `postcode_prefix = NULL` (migration), drop from MCP schema. **Needs:** Q3 (KAN-153 test sign-off — `discoverability-{helpers,actions}.test.ts`), Q4 (privacy-policy/ROPA edit), and sequencing with KAN-341 so discovery isn't dark.

---

## 6. KAN-341 — town/city via postcode lookup (buildable, no new secret)

`profiles.city` exists. Reuse `GOOGLE_PLACES_API_KEY` via a server action that calls Places `searchText` with the postcode + `regionCode: 'GB'`, parses `postal_town`/`locality` from `addressComponents`, presents the city, stores **only the city** (postcode held in memory, never persisted/logged). City-based search replaces postcode search. **Needs:** Q4 (privacy-policy: disclose Google as a recipient), Q5 (confirm reuse of the Places key vs a dedicated Geocoding key).

---

## 7. KAN-342 — gifts de-gate (gating tweak)

The rec engine renders on the public profile. Phase 1: decouple gift-section *visibility* from `paid_gift_links` (show the unpaid/plain-link path; no affiliate cookies). `paid_gift_links` then governs only monetisation. **Needs:** confirm the rec renderer has a plain-link path (likely yes — `eligibility-filter.ts`/`country-codes.ts`) + Q3-style test sign-off if a `paid_gift_links`-gating test must change. W3 (add-gifts widget) already assumes the unpaid path needs no entitlement.

---

## 8. KAN-338 — establishment autocomplete (spike recommendation)

Affiliations are free-text today (`school_affiliations.school_name`). Recommendation: **MVP = Places `searchText` autocomplete** (reuses the existing key; dedup on `google_place_id`), with a **UK-gov data source** (EDUBASE schools / Companies House) as the higher-quality follow-up. Legal: confirm Places **caching ToS** for persisting `place_id`+name. **No build before your sign-off** (it's a spike).

---

## 9. Decisions I made (defaults) + questions needing your sign-off

**Defaults applied (easy to change — all in `resolve-widgets.ts` / `dashboard-widgets.tsx`):**
- Empty→drafted threshold = **completion_score ≥ 40**.
- Dismissal = **per-widget, re-surfaces on state change**; W1/W2 not dismissible.
- Layout = **one primary CTA in empty/drafted; stack in published**.
- Widget copy = **proposed** (W1–W6) — see `dashboard-widgets.tsx`.

**Questions / approvals:**
1. **(test sign-off)** `convene-nav.test.ts` asserts the old inline Convene card on the dashboard page; the refit moved Convene to the W6 widget (still flag-gated). May I **re-point** the test to assert the new structure (not weaken it)?
2. **(copy)** Confirm/adjust the W1–W6 widget copy.
3. **(thresholds/model)** Confirm the 40% empty→drafted threshold, the dismissal model, and one-primary-vs-stack layout.
4. **(KAN-339)** Go-ahead to remove postcode + sign-off to update the KAN-153 `discoverability-*` tests, + the privacy-policy/ROPA edit.
5. **(KAN-341/338 Google)** OK to reuse `GOOGLE_PLACES_API_KEY` for postcode→city + establishment autocomplete (vs provisioning a dedicated Geocoding key)? + privacy-policy disclosure of Google as a recipient + Places caching-ToS legal check.
6. **(KAN-338 source)** Establishment autocomplete backend: Places (fast, reuses key) vs UK-gov data (higher quality, more work) vs both?

**Before this can go to dev:** apply migration `20260630010000_kan345_dashboard_widget_state.sql` to dev-lyra; write the KAN-348 E2E against the new dashboard.
