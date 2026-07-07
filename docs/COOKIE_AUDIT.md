# Cookie audit (KAN-193)

> Enumerates every cookie set on a Lyra visitor's browser, who sets it, on which domain, what changes (if anything) when affiliate links land. This is the canonical reference for the public `/cookies` and `/privacy` pages — keep it in sync when behaviour changes.

Last audit: 2026-05-16. Reconciled 2026-07-03 (SEC-72 — analytics now consent-gated).

## Cookies set on `*.checklyra.com`

All current cookies are **strictly necessary** under UK GDPR / PECR. No consent is required for these because the user cannot expect the site to work without them.

> **Analytics gating (SEC-72).** Vercel Analytics + Speed Insights are cookieless (no storage/access of information on the visitor's device — see the row below), so PECR Reg. 6 does not strictly require prior consent for them. Even so, Lyra treats analytics as **non-essential** and runs it **only after the visitor chooses "Accept all"** on the consent banner. "Essential only" (decline), or making no choice, keeps analytics off. The gate lives in `src/app/consented-analytics.tsx` (decision in `src/app/consent-state.ts`); the banner writes the choice in `src/app/cookie-consent.tsx`. This makes the banner's two buttons functional and keeps the privacy policy's "opt out of analytics via the cookie consent banner" claim honest.

| Cookie | Set by | Purpose | Duration | Category |
|---|---|---|---|---|
| `sb-*-auth-token` | Supabase Auth (via `@supabase/ssr`, server-side on sign-in) | Keeps the user signed in | Session / up to 7 days (refresh-token TTL) | Essential |
| `sb-*-auth-token-code-verifier` | Supabase Auth (server-side during the OAuth flow) | CSRF protection for OAuth sign-in (e.g. Google) | Session | Essential |
| `__cf_bm` | Cloudflare (edge) | Bot detection | 30 minutes | Essential — set by Cloudflare for all `*.checklyra.com` traffic |

Not set by Lyra:
- No analytics cookies. Vercel Analytics is the only analytics provider; it collects anonymised page views **without setting a cookie** (see [Vercel docs](https://vercel.com/docs/concepts/analytics/privacy-policy)).
- No marketing cookies.
- No targeting cookies.
- No A/B-testing cookies.
- No third-party fingerprinting.

## What changes when an affiliate link is clicked

**Nothing on the `*.checklyra.com` domain.** The Affiliate Link Service (KAN-188 / KAN-191) generates a URL that points at the affiliate network's redirect domain (Sovrn's `redirect.sovrn.com` once live) or directly at the retailer (when the merchant isn't covered by the network). The user's browser follows the redirect; cookies are set by:

1. **The affiliate network's redirect domain** (Sovrn) — sets its own cookies on `sovrn.com`-derived domains for click attribution. Governed by [Sovrn's privacy policy](https://www.sovrn.com/legal/privacy-policy/). Lyra has no control over these.
2. **The destination retailer** — sets its own cookies on its own domain. Same as any other outbound link the user might click.

None of these cookies are set on `*.checklyra.com`. The Sovrn cookie does not allow `checklyra.com` to be tracked or fingerprinted; it allows Sovrn to attribute a future purchase back to the click for commission purposes only.

## Internal click log — server-side, no cookie

For internal analytics (per-merchant EPC, monthly reconciliation against Sovrn's report — KAN-195), Lyra logs every affiliate-link generation event to the `affiliate_clicks` table in Supabase (KAN-189 schema). The record contains:

- `click_id` (opaque UUID; no user identifier)
- `session_id` (server-side, derived from the existing essential auth cookie if the user is signed in; null for anonymous browsing)
- `recipient_id` (the profile being viewed; nullable for landing-page clicks)
- `buyer_country` / `recipient_country` (ISO-2 codes; derived from Cloudflare `CF-IPCountry` header which is request-only, never stored as IP)
- `raw_url`, `monetised_url`, `provider`, `merchant_id`

**No new cookie is set by this logging.** The session id (when present) re-uses the existing essential auth cookie value. Anonymous browsers produce rows with null `session_id`.

## Decisions arising from this audit

1. **No cookie consent banner change required *for affiliate-link clicks*.** All *cookies* are essential and the affiliate cookie boundary is at Sovrn's domain, not ours, so no new opt-in mechanic is needed for clicks. (Separately, SEC-72 later made the existing banner's analytics choice functional — see the "Analytics gating" note above. That did not add a cookie; it gated the cookieless Vercel Analytics behind explicit accept.)
2. **No "Marketing / Affiliate" category in the consent UI.** Earlier drafts of KAN-193 considered adding one — confirmed unnecessary because Lyra sets no marketing/affiliate cookies on its own domain.
3. **Privacy policy updated** (this PR) to explicitly disclose Sovrn as an affiliate partner, what data they receive when a user clicks, and the legitimate-interest lawful basis.
4. **Cookie policy updated** (this PR) to add an "Affiliate links" section pointing out that the cookies are set off-domain, not by us, with links to Sovrn's and the retailer's policies.
5. **Sovrn DPA**: should be signed during Sovrn onboarding (KAN-184). Confirm it's in the signed-contracts folder before going live; if not, raise with Sovrn before flipping the SOVRN_API_KEY on.

## When this audit needs to be re-run

- Adding any new affiliate network (e.g. KAN-196 phase 2 brings Amazon direct + possibly Geniuslink — both would route via their own redirect domains, no cookie change on our side, but re-audit when activated).
- Adding any analytics provider that uses cookies (would require a consent banner update).
- Adding any first-party Lyra cookie used for tracking or behavioural data (none planned).
- Significant change to the auth flow (e.g. swapping out Supabase Auth).

## References

- UK ICO guidance on cookies: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/online/cookies-and-similar-technologies/>
- PECR Regulation 6 (cookies & similar): <https://www.legislation.gov.uk/uksi/2003/2426/regulation/6>
- Public-facing Lyra cookie policy: `src/app/(legal)/cookies/page.tsx`
- Public-facing Lyra privacy policy: `src/app/(legal)/privacy/page.tsx`
- Affiliate-partners disclosure: `src/app/(legal)/partners/page.tsx` (KAN-184)
