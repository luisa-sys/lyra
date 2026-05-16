/**
 * KAN-202: types + helpers for the recommendation_events feedback log.
 *
 * Keep enums aligned with the SQL check constraints in
 * supabase/migrations/20260516230000_recommendation_events.sql.
 *
 * Producers (future):
 *   - Web recommendation render — emits 'shown' (KAN-191)
 *   - Affiliate Link Service — emits 'clicked' (KAN-188)
 *   - Reconciliation cron — emits 'converted' (KAN-195)
 *   - Web recommendation card — emits 'thumbs_up' / 'thumbs_down' / 'hidden'
 *     (KAN-191)
 *   - MCP `lyra_record_feedback` — emits 'thumbs_up' / 'thumbs_down' (KAN-201,
 *     in the lyra-mcp-server repo)
 *
 * Consumers:
 *   - Nightly aggregation cron — computes per-merchant EPC + CTR
 *   - Admin dashboard — surfaces feedback signals (KAN-195)
 *   - Future learned ranker (V2.1 evolution in KAN-199)
 */

export const RECOMMENDATION_EVENT_TYPES = [
  'shown',
  'clicked',
  'converted',
  'thumbs_up',
  'thumbs_down',
  'hidden',
] as const;

export type RecommendationEventType =
  (typeof RECOMMENDATION_EVENT_TYPES)[number];

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(RECOMMENDATION_EVENT_TYPES);

export function isRecommendationEventType(
  value: unknown
): value is RecommendationEventType {
  return typeof value === 'string' && EVENT_TYPE_SET.has(value);
}

export type RecommendationEventSource = 'web' | 'mcp' | 'email';

const SOURCE_SET: ReadonlySet<string> = new Set(['web', 'mcp', 'email']);

export function isRecommendationEventSource(
  value: unknown
): value is RecommendationEventSource {
  return typeof value === 'string' && SOURCE_SET.has(value);
}

export type RecommendationEventRow = {
  event_id: string;
  created_at: string;
  recommendation_id: string;
  session_id: string | null;
  user_id: string | null;
  recipient_id: string | null;
  merchant_id: string | null;
  event_type: RecommendationEventType;
  source: RecommendationEventSource;
  metadata: Record<string, unknown>;
};

/**
 * Sanitise the free-form `metadata` JSONB before insert. The DB column is
 * `jsonb not null default '{}'` so we always return a fresh plain object.
 *
 * Rules:
 *   - Non-object / array / null input → empty object.
 *   - Keys must be non-empty strings (defence against prototype-pollution
 *     style keys like `__proto__`).
 *   - Values may be: string (length-capped 200), finite number, boolean.
 *     Anything else is dropped silently.
 *
 * NO PII: emails, phone numbers, full names should never appear in metadata.
 * The caller is responsible for not putting them in; this function is the
 * last-line defence shape-check, not a PII scrubber.
 */
export function sanitiseEventMetadata(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object') return {};
  if (Array.isArray(raw)) return {};

  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 64) continue;
    // Reject prototype-pollution attempts even though spreading into a fresh
    // object would protect downstream consumers.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;

    if (typeof value === 'string') {
      out[key] = value.slice(0, 200);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
    // Skip everything else (objects, arrays, null, undefined, functions).
  }

  return out;
}
