/**
 * KAN-326: feature tiers + the shared admin status/access/publish badge logic.
 */
import { userStatusBadge, accessBadge, publishBadge } from '@/app/admin/users/status-badges';
import {
  GA_FEATURE_KEYS,
  TEST_FEATURE_KEYS,
  FEATURE_KEYS,
  FEATURE_CONFIG,
} from '@/lib/features/registry';

describe('feature tiers', () => {
  it('GA = media_uploads + discovery; test = the opt-in set', () => {
    expect(new Set(GA_FEATURE_KEYS)).toEqual(new Set(['media_uploads', 'discovery']));
    expect(new Set(TEST_FEATURE_KEYS)).toEqual(
      new Set(['mcp', 'convene', 'paid_gift_links', 'convene_paid_channels']),
    );
  });

  it('every feature has a tier and the two tiers partition all keys', () => {
    for (const k of FEATURE_KEYS) {
      expect(['ga', 'test']).toContain(FEATURE_CONFIG[k].tier);
    }
    expect(GA_FEATURE_KEYS.length + TEST_FEATURE_KEYS.length).toBe(FEATURE_KEYS.length);
  });

  it('GA features default on, test features default off', () => {
    for (const k of GA_FEATURE_KEYS) expect(FEATURE_CONFIG[k].defaultEnabled).toBe(true);
    for (const k of TEST_FEATURE_KEYS) expect(FEATURE_CONFIG[k].defaultEnabled).toBe(false);
  });
});

describe('userStatusBadge (priority: suspended > admin > lifecycle)', () => {
  const base = { is_suspended: false, is_admin: false, user_status: 'live' as const };

  it('suspended wins over everything', () => {
    expect(userStatusBadge({ ...base, is_suspended: true, is_admin: true }).label).toBe('suspended');
  });

  it('admin wins over lifecycle when not suspended', () => {
    expect(userStatusBadge({ ...base, is_admin: true }).label).toBe('admin');
  });

  it('lifecycle otherwise', () => {
    expect(userStatusBadge({ ...base, user_status: 'live' }).label).toBe('live');
    expect(userStatusBadge({ ...base, user_status: 'waitlist' }).label).toBe('waitlist');
    expect(userStatusBadge({ ...base, user_status: 'not_applied' }).label).toBe('not applied');
  });
});

describe('accessBadge', () => {
  it('prod / beta', () => {
    expect(accessBadge('prod').label).toBe('prod');
    expect(accessBadge('beta').label).toBe('beta');
  });
});

describe('publishBadge (public > age check > private)', () => {
  it('published -> public regardless of age', () => {
    expect(publishBadge({ is_published: true, age_status: 'none' }, true).label).toBe('public');
  });

  it('unpublished + gate on + not passed -> age check', () => {
    expect(publishBadge({ is_published: false, age_status: 'none' }, true).label).toBe('age check');
    expect(publishBadge({ is_published: false, age_status: 'pending' }, true).label).toBe('age check');
  });

  it('unpublished + gate on + passed -> private', () => {
    expect(publishBadge({ is_published: false, age_status: 'passed' }, true).label).toBe('private');
  });

  it('unpublished + gate off -> private (age irrelevant)', () => {
    expect(publishBadge({ is_published: false, age_status: 'none' }, false).label).toBe('private');
  });
});
