# Geo-signal design — buyer location + recipient delivery country (KAN-185)

> The recommendation engine and the affiliate link service both need to know two different geographies for every recommendation: **where the buyer is** (drives which affiliate program receives the commission) and **where the recipient is** (drives which products are eligible to recommend, because shipping rules differ per merchant per country). This document locks the data flow and precedence rules ahead of implementation in KAN-186, KAN-188, KAN-190, KAN-198, KAN-201.

## The two signals

| Signal | Source | Purpose | Used by |
|---|---|---|---|
| **Buyer country** (ISO-3166 alpha-2) | (1) Cloudflare `CF-IPCountry` header on the request, (2) cached for the session, (3) user account-level override in Settings | Decides which affiliate program (Amazon UK vs Amazon US, Sovrn region) the commission attributes to | Affiliate Link Service (KAN-188), eligibility filter (KAN-190), MCP tool inputs (KAN-201) |
| **Recipient delivery country** (ISO-3166 alpha-2) | New nullable field `recipients.delivery_country_code` on the recipient profile (KAN-186) | Decides which products are eligible to recommend, by filtering out merchants that don't ship to the recipient's country | Recommender input audit (KAN-198), eligibility filter (KAN-190) |

These are **separate fields with different lifetimes**: buyer country can change per session (a UK buyer travelling in the US still gets attributed to UK Amazon, by default); recipient country only changes when the user explicitly edits the recipient profile.

## Detection precedence — buyer country

