/**
 * KAN-309 / KAN-310: the two-axis access-model transition matrix is pure, so we
 * test it directly — every action's exact column changes, the audited action
 * string, and whether an approval email is appropriate.
 */
import {
  computeAccessTransition,
  isBulkAction,
  BULK_ACTIONS,
} from '@/app/admin/users/users-actions-shared';

const NOW = '2026-06-22T00:00:00.000Z';

// KAN-326 Phase C: the legacy state columns (access_stage, early_access,
// is_beta_eligible, beta_access_status) were dropped — computeAccessTransition
// must never write them again. user_status + access_tier are the sole truth.
const LEGACY_COLS = ['access_stage', 'early_access', 'is_beta_eligible', 'beta_access_status'] as const;
function expectNoLegacyCols(update: Record<string, unknown>) {
  for (const col of LEGACY_COLS) expect(update).not.toHaveProperty(col);
}

describe('computeAccessTransition (KAN-309 / KAN-326)', () => {
  it('enable_beta sets the new axes + approved-at, writes NO legacy cols, and emails', () => {
    const t = computeAccessTransition('enable_beta', { now: NOW });
    expect(t.update).toMatchObject({
      user_status: 'live',
      access_tier: 'beta',
      beta_approved_at: NOW,
    });
    expectNoLegacyCols(t.update);
    expect(t.moderationAction).toBe('enable_beta');
    expect(t.sendApprovalEmail).toBe(true);
  });

  it('disable_beta returns to waitlist, clears approval, NO legacy cols, no email', () => {
    const t = computeAccessTransition('disable_beta', { now: NOW });
    expect(t.update).toMatchObject({
      user_status: 'waitlist',
      access_tier: 'beta',
      beta_approved_at: null,
    });
    expectNoLegacyCols(t.update);
    expect(t.moderationAction).toBe('disable_beta');
    expect(t.sendApprovalEmail).toBe(false);
  });

  it('promote_live_with_beta → live/prod, NO legacy cols, emails', () => {
    const t = computeAccessTransition('promote_live_with_beta', { now: NOW });
    expect(t.update).toMatchObject({
      user_status: 'live',
      access_tier: 'prod',
    });
    expectNoLegacyCols(t.update);
    expect(t.moderationAction).toBe('promote_live');
    expect(t.sendApprovalEmail).toBe(true);
  });

  it('promote_live_no_beta → live/prod, NO legacy cols, no email', () => {
    const t = computeAccessTransition('promote_live_no_beta', { now: NOW });
    expect(t.update).toMatchObject({
      user_status: 'live',
      access_tier: 'prod',
    });
    expectNoLegacyCols(t.update);
    expect(t.moderationAction).toBe('promote_live');
    expect(t.sendApprovalEmail).toBe(false);
  });

  it('suspend uses reason + now and does NOT touch the access axes', () => {
    const t = computeAccessTransition('suspend', { now: NOW, reason: 'spam' });
    expect(t.update).toMatchObject({
      is_suspended: true,
      suspended_at: NOW,
      suspension_reason: 'spam',
    });
    expect(t.update.access_stage).toBeUndefined();
    expect(t.update.is_beta_eligible).toBeUndefined();
    expect(t.update.user_status).toBeUndefined();
    expect(t.update.access_tier).toBeUndefined();
    expect(t.moderationAction).toBe('suspend');
  });

  it('unsuspend clears the suspension fields only', () => {
    const t = computeAccessTransition('unsuspend', { now: NOW });
    expect(t.update).toMatchObject({
      is_suspended: false,
      suspended_at: null,
      suspension_reason: null,
    });
    expect(t.update.access_stage).toBeUndefined();
    expect(t.update.user_status).toBeUndefined();
    expect(t.update.access_tier).toBeUndefined();
    expect(t.moderationAction).toBe('unsuspend');
  });

  it('isBulkAction validates against the known set', () => {
    for (const a of BULK_ACTIONS) {
      expect(isBulkAction(a.value)).toBe(true);
    }
    expect(isBulkAction('grant_admin')).toBe(false);
    expect(isBulkAction('')).toBe(false);
    expect(isBulkAction('drop_table')).toBe(false);
  });

  it('only suspend requires a reason', () => {
    expect(BULK_ACTIONS.find((a) => a.value === 'suspend')?.requiresReason).toBe(true);
    expect(BULK_ACTIONS.filter((a) => a.requiresReason).map((a) => a.value)).toEqual(['suspend']);
  });
});
