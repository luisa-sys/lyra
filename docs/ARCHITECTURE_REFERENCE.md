# Lyra platform architecture reference

**Lyra is an MCP-first platform where AI companions serve as the primary interface, backed by Next.js on Vercel, Supabase on PostgreSQL 17, and an MCP server on Railway.** This document covers every layer of the technical architecture — from protocol-level MCP message formats to DNS record configuration — providing the canonical reference for building, deploying, and scaling Lyra across environments. The architecture reflects the emerging paradigm where business logic is exposed as MCP tools first, with traditional web UI as a complementary interface.

---

## Next.js 15 App Router forms the rendering backbone

Every component in the App Router is a **Server Component by default**, executing exclusively on the server with zero client JavaScript. The `'use client'` directive creates a serialization boundary — everything the marked file imports becomes part of the client bundle. The architectural imperative is to push `'use client'` as deep as possible in the component tree. Server Components render into a **React Server Component Payload** (the "Flight" format), a streaming binary representation containing the rendered virtual DOM, placeholders for Client Component hydration points, and serialized props. React's custom serialization supports `Date`, `Map`, `Set`, `Promise`, typed arrays, but rejects functions, class instances, and circular references at runtime.

The `children` prop pattern is foundational for Lyra's layout architecture: a Client Component (e.g., an interactive modal shell) can accept Server Components as `children`, allowing server-rendered content to nest inside client-interactive wrappers without expanding the client bundle. This pattern enables Lyra's dashboard to keep heavy data-fetching components server-side while wrapping them in interactive client containers.

**Route Handlers** (`route.ts`) use Web standard `Request`/`Response` APIs, colocated with file-system routing. GET handlers are statically cached at build time unless they read cookies, headers, or searchParams. For Lyra's API surface, Route Handlers serve as the bridge between the Next.js frontend and Supabase — but notably, the MCP server on Railway handles the primary AI-facing API surface independently.

**Middleware** (`middleware.ts`) runs on Vercel's **Edge Runtime** before every request — a V8 environment with no Node.js APIs, no `require()`, and a 1–4 MB size limit. For Lyra, middleware handles auth token validation (using Web Crypto API-compatible JWT libraries, not `jsonwebtoken`), environment-based redirects, and header injection. As of Next.js 15.5, stable Node.js middleware is available, and Next.js 16 introduced `proxy.js` as a Node.js-only alternative for use cases requiring full Node capabilities.

**Server Actions** eliminate the need for internal API routes for mutations. Each `'use server'` function becomes a POST endpoint behind the scenes, with automatic CSRF protection via Origin header comparison. Lyra uses Server Actions for form submissions and data mutations, wrapping them with Zod validation via `next-safe-action` for consistent auth checks and error handling.

**Caching underwent a fundamental shift in Next.js 15**: all caching is now opt-in. The four cache layers remain — Request Memoization (React `cache()` deduplication within a render), Data Cache (persistent server-side fetch results), Full Route Cache (prerendered HTML/RSC payloads), and Router Cache (client-side navigation cache) — but `fetch()` calls are no longer cached by default. The emerging `'use cache'` directive (Next.js 16, enabled via `cacheComponents: true`) replaces `unstable_cache` with a cleaner model: function arguments become cache keys automatically, `cacheLife('hours')` controls staleness, and `cacheTag('posts')` enables invalidation via `revalidateTag`.

---

## Vercel's three-environment model maps to Lyra's branch strategy

Vercel provides **Production**, **Preview**, and **Development** environments, plus custom environments with branch rules. Every push to a non-production branch generates a Preview deployment at `{project}-git-{branch}-{team}.vercel.app` with its own unique hash URL. When a PR merges, the merge commit triggers a Production deployment automatically.

