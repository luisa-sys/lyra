import {
  computeProfileCompletion,
  COMPLETION_COMPONENTS,
  type ProfileCompletionInput,
} from '@/lib/dashboard/profile-completion';

const EMPTY: ProfileCompletionInput = {
  displayName: null,
  bioShort: null,
  headline: null,
  city: null,
  avatarUrl: null,
  hasGifts: false,
  hasAffiliations: false,
};

describe('KAN-349 computeProfileCompletion', () => {
  it('is 0 for a brand-new empty profile', () => {
    expect(computeProfileCompletion(EMPTY)).toBe(0);
  });

  it('the component weights sum to exactly 100', () => {
    expect(COMPLETION_COMPONENTS.reduce((s, c) => s + c.points, 0)).toBe(100);
  });

  it('a just-signed-up user (name only) is below the drafted threshold (40)', () => {
    const score = computeProfileCompletion({ ...EMPTY, displayName: 'Ben Stephens' });
    expect(score).toBe(20);
    expect(score).toBeLessThan(40); // stays "empty" → still shows Complete-profile
  });

  it('name + a short intro reaches the drafted threshold (40)', () => {
    const score = computeProfileCompletion({
      ...EMPTY,
      displayName: 'Ben',
      bioShort: 'I love a quiet morning.',
    });
    expect(score).toBe(40);
    expect(score).toBeGreaterThanOrEqual(40); // becomes "drafted" → shows Publish
  });

  it('counts the headline as the intro when bio_short is empty', () => {
    const withHeadline = computeProfileCompletion({ ...EMPTY, displayName: 'Ben', headline: 'Mum & coffee lover' });
    const withBio = computeProfileCompletion({ ...EMPTY, displayName: 'Ben', bioShort: 'Mum & coffee lover' });
    expect(withHeadline).toBe(withBio);
    expect(withHeadline).toBe(40);
  });

  it('is 100 when every component is filled', () => {
    expect(
      computeProfileCompletion({
        displayName: 'Ben',
        bioShort: 'intro',
        headline: 'headline',
        city: 'London',
        avatarUrl: 'https://x/y.jpg',
        hasGifts: true,
        hasAffiliations: true,
      }),
    ).toBe(100);
  });

  it('treats whitespace-only strings as empty', () => {
    expect(computeProfileCompletion({ ...EMPTY, displayName: '   ' })).toBe(0);
  });

  it('gifts and affiliations each contribute', () => {
    expect(computeProfileCompletion({ ...EMPTY, hasGifts: true })).toBe(15);
    expect(computeProfileCompletion({ ...EMPTY, hasAffiliations: true })).toBe(15);
    expect(computeProfileCompletion({ ...EMPTY, hasGifts: true, hasAffiliations: true })).toBe(30);
  });
});
