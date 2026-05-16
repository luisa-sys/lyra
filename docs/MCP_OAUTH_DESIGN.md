# MCP OAuth 2.1 — Architecture Decision + Sub-Ticket Breakdown (KAN-88)

> Replace API-key copy-paste auth on the Lyra MCP server with the OAuth 2.1 Authorization Code + PKCE flow per the **MCP Authorization spec** (draft 2025-11-25). End state: a user adds Lyra in Claude.ai, Claude redirects them to `checklyra.com/oauth/authorize`, they sign in (Google or password), click "Allow Claude to access your Lyra profile", and Claude gets an access token automatically. Read tools stay unauthenticated.

This doc decides the architecture and splits the work into deliverable sub-tickets. It is NOT a step-by-step implementation guide — those go in the sub-tickets.

## Decision: Option A (Supabase-backed thin OAuth layer)

| | A. Supabase + thin OAuth layer | B. Auth0 / Clerk / Descope | C. node-oidc-provider |
|---|---|---|---|
| New monthly cost | £0 | £25–£250 | £0 |
| Migration effort | Low | High (rewrite auth) | Medium |
| Code we maintain | OAuth endpoints (~6 routes + middleware) | Webhooks, callbacks | Full provider config |
| Time to ship | 2 weeks | 4 weeks (migration) | 3 weeks |
| Spec compliance | Manual but small surface | Out of the box | Out of the box |
| Auth UX continuity | Yes (existing login screen) | No (rebuild) | Yes |
| Security review surface | We own the JWT issuance | Vendor handles | Library handles |

**Chosen: Option A.** Reuses existing Supabase Auth (Lyra has email/password + Google already; Apple deferred per KAN-90). The OAuth surface we add is small: 4 endpoints + 2 tables + 1 middleware. We keep full control of the consent UX and can render it in the existing design system without an iframe / vendor branding.

Option B is rejected on cost + auth-rewrite risk. Option C is technically clean but is more code to babysit than Option A for the same outcome.

## What the MCP spec actually requires (cliff notes)

From the MCP Authorization spec draft 2025-11-25:

### Resource Server (the MCP server itself, `lyra-mcp-server`)
1. **Return HTTP 401 with `WWW-Authenticate` header** when a write tool is called without a valid bearer token. The header must include `resource_metadata` pointing at the PRM endpoint.
2. **Serve Protected Resource Metadata** at `https://mcp.checklyra.com/.well-known/oauth-protected-resource` per RFC 9728. The PRM tells the client (Claude) where the authorization server lives.
3. **Validate bearer tokens** on every write-tool invocation. Reject expired or tampered tokens with 401.
4. **NOT act as the authorization server.** Strict separation of concerns: token issuance lives on `checklyra.com`, not `mcp.checklyra.com`.

### Authorization Server (Next.js app at `checklyra.com`)
1. **Authorization Code flow with mandatory PKCE.** Reject `code_challenge_method` other than `S256`. Reject any flow request lacking `code_challenge`.
2. **`/.well-known/oauth-authorization-server`** metadata per RFC 8414 — lists endpoints, supported methods, scopes.
3. **Dynamic Client Registration** at `POST /oauth/register` (RFC 7591) — Claude registers itself when first connecting. Alternative: Client ID Metadata Documents (CIMD) — also acceptable per the spec; lighter to implement but Claude.ai prefers DCR.
4. **`GET /oauth/authorize`** — checks the user is signed in (redirect to existing `/login` if not), renders a consent screen ("Allow Claude to read and write to your Lyra profile?"), creates an authorization code on Allow.
5. **`POST /oauth/token`** — exchanges code for an access token (JWT) and refresh token. Validates PKCE verifier against the stored challenge.
6. **`POST /oauth/revoke`** — revokes a token / refresh token. RFC 7009.

### Read-tool exception (Lyra-specific)
Per `docs/ARCHITECTURE.md` — `lyra_search_profiles`, `lyra_get_profile`, `lyra_get_section`, `lyra_recommend_gifts`, `lyra_get_insights`, `lyra_list_schools` are all PUBLIC (no auth). Only the write tools need bearer tokens. The MCP server enforces this today via per-tool checks and we keep that pattern — OAuth changes only the auth credential format, not which tools require it.

## Architecture

