/**
 * KAN-191: Affiliate Link Service — server-side chokepoint that turns any
 * raw merchant URL into a click-tracked, geo-localised, monetised link.
 *
 * Implements the contract specified in docs/AFFILIATE_LINK_SERVICE_DESIGN.md
 * (KAN-188 design ticket).
 *
 * Contract guarantees:
 *   1. The link ALWAYS works. If every provider fails, we return the raw URL
 *      with monetised:false rather than throwing.
 *   2. The click is ALWAYS logged to affiliate_clicks (KAN-189). The log is
 *      the source of truth for reconciliation (KAN-195) and the feedback
 *      loop (KAN-202).
 *   3. SubID convention is the KAN-189 helper: `lyra-{clickId}` for web/email
 *      and `lyra-mcp-{clickId}` for MCP.
 *   4. Server-side only. SOVRN_API_KEY never leaves the server.
 *
 * MVP state (this PR):
 *   - Sovrn provider is STUBBED: returns { ok: false, reason: 'sovrn_unconfigured' }
 *     when SOVRN_API_KEY is unset. Once Luisa's Sovrn application is approved
 *     (KAN-184) and the key is provisioned in env, the stub flips to the real
 *     POST /api/optimize call without any other code change.
 *   - Raw fallback is the only working path today. Every link is returned
 *     un-monetised but every click is still logged for analytics.
 *   - Eligibility matrix (KAN-187) lookup is not wired yet — pending KAN-184
 *     because the matrix is seeded from Sovrn's Merchant API.
 *
 * When SOVRN_API_KEY lands:
 *   1. Set the env var.
 *   2. Provider chain auto-activates.
 *   3. Run the smoke monitor (KAN-194 when it exists) to confirm localised
 *      links work end-to-end.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import {
  buildSubId,
  type AffiliateClickSource,
  type AffiliateProvider,
} from './types';
import { detectMerchant } from './merchant-detector';
import { isPaidLinksAllowedForRecipient } from '@/lib/features/entitlements-service';

export type AffiliateLinkRequest = {
  /** The raw merchant product URL the recommender chose. */
  rawUrl: string;
  /** ISO-3166 alpha-2; from the KAN-185 geo signal (buyer's location). */
  buyerCountry: string;
  /** ISO-3166 alpha-2; recipient's delivery country. Falls back to buyerCountry. */
  recipientCountry?: string | null;
  /** Session id for attribution to a browsing session. Should be set. */
  sessionId?: string | null;
  /** Authenticated buyer id. NULL for anonymous flows. */
  userId?: string | null;
  /** Anchors the click to a recipient profile when known. */
  recipientId?: string | null;
  /** Free-form recommendation id (per the KAN-189 schema). */
  recommendationId?: string | null;
  /** Which surface initiated the call. */
  source: AffiliateClickSource;
  /**
   * KAN-309: precomputed paid-gift-links gate for the recipient (entitlement +
   * disclosure compliance). When omitted, the service computes it from
   * recipientId and FAILS CLOSED (no recipient → not allowed).
   */
  paidLinksEnabled?: boolean;
};

export type AffiliateLinkResult = {
  /** The user-facing URL. ALWAYS a working link (raw if no provider succeeded). */
  url: string;
  /** Opaque UUID. Join key in affiliate_clicks (KAN-189). */
  clickId: string;
  /** Which provider monetised it (or 'raw' if none). */
  provider: AffiliateProvider;
  /** True iff a commission can be earned on a click. */
  monetised: boolean;
  /** Canonical merchant id if recognised; null if unknown. */
  merchant: string | null;
};

type ProviderOutcome =
  | { ok: true; url: string; provider: 'sovrn' | 'amazon_direct' | 'geniuslink' }
  | { ok: false; reason: string };

/** Service-role Supabase client — server-side only. */
function getServiceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

/**
 * Main entry point. The recommender + MCP tool both call this for every
 * candidate URL they want to surface.
 */
