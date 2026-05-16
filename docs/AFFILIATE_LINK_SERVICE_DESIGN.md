# Affiliate Link Service — architecture (KAN-188)

> Every recommendation in Lyra must resolve to a click-tracked, geo-localised, monetised URL. The **Affiliate Link Service** is the single server-side chokepoint that takes a raw product URL plus geo + session context and returns the monetised link. This document specifies the contract, provider chain, caching, failure modes, latency budget, and the Phase-2 evolution path.

This is a design ticket. Implementation lands in subsequent tickets — see the cross-reference table at the bottom.

## Contract

```ts
type AffiliateLinkRequest = {
  rawUrl: string;            // The merchant product URL the recommender chose
  buyerCountry: string;      // ISO-3166 alpha-2; from KAN-185 geo signal
  recipientCountry: string;  // ISO-3166 alpha-2; from KAN-185 geo signal (falls back to buyer when NULL)
  sessionId: string;         // For attribution to a browsing session
  userId?: string | null;    // Authenticated user (buyer); null for anonymous flows
  recipientId?: string | null; // Anchors the click to a recipient profile if known
  recommendationId?: string | null; // For per-recommendation analytics + feedback loop (KAN-202)
  source: 'web' | 'mcp' | 'email'; // Which surface initiated the call
};

type AffiliateLinkResult = {
  url: string;               // The user-facing URL. ALWAYS a working link.
  clickId: string;           // Opaque UUID. Used as the join key in `affiliate_clicks` (KAN-189).
  provider: 'sovrn' | 'amazon_direct' | 'raw';  // Which provider monetised it. 'raw' means no monetisation.
  monetised: boolean;        // True iff a commission can be earned on a click on `url`.
  merchant: string | null;   // Canonical merchant ID if known (matches `affiliate_merchant_eligibility.merchant_id`)
};
```

**Contract guarantees:**

1. **The link always works.** If every provider in the chain fails, the service returns the raw input URL with `monetised: false` rather than throwing. We never break the user experience to gain attribution.
2. **The click is always logged** (KAN-189). Whether monetised or not. The log is the source of truth for reconciliation (KAN-195) and for the feedback loop (KAN-202).
3. **Sub-ID convention.** Every monetised provider receives our `clickId` (format `lyra-{clickId}` for web/email, `lyra-mcp-{clickId}` for MCP) as its SubID parameter. This lets us attribute revenue back to the click without depending on the provider's own analytics.
4. **Server-side only.** No client-side calls — the Sovrn API key never reaches the browser bundle.

## Provider chain (MVP — Sovrn only)

```
input → check eligibility matrix (KAN-187)
     → if not eligible for buyer's country → return raw URL with monetised:false
     → else → call Sovrn Link Optimizer (POST /api/optimize) with the SubID
     → if Sovrn returns a usable link → return it
     → if Sovrn errors or times out → return raw URL with monetised:false
     → log to affiliate_clicks regardless
```

