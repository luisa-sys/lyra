/**
 * KAN-309 follow-on: feature-entitlement registry precedence (pure).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FEATURE_KEYS,
  FEATURE_CONFIG,
  isFeatureKey,
  resolveEntitlements,
} from '@/lib/features/registry';

const ROOT = resolve(__dirname, '../..');

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

describe('media_uploads gate covers BOTH upload entrypoints (KAN-309)', () => {
  // media_uploads is scoped to "Profile photo & file/media uploads". Both the
  // file uploader AND the avatar uploader must check it, or an admin's revoke
  // is only partially effective.
  it('uploadProfileFile gates on media_uploads', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/dashboard/profile/files-actions.ts'), 'utf-8');
    expect(src).toMatch(/getMyFeatureEntitlements/);
    expect(src).toMatch(/media_uploads/);
  });
  it('uploadAvatar gates on media_uploads', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/dashboard/profile/actions.ts'), 'utf-8');
    // the gate must appear inside uploadAvatar, before the storage upload
    const fn = src.slice(src.indexOf('export async function uploadAvatar'));
    const gateIdx = fn.indexOf('features.media_uploads');
    const uploadIdx = fn.indexOf("storage\n");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(fn).toMatch(/getMyFeatureEntitlements/);
    // gate precedes the profile-photos upload call
    expect(gateIdx).toBeLessThan(fn.indexOf("from('profile-photos')"));
    void uploadIdx;
  });
});
