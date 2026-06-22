# Sentry Setup (KAN-104)

> The SDK is scaffolded behind a flag-based gate, asymmetric between server and browser by Next.js's `NEXT_PUBLIC_` env-var rules. This doc walks through activating it on each environment.

## What's already shipped (PR #136)

- `@sentry/nextjs` installed
- `instrumentation.ts` — server + edge runtime init, gated on `NEXT_PUBLIC_SENTRY_DSN` AND `IS_SENTRY_ENABLED='true'`
- `instrumentation-client.ts` — browser init, gated on `NEXT_PUBLIC_SENTRY_DSN` presence only (see "Why the gate asymmetry" below — KAN-104 follow-up 2026-05-17)
- `next.config.ts` wrapped with `withSentryConfig` (source-map upload + tunnel-route off + DE-region CSP)
- Build uses Webpack (`next build --webpack`) because Sentry's plugin doesn't fully thread `instrumentation-client.ts` through Turbopack in `@sentry/nextjs@10.x` (revisit when v11 ships Turbopack-complete)
- 8 unit tests guarding the gates + CSP + auth-token-never-NEXT_PUBLIC

Until the env vars are populated, the SDK is **completely inert** — no network calls, no event capture, no overhead.

## Why the gate asymmetry (KAN-104 follow-up, 2026-05-17)

The original design used `NEXT_PUBLIC_SENTRY_DSN` AND `IS_SENTRY_ENABLED='true'` for both server and browser. **The two-flag gate doesn't work in the browser** because Webpack/Next.js only inlines `process.env.NEXT_PUBLIC_*` env vars into client bundles. `IS_SENTRY_ENABLED` (no `NEXT_PUBLIC_` prefix) resolves to `undefined` at browser runtime, which means `"true" === undefined` was always false and Sentry never initialised in the browser regardless of what was set in Vercel.

Fix: the browser gate now checks DSN presence only. Set the DSN var to empty (or unset it) to disable Sentry in the browser. Equivalent safety to the original design, just expressed through one visible env var instead of two.

The server-side gate retains the two-flag combo because Node has access to all env vars at runtime.

## Account snapshot (filled in on first activation)

| Field | Value | Notes |
|---|---|---|
| Region | EU (de.sentry.io) | GDPR-friendly |
| Org ID | `o4511605710127104` | Numeric, baked into DSN |
| Project ID | `4511605735424080` | Numeric, baked into DSN |
| Org slug | `checklyra` | Needed for source-map upload only |
| Project slug | `lyra` | Same |
| DSN | `https://7ce4583403ac31941f4c5b06c8abddd2@o4511605710127104.ingest.de.sentry.io/4511605735424080` | Public-by-design, safe in client bundle |

## Activating Sentry on an environment

### Fastest path — `activate-sentry.yml` (one shot, all envs)

```bash
gh workflow run activate-sentry.yml -f confirm=ACTIVATE -f scopes=all
```

This upserts `NEXT_PUBLIC_SENTRY_DSN` + `IS_SENTRY_ENABLED=true` on every env scope (development, preview/develop, preview/staging, preview/beta, production) via the Vercel REST API. Idempotent — safe to re-run. After it completes, each env still needs a redeploy to pick up the new vars (see "Next steps" in the workflow run summary).

For finer-grained control (single env at a time), pass `-f scopes="development::"` (or similar) instead of `all`.

### Manual path — Vercel UI

Vercel → `lyra` project → Settings → Environment Variables. Add the following, scoped to your target env (Development / Preview / Production):

| Variable | Value | Sensitive? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://7ce4583403ac31941f4c5b06c8abddd2@o4511605710127104.ingest.de.sentry.io/4511605735424080` | No | Where the SDK sends events. The `NEXT_PUBLIC_` prefix exposes it to the browser, which is correct — DSN is public-by-design. |
| `IS_SENTRY_ENABLED` | `true` | No | **Server kill switch only.** Setting to `false` (or removing) disables Sentry on the server runtime. Browser is gated on `NEXT_PUBLIC_SENTRY_DSN` presence — see "Why the gate asymmetry" above. To kill Sentry in the browser, clear `NEXT_PUBLIC_SENTRY_DSN` instead. |