**Branch-scoped environment variables** are the mechanism enabling Lyra's multi-environment Supabase connectivity. Each variable can target Production, Preview, or Development. Within Preview, variables can be further scoped to specific branch names — a `staging` branch gets its own `SUPABASE_URL` pointing to the staging Supabase project, overriding the default Preview value without requiring duplication of every other variable. Critical detail: `NEXT_PUBLIC_` variables are **inlined at build time** via static text replacement and frozen into the JavaScript bundle. Server-only variables (no prefix) remain available at runtime in dynamically rendered Server Components.

**Custom environments** enable Lyra's staging domain. A custom environment with a branch rule matching `staging` gets its own attached domain (`stage.checklyra.com`), its own environment variables, and auto-deploy triggers. This creates a persistent staging URL distinct from ephemeral PR previews.

Vercel system variables provide deployment context: `VERCEL_ENV` returns `"production"`, `"preview"`, or `"development"`, while `VERCEL_GIT_COMMIT_REF` exposes the branch name — enabling Lyra's runtime environment detection without hardcoded flags. **Staged production deployments** allow disabling auto-assignment of custom domains, letting Lyra verify a production build at its hash URL before manually promoting it to `checklyra.com`.

Vercel's **Fluid Compute** (default since April 2025) optimizes serverless function performance through concurrent invocation sharing, bytecode caching, and cross-AZ failover. A single function instance handles up to **30,000 concurrent invocations** on Pro plans, dramatically reducing cold starts. Edge Functions run on V8 at ~15 global locations with sub-50ms cold starts but no Node.js APIs — Lyra uses these sparingly, only for middleware and lightweight geo-routing.

---

## Supabase wraps unmodified PostgreSQL 17 with a service constellation

Supabase deploys a single PostgreSQL 17 instance surrounded by specialized services: **Kong** (API gateway, validates API keys), **PostgREST** (auto-generates REST API from schema), **GoTrue** (JWT-based auth), **Realtime** (Elixir/Phoenix WebSocket engine), **Storage API** (S3-compatible objects), **Edge Functions** (Deno runtime), and **Supavisor** (Elixir-based connection pooler). Each service owns its own schema — `public` for application data, `auth` for users/sessions/identities, `storage` for object metadata, `realtime` for message routing.

The database role hierarchy is central to Lyra's security model. PostgREST connects as the `authenticator` role, then `SET ROLE` to either `anon` (unauthenticated requests) or `authenticated` (valid JWT present) per-request. The `service_role` has `BYPASSRLS` privilege, completely skipping Row Level Security. Lyra's server-side operations (Edge Functions, background jobs) use service_role access; all client-facing queries go through RLS.

**Connection pooling via Supavisor** provides three access patterns: direct connection on port 5432 (full wire protocol, IPv6 only), Session Mode on pooler port 5432 (one client = one backend, supports prepared statements), and **Transaction Mode on port 6543** (connections shared between transactions, ideal for serverless). Lyra's Next.js Server Components and Route Handlers use Transaction Mode exclusively, since Vercel's serverless functions create and destroy connections rapidly. The pool size should stay under 40% of `max_connections` when PostgREST is heavily used.

### Row Level Security patterns for Lyra

RLS policies are implicit WHERE clauses evaluated on every query. When RLS is enabled with no policies, the table is completely inaccessible — a secure default. The `auth.uid()` function extracts the user UUID from the JWT's `sub` claim via the session context set by PostgREST.

Lyra's core RLS pattern is **owner-based access with team sharing**. The critical performance optimization is wrapping `auth.uid()` in a subselect `(select auth.uid())` to enable PostgreSQL's initPlan caching — without the subselect wrapper, the function evaluates per-row rather than once per statement, causing **orders-of-magnitude performance degradation** on large tables. For team-based access, the pattern avoids joins in policies entirely:

```sql
CREATE FUNCTION user_teams() RETURNS SETOF uuid AS $$
  SELECT team_id FROM team_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER SET search_path = '';

CREATE POLICY "Team access" ON projects
  FOR SELECT TO authenticated
  USING (team_id IN (SELECT user_teams()));
```