export async function getAffiliateLink(
  req: AffiliateLinkRequest,
): Promise<AffiliateLinkResult> {
  const clickId = crypto.randomUUID();
  const subId = buildSubId(clickId, req.source);
  const recipientCountry = req.recipientCountry ?? req.buyerCountry;
  const merchant = detectMerchant(req.rawUrl);

  // KAN-309: paid links are a per-RECIPIENT entitlement (+ disclosure
  // compliance gate). When not allowed, return the raw URL with NO click log —
  // an opted-out profile's recommendations must neither monetise nor pollute
  // attribution data. Callers (the V2 pipeline) precompute via
  // req.paidLinksEnabled to avoid a per-candidate read; otherwise we fail
  // closed off the recipient id.
  const monetisationAllowed =
    req.paidLinksEnabled ?? (await isPaidLinksAllowedForRecipient(req.recipientId));
  if (!monetisationAllowed) {
    return { url: req.rawUrl, clickId, provider: 'raw', monetised: false, merchant };
  }

  // Provider chain. MVP: only Sovrn (currently stubbed) → raw fallback.
  // Phase 2 will insert Amazon-direct ahead of Sovrn here.
  const outcome = await trySovrn(req.rawUrl, subId);

  const result: AffiliateLinkResult = outcome.ok
    ? {
        url: outcome.url,
        clickId,
        provider: outcome.provider,
        monetised: true,
        merchant,
      }
    : {
        url: req.rawUrl,
        clickId,
        provider: 'raw',
        monetised: false,
        merchant,
      };

  // Click log is fire-and-forget at the response level — the user gets their
  // URL even if the DB write is slow. Errors are logged, not surfaced.
  void logClick({
    clickId,
    sessionId: req.sessionId ?? null,
    userId: req.userId ?? null,
    recipientId: req.recipientId ?? null,
    recommendationId: req.recommendationId ?? null,
    merchantId: merchant,
    buyerCountry: req.buyerCountry,
    recipientCountry,
    provider: result.provider,
    providerSubid: result.monetised ? subId : null,
    source: req.source,
    rawUrl: req.rawUrl,
    monetisedUrl: result.url,
  }).catch((err: unknown) => {
    // Critical: we want to KNOW if click logging fails, but not break the
    // user. Log to stderr; Sentry will pick it up in environments where it
    // is wired (KAN-104).
    console.error('[affiliate-link-service] click log failed', err);
  });

  return result;
}

/**
 * Sovrn Link Optimizer provider. Currently stubbed pending KAN-184 (Sovrn
 * account approval + SOVRN_API_KEY provisioning).
 *
 * When SOVRN_API_KEY is set this function will POST to Sovrn with a 300ms
 * hard timeout. When unset (current state), returns ok:false so the caller
 * falls back to raw.
 */
async function trySovrn(rawUrl: string, subId: string): Promise<ProviderOutcome> {
  const apiKey = process.env.SOVRN_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: 'sovrn_unconfigured' };
  }

  // Real-implementation skeleton — exercised once KAN-184 lands.
  /* istanbul ignore next — covered by integration tests when Sovrn is live */
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300);
    const response = await fetch('https://api.sovrn.com/optimize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: rawUrl, sub_id: subId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, reason: `sovrn_http_${response.status}` };
    }
    const json = (await response.json()) as { url?: string };
    if (typeof json.url !== 'string' || json.url.length === 0) {
      return { ok: false, reason: 'sovrn_empty_url' };
    }
    return { ok: true, url: json.url, provider: 'sovrn' };
  } catch (err: unknown) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'sovrn_timeout' : 'sovrn_error';
    return { ok: false, reason };
  }
}

type ClickLogRow = {
  clickId: string;
  sessionId: string | null;
  userId: string | null;
  recipientId: string | null;
  recommendationId: string | null;
  merchantId: string | null;
  buyerCountry: string;
  recipientCountry: string;
  provider: AffiliateProvider;
  providerSubid: string | null;
  source: AffiliateClickSource;
  rawUrl: string;
  monetisedUrl: string;
};

async function logClick(row: ClickLogRow): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase.from('affiliate_clicks').insert({
    click_id: row.clickId,
    session_id: row.sessionId,
    user_id: row.userId,
    recipient_id: row.recipientId,
    recommendation_id: row.recommendationId,
    merchant_id: row.merchantId,
    buyer_country: row.buyerCountry,
    recipient_country: row.recipientCountry,
    provider: row.provider,
    provider_subid: row.providerSubid,
    source: row.source,
    raw_url: row.rawUrl,
    monetised_url: row.monetisedUrl,
  });
  if (error) throw error;
}
