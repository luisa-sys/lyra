# Dev E2E & Regression Testing

Catch dashboard / onboarding-journey regressions **early in the dev lifecycle**, before they reach staging/beta/prod. Born out of BUGS-63 (the dashboard rendered blank on dev for ~a day before anyone noticed) and the KAN-349 journey work.

> **Why this exists:** the CI "Playwright E2E (local build)" gate runs against a *local* production build and only exercises a *fresh* user (empty state). It did **not** catch (a) the deployed-build Suspense reveal failure (BUGS-63), nor (b) the `completion_score` journey gap — both only show on the real Vercel deploy and/or for non-fresh users. Run the checks below against the **deployed dev site** after every dashboard-touching deploy.

---

## 1. Per-deploy smoke (do this after every `deploy-dev`)

Fast, ~2 min. A logged-in dev session is required for the dashboard checks (cookie scoped to `.checklyra.com`).

| # | Check | How | Pass |
|---|---|---|---|
| 1 | Homepage renders | `curl -sS -o /dev/null -w '%{http_code}' https://dev.checklyra.com/` | 200 |
| 2 | **Dashboard renders on HARD LOAD** | In the browser, open `https://dev.checklyra.com/dashboard?cb=$(rand)` directly (not a soft nav) | Full dashboard (header + a widget + profile card), **not** a blank page / lone footer |
| 3 | Dashboard is a single `<main>` | DevTools console: `document.querySelectorAll('main').length` | `1` (a hidden 2nd `<main>` ⇒ BUGS-63 has regressed — see §4) |
| 4 | Profile editor renders | open `/dashboard/profile` | sections + fields render |
| 5 | Public profile renders | open `/<your-slug>` | profile shows; **no** postcode anywhere |
| 6 | Health | `curl -s https://dev.checklyra.com/api/health` | `{"ok":true,...}` |

**The single most important check is #2/#3** — the dashboard rendering on a *hard load* (refresh / typed URL), because soft (in-app) navigation can mask a broken Suspense reveal.

---

## 2. Widget-journey state matrix (KAN-349)

The dashboard widget set is a pure function of the profile signals (`src/lib/dashboard/resolve-widgets.ts`). Verify each row by setting the signals (UI or SQL) and reloading `/dashboard`; read `document.querySelector('[data-onboarding-state]')` + `[data-widget]`.

| State | Signals | Widgets (in order) |
|---|---|---|
| `empty` | not published, completion < 40 | W1 `complete_profile` |
| `drafted` | not published, completion ≥ 40 | W2 `publish` (→ Verify-age if `age_status` not passed) |
| `published_activate` | published, missing gifts **or** affiliations | W3 `add_gifts` · W4 `add_affiliations` · W5 `share` |
| `published_grow` | published, has gifts **and** affiliations | W5 `share` · W6 `convene` (only if convene-entitled) |

- **Completion is derived at read-time** from live content (`src/lib/dashboard/profile-completion.ts`) — NOT the stored `profiles.completion_score` (which is vestigial / always 0 for real users). Name only = 20%; name + a short intro = 40% (→ drafted).
- **Dismissal** (`✕` on secondary widgets; W1/W2 are not dismissible) persists to `profiles.dashboard_widget_state` as `{ widget_id: { state, dismissed_at } }` and **re-surfaces on a state change** (the record is keyed to the state it was dismissed in).
- The **share widget has two versions**: while a beta invite link exists (`LYRA_INVITE_CODE` set) it's the "Share beta access" /join card; otherwise a "Share Lyra" /signup card. Dev has no invite code, so expect the /signup version.

---

## 3. Full fresh-user E2E walkthrough

Walks the whole journey. Use a deliverable test address (see §5).