Security definer functions prevent nested RLS evaluation on cross-table lookups. Adding B-tree indexes on policy-referenced columns (`user_id`, `team_id`) delivers 100x+ improvements on large tables. Always specifying `TO authenticated` ensures evaluation is skipped entirely for anonymous requests.

### Auth flow: JWTs, PKCE, and session management

Supabase Auth issues JWTs with standard claims: `sub` (user UUID), `role` (`"authenticated"`), `aud`, `iss`, `aal` (assurance level — `aal1` for password, `aal2` for MFA), `session_id`, `email`, plus `app_metadata` and `user_metadata`. Access tokens default to 1-hour expiry; refresh tokens are long-lived and single-use.

For Lyra's SSR context, the `@supabase/ssr` package stores tokens in HTTP cookies and uses **PKCE flow** — auth codes exchanged server-side via `exchangeCodeForSession()`, never exposing tokens in URL fragments. Middleware calls `supabase.auth.getUser()` on every request to validate the JWT signature against the JWKS endpoint (not `getSession()`, which reads storage without revalidation). The client must be initialized **inside each request handler**, never at module scope — Vercel's Fluid Compute shares function instances across invocations, so module-scoped clients would leak sessions between users.

OAuth (Google, GitHub) follows the redirect flow: client → GoTrue authorize endpoint → provider consent → GoTrue callback → user created/updated in `auth.users` and `auth.identities` → redirect to Lyra with auth code → PKCE exchange. Custom Access Token Hooks allow injecting RBAC claims into JWTs before issuance.

### The new API key format decouples rotation from sessions

The **`sb_publishable_`** key (replacing `anon`) and **`sb_secret_`** keys (replacing `service_role`) are opaque tokens, not JWTs. Kong validates the `apikey` header, identifies the consumer role, then substitutes an internal pre-signed JWT for upstream services. This architecture means **key rotation no longer invalidates user sessions** — the old JWT-based keys shared the signing secret, so rotating it broke everything simultaneously. Multiple `sb_secret_` keys can coexist, enabling zero-downtime rotation. New projects default to the new format; legacy keys remain supported during migration. The publishable key cannot be placed in the `Authorization` header — it's strictly for the `apikey` header, with user JWTs passing separately via `Authorization: Bearer`.

---

## MCP uses JSON-RPC 2.0 over Streamable HTTP transport

The Model Context Protocol, open-sourced by Anthropic in November 2024 and donated to the Linux Foundation's Agentic AI Foundation in December 2025, defines communication between AI clients and tool servers. All messages use **JSON-RPC 2.0** encoding with three message types: **requests** (have `id`, expect response), **responses** (match request `id`), and **notifications** (no `id`, fire-and-forget).

The protocol lifecycle begins with a three-step initialization handshake. The client sends an `initialize` request declaring its `protocolVersion`, `capabilities` (roots, sampling, elicitation), and `clientInfo`. The server responds with its own capabilities — `tools`, `resources`, `prompts`, `logging` — each optionally supporting `listChanged` notifications for dynamic updates. The client then sends an `initialized` notification, after which normal operations begin.

### Three primitives define the interaction surface

**Tools** are model-controlled functions the LLM discovers via `tools/list` and invokes via `tools/call`. Each tool declares a `name`, `description` (critical — the LLM relies on this text to decide when to use the tool), and `inputSchema` (JSON Schema for argument validation). Results return a `content` array of typed items (`text`, `image`, `resource`). Tool annotations provide behavioral hints: `readOnlyHint`, `destructiveHint`, `idempotentHint`. Dynamic tool registration allows servers to add/remove tools at runtime, emitting `notifications/tools/list_changed`.

**Resources** are application-controlled read-only data addressed by URI (`file:///`, `resource://`). The client decides which resources to surface to the model. Resources support subscriptions for change notifications and templates for parameterized URI patterns.