1. **Explicit user setting**, if present on the authenticated user's account (`users.country_code_override`). Stable across sessions. Highest priority because a user might be travelling and want commission to still route via their home country.
2. **Cloudflare `CF-IPCountry` request header** (set by Cloudflare on every request to `*.checklyra.com`). 99%+ accurate for non-VPN traffic. Captured at the edge, attached to the session.
3. **Session-cached value** from a previous request in the same session — avoids re-checking on every navigation.
4. **Fallback: `GB`** (Lyra's primary market). Logged as a low-confidence detection.

The detected value is cached on the session for 24h and is overwritten only when the user signs out or explicitly changes their country in Settings.

### Why not the IP geolocation lookup directly?
We deliberately do not retain raw IP addresses or use a paid geolocation service. Cloudflare's `CF-IPCountry` is already supplied for free on every request, derived at the edge from MaxMind data. We trust it as our only IP-derived signal and never see the underlying IP outside the request lifecycle.

## Recipient delivery country

- Stored as `recipients.delivery_country_code` (KAN-186 migration).
- Nullable. NULL means **"unknown — fall back to buyer country"** at query time.
- Editable in the recipient/profile edit UI. Defaults to the buyer's detected country when first creating a recipient profile, so the buyer can leave it untouched in the common case (buyer and recipient in the same country).
- Exposed via the existing MCP tool `lyra_update_profile` (additive parameter).
- Used as a hard filter against the country × merchant eligibility matrix (KAN-187): if the recipient is in DE, we will not surface a merchant whose only eligible storefront is the UK.

## Precedence rules (which signal applies where)

| Decision | Signal used | Reason |
|---|---|---|
| Which affiliate program receives the click | **Buyer country** | Commission must be attributed to the program that matches the buyer's domicile; cross-country attribution breaks the affiliate ToS. |
| Which products are surfaced as candidates | **Recipient delivery country** (falls back to buyer country when NULL) | Shipping eligibility is a recipient-side concern. |
| Which Amazon storefront the link points at (Phase 2) | **Recipient delivery country** at the link level, **buyer country** at the program level (Earn Globally) | Once Amazon direct is live, Earn Globally lets a UK Associates tag earn on DE / FR / IT / ES orders — so the storefront follows the recipient while the program follows the buyer. |
| Currency shown in the UI | **Buyer country** (default) with explicit override on the recommendation request | Buyers think in their own currency by default. |

## Edge cases

| Case | Handling |
|---|---|
| **Buyer in US, recipient in UK** | Affiliate link routes via Sovrn's US-eligible program for the buyer; recommender filters to merchants that ship to UK; UI shows GBP price (recipient currency? buyer currency?). _Decision: show buyer's currency in the UI; show the destination currency in the rationale string._ |
| **Recipient delivery country NULL** | Treat as "same as buyer". Recommender uses buyer country for the eligibility filter. Logged so we can prompt the user to fill it in. |
| **Buyer in unsupported country** (e.g. Brazil pre-Phase 2) | Recommender returns concepts (V1) but no monetised products. UI shows recommendations with no affiliate links, explanatory copy "Affiliate links not yet available in your region". |
| **Buyer using a VPN** | We use whatever country `CF-IPCountry` reports. If the user wants to override, they can in Settings. We do not attempt to detect VPN/proxy use. |
| **Embedded WebView (mobile app, KAN-69) without Cloudflare** | If the request reaches us via a path that bypasses Cloudflare, the header is missing. We treat missing as `GB` (logged) and rely on the user's account-level override. |
| **MCP server invocation** | The MCP server today exposes `lyra_recommend_gifts` as a **public** read tool (no auth, per `docs/ARCHITECTURE.md`). The buyer's identity is therefore unknown at MCP-call time, and `CF-IPCountry` reflects the AI assistant's egress IP, not the end-user's. **Resolution**: KAN-201 makes `lyra_recommend_gifts` an authenticated tool (via the existing MCP OAuth flow, KAN-88) so the server can identify the buyer and look up their stored country preference. Until KAN-88 + KAN-201 ship, MCP recommendations default to GB and a top-level note in the response asks the assistant to confirm the buyer's country. |

## Privacy & GDPR / UK GDPR / PECR

- **No PII is created by this design.** `CF-IPCountry` is derived from the IP at the edge and is not user-identifying.
- Raw IP addresses are never persisted by application code. They appear in Cloudflare logs (retained per Cloudflare's policy) but not in our Supabase tables.
- The buyer country override stored on the user account (`users.country_code_override`) is a single ISO-2 code, set explicitly by the user. Low-sensitivity.
- The recipient delivery country (`recipients.delivery_country_code`) is set by the buyer for the recipient. Treated with the same RLS as other recipient fields (owner + viewers-with-link).
- **Lawful basis** under UK GDPR Art. 6(1)(f) legitimate interest: detecting buyer country to route commission to the correct affiliate program is necessary to operate the monetisation product the buyer is using. Documented in the affiliate-partners section of the privacy policy (KAN-193).
- **No cookie required** for buyer-country detection — `CF-IPCountry` is a request header, not a stored cookie. Means no PECR consent burden for this specific signal.
- Privacy policy (KAN-193) is updated to disclose that we use the Cloudflare-supplied country code to route affiliate commission and filter recommendations.

## Affiliate-tooling implications

- **Eligibility matrix** (KAN-187) is keyed on `(merchant_id, country_code)` with the country always being the **buyer's** country at the program level. Recipient country is used as a secondary filter on shipping.
- **Affiliate Link Service** (KAN-188) takes both signals as inputs and is responsible for resolving them into a final, monetised URL.
- **Click log** (KAN-189) records both `buyer_country` and `recipient_country` per click so reporting (KAN-195) can break commission down by either axis.
- **Smoke monitor** (KAN-194) iterates over `(merchant_id × buyer_country)` and spoofs `Accept-Language` + `CF-IPCountry` headers to verify localisation. Recipient country is also exercised in a smaller cross-country matrix.

## Implementation summary (no code in this ticket)

| Ticket | Reads buyer country | Reads recipient country |
|---|---|---|
| KAN-186 — recipient profile field | — | adds the field |
| KAN-187 — eligibility matrix seed | (key) | (used by KAN-190 for shipping filter) |
| KAN-188 — link service design | input parameter | input parameter |
| KAN-189 — click log schema | column `buyer_country` | column `recipient_country` |
| KAN-190 — recommender eligibility filter | hard filter | hard filter |
| KAN-191 — link rendering | request param | request param |
| KAN-194 — smoke monitor | iterates | iterates secondary axis |
| KAN-195 — reporting | break-down dimension | break-down dimension |
| KAN-201 — MCP `lyra_recommend_gifts` | from authenticated user | from authenticated user's named recipient |

## Open questions (resolve when ticket activates)

1. **User-account-level override UX**: where to put the "country" Setting? Current account page does not have a country field. Suggested under Account → Region. Tracked when implementation starts.
2. **Currency display in UI** when buyer and recipient diverge: confirm the rule above ("buyer currency in card; destination currency in rationale") with Luisa before KAN-191 lands.
3. **Mobile app (KAN-69) handling**: confirm the mobile app routes API calls through `checklyra.com` (so `CF-IPCountry` is present) and not directly to Supabase.

## Acceptance for KAN-185

- [x] Two signals defined with sources, lifetimes, and use sites.
- [x] Buyer-country detection precedence locked.
- [x] Edge cases enumerated.
- [x] GDPR / PECR position stated.
- [x] Downstream-ticket inputs spelled out.
- [ ] Reviewed and approved by Luisa (in PR review).
