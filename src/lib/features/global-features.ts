/**
 * KAN-408: the global (environment-scoped) feature-switch registry.
 *
 * These are the admin-managed master switches that turn a feature ON/OFF for
 * EVERY user in an environment. They sit ABOVE the per-user entitlement layer
 * (src/lib/features/registry.ts):
 *
 *   effective = existing env/credential gates          (unchanged, fail-closed)
 *             AND globalSwitch(environment, feature)     (THIS layer, default ON)
 *             AND perUserEntitlement(user, feature)      (unchanged; hidden+inert
 *                                                          when the global switch
 *                                                          is off)
 *
 * The AND with the global switch is what makes an off switch un-overridable per
 * user: a per-user grant is inert while the global switch is off, and the admin
 * per-user toggle is hidden.
 *
 * Plain module (NOT 'use server') so the constants / types / pure helper can be
 * imported by server components, server actions, the MCP-server mirror, and
 * tests alike (mirrors the BUGS-12 rule for the per-user registry).
 *
 * DEFAULT semantics are PER KEY (see `defaultEnabled`). Most features default
 * ON (a row is only written to turn one off), so shipping the table changes
 * nothing until an admin flips a switch. `age_verification` is the exception —
 * it defaults OFF, because develop's baseline (KAN-407) is an 18+
 * self-declaration with no provider check; turning the switch ON re-enables the
 * provider (Didit) age-verification gate for that environment.
 */

import type { FeatureKey } from './registry';

/**
 * The features that carry a global environment switch. NOTE this is a distinct
 * list from the per-user FEATURE_KEYS: `age_verification` has a global switch
 * but no per-user boolean entitlement (its per-user state is the `age_status`
 * enum), while `mcp` / `media_uploads` / `discovery` are per-user only for now.
 */
export const GLOBAL_FEATURE_KEYS = [
  'mcp',
  'convene',
  'paid_gift_links',
  'age_verification',
] as const;

export type GlobalFeatureKey = (typeof GLOBAL_FEATURE_KEYS)[number];

export interface GlobalFeatureConfig {
  key: GlobalFeatureKey;
  label: string;
  description: string;
  /**
   * Human-readable name of the env var / credential that must ALSO be present
   * for the feature to run at all. The global switch cannot enable a feature
   * whose credential is missing — it only ANDs on top. Shown in the admin UI.
   */
  envPrerequisite: string | null;
  /** Value returned by resolveGlobalSwitches when the feature has NO row. */
  defaultEnabled: boolean;
  /**
   * The per-user entitlement key this global switch fronts, if any. When the
   * global switch is off, the matching per-user toggle in /admin/users/[slug]
   * is hidden. `null` means there is no per-user boolean toggle to hide (age
   * verification hides its status-override section instead).
   */
  userFeatureKey: FeatureKey | null;
  /**
   * Security-sensitive: turning this OFF disables a safety/compliance control
   * (e.g. the 18+ age gate), so the admin UI requires an extra typed/confirm
   * step before the off-flip is submitted. Audited either way.
   */
  sensitive?: boolean;
}

export const GLOBAL_FEATURE_CONFIG: Record<GlobalFeatureKey, GlobalFeatureConfig> = {
  mcp: {
    key: 'mcp',
    label: 'MCP access',
    description: 'Administration of a user’s Lyra data via AI agents (MCP write tools).',
    // No env var gates MCP — the MCP server enforces per-user entitlement. When
    // this global switch is off the per-user toggle is hidden; MCP-server
    // enforcement of the global switch is the KAN-222 lockstep follow-up.
    envPrerequisite: null,
    defaultEnabled: true,
    userFeatureKey: 'mcp',
  },
  convene: {
    key: 'convene',
    label: 'Convene',
    description: 'AI-orchestrated gatherings (host GUI + agent tools + invites).',
    envPrerequisite: 'CONVENE_ENABLED',
    defaultEnabled: true,
    userFeatureKey: 'convene',
  },
  paid_gift_links: {
    key: 'paid_gift_links',
    label: 'Paid referrals',
    description: 'Monetised affiliate links on gift recommendations (Sovrn).',
    envPrerequisite: 'SOVRN_API_KEY',
    defaultEnabled: true,
    userFeatureKey: 'paid_gift_links',
  },
  age_verification: {
    key: 'age_verification',
    label: 'Age verification (provider check)',
    description:
      'OFF (default): 18+ self-declaration at sign-up only. ON: also require a provider (Didit) age check before publishing.',
    envPrerequisite: 'DIDIT_API_KEY',
    defaultEnabled: false, // baseline is self-declaration (KAN-407); provider is opt-in
    userFeatureKey: null,
    sensitive: true, // toggling changes a compliance control (Art. 9 provider check) — confirm required
  },
};

export function isGlobalFeatureKey(value: string): value is GlobalFeatureKey {
  return (GLOBAL_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Pure: merge DB switch rows onto the default-ON baseline to produce a full
 * key→enabled map for one environment. A row always wins over the default;
 * unknown keys are ignored. Kept pure (no I/O) so the precedence is directly
 * unit-testable — mirrors resolveEntitlements() for the per-user layer.
 */
export function resolveGlobalSwitches(
  rows: ReadonlyArray<{ feature_key: string; enabled: boolean }>,
): Record<GlobalFeatureKey, boolean> {
  const out = {} as Record<GlobalFeatureKey, boolean>;
  for (const k of GLOBAL_FEATURE_KEYS) out[k] = GLOBAL_FEATURE_CONFIG[k].defaultEnabled;
  for (const r of rows) {
    if (isGlobalFeatureKey(r.feature_key)) out[r.feature_key] = r.enabled;
  }
  return out;
}