**Prompts** are user-controlled templates that inject structured messages into the conversation. Retrieved via `prompts/get` with arguments, they return a `messages` array with role and typed content.

### Streamable HTTP replaces SSE as the remote transport

Introduced in spec version `2025-03-26`, Streamable HTTP uses a **single HTTP endpoint** (e.g., `https://mcp.checklyra.com/mcp`). Every client message is a POST with `Accept: application/json, text/event-stream`. The server responds with EITHER a direct JSON response (`Content-Type: application/json`) for simple results, OR an SSE stream (`Content-Type: text/event-stream`) for streaming, progress notifications, and multi-step operations. This duality is architecturally significant: **the simplest MCP servers can be deployed as stateless serverless functions** returning direct JSON, while complex servers stream results progressively.

Session management uses the `Mcp-Session-Id` header. The server MAY assign a session ID in the initialize response; the client MUST include it in all subsequent requests. **Stateless servers simply omit the session ID**, operating without session state. Lyra's MCP server on Railway uses stateful sessions for user context persistence across tool calls, with the session ID as a cryptographically secure UUID.

A GET request to the MCP endpoint opens a standalone SSE stream for server-initiated messages (notifications, requests) unrelated to any current POST. DELETE terminates the session explicitly.

### TypeScript SDK and Express integration

Lyra's MCP server uses the `@modelcontextprotocol/sdk` package with Express:

```typescript
const server = new McpServer({ name: 'lyra-mcp', version: '1.0.0' });

server.registerTool('get_profile', {
  description: 'Retrieve a user profile by username',
  inputSchema: { username: z.string() },
  annotations: { readOnlyHint: true }
}, async ({ username }) => ({
  content: [{ type: 'text', text: JSON.stringify(profile) }]
}));
```

The `StreamableHTTPServerTransport` handles POST/GET/DELETE on a single Express route. For stateful operation, `sessionIdGenerator` produces UUIDs; for stateless, it's set to `undefined`. The Express middleware package provides `hostHeaderValidation()` for DNS rebinding protection. Authentication follows the spec's OAuth 2.1 mandate: unauthenticated requests receive `401`, triggering the client's OAuth flow.

---

## MCP-first architecture inverts traditional application design

The MCP-first paradigm, now articulated by multiple production teams, inverts the build order: **define core functionality → build MCP server exposing it as tools → test with AI clients → build web UI later if needed.** The MCP server IS the primary backend. AI companions (Claude, ChatGPT, Cursor) become the frontend. The web UI becomes a complementary dashboard.

For Lyra, this means the MCP server exposes every core platform action — profile management, link CRUD, analytics queries, referral tracking — as MCP tools. A user interacting with Lyra through Claude Desktop or ChatGPT can accomplish everything available in the web UI through natural language. The web dashboard exists for visual analytics, bulk management, and situations where conversational interaction is less efficient.

Real-world precedents validate this pattern. **Blender MCP** (7,600+ GitHub stars) enables natural-language 3D modeling. **Figma Context MCP** (2,600+ stars) gives AI coding tools direct access to design data, with developers reporting 2–5x faster UI implementation. **Conscia's Universal MCP Server** transforms commerce backends into AI-ready APIs for product discovery, cart, and checkout through conversation. **MCP Apps** (January 2026) extended this further — tools can now return interactive UI components rendered in sandboxed iframes within Claude, ChatGPT, and VS Code, with bidirectional communication back to the conversation.

Tool design for AI consumption requires flat schemas, unambiguous descriptions, minimal required parameters with sensible defaults, and composite tools for multi-step workflows. For large APIs, the dynamic tool pattern — meta-tools like `list_endpoints`, `get_schema`, `invoke_endpoint` — avoids saturating the LLM's context window with hundreds of tool definitions.

---

## Railway hosts Lyra's MCP server as a Vercel sidecar

