/**
 * KAN-309 follow-on: the per-user feature-entitlement registry.
 *
 * Single source of truth for the feature keys the admin back-office can toggle
 * per user. Plain module (NOT 'use server') so the constants/types/pure helper
 * can be imported by server components, server actions, the MCP server (mirror),
 * and tests alike.
 *
 * Per-key `defaultEnabled` is what lets ONE table serve both:
 *   - "opt-in beta" features (default OFF — need an explicit grant): convene,
 *     paid_gift_links, mcp, convene_paid_channels
 *   - "default-on, admin-revocable" features (default ON — only a revoke writes
 *     a row): media_uploads, discovery
 *
 * The effective gate at every call site is ALWAYS: ENV_FLAG && isFeatureEnabled.
 * The per-env flag named in `envPrerequisite` stays the master kill-switch.
 */

export const FEATURE_KEYS = [
  'mcp',
  'convene',
  'paid_gift_links',
  'convene_paid_channels',
  'media_uploads',
  'discovery',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * KAN-326: every feature has a `tier`:
 *   - 'ga'   = generally available — ON for everyone, admin-revocable. Turning
 *              it off for a user shows a "features disabled" badge.
 *   - 'test' = experimental ("test features", was "beta features") — the opt-in
 *              set. Promoting a feature from 'test' to 'ga' makes it on-by-default
 *              while staying per-user revocable.
 */
export type FeatureTier = 'ga' | 'test';

export interface FeatureConfig {
  key: FeatureKey;
  label: string;
  description: string;
  /** Returned by isFeatureEnabled when the user has NO entitlement row. */
  defaultEnabled: boolean;
  /** GA (on for everyone, revocable) vs test (experimental opt-in). */
  tier: FeatureTier;
  /** Human-readable name of the per-env master switch, if any. */
  envPrerequisite: string | null;
}

export const FEATURE_CONFIG: Record<FeatureKey, FeatureConfig> = {
  mcp: {
    key: 'mcp',
    label: 'MCP access',
    description: 'AI-assistant write tools via the MCP server.',
    defaultEnabled: false, // backfilled true for existing API-key holders
    tier: 'test',
    envPrerequisite: null,
  },
  convene: {
    key: 'convene',
    label: 'Convene',
    description: 'AI-orchestrated gatherings (host GUI + agent tools).',
    defaultEnabled: false,
    tier: 'test',
    envPrerequisite: 'CONVENE_ENABLED',
  },
  paid_gift_links: {
    key: 'paid_gift_links',
    label: 'Paid gift links',
    description: "Monetised affiliate links on this profile's gift recommendations.",
    defaultEnabled: false,
    tier: 'test',
    envPrerequisite: 'SOVRN_API_KEY',
  },
  convene_paid_channels: {
    key: 'convene_paid_channels',
    label: 'Convene SMS / WhatsApp',
    description: 'Paid invite channels (SMS/WhatsApp) for Convene.',
    defaultEnabled: false,
    tier: 'test',
    envPrerequisite: 'CONVENE_ENABLED',
  },
  media_uploads: {
    key: 'media_uploads',
    label: 'Media uploads',
    description: 'Profile photo & file/media uploads.',
    defaultEnabled: true,
    tier: 'ga',
    envPrerequisite: null,
  },
  discovery: {
    key: 'discovery',
    label: 'Discovery',
    description: 'Be found by phone number / postcode.',
    defaultEnabled: true,
    tier: 'ga',
    envPrerequisite: null,
  },
};

/** GA features (on for everyone, revocable) and test features (experimental opt-in). */
export const GA_FEATURE_KEYS: FeatureKey[] = FEATURE_KEYS.filter(
  (k) => FEATURE_CONFIG[k].tier === 'ga',
);
export const TEST_FEATURE_KEYS: FeatureKey[] = FEATURE_KEYS.filter(
  (k) => FEATURE_CONFIG[k].tier === 'test',
);

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Pure: merge DB entitlement rows onto the per-key defaults to produce a full
 * key→enabled map. A row always wins over the default; unknown keys are ignored.
 * Kept pure (no I/O) so the precedence logic is directly unit-testable.
 */
export function resolveEntitlements(
  rows: ReadonlyArray<{ feature_key: string; enabled: boolean }>,
): Record<FeatureKey, boolean> {
  const out = {} as Record<FeatureKey, boolean>;
  for (const k of FEATURE_KEYS) out[k] = FEATURE_CONFIG[k].defaultEnabled;
  for (const r of rows) {
    if (isFeatureKey(r.feature_key)) out[r.feature_key] = r.enabled;
  }
  return out;
}