After saving, redeploy that environment (push a commit or manually trigger via Vercel UI) so the new vars reach the build.

### Step 2: Verify event flow (~30 seconds)

Visit a deliberately-broken route on dev to trigger an error. Easy options:

```bash
# Server-side error: visit any route that throws
curl https://dev.checklyra.com/api/__sentry-test  # 404 — captured as a Next.js NotFoundError

# Client-side error: open dev.checklyra.com in browser, press F12, paste in console:
throw new Error("KAN-104 verification ping " + new Date().toISOString())
```

Then check Sentry → Issues. The event should appear within ~30 seconds. If it doesn't:

1. Hit the URL again and watch the browser DevTools Network tab — you should see a request to `https://*.ingest.de.sentry.io`. If you don't, the SDK didn't initialise — check both env vars are set on the right env.
2. If the network request is there but events don't show in Sentry, the DSN is wrong (typo? rotated?) — check Sentry → Settings → Client Keys (DSN).
3. If events show but the wrong env tag (e.g. dev events tagged `production`), check `VERCEL_ENV` is being set correctly — Vercel sets it automatically per environment.

### Step 3 (optional, do once for source maps): activation for build-time integration

Source maps turn `<minified>:42:13` into `Login.tsx:42:13` in the Sentry UI. This requires three more Vercel env vars set on **Production** (and ideally all envs):

| Variable | Value | Sensitive? | Where to find it |
|---|---|---|---|
| `SENTRY_AUTH_TOKEN` | `sntrys_...` (long token) | **YES** — mark as encrypted in Vercel | Sentry top-right user icon → User Auth Tokens → Create New Token. Scopes: `org:read`, `project:read`, `project:write`, `project:releases` |
| `SENTRY_ORG` | (your org slug) | No | Sentry URL bar when signed in: `https://sentry.io/organizations/[ORG_SLUG]/` |
| `SENTRY_PROJECT` | `lyra` (probably) | No | Sentry → Settings → Projects → click project → URL becomes `/projects/[PROJECT_SLUG]/` |

The token belongs in **Vercel** (where the build runs), not in GitHub Secrets. GitHub-Secrets-only would mean the token never reaches `next build` and source-map upload silently fails.

If `SENTRY_AUTH_TOKEN` is missing or wrong, builds still succeed and events still flow — they just have minified stack traces. Source-map upload errors are caught and logged (not fatal) per the `errorHandler` in `next.config.ts`.

## Rotation

`SENTRY_AUTH_TOKEN` should be rotated annually (matching the LYRA_RELEASE_PAT cadence). Process:

1. Sentry → User Auth Tokens → Create new token (same scopes)
2. Update `SENTRY_AUTH_TOKEN` in Vercel env vars (each env)
3. Trigger a redeploy on each env to pick up the new token
4. Confirm a fresh deploy uploaded source maps (Sentry → Releases → newest release should show "Source Maps: 0 → N")
5. Revoke the old token in Sentry

The DSN itself doesn't expire and doesn't need rotation unless leaked.

This rotation step is tracked in `docs/SECURITY_ROTATION.md`.

## What's NOT enabled by default

- **Session Replay** (replays of user interactions on errors). Off because:
  - Cost — replay storage is the largest line item on most Sentry bills
  - PII — replay can capture form input, password field values (if not masked), screen contents
  - Enable per-incident only via `replaysSessionSampleRate` + `replaysOnErrorSampleRate` in `instrumentation-client.ts`
- **Tunnel route**. Off because each tunnel-routed event becomes a serverless invocation on Vercel, eating quota fast on a free Sentry plan
- **PII capture** (`sendDefaultPii`). Off — explicit opt-in per Lyra's privacy stance
- **MCP server integration**. The `lyra-mcp-server` repo will get its own `@sentry/node` integration in a separate ticket. KAN-104 is web-app-only.

## Reference

- [@sentry/nextjs docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- KAN-104 ticket: <https://checklyra.atlassian.net/browse/KAN-104>
- Related: `docs/SECURITY_ROTATION.md` (rotation cadence), `docs/UPTIMEROBOT_SETUP.md` (the other monitoring layer — uptime, not error capture)