Railway fills the architectural gap Vercel's serverless model cannot: **long-running processes, persistent WebSocket connections, and TCP services.** Lyra's MCP server requires persistent HTTP connections for SSE streaming, session state, and consistent response times — characteristics incompatible with Vercel's function timeout limits and stateless execution model.

Railway's deployment pipeline detects the source automatically: Dockerfile first, then **Railpack** (the new default builder replacing Nixpacks), which identifies the language, installs dependencies, builds, and produces an OCI-compliant image. GitHub auto-deploy triggers on every push to the configured branch. The **"Wait for CI"** toggle makes Railway pause deployment until GitHub Actions workflows pass — deployments enter a `WAITING` state and are `SKIPPED` if any workflow fails.

**Environment variable management** uses a hierarchical model: service variables (scoped to a service within an environment), shared variables (scoped to project + environment), and reference variables using template syntax (`${{shared.SUPABASE_URL}}`, `${{Postgres.DATABASE_URL}}`). Sealed variables hide values in the UI and API, suitable for secrets. All variable changes create staged diffs that must be explicitly deployed.

Railway provisions **Let's Encrypt SSL certificates automatically** — RSA 2048-bit, 90-day validity, auto-renewed at 2 months. Custom domains require a CNAME record pointing to the Railway-provided target (e.g., `g05ns7.up.railway.app`). Certificate issuance completes within ~1 hour of DNS verification.

**Private networking** between Railway services uses encrypted Wireguard tunnels with internal DNS (`service.railway.internal`). This is environment-isolated — services in different environments cannot communicate privately. Lyra could use this for a future worker service (queue consumer, scheduled jobs) communicating with the MCP server without public network traversal.

---

## Cloudflare manages DNS while Vercel and Railway handle SSL

Cloudflare serves as Lyra's DNS authority with a strict configuration principle: **DNS-only mode (grey cloud) for all records pointing to Vercel and Railway.** Vercel explicitly recommends against Cloudflare's proxy (orange cloud) because it masks visitor IPs (breaking Vercel Analytics and Bot Protection), creates competing CDN/cache layers, and can interfere with Let's Encrypt certificate renewal on the `/.well-known/acme-challenge` path.

The DNS record layout for Lyra:

- `checklyra.com` — A record, DNS-only → `76.76.21.21` (Vercel)
- `www.checklyra.com` — CNAME, DNS-only → `cname.vercel-dns.com`
- `stage.checklyra.com` — CNAME, DNS-only → `cname.vercel-dns.com` (Vercel custom environment)
- `mcp.checklyra.com` — CNAME, DNS-only → `{hash}.up.railway.app` (MCP server)
- MX records → Cloudflare Email Routing servers (`amir.mx.cloudflare.net`, etc.)
- TXT → `v=spf1 include:_spf.mx.cloudflare.net ~all`

If Railway domains must use Cloudflare proxy (for WAF on the MCP endpoint), SSL/TLS must be set to **"Full"** (not Flexible, not Full Strict). Railway will use its default `*.up.railway.app` wildcard certificate for Cloudflare-to-origin encryption. TCP proxy domains (if needed for direct database access) require DNS-only mode unconditionally.

**Cloudflare Email Routing** forwards `hello@checklyra.com` to a Gmail address with automatic MX record management, DKIM signing, and catch-all rules. Destination addresses require verification and are shared at the account level across domains.

---

## GitHub Actions orchestrates the develop → staging → main pipeline

Lyra uses a three-branch promotion model with automated workflows for `develop` → `staging` merges and manual `workflow_dispatch` triggers for `staging` → `main` production promotions.

The critical architectural constraint is that **events triggered by `GITHUB_TOKEN` do not trigger subsequent workflows** — by design, to prevent recursive loops. When a GitHub Actions workflow merges `develop` into `staging` using `GITHUB_TOKEN`, the merge commit will NOT trigger Railway's "Wait for CI" or Vercel's preview deployment workflow. The solution is **GitHub App tokens**: the `actions/create-github-app-token@v3` action generates a short-lived token from a registered GitHub App, and pushes using this token DO trigger downstream workflows.