```
┌────────────────────────┐                          ┌──────────────────────────┐
│ Claude.ai              │                          │ Lyra Web (checklyra.com) │
│ (OAuth Client)         │     1. DCR              │ Next.js                  │
│                        │ ───────────────────────► │ POST /oauth/register     │
│                        │                          │                          │
│                        │     2. authorize         │ GET /oauth/authorize     │
│                        │ ───────────────────────► │ → /login if not auth'd   │
│                        │                          │ → render consent screen  │
│                        │     3. authz code        │ ◄─ Allow ─               │
│                        │ ◄──────────────────────  │ ← create authz code      │
│                        │                          │                          │
│                        │     4. token exchange    │ POST /oauth/token        │
│                        │ ───────────────────────► │ verify PKCE + issue JWT  │
│                        │                          │                          │
│                        │     5. write tool call   │                          │
│                        │     w/ Bearer ${jwt}     │                          │
└────────────────────────┘                          └──────────────────────────┘
            │                                                    │
            │                                                    │
            ▼                                                    │
┌────────────────────────┐                                       │
│ Lyra MCP Server        │                                       │
│ (Resource Server,      │                                       │
│ mcp.checklyra.com)     │                                       │
│                        │     6. write tool call                │
│                        │ ◄─ Bearer JWT                         │
│                        │                                       │
│ → verify JWT signature │                                       │
│ → verify aud claim     │                                       │
│   matches "lyra-mcp"   │                                       │
│ → check exp            │                                       │
│ → look up user_id      │                                       │
│ → execute tool         │                                       │
└────────────────────────┘                                       │
```

## Data model

Two new tables in `prod-lyra` (and replicas in `dev-lyra`, `stage-lyra`):

### `oauth_clients` (registered OAuth clients)
| Column | Type | Notes |
|---|---|---|
| `client_id` | text PK | Generated `cli_*` opaque ID |
| `client_secret_hash` | text NULL | NULL for public clients; bcrypt for confidential. Claude.ai is a public client, so NULL in practice. |
| `client_name` | text | Display name shown on the consent screen |
| `redirect_uris` | text[] | Whitelist; spec requires exact match |
| `created_at` | timestamptz default now() |
| `created_by_user_id` | uuid NULL | NULL for self-registered (DCR), set for admin-created clients |
| `metadata` | jsonb | Client logo URL, policy URL, etc. — populated from DCR request |
| `is_revoked` | boolean default false |

RLS: only the row owner can update / read; anonymous can read `client_name` + `metadata` for the consent screen (read-only).

### `oauth_codes` (short-lived authorization codes)
| Column | Type | Notes |
|---|---|---|
| `code` | text PK | Random 32 bytes base64url |
| `client_id` | text FK → oauth_clients |
| `user_id` | uuid FK → auth.users |
| `redirect_uri` | text | Must match the exact value used in the authorize request |
| `code_challenge` | text | Stored from authorize; verified at token endpoint |
| `code_challenge_method` | text | Always 'S256' in practice |
| `scope` | text[] | Requested scopes |
| `expires_at` | timestamptz | now() + 60s; spec says codes MUST be short-lived |
| `consumed_at` | timestamptz NULL | Mark on first use; second-use = error |

RLS: no client access — service-role only. Codes are server-side state.

### Tokens
Issued as **JWTs signed with `LYRA_OAUTH_SIGNING_KEY`** (new env var, asymmetric RS256). No DB row required for access tokens — they verify by signature. Refresh tokens DO need a DB row so they can be revoked individually:

### `oauth_refresh_tokens`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |
| `token_hash` | text | SHA-256 of the refresh-token value |
| `client_id` | text FK |
| `user_id` | uuid FK |
| `scope` | text[] |
| `issued_at` | timestamptz |
| `expires_at` | timestamptz | now() + 90 days |
| `revoked_at` | timestamptz NULL | Set on logout / revoke endpoint |

## Sub-ticket breakdown

Each sub-ticket is independently shippable; they form a chain where later steps require earlier ones merged.

### KAN-88-A — Spec stubs + Protected Resource Metadata _(1 day, no user-visible change)_
1. Add `POST` write-tool middleware in `lyra-mcp-server` that returns 401 + `WWW-Authenticate: Bearer realm="lyra", resource_metadata="https://mcp.checklyra.com/.well-known/oauth-protected-resource"` when no `Authorization: Bearer` header is present. **For now**, keep the existing API-key auth as a parallel path — if API key valid, allow. Only the **absent both** case 401s.
2. Add the PRM endpoint at `https://mcp.checklyra.com/.well-known/oauth-protected-resource` returning static JSON per RFC 9728:
   ```json
   { "resource": "https://mcp.checklyra.com",
     "authorization_servers": ["https://checklyra.com"],
     "scopes_supported": ["profile:read", "profile:write"],
     "bearer_methods_supported": ["header"] }
   ```