**Eligibility check (KAN-187 table)**:
- Look up `affiliate_merchant_eligibility` by `(detect_merchant(rawUrl), buyerCountry)`.
- `detect_merchant` is a URL-pattern utility that maps known domains (amazon.com → "amazon", etsy.com → "etsy", etc.) to canonical IDs. Unknown domains return `null` and skip the eligibility check (we still try Sovrn — it may know merchants we don't).
- If `is_active=false`, skip Sovrn — Luisa may have toggled the merchant off for compliance.

**Sovrn invocation**:
- `POST https://api.sovrn.com/optimize` with `{ url: rawUrl, sub_id: "lyra-<clickId>" }`.
- Auth: `SOVRN_API_KEY` from env.
- Timeout: 300ms hard. If we miss the latency budget, we degrade to raw URL.
- Retry: zero. Failure means "this click goes un-monetised but the user still gets to the merchant".

**Phase 2 evolution (KAN-196)** — Amazon-direct branch sits **ahead** of Sovrn for any URL we detect as an Amazon domain:

```
input → detect merchant
     → if merchant == "amazon" AND we have an Associates tag for buyerCountry
       → route via Geniuslink (or own router) to the correct Amazon storefront with our tag
       → return monetised URL
     → else fall through to the existing Sovrn branch
```

The new branch is additive. The contract above does not change.

## Caching

Same `(rawUrl, buyerCountry, recipientCountry)` triple → same `(url, provider, monetised, merchant)` for 24h. We cache the result, not the clickId — each call always produces a fresh `clickId` because each click is a distinct event.

**Where**: Cloudflare KV (new namespace `lyra-affiliate-cache`). KV is sufficient because the value is small (< 1KB) and the TTL is long. Supabase would also work but KV is cheaper at high QPS and closer to the edge.

**TTL**: `AFFILIATE_LINK_CACHE_TTL_SECONDS`, default 86400. Configurable so we can shorten in early testing.

**Invalidation**: not needed for v1. If a merchant program changes, the cache will roll over within 24h naturally.

## Failure modes

| Failure | Behaviour | User-visible? |
|---|---|---|
| Eligibility lookup fails (DB error) | Skip eligibility check; try Sovrn anyway | No |
| Sovrn 429 / 5xx | Return raw URL with `monetised:false`, log warning | No |
| Sovrn 4xx (bad URL, bad SubID) | Same; log error with details | No |
| Sovrn timeout (>300ms) | Same; log timeout metric | Slight latency hit, no error |
| Click log insert fails | Still return the URL; log critical error (we want to know but not break the user) | No |
| Cache write fails | Continue without cache; service degrades to one Sovrn call per request | No (until QPS hits Sovrn rate limit) |

Failure modes are observable in Sentry (KAN-104). Every degraded call increments a counter so we can alert on degradation rate (e.g. "Sovrn failure rate > 5% over 5 minutes → page").

## Latency budget

- Total budget: **<100ms p95**, **<300ms p99**.
- Breakdown:
  - Cache hit (target ≥80% hit rate after a warm period): <10ms.
  - Cache miss with Sovrn success: <250ms (Sovrn 300ms timeout - 50ms for our overhead).
  - Cache miss with Sovrn failure: <320ms (300ms timeout + log + write).
- The Affiliate Link Service is called inline on every recommendation render. The latency budget protects the recommender's overall p95 of <1.5s for a 5-item list.

## Click logging

Every call writes a row to `affiliate_clicks` (KAN-189 schema):
- `clickId` (PK)
- `created_at` (now)
- `session_id`, `user_id`, `recipient_id`, `recommendation_id` (from request)
- `merchant_id` (from eligibility lookup; `null` if unknown)
- `buyer_country`, `recipient_country` (from request)
- `provider` ("sovrn" / "amazon_direct" / "raw")
- `provider_subid` (the SubID we sent the provider; `null` for raw)
- `raw_url`, `monetised_url`
- Conversion fields (`converted_at`, `commission_*`) populated later by the reconciliation cron (KAN-195)

The write is **fire-and-forget** at the response level — the user gets their URL even if the DB write is slow. The write awaits in a non-blocking pattern but errors are logged, not surfaced.

## Security review

| Threat | Mitigation |
|---|---|
| API key exposure | `SOVRN_API_KEY` server-side only; never sent to the client bundle; verified by `grep` in `pr-checks.yml` (track follow-up in KAN-194 smoke tests). |
| PII in SubID | SubID is an opaque UUID. No user email, profile slug, or recipient name is ever in the SubID. |
| PII in raw URL | We log the raw merchant URL the recommender chose. This may contain product IDs, never user PII. We verify in unit tests that the URL doesn't contain `@` or `?email=`-shaped patterns before logging. |
| Open redirect via raw URL | The service only forwards URLs that came from the recommender (internal trust boundary). We do NOT accept arbitrary URLs from query strings or user input. |
| Sovrn-supplied URL is malicious | Sovrn-returned URLs are 302 redirects through their own domain. We never `<a href>` an untrusted attacker-controlled URL because the raw URL came from our recommender's own candidate pool. |
| Cache poisoning | KV writes are server-only with our worker's auth. No external write path. |
| Rate-limit DoS via the service | Per-IP rate limit on the endpoint that calls this service (the recommender API + MCP) is the right place to defend, not in the link service itself. Tracked in KAN-201 (MCP) and KAN-191 (web). |

## Architecture impact

- New module: `src/lib/affiliate/` in the Lyra web app.
  - `link-service.ts` — entry point, the `getAffiliateLink()` function above.
  - `providers/sovrn.ts` — Sovrn Link Optimizer client with timeout + telemetry.
  - `providers/raw.ts` — passthrough provider for un-monetisable URLs.
  - `merchant-detector.ts` — URL → canonical merchant_id mapping (small allowlist for MVP; grows from KAN-187 seed data).
- New env vars (all 4 envs):
  - `SOVRN_API_KEY` (provisioned in KAN-184).
  - `AFFILIATE_LINK_CACHE_TTL_SECONDS` (default 86400).
- New Cloudflare KV namespace: `lyra-affiliate-cache` (added via Wrangler in the same PR that wires the link service into the recommender — KAN-191).
- New Supabase table: `affiliate_clicks` (KAN-189 separate migration).
- Cross-cutting docs: this design doc, plus a one-liner in `ARCHITECTURE.md` pointing here.

## Tests required (when implementation tickets land)

- **Unit (KAN-191 / KAN-201)**:
  - `getAffiliateLink()` returns raw URL with `monetised:false` when eligibility check returns nothing.
  - `getAffiliateLink()` returns Sovrn URL when eligibility matches and Sovrn returns a usable link.
  - `getAffiliateLink()` falls back to raw on Sovrn timeout / 5xx / 4xx.
  - Click is logged on every code path (mocked DB).
  - SubID is opaque (UUID) and unique per call.
- **Functional (KAN-191)**:
  - End-to-end render: profile → recommender → link service → card renders with monetised href and Affiliate badge (KAN-192).
- **E2E (KAN-194 smoke monitor)**:
  - For each `(merchant × buyer_country)` in the top matrix, the returned URL redirects to the localised merchant.
- **Test integrity policy**: no Sovrn API key in tests. Sovrn client is dependency-injected and mocked.

## Acceptance criteria (this ticket — design only)

- [x] Contract defined with input + output types.
- [x] Provider chain explicit for MVP (Sovrn only).
- [x] Phase-2 evolution path (Amazon-direct branch) described non-breakingly.
- [x] Caching strategy + TTL set.
- [x] Failure modes + observability defined.
- [x] Latency budget set.
- [x] Threat model + mitigations stated.
- [ ] Reviewed and approved by Luisa.

## Cross-reference

| Ticket | What it does relative to this design |
|---|---|
| KAN-184 | Sovrn account + `SOVRN_API_KEY` provisioning |
| KAN-185 | Geo signals consumed by this service |
| KAN-186 | Recipient delivery country field (input to the service) |
| KAN-187 | Eligibility matrix this service reads |
| KAN-189 | Click logging schema this service writes to |
| KAN-190 | Eligibility filter that runs upstream and decides whether to call this service at all (related: see "open question" below) |
| KAN-191 | Web rendering — calls this service |
| KAN-194 | Smoke monitor — exercises this service across geo matrix |
| KAN-195 | Reporting — joins `affiliate_clicks` to Sovrn's report on SubID |
| KAN-196 | Phase-2 Amazon-direct branch |
| KAN-201 | MCP rendering — calls this service from the MCP server |

## Open question

**Where does the eligibility check live — in the recommender filter (KAN-190) or in this link service?** Both options work. Today's design has it in **both**: the recommender drops obviously ineligible merchants pre-render (so we don't even try to monetise them), and the link service does a second pass as a safety net (so a stale recommender cache can't surface a since-disabled merchant). This duplicates the lookup but keeps both layers independently correct. Confirm in PR review whether duplication or single-source is preferred.