```yaml
- uses: actions/create-github-app-token@v3
  id: app-token
  with:
    app-id: ${{ vars.APP_ID }}
    private-key: ${{ secrets.PRIVATE_KEY }}
- uses: actions/checkout@v4
  with:
    token: ${{ steps.app-token.outputs.token }}
```

**Branch protection** requires adding the GitHub App (or `github-actions[bot]`) to the "Allow specified actors to bypass required pull requests" list. Without this, CI-driven merges to protected branches will be rejected.

The `permissions` block follows a restrictive model: specifying ANY scope causes all unspecified scopes to default to `none`. Lyra's deployment workflow needs `contents: write` (push commits/tags), `deployments: write` (create deployment statuses), and `id-token: write` (OIDC for cloud provider authentication).

**Concurrency controls** prevent parallel deployments to the same environment:

```yaml
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true
```

**GitHub Environments** provide environment-scoped secrets and required reviewer gates. The `production` environment requires manual approval before deployment proceeds, while `staging` deploys automatically on merge. Environment secrets use the same `secrets.X` syntax but resolve to different values per environment.

For Vercel integration via CI, `vercel build` runs locally (or in CI), producing a `.vercel/output` directory conforming to the Build Output API. `vercel deploy --prebuilt` uploads this artifact without giving Vercel source code access. Disabling Vercel's native GitHub integration (`"github": { "enabled": false }` in `vercel.json`) prevents duplicate deployments.

---

## PWA launches first, React Native follows with shared business logic

Lyra's mobile strategy is web-first PWA with a planned React Native iOS app. The monorepo architecture uses **Turborepo** with pnpm workspaces to share TypeScript packages between `apps/web` (Next.js) and `apps/mobile` (Expo):

```
lyra/
  apps/
    web/           # Next.js 15 App Router (PWA)
    mobile/        # React Native via Expo
  packages/
    api/           # Typed Supabase client + Zod schemas
    types/         # Shared TypeScript interfaces
    state/         # Zustand stores
    config/        # ESLint, TSConfig
```

**Solito v5** (October 2025) bridges navigation: on web, it returns pure Next.js components (no React Native Web dependency); on native, it uses React Navigation/Expo Router. The architectural principle is "share business logic, not UI" — API clients, validation schemas, state management, and domain models live in shared packages, while UI components are platform-specific. The `.native.tsx` file extension convention enables platform-specific implementations of shared interfaces.

PWA capabilities on iOS since 16.4 include Web Push notifications (Home Screen apps only), Service Workers, offline caching, and standalone display mode. The hard limitations driving native migration are: no background sync, no silent push, no Bluetooth/NFC, storage quota pressure from WebKit, and no App Store discoverability.

React Native's **New Architecture** is now the default (v0.76+): JSI provides synchronous JavaScript↔C++ communication replacing the async JSON bridge, Fabric enables concurrent rendering with interruptible updates, and TurboModules load lazily with type-safe Codegen bindings. **Expo's Continuous Native Generation** means native directories are generated on-demand from `app.json` (like `node_modules` from `package.json`), with Config Plugins for native customization without ejecting. EAS Build handles cloud-based iOS builds, EAS Submit automates App Store submission, and EAS Update pushes OTA JavaScript updates without review.

### App Store requirements for MCP-integrated apps

Apple's **Guideline 5.1.2(i)** (updated November 2025) explicitly regulates "third-party AI": apps must present a consent modal before transmitting personal data to external AI providers, with ongoing controls in Settings for users to review which providers receive data and option to disable. Guideline **4.2** requires sufficient native functionality — a pure WebView wrapper will be rejected. Lyra's native app must include native navigation, native UI elements, and meaningful functionality beyond what the PWA offers.