1. **Sign up** at `/signup` (dev = waitlist framing: full name + email + consent; no skip-code field unless `LYRA_INVITE_CODE` is set). Expect "Check your email…".
2. **Confirm** via the magic link (`/auth/confirm?token_hash=…&type=signup`). Lands on `/dashboard` (dev's waitlist is framing-only; access_tier defaults to `beta`). → **empty** state, W1 *Complete your profile*.
3. **Fill the profile** (`/dashboard/profile`, auto-saves): add a short intro → completion crosses 40 → **drafted**, W2 *Publish* (or *Verify your age to publish* if `age_status` ≠ passed).
4. **Age + publish**: real age check is Didit (KAN-282); for a journey test set `age_status='passed'` and publish. → **published_activate**, W3/W4/W5.
5. **Add a gift + an affiliation** → **published_grow**, W5 (+ W6 if convene-entitled).
6. **Dismiss** a secondary widget → it disappears + persists; reload confirms.
7. **Public profile** (`/<slug>`) renders with gifts visible (KAN-342), city shown, no postcode (KAN-339).
8. **City lookup** (`/dashboard/profile` → "Find your town from a postcode"): a valid postcode (e.g. `EH1 1RE`) populates City (`Edinburgh`) and clears the postcode box (KAN-341; postcode never stored).

---

## 4. Diagnostic playbook — "the dashboard is blank"

This is BUGS-63. Symptom: only the site footer shows; header/widgets/profile are absent. Work through it in the browser console:

1. `document.querySelectorAll('main').length` → **2** means the real dashboard `<main>` is parked in a `<div hidden>` React streaming holder and never revealed (a stuck Suspense boundary). Confirm: the visible `<main>` is the loading skeleton; the hidden one has `[data-onboarding-state]`.
2. `(await fetch('/dashboard')).status` → 200 + the HTML ends with `</html>` and contains `$RC` ⇒ the **server** is fine; it's a **client reveal/hydration** failure.
3. Rule out the usual suspects:
   - **Service worker / cache**: `navigator.serviceWorker.getRegistrations()` then unregister + `caches.keys()`/`caches.delete()`; hard-reload. (`public/sw.js` is network-first and bypasses `/dashboard`; it does NOT cache JS — so rarely the cause, but clear it to be sure.)
   - **CSP**: `script-src` must allow `'unsafe-inline'` (it does) — blocked inline scripts would also break `__next_f`.
   - Compare with the **homepage** (no `loading.tsx`) — if it hydrates and `/dashboard` doesn't, the difference is the **`loading.tsx` Suspense boundary**.
4. **Root cause & fix (BUGS-63):** the `/dashboard` `loading.tsx` Suspense boundary's streamed content was never revealed on hard loads on the deployed Next 16.2.6 build. Fix = remove `src/app/dashboard/loading.tsx` so `/dashboard` renders like every other working route (full SSR → hydrate). Re-introducing a `loading.tsx` here needs re-verification against §1 #2/#3 on a real deploy.

---

## 5. Test-user management on dev

You can create / edit / delete dev users freely (dev-lyra = `ilprytcrnqyrsbsrfujj`).

- **Deliverable address**: `ben+<tag>@santos-stephens.com` (Gmail subaddressing → one inbox) is guaranteed deliverable; `ben@thestephens.org.uk` also forwards to that inbox.
- **Get the confirm link without scraping the email** (the browser MCP blocks reading query-string URLs): read the token from the DB and build the URL —
  ```sql
  select token_hash from auth.one_time_tokens where relates_to='<email>' order by created_at desc limit 1;
  ```
  →  `https://dev.checklyra.com/auth/confirm?token_hash=<token_hash>&type=signup` (the stored `pkce_…` hash is used verbatim; `verifyOtp` needs no browser-bound verifier).
- **Drive states** directly:
  ```sql
  -- published_activate (then add gifts/affiliations for published_grow):
  update profiles set age_status='passed', is_published=true where user_id='<uid>';
  insert into profile_items (profile_id, category, title) values ('<pid>','gift_ideas'::item_category,'A good book');
  insert into school_affiliations (profile_id, school_name) values ('<pid>','Greenfield Primary');
  -- reset to a clean fresh user:
  update profiles set is_published=false, age_status='none', dashboard_widget_state='{}' where user_id='<uid>';
  delete from profile_items where profile_id='<pid>'; delete from school_affiliations where profile_id='<pid>';
  ```
- **Clean up** test users afterwards (delete the `auth.users` row; the profile cascades) and revert any edits to real accounts.

---

## 6. Findings log (2026-06-30)

| Ref | Finding | Status |
|---|---|---|
| **BUGS-63** | Dashboard blank on hard load — `/dashboard/loading.tsx` Suspense never reveals (all `/dashboard/*`). | Fixed (PR #409, loading.tsx removed). |
| KAN-349 | `completion_score` never computed → empty→drafted journey stuck for real users + "0%" display. | Fixed (PR #410, derive at read-time). |
| (transient) | Occasional `503` on a profile auto-save / `/dashboard` revalidation right after a fresh deploy = Vercel cold start. Re-check; not a code bug if it doesn't recur. | Watch |
| (minor) | A profile published *before* age-gating can show "Verify your age to publish" in the editor (`is_published=true` + `age_status='none'`). Cosmetic; new users are gated correctly. | Note |
| Verified | empty / published_activate / published_grow widgets, dismissal persistence, KAN-341 city lookup, KAN-339 no-postcode, KAN-342 gifts on public profile. | OK |
