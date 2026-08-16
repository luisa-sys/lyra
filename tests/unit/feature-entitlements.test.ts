/**
 * KAN-309 follow-on: feature-entitlement registry precedence (pure).
 */
import {
  FEATURE_KEYS,
  FEATURE_CONFIG,
  isFeatureKey,
  resolveEntitlements,
} from '@/modules/features/registry';


describe('feature registry (KAN-309)', () => {
  it('isFeatureKey accepts known keys and rejects others', () => {
    for (const k of FEATURE_KEYS) expect(isFeatureKey(k)).toBe(true);
    expect(isFeatureKey('nope')).toBe(false);
    expect(isFeatureKey('')).toBe(false);
    expect(isFeatureKey('is_admin')).toBe(false);
  });

  it('the three owner-named beta features default OFF; uploads/discovery default ON', () => {
    expect(FEATURE_CONFIG.mcp.defaultEnabled).toBe(false);
    expect(FEATURE_CONFIG.convene.defaultEnabled).toBe(false);
    expect(FEATURE_CONFIG.paid_gift_links.defaultEnabled).toBe(false);
    expect(FEATURE_CONFIG.convene_paid_channels.defaultEnabled).toBe(false);
    expect(FEATURE_CONFIG.media_uploads.defaultEnabled).toBe(true);
    expect(FEATURE_CONFIG.discovery.defaultEnabled).toBe(true);
  });

  it('resolveEntitlements falls back to per-key defaults when no rows', () => {
    const map = resolveEntitlements([]);
    expect(map.convene).toBe(false);
    expect(map.media_uploads).toBe(true);
    expect(map.discovery).toBe(true);
  });

  it('an explicit row always wins over the default (both directions)', () => {
    const map = resolveEntitlements([
      { feature_key: 'convene', enabled: true }, // default off → on
      { feature_key: 'media_uploads', enabled: false }, // default on → off
    ]);
    expect(map.convene).toBe(true);
    expect(map.media_uploads).toBe(false);
    // untouched keys keep defaults
    expect(map.mcp).toBe(false);
    expect(map.discovery).toBe(true);
  });

  it('ignores unknown feature keys in rows', () => {
    const map = resolveEntitlements([
      { feature_key: 'totally_made_up', enabled: true },
    ]);
    expect(Object.keys(map).sort()).toEqual([...FEATURE_KEYS].sort());
  });
});

// The "media_uploads gate covers BOTH upload entrypoints" block that used to sit
// here was a source-text scan: it regexed files-actions.ts and actions.ts for
// `getMyFeatureEntitlements` and compared string indices to guess the gate
// preceded the upload. It has been replaced by tests/unit/media-uploads-gate.test.ts,
// which executes both actions with the entitlement revoked and asserts the
// refusal AND that storage was never reached — and, with it granted, that each
// action proceeds past the gate to fail at the next check, proving the refusal
// came from the gate. Both directions are mutation-proven. (KAN-414 F4,
// KAN-417 §8 group 2, founder sign-off 2026-07-30.)
