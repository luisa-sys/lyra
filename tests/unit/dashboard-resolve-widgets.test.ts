/**
 * KAN-344 — onboarding-progress state resolver. Table-driven coverage of the
 * §5/§6 mapping: state derivation + the ordered, gated, non-dismissed widget set.
 */
import {
  resolveWidgets,
  resolveOnboardingState,
  isDismissible,
  EMPTY_TO_DRAFTED_THRESHOLD,
  type WidgetResolverInput,
  type WidgetId,
} from '@/lib/dashboard/resolve-widgets';

function input(overrides: Partial<WidgetResolverInput> = {}): WidgetResolverInput {
  return {
    isPublished: false,
    completionScore: 0,
    hasGifts: false,
    hasAffiliations: false,
    conveneEntitled: false,
    ...overrides,
  };
}
const ids = (r: { widgets: { id: WidgetId }[] }) => r.widgets.map((w) => w.id);

describe('KAN-344 resolveOnboardingState', () => {
  it('empty: unpublished + below the completion threshold', () => {
    expect(resolveOnboardingState({ isPublished: false, completionScore: EMPTY_TO_DRAFTED_THRESHOLD - 1, hasGifts: false, hasAffiliations: false })).toBe('empty');
  });
  it('drafted: unpublished + at/above the completion threshold', () => {
    expect(resolveOnboardingState({ isPublished: false, completionScore: EMPTY_TO_DRAFTED_THRESHOLD, hasGifts: false, hasAffiliations: false })).toBe('drafted');
  });
  it('published_activate: published but missing gifts or affiliations', () => {
    expect(resolveOnboardingState({ isPublished: true, completionScore: 100, hasGifts: false, hasAffiliations: true })).toBe('published_activate');
    expect(resolveOnboardingState({ isPublished: true, completionScore: 100, hasGifts: true, hasAffiliations: false })).toBe('published_activate');
  });
  it('published_grow: published with both gifts and affiliations', () => {
    expect(resolveOnboardingState({ isPublished: true, completionScore: 100, hasGifts: true, hasAffiliations: true })).toBe('published_grow');
  });
});

describe('KAN-344 resolveWidgets — widget sets per state', () => {
  it('empty → single W1 complete_profile', () => {
    const r = resolveWidgets(input({ completionScore: 10 }));
    expect(r.state).toBe('empty');
    expect(ids(r)).toEqual(['complete_profile']);
  });

  it('drafted → single W2 publish', () => {
    const r = resolveWidgets(input({ completionScore: 60 }));
    expect(r.state).toBe('drafted');
    expect(ids(r)).toEqual(['publish']);
  });

  it('published_activate, no gifts/affiliations → add_gifts, add_affiliations, share', () => {
    const r = resolveWidgets(input({ isPublished: true, completionScore: 100 }));
    expect(r.state).toBe('published_activate');
    expect(ids(r)).toEqual(['add_gifts', 'add_affiliations', 'share']);
    expect(r.widgets.map((w) => w.order)).toEqual([0, 1, 2]);
  });

  it('published_activate, has gifts only → add_affiliations, share (no add_gifts)', () => {
    const r = resolveWidgets(input({ isPublished: true, completionScore: 100, hasGifts: true }));
    expect(ids(r)).toEqual(['add_affiliations', 'share']);
  });

  it('published_grow → share only (no convene without entitlement)', () => {
    const r = resolveWidgets(input({ isPublished: true, completionScore: 100, hasGifts: true, hasAffiliations: true }));
    expect(r.state).toBe('published_grow');
    expect(ids(r)).toEqual(['share']);
  });

  it('published_grow + convene entitlement → share, convene', () => {
    const r = resolveWidgets(input({ isPublished: true, completionScore: 100, hasGifts: true, hasAffiliations: true, conveneEntitled: true }));
    expect(ids(r)).toEqual(['share', 'convene']);
  });
});

describe('KAN-344 dismissal', () => {
  it('a dismissed secondary widget is removed + order recompacts', () => {
    const r = resolveWidgets(input({ isPublished: true, completionScore: 100, dismissed: { add_gifts: true } }));
    expect(ids(r)).toEqual(['add_affiliations', 'share']);
    expect(r.widgets.map((w) => w.order)).toEqual([0, 1]);
  });

  it('W1 complete_profile is NOT dismissible (primary CTA survives a stale dismissal)', () => {
    expect(isDismissible('complete_profile')).toBe(false);
    const r = resolveWidgets(input({ completionScore: 10, dismissed: { complete_profile: true } as Record<WidgetId, boolean> }));
    expect(ids(r)).toEqual(['complete_profile']);
  });

  it('W2 publish is NOT dismissible', () => {
    expect(isDismissible('publish')).toBe(false);
  });

  it('secondary widgets ARE dismissible', () => {
    for (const id of ['add_gifts', 'add_affiliations', 'share', 'convene'] as WidgetId[]) {
      expect(isDismissible(id)).toBe(true);
    }
  });

  it('all secondary dismissed in grow → empty widget list (clean dashboard)', () => {
    const r = resolveWidgets(input({ isPublished: true, completionScore: 100, hasGifts: true, hasAffiliations: true, conveneEntitled: true, dismissed: { share: true, convene: true } }));
    expect(r.state).toBe('published_grow');
    expect(ids(r)).toEqual([]);
  });
});