For monetization, the **post-Epic ruling** (May 2025) allows US App Store apps to freely link to external payment without Apple's External Purchase Link Entitlement. Outside the US, the entitlement with a one-link rule still applies. The recommended pattern: offer both IAP and web checkout (Stripe), letting users choose. Web checkout yields ~$9.40 of a $10 subscription versus $7.00 via Apple's 30% cut.

---

## Affiliate tracking uses server-side click attribution with account-level persistence

Lyra's referral architecture combines cookie-based initial capture with account-level persistence. When a visitor clicks a referral link (`checklyra.com/ref/USERNAME`), the server logs the click with a generated `click_id`, sets a `referred_by` cookie (30-day expiry), and redirects to the destination. At registration, the cookie value persists to the user record's `referred_by` field — solving cross-device attribution permanently.

Server-side click tracking is essential over client-side: the click hits Lyra's server → logs to `referral_clicks` with IP, user agent, UTM parameters, and unique `click_id` → sets cookie → redirects. This survives ad blockers and ITP restrictions that kill client-side tracking scripts.

For affiliate link revenue (creators earning commissions on product links), the **postback/webhook pattern** is the standard: when a conversion occurs on the affiliate network (Amazon Associates, Impact, ShareASale), the network fires a server-to-server HTTP request to Lyra's webhook endpoint with the `click_id`, transaction amount, and commission. Lyra matches the `click_id` to the originating profile and records the conversion.

The schema design centers on four tables: `referral_clicks` (high-volume, potentially time-series partitioned), `referral_conversions` (matched click→conversion with status lifecycle: pending→approved→rejected), `commission_payouts` (aggregated payment records with holding period), and a materialized view for daily earnings aggregation per profile. The **30-day holding period** before commission availability is critical for fraud prevention — it accommodates refund windows and allows behavioral analysis before releasing funds.

Platform-level referrals (user A refers user B to Lyra) use a **recurring commission model**: the referrer earns a percentage of each payment the referred user makes for the lifetime of the account. Tiered structures incentivize volume — escalating commission rates at referral count thresholds, with a minimum activity requirement (referred user must complete a meaningful action) before the referrer earns credit.

Fraud prevention relies on layered defenses: IP monitoring for duplicate signups, device fingerprinting, email domain validation (blocking disposable providers), velocity controls on referral redemptions, delayed payouts, and automatic flagging of accounts exceeding behavioral thresholds for manual review.

---

## Conclusion

Lyra's architecture reflects a genuine paradigm shift: the MCP server is the primary application interface, not a bolt-on integration. The technical stack — Next.js 15 on Vercel for SSR/SSG with branch-scoped environments, Supabase PostgreSQL 17 with RLS and the new `sb_publishable_`/`sb_secret_` key format, a stateful MCP server on Railway exposed via Streamable HTTP, Cloudflare for DNS-only resolution, and GitHub Actions with App token-based promotion workflows — is purpose-built for this inversion.

Three architectural insights stand out. First, the MCP-first pattern means Lyra's web dashboard is architecturally optional — every capability exists as an MCP tool before it becomes a UI feature, ensuring AI clients are never second-class consumers. Second, Supabase's JWT-to-PostgreSQL-role mapping creates a single security model spanning REST, Realtime, and Storage — RLS policies written once enforce access across every data path. Third, the Vercel + Railway sidecar pattern resolves the fundamental tension between serverless (scale-to-zero, edge distribution) and stateful services (persistent connections, session state) without forcing either platform beyond its strengths.

The migration path to React Native is de-risked by the Turborepo monorepo with shared business logic packages — the same Supabase client, Zod schemas, and Zustand stores power both the PWA and the future native app, with platform-specific UI shells and Solito bridging navigation. Apple's 2025 AI guidelines and the post-Epic payment landscape are factored into the monetization architecture from the start.
