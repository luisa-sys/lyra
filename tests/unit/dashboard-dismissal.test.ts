/**
 * KAN-345 — dashboard widget dismissal helpers: re-surface on state change.
 */
import { dismissedForState, withDismissal, type DashboardWidgetState } from '@/lib/dashboard/dismissal';

describe('KAN-345 dismissal helpers', () => {
  it('withDismissal records the widget with the current state + timestamp', () => {
    const next = withDismissal({}, 'share', 'published_grow', '2026-06-30T00:00:00Z');
    expect(next.share).toEqual({ dismissed_at: '2026-06-30T00:00:00Z', state: 'published_grow' });
  });

  it('withDismissal merges without clobbering other widgets', () => {
    const start: DashboardWidgetState = { share: { dismissed_at: 't1', state: 'published_grow' } };
    const next = withDismissal(start, 'convene', 'published_grow', 't2');
    expect(Object.keys(next).sort()).toEqual(['convene', 'share']);
  });

  it('dismissedForState marks a widget dismissed only IN the state it was dismissed', () => {
    const stored: DashboardWidgetState = { add_gifts: { dismissed_at: 't', state: 'published_activate' } };
    expect(dismissedForState(stored, 'published_activate')).toEqual({ add_gifts: true });
  });

  it('a widget re-surfaces when the state changes (different state → not dismissed)', () => {
    const stored: DashboardWidgetState = { share: { dismissed_at: 't', state: 'published_activate' } };
    expect(dismissedForState(stored, 'published_grow')).toEqual({});
  });

  it('null/empty store → nothing dismissed', () => {
    expect(dismissedForState(null, 'empty')).toEqual({});
    expect(dismissedForState({}, 'drafted')).toEqual({});
  });
});
