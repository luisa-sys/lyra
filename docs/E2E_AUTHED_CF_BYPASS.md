# Authed E2E — reaching the origin past Cloudflare (KAN-348)

**Status: SOLVED (2026-07-24).** The authenticated journey suite
(`.github/workflows/e2e-authed.yml`) could not reach the deployed dev origin from
a GitHub Actions runner, because Cloudflare bot-management served the runner IP a
`403 "Just a moment…"` challenge (CLAUDE.md **gotcha #7**). Proven in-run:

```
nav chain: 307 /auth/confirm -> 403 /auth/confirm -> 403 /auth/confirm
goto status: 403   server: cloudflare   cf-ray: …-LAX
page title: "Just a moment..."
```

## The solution that works: a DNS-only (grey-cloud) test subdomain

`e2e-dev.checklyra.com` is a **DNS-only** alias of the develop deployment:

- **Vercel**: `e2e-dev.checklyra.com` added to the `lyra` project, connected to
  the **Preview → develop** branch (serves the same build as `dev.checklyra.com`).
- **Cloudflare DNS**: `CNAME e2e-dev → 3473b79482213ee3.vercel-dns-017.com`, with
  **Proxy status = DNS only (grey cloud)**. Traffic goes straight to Vercel, so
  Cloudflare bot-management never sees it — no challenge.
- **Cookies still work**: it is still a `.checklyra.com` subdomain, so the
  parent-scoped session cookie (`withParentCookieDomain` → `.checklyra.com`) is
  valid on it. (Pointing at a `*.vercel.app` URL would drop the cookie because the
  develop build's `NEXT_PUBLIC_SITE_URL` is a checklyra host.)
- The suite targets it via the workflow `base_url` default
  (`https://e2e-dev.checklyra.com`). The prod-guard allows it (dev) and still
  blocks the prod/beta family.

Verify + run:
```bash
gh workflow run e2e-authed.yml --repo luisa-sys/lyra -f base_url=https://e2e-dev.checklyra.com
gh run watch --repo luisa-sys/lyra
```

## Why NOT a Cloudflare WAF skip rule

The first attempt was a WAF **Skip** rule keyed to a secret header the harness
sends (`E2E_CF_BYPASS_HEADER` / `E2E_CF_BYPASS_SECRET`, still wired in
`playwright.config.ts` + `mint-session.ts` + the workflow as a harmless no-op).
**It does not work on this zone**: checklyra.com is a **free** Cloudflare plan,
and free **Bot Fight Mode** (Security → Bots) cannot be excepted by a WAF Skip
rule — only paid **Super Bot Fight Mode** can. The "Just a moment…" challenge is
Bot Fight Mode, so the rule had no effect. **Leftovers that can be removed** (they
do nothing now): the `E2E authed harness bypass (KAN-348)` WAF custom rule, and
the `E2E_CF_BYPASS_HEADER` / `E2E_CF_BYPASS_SECRET` GitHub secrets.

## Convene widget (test #4) — enable convene on the target env

`published_grow` asserts the convene widget renders. It is gated
`CONVENE_ENABLED` (env) **AND** `global_feature_switches.convene` (admin, per-env)
**AND** the per-user entitlement (the seed sets this). On dev the global switch
was `false`; it must be `true` for that case to pass. Enabled 2026-07-24.

## Known remaining failure — KAN-271 (pre-existing)

`journey.authed.spec.ts` › *edits a Manual-of-Me box; the change appears on the
published profile* was `test.fixme` (skipped) before being un-skipped. It fails:
the edit never lands in `profile_manual_of_me` (verified empty after a run) though
the editor shows a "Saved" toast. This is a real profile-editor persist/render gap
(or a test-interaction issue), unrelated to the CF work. **Do not enable the
`push`/`schedule` triggers until this is green or re-`fixme`'d with a tracking
ticket** — otherwise the suite is perpetually red. Fixing/adjusting the test needs
sign-off (Test Integrity Policy).

## What was fixed getting here (2026-07-24)

- **Dev + prod `auth.users` NULL-token 500** — demo-seed rows had NULL GoTrue
  token columns → `listUsers` 500 before any seed ran. Normalised NULL → `''`.
- **Seed 18+ declaration** — `seed-user.ts` now sets `age_declared_18_at` so seeded
  users clear the KAN-407 `/confirm-age` gate.
- **mint-session diagnostics** — capture real edge evidence (status, cf-ray, title).
