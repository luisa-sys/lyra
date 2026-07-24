# Authed E2E — Cloudflare bot-management bypass (KAN-348)

**Status:** the authenticated journey suite (`.github/workflows/e2e-authed.yml`)
is fully working *except* it cannot reach the deployed dev/stage origin from a
GitHub Actions runner, because Cloudflare bot-management serves the runner IP a
`403 "Just a moment…"` challenge (CLAUDE.md **gotcha #7**). Proven on 2026-07-24:

```
nav chain: 307 /auth/confirm  ->  403 /auth/confirm  ->  403 /auth/confirm
goto status: 403   server: cloudflare   cf-ray: a2016c9b9980cba2-LAX
page title: "Just a moment..."
body: "…Performing security verification… protect against malicious bots…"
```

The app + a residential-IP curl both redirect `/auth/confirm -> /dashboard`
cleanly; only the datacenter runner IP is challenged. Everything else in the
harness is fixed and green up to this point (secrets valid, seed users clear the
GoTrue `listUsers` path and the KAN-407 18+ gate, sessions would mint).

## The fix — a Cloudflare WAF *skip* rule keyed to a secret header

The harness sends a secret header on every request when two GitHub secrets are
set; a Cloudflare rule matches that header and **skips** bot-management for those
requests only. Both halves are required — code (already merged) + the two
founder actions below.

### 1. Generate a secret and pick a header name

```bash
openssl rand -hex 32      # the SECRET value (copy it)
```

Header name convention: `x-lyra-e2e-bypass` (any custom `x-…` name works, but it
must match the Cloudflare rule exactly).

### 2. Set the two GitHub Actions secrets (luisa-sys/lyra)

GitHub → luisa-sys/lyra → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `E2E_CF_BYPASS_HEADER` | `x-lyra-e2e-bypass` |
| `E2E_CF_BYPASS_SECRET` | the `openssl rand -hex 32` output |

(These are consumed by `playwright.config.ts` + `tests/e2e/support/mint-session.ts`
and passed through `e2e-authed.yml`. Until BOTH are set the header is never sent
— the harness is a no-op, the anon localhost gate is unaffected.)

### 3. Create the Cloudflare WAF skip rule (checklyra.com zone)

Cloudflare dashboard → **checklyra.com** zone → **Security → WAF → Custom rules
→ Create rule**:

- **Name:** `E2E authed harness bypass (KAN-348)`
- **Expression** (Edit expression):
  ```
  (http.host in {"dev.checklyra.com" "stage.checklyra.com"}
   and any(http.request.headers["x-lyra-e2e-bypass"][*] eq "<PASTE THE SECRET>"))
  ```
- **Action:** **Skip** → tick **Super Bot Fight Mode** (and, if present, **All
  remaining custom rules** and any managed challenge). This lets the matching
  requests through to the origin without a challenge.
- Deploy.

> Scope it to the dev/stage hosts only — never `checklyra.com`/`beta`. The
> secret header is the actual guard; the host filter is defence in depth. The
> authed harness is hard-guarded against prod Supabase already
> (`tests/e2e/support/supabase-admin.ts`).

### 4. Verify, then enable the schedule

```bash
gh workflow run e2e-authed.yml --repo luisa-sys/lyra -f base_url=https://dev.checklyra.com
gh run watch --repo luisa-sys/lyra
```

Green → the seeded journey states all mint sessions and the dashboard assertions
run. Then flip the suite from dispatch-only to CI-wired by uncommenting the
`push:`/`schedule:` block at the top of `.github/workflows/e2e-authed.yml` (a
1-line change) and PR it through the pipeline.

## What was already fixed getting here (2026-07-24)

- **E2E_SUPABASE_* secrets** — verified valid (were never the blocker).
- **Dev + prod `auth.users` NULL-token 500** — the pre-existing demo-seed rows
  had NULL token columns, so GoTrue `listUsers` 500'd before any seed ran.
  Normalised NULL → `''` on both projects (non-destructive; real users untouched).
- **Seed harness age gate** — `seed-user.ts` set the pre-KAN-407 age columns but
  not `age_declared_18_at`, so seeded users were diverted to `/confirm-age`.
  Now declares 18+ on every seeded state.
- **mint-session diagnostics** — now capture the real edge status / CF challenge
  instead of a misleading "check the redirect allowlist" hint.
