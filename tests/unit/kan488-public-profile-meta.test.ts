/**
 * KAN-488 — public profile metadata carries the smallest public subset
 * (spec v0.8 §1 "Never include hidden data in public HTML, metadata …").
 * Expected values are literals (CLAUDE.md failure mode 10).
 */
import { buildPublicProfileMeta } from '@/modules/public-profile/public-profile-meta';

const SITE = 'https://checklyra.com';

describe('KAN-488 buildPublicProfileMeta', () => {
  test('name, ID URL, headline and photo — nothing else', () => {
    const meta = buildPublicProfileMeta(
      {
        slug: 'alice',
        display_name: 'Alice Example',
        headline: 'Gardener and maker',
        avatar_url: 'https://cdn.example.com/alice.jpg',
      },
      SITE,
    );
    expect(meta).toEqual({
      title: 'Alice Example — Lyra',
      name: 'Alice Example',
      description: 'Gardener and maker',
      headline: 'Gardener and maker',
      url: 'https://checklyra.com/alice',
      image: 'https://cdn.example.com/alice.jpg',
    });
    const text = JSON.stringify(meta);
    expect(text).not.toContain('address');
    expect(text).not.toContain('GB');
  });

  test('extra row fields (intro, city, country) never leak into the output', () => {
    const row = {
      slug: 'alice',
      display_name: 'Alice Example',
      headline: null,
      avatar_url: null,
      bio_short: 'PRIVATE-INTRO-TEXT',
      city: 'Leeds',
      country: 'GB',
    };
    const meta = buildPublicProfileMeta(row, SITE);
    expect(JSON.stringify(meta)).not.toMatch(/PRIVATE-INTRO-TEXT|Leeds|GB/);
  });

  test('no headline: falls back to "<name>\'s Lyra profile"; blank headline counts as none', () => {
    for (const headline of [null, '   ']) {
      const meta = buildPublicProfileMeta(
        { slug: 'alice', display_name: 'Alice', headline, avatar_url: null },
        SITE,
      );
      expect(meta.description).toBe("Alice's Lyra profile");
      expect(meta.headline).toBeNull();
      expect(meta.image).toBeNull();
    }
  });

  test('a non-http(s) photo URL is dropped', () => {
    const meta = buildPublicProfileMeta(
      { slug: 'alice', display_name: 'Alice', headline: null, avatar_url: 'javascript:alert(1)' },
      SITE,
    );
    expect(meta.image).toBeNull();
  });
});
