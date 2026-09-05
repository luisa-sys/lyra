/**
 * KAN-408: the global (environment-scoped) feature-switch registry + resolver.
 */
import {
  GLOBAL_FEATURE_KEYS,
  GLOBAL_FEATURE_CONFIG,
  isGlobalFeatureKey,
  resolveGlobalSwitches,
} from '@/modules/features/global-features';

describe('global feature registry (KAN-408)', () => {
  it('covers the current global features', () => {
    expect([...GLOBAL_FEATURE_KEYS].sort()).toEqual(
      ['age_verification', 'convene', 'mcp', 'paid_gift_links'].sort(),
    );
  });

  it('every key has a config entry with a matching key field', () => {
    for (const k of GLOBAL_FEATURE_KEYS) {
      expect(GLOBAL_FEATURE_CONFIG[k].key).toBe(k);
      expect(GLOBAL_FEATURE_CONFIG[k].label.length).toBeGreaterThan(0);
    }
  });

  it('maps mcp/convene/paid_gift_links to their per-user feature key; age has none', () => {
    expect(GLOBAL_FEATURE_CONFIG.mcp.userFeatureKey).toBe('mcp');
    expect(GLOBAL_FEATURE_CONFIG.convene.userFeatureKey).toBe('convene');
    expect(GLOBAL_FEATURE_CONFIG.paid_gift_links.userFeatureKey).toBe('paid_gift_links');
    expect(GLOBAL_FEATURE_CONFIG.age_verification.userFeatureKey).toBeNull();
  });

  it('age verification defaults OFF (self-declaration baseline); the rest default ON', () => {
    expect(GLOBAL_FEATURE_CONFIG.age_verification.defaultEnabled).toBe(false);
    expect(GLOBAL_FEATURE_CONFIG.mcp.defaultEnabled).toBe(true);
    expect(GLOBAL_FEATURE_CONFIG.convene.defaultEnabled).toBe(true);
    expect(GLOBAL_FEATURE_CONFIG.paid_gift_links.defaultEnabled).toBe(true);
  });

  it('age verification is flagged security-sensitive (confirm on toggle)', () => {
    expect(GLOBAL_FEATURE_CONFIG.age_verification.sensitive).toBe(true);
  });

  it('isGlobalFeatureKey guards against unknown keys', () => {
    expect(isGlobalFeatureKey('convene')).toBe(true);
    expect(isGlobalFeatureKey('mcp')).toBe(true); // now has a global switch too
    expect(isGlobalFeatureKey('media_uploads')).toBe(false); // per-user only, no global switch
    expect(isGlobalFeatureKey('hack')).toBe(false);
  });
});

describe('resolveGlobalSwitches (KAN-408) — per-key defaults', () => {
  it('no rows → per-key defaults (age OFF, the rest ON)', () => {
    expect(resolveGlobalSwitches([])).toEqual({
      mcp: true,
      convene: true,
      paid_gift_links: true,
      age_verification: false,
    });
  });

  it('an explicit enabled=false row wins over the default', () => {
    const map = resolveGlobalSwitches([{ feature_key: 'convene', enabled: false }]);
    expect(map.convene).toBe(false);
    expect(map.mcp).toBe(true); // untouched → still ON
    expect(map.paid_gift_links).toBe(true); // untouched → still ON
    expect(map.age_verification).toBe(false); // untouched → still default OFF
  });

  it('an explicit enabled=true row turns age verification ON', () => {
    expect(
      resolveGlobalSwitches([{ feature_key: 'age_verification', enabled: true }]).age_verification,
    ).toBe(true);
  });

  it('ignores keys with no global switch (e.g. per-user-only media_uploads)', () => {
    const map = resolveGlobalSwitches([{ feature_key: 'media_uploads', enabled: false }]);
    expect(map).toEqual({ mcp: true, convene: true, paid_gift_links: true, age_verification: false });
  });
});
