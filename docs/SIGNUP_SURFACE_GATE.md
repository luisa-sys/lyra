# Un-skippable sign-up gate (develop → staging)

> **Ticket:** KAN-413 (companion to the Staging Soak routine —
> `docs/STAGING_SOAK_ROUTINE.md`).

## Why this exists

The daily **Staging Soak** deliberately does **not** test user sign-up: it
drives a *persistent* soak account that it resets to initial account-setup each
run, so it exercises everything a signed-up user does but never account
**creation**. That is a conscious trade (a stable account is cheaper and
cleaner than signing up fresh daily) — but it leaves one gap: a change that
breaks sign-up would sail past the soak.

This gate closes that gap. **If — and only if — a develop→staging promotion
touches the sign-up surface, a real end-to-end sign-up test must run and pass
before the promotion proceeds.** It cannot be skipped by omission: the surface
is detected from the diff, and an unverifiable diff/manifest fails closed.

## The two moving parts

1. **The surface manifest** — `.github/signup-surface.paths`. A deliberately
   broad list of globs ("could be impacted in any way" beats "definitely
   breaks it"). Migrations are content-filtered: a migration counts only if it
   references the account-creation surface (`handle_new_user` / `auth.users` /
   `on_auth_user` / the `profiles` table), so ordinary migrations don't trip it.
2. **The gate** — the `signup-gate` job in `.github/workflows/promote-to-staging.yml`.
   It runs `scripts/check-signup-surface-gate.sh origin/staging origin/develop`:
   - **CLEAN** (exit 0) → no-op, promotion proceeds.
   - **TOUCHED** (exit 10) → run the real signup E2E
     (`tests/e2e/signup/signup.e2e.spec.ts`, project `signup-e2e`) against the
     develop deploy; it must pass.
   - **ERROR** (exit 1: manifest unreadable / diff uncomputable) → **fail-closed**,
     promotion blocked.

The detection script is deterministic and unit-tested (see the scenarios in its
header); the fail-closed behaviour is the load-bearing property.

## What the sign-up E2E actually does

It drives the **real** `/signup` form — ticks the 18+ declaration, fills name +
email + consent, submits the `signUp` server action — then completes activation
the way production does (a magic-link `token_hash` through `/auth/confirm`) and
asserts a first session lands on `/dashboard`. It also asserts the
`handle_new_user` trigger seeded a `profiles` row. The fresh test user is
**deleted** afterwards (unlike the persistent soak user — this test's subject is
a *new* account each run). It targets `e2e-dev.checklyra.com` (the DNS-only
grey-cloud alias that bypasses CF bot-management — see
`docs/E2E_AUTHED_CF_BYPASS.md`).

## Rollout: `warn` → `block`  ⚠️ ACTION FOR THE FOUNDER

The gate ships with enforcement **`warn`** (repo variable `SIGNUP_GATE_ENFORCE`
unset or `warn`): it detects + runs + annotates, but does **not** block, so it
cannot wedge the pipeline before the signup E2E has proven itself. To make it
genuinely un-skippable:

1. Provision the E2E secrets (already used by `e2e-authed.yml`):
   `E2E_SUPABASE_URL`, `E2E_SUPABASE_SERVICE_ROLE_KEY` (staging-scoped, **never
   prod**), and — if the develop deploy is CF-proxied — `E2E_CF_BYPASS_HEADER` /
   `E2E_CF_BYPASS_SECRET` + the Cloudflare WAF skip rule.
2. Dispatch `promote-to-staging` on a signup-touching change (or run the
   `signup-e2e` project by hand against `e2e-dev`) and confirm one **green** run.
3. Set repo **variable** `SIGNUP_GATE_ENFORCE = block`. From then on, a
   signup-touching promotion cannot complete unless the signup E2E passes.

## Known phasing

`promote-to-staging.yml` runs its definition from the **default branch** (the
`workflow_dispatch`-reads-main gotcha), so this gate is only active once the
workflow change reaches `main` through the normal release chain. Until then the
manifest + script are present (from `develop`) but the job that invokes them
must ride to `main` first. This is expected — the gate protects promotions
*after* it lands, not the promotion that carries it.

## Maintaining the surface list

When you add code that participates in account creation, add its path to
`.github/signup-surface.paths`. There is no downside to over-listing — a false
"touched" just runs a passing signup E2E. The real risk is under-listing, so
prefer breadth. The `profiles`/trigger content-filter keeps the broad
`supabase/migrations/**` entry from being noisy.