3. Add AS metadata endpoint at `https://checklyra.com/.well-known/oauth-authorization-server` returning static JSON listing the OAuth endpoint URLs (even before they're implemented — discovery is allowed to advertise endpoints that 501 today).
4. Unit tests: PRM returns 200 + correct JSON. Write tool without auth returns 401 + correct header. Write tool with valid API key still works.

**Acceptance:** Claude.ai shows "OAuth required" prompt when connecting (instead of falling through silently). API-key users see no change.

### KAN-88-B — Database tables + RLS _(0.5 day)_
1. Migration: `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens`. Indexes on lookup columns (`code`, `token_hash`, `client_id`).
2. RLS policies (service-role-only on codes/tokens; anonymous read of `client_name`/`metadata` on clients).
3. Tests: RLS via `apply_migration` test runs (try anonymous SELECT — must fail / return only public cols).

**Acceptance:** Tables live on dev. Anonymous-context test against each table returns expected RLS denial.

### KAN-88-C — JWT signing infrastructure _(1 day)_
1. Generate an RS256 keypair. **Private key** → Vercel env var `LYRA_OAUTH_SIGNING_KEY` (PEM, sensitive). **Public key** → published at `https://checklyra.com/.well-known/jwks.json` (so MCP server can verify offline).
2. Helper module `src/lib/oauth-jwt.ts`: `issueAccessToken(userId, clientId, scope)` returns a signed JWT with `aud="lyra-mcp"`, `iss="https://checklyra.com"`, `sub=userId`, `client_id`, `scope`, `iat`, `exp` (now + 1h).
3. Verifier in `lyra-mcp-server`: fetch JWKS once, cache, verify signature + claims. Reject if `iss`, `aud`, `exp` wrong.
4. Add `LYRA_OAUTH_SIGNING_KEY` to `docs/SECURITY_ROTATION.md` (annual rotation; document keypair-rotation procedure with overlap window).

**Acceptance:** Round-trip test — `issueAccessToken` produces a token that the MCP server verifier accepts. Tampered token rejected. Expired token rejected.

### KAN-88-D — `/oauth/authorize` + consent screen UI _(2 days)_
1. `GET /oauth/authorize` route handler: validates `client_id`, `redirect_uri` (exact match against `oauth_clients.redirect_uris`), `response_type=code`, `code_challenge`, `code_challenge_method=S256`. Returns 400 on any validation fail.
2. If user not signed in → redirect to `/login?next=/oauth/authorize?...originalParams`.
3. If signed in → render consent screen (`src/app/oauth/authorize/consent-screen.tsx`, Server Component): show client name, requested scopes ("read your profile", "write to your profile"), Allow / Deny buttons. Use the existing design tokens (sage / blush) for buttons; do NOT reinvent the UI.
4. On Allow: insert row into `oauth_codes` with the PKCE challenge, redirect to `<redirect_uri>?code=<code>&state=<state>`.
5. On Deny: redirect to `<redirect_uri>?error=access_denied&state=<state>`.
6. Server action + tests for the consent flow (Playwright E2E + unit on code generation / PKCE validation).

**Acceptance:** Manual: hit `/oauth/authorize` with a hand-built URL, see the consent screen, click Allow, get redirected with a code. Same flow when not signed in → land on `/login`, sign in, return to consent screen.

### KAN-88-E — `/oauth/token` exchange + refresh _(1 day)_
1. `POST /oauth/token` route handler. Grant types: `authorization_code` + `refresh_token`.
2. For `authorization_code`: look up code, verify not consumed, verify expiry, verify `code_verifier` against stored `code_challenge` (SHA-256 compare), issue access JWT + refresh token, mark code consumed.
3. For `refresh_token`: look up token hash, verify not revoked / not expired, issue new access JWT (rotate refresh per spec recommendation).
4. `POST /oauth/revoke`: hash incoming token, mark revoked.
5. Unit tests for every error path (used code, wrong PKCE verifier, expired code, revoked refresh).

**Acceptance:** Round-trip authorize → token works end-to-end via curl. Replaying a consumed code returns 400. Wrong verifier returns 400.

### KAN-88-F — Dynamic Client Registration `POST /oauth/register` _(1 day)_
1. RFC 7591 endpoint. Validate request body (redirect_uris required, client_name required). Reject if `redirect_uris` is missing or contains non-https or localhost in production.
2. Generate `client_id` (`cli_<random>`). For public clients (Claude.ai is one — PKCE-only), no `client_secret`.
3. Return `client_id`, `client_id_issued_at`, supported flows.
4. Rate-limit aggressively — 5 registrations per IP per hour. Spam DCR is a known abuse vector.

**Acceptance:** Claude.ai successfully self-registers on first connect.

### KAN-88-G — End-to-end test with Claude.ai _(0.5 day)_
1. Add `https://mcp.checklyra.com/mcp` as a connector in Claude.ai.
2. Walk through OAuth flow.
3. Use a write tool from the chat (e.g. "Add 'cold brew coffee' to my Lyra likes") — verify auth works.
4. Sign-out + sign-in flow — verify refresh works without prompting again.
5. Document the resulting flow in `docs/MCP_OAUTH_SETUP.md` for the runbook.

**Acceptance:** Real end-to-end: connect, allow, write — no key copy-paste.

### KAN-88-H — Deprecate API-key auth (separate ticket, separate cadence) _(longer arc)_
1. Add a dashboard banner: "API keys are deprecated as of YYYY — please re-connect your AI companion via OAuth."
2. Emit a `::warning::` MCP response when a request uses API-key auth.
3. After 90 days, return 401 + the same `WWW-Authenticate` flow.
4. Drop the `api_keys` table once usage is at zero.

**Don't ship H until A–G are stable for 30 days.** API keys are the user-visible fallback while the OAuth path beds in.

## Security review

- **Audience binding (`aud` claim)**: every issued JWT MUST have `aud="lyra-mcp"`. The MCP server verifier MUST reject tokens with any other audience — prevents token reuse against a different resource server even if one is later added.
- **PKCE is mandatory** — no client should be able to skip it. `code_challenge_method != S256` → reject; missing `code_challenge` → reject.
- **Redirect URI exact-match** — no prefix matching, no wildcards. Open redirects are the #1 attack surface on OAuth servers.
- **Authorization codes are single-use + 60s lifetime** — `consumed_at` IS NOT NULL = reject.
- **DCR rate-limiting** — 5 registrations per IP per hour.
- **Refresh tokens stored as SHA-256 hashes only** — never plaintext at rest.
- **Private signing key in Vercel env vars only**, marked sensitive. Annual rotation per `SECURITY_ROTATION.md` with a 7-day overlap window (publish both old and new public keys in JWKS during the overlap; MCP server caches both).
- **Sentry data scrubbing** — make sure OAuth params (code, state, code_verifier) NEVER hit Sentry breadcrumbs. Add explicit allowlist to `instrumentation.ts`.

## Open questions / parking lot

1. **Token introspection endpoint** (RFC 7662) — should we publish one so the MCP server can revoke-check without a DB hit, or rely purely on signature + exp? **Decision: skip for v1**, rely on signature + short expiry (1h). Add later if revoke-time-to-effect matters.
2. **Scopes design** — start with two: `profile:read`, `profile:write`. Avoid finer-grained scopes (`gifts:write`) until there's a real need.
3. **Consent screen branding** — must NOT look like a fake login. Render the user's email at the top so they're sure they're consenting on the right account.
4. **iOS Safari WebKit Safari ITP** — third-party cookies on the OAuth flow can break Safari. Test specifically against Safari + Claude.ai-on-iPad.

## Reference

- MCP Authorization spec: <https://github.com/modelcontextprotocol/specification/blob/main/docs/specification/draft/auth/index.md>
- RFC 6749 (OAuth 2.0): <https://www.rfc-editor.org/rfc/rfc6749>
- RFC 7636 (PKCE): <https://www.rfc-editor.org/rfc/rfc7636>
- RFC 8414 (AS Metadata): <https://www.rfc-editor.org/rfc/rfc8414>
- RFC 7591 (DCR): <https://www.rfc-editor.org/rfc/rfc7591>
- RFC 9728 (Protected Resource Metadata): <https://www.rfc-editor.org/rfc/rfc9728>
- Lyra ticket: <https://checklyra.atlassian.net/browse/KAN-88>
- Related: KAN-37 (social login — Google done, Apple deferred), KAN-90 (Google Cloud lockdown), `docs/SECURITY_ROTATION.md`
