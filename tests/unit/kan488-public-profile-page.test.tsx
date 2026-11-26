/**
 * KAN-488 — the public profile page, rendered end to end (spec v0.8 §1, §2
 * 01–10, §3, §4 "Developer acceptance tests").
 *
 * The real `src/app/[slug]/page.tsx` is awaited and rendered with
 * `renderToStaticMarkup`; only the Supabase clients, Next's link/image/
 * notFound and Sentry are stood in for. The service client is the
 * per-statement mock whose fixture rows are filtered by each statement's own
 * `.eq()` / `.in()` calls, so a filter dropped from the loader lets the
 * secret row into the HTML.
 *
 * Every expected value is a literal written here (CLAUDE.md failure mode 10).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

const mockState: {
  rows: Record<string, Array<Record<string, unknown>>>;
  viewerId: string | null;
} = { rows: {}, viewerId: null };

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, className }: { href: unknown; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href: String(href), className }, children),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt?: string; src: unknown }) => React.createElement('img', { alt, src: String(src) }),
}));
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
jest.mock('@/modules/platform/env', () => ({ env: { siteUrl: () => 'https://checklyra.com' } }));
jest.mock('@/modules/platform/supabase-service', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  const harness = require('../support/supabase-statement-mock');
  return {
    createServiceRoleClient: () =>
      harness.createStatementMockClient({ getUserId: () => null, rows: (t: string) => mockState.rows[t] }),
  };
});
jest.mock('@/modules/platform/supabase-server', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  const harness = require('../support/supabase-statement-mock');
  return {
    createClient: async () => harness.createStatementMockClient({ getUserId: () => mockState.viewerId }),
  };
});

import Page, { generateMetadata } from '@/app/[slug]/page';
import { stripHtml } from '@/modules/guards/sanitise';
import { statementLog, onlyStatement } from '../support/supabase-statement-mock';
import { aliceProfileRow, aliceRows, SECRET_TOKENS } from '../support/kan488-public-profile-fixture';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function render(): Promise<string> {
  return renderToStaticMarkup(await Page(params('alice')));
}

// Tag stripping reuses the loop-until-stable stripHtml, and entities are
// decoded in ONE pass so "&amp;quot;" can never become '"' (CodeQL
// js/incomplete-multi-character-sanitization, js/double-escaping).
const ENTITIES: Record<string, string> = { '&amp;': '&', '&#x27;': "'", '&quot;': '"' };
function decode(s: string): string {
  return stripHtml(s).replace(/&amp;|&#x27;|&quot;/g, (e) => ENTITIES[e]).trim();
}

function h2Texts(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => decode(m[1]));
}

function jsonLd(html: string): unknown {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse((m as RegExpMatchArray)[1]);
}

beforeEach(() => {
  statementLog.reset();
  mockState.rows = aliceRows();
  mockState.viewerId = null;
});

describe('KAN-488 page — sections', () => {
  test('h2 headings are the v0.8 section labels, in spec order, with no emoji', async () => {
    expect(h2Texts(await render())).toEqual([
      'Where you might know me from',
      'Gifts: Things I love, can’t get enough of, or have been dreaming about',
      'Things that aren’t really for me',
      'To understand me a little better',
      'A few of my favourite things',
      'Tips & life hacks I can share',
      'Problems I’m trying to solve — ideas welcome',
      'Random Questions & Answers',
      'Billboard',
    ]);
  });

  test('About content: name, @ID, headline, city + country name, intro with breaks, causes, proud of', async () => {
    const html = await render();
    expect(html).toContain('<h1');
    expect(html).toContain('>Alice Example</h1>');
    expect(html).toContain('@alice');
    expect(html).toContain('Gardener and maker');
    expect(html).toContain('Leeds, United Kingdom');
    expect(html).toMatch(/whitespace-pre-line">Hello there\.\nI grow tomatoes\.</);
    expect(html).toContain('Causes close to my heart');
    expect(html).toContain('Clean rivers');
    expect(html).toContain('Things I’m proud of');
    expect(html).toContain('Ran a marathon');
    // KAN-488 review (minor 7): the photo is decorative — the name is the h1
    // right after it. Was: alt="Alice Example" (announced the name twice).
    expect(html).toContain('src="https://cdn.example.com/alice.jpg" alt=""');
    expect(html).not.toContain('alt="Alice Example"');
  });

  test('the brand-bar <nav> sits outside <main>, before it', async () => {
    const html = await render();
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    expect(main).not.toBeNull();
    expect(main![1]).not.toContain('<nav');
    expect(html.indexOf('aria-label="Profile navigation"')).toBeGreaterThan(-1);
    expect(html.indexOf('</nav>')).toBeLessThan(html.indexOf('<main'));
    expect(main![1]).toContain('>Alice Example</h1>');
  });

  test('"AI suggested" appears exactly once, with the approved AI gift under it', async () => {
    const html = await render();
    expect(html.match(/AI suggested/g)).toHaveLength(1);
    expect(html.indexOf('AI suggested')).toBeLessThan(html.indexOf('Kite kit'));
    expect(html.indexOf('Pottery class')).toBeLessThan(html.indexOf('AI suggested'));
  });

  test('no "AI suggested" group when there is no approved AI gift', async () => {
    mockState.rows = aliceRows();
    mockState.rows.profile_items = mockState.rows.profile_items.filter((r) => r.id !== 'i-ai-ok');
    const html = await render();
    expect(html).not.toContain('AI suggested');
    expect(html).toContain('Pottery class');
  });

  test('billboard keeps its line break inside a whitespace-pre-line element', async () => {
    const html = await render();
    expect(html).toMatch(/<p class="[^"]*whitespace-pre-line[^"]*">Be kind\nShip it<\/p>/);
  });

  test('answers, gift preference and understand text keep their line breaks', async () => {
    const html = await render();
    expect(html).toMatch(/whitespace-pre-line[^"]*">A good pen\nand paper</);
    expect(html).toMatch(/whitespace-pre-line[^"]*">Surprises welcome\.\nSize M\.</);
    expect(html).toMatch(/whitespace-pre-line[^"]*">Loves tea\nand cake</);
    expect(html).toContain('Who you’d invite for a dinner party, dead or alive?');
  });

  test('links: validated http(s) only, new tab with noopener noreferrer; javascript: never rendered', async () => {
    const html = await render();
    expect(html).toContain(
      'href="https://pottery.example.com/classes" target="_blank" rel="noopener noreferrer"',
    );
    expect(html).toContain('Middlemarch');
    expect(html).not.toContain('javascript:');
  });

  test('every completed v0.8 entry in the fixture renders', async () => {
    const html = await render();
    for (const title of [
      'Clean rivers',
      'Ran a marathon',
      'Pottery class',
      'Kite kit',
      'Perfume',
      'Stay curious',
      'Middlemarch',
      'Batch cooking',
      'Finding a plumber',
      'Hillside Choir',
      'Ada Lovelace',
      'Favourite tool?',
    ]) {
      expect(html).toContain(title);
    }
  });

  test('an empty profile renders only the About content', async () => {
    mockState.rows = aliceRows({
      public_profiles: [
        aliceProfileRow({ headline: null, bio_short: null, city: null, country: null, gift_voucher_hint: null, billboard: null }),
      ],
      profile_items: [],
      school_affiliations: [],
      profile_manual_of_me: [],
      profile_conversation_starters: [],
    });
    const html = await render();
    expect(h2Texts(html)).toEqual([]);
    expect(html).toContain('>Alice Example</h1>');
    expect(html).toContain('@alice');
  });
});

describe('KAN-488 page — nothing hidden reaches the page', () => {
  test('HTML (including JSON-LD) contains no hidden affiliation, unapproved AI, legacy or members-only token', async () => {
    const html = await render();
    for (const token of SECRET_TOKENS) expect(html).not.toContain(token);
    expect(html).toContain('Hillside Choir');
    expect(html).toContain('Batch cooking');
  });

  test('a signed-in visitor sees the members-only tip (and still no other secret)', async () => {
    mockState.viewerId = 'u-visitor';
    const html = await render();
    expect(html).toContain('MEMBERS-ONLY-TIP');
    expect(html).not.toContain('SECRET-AI-GIFT');
    expect(html).not.toContain('SECRET-SCHOOL');
    expect(html).not.toContain('LEGACY-DISLIKE');
  });

  test('no recommendations block, affiliate links, forms or contact links', async () => {
    const html = await render();
    for (const s of ['Matches interests', 'Gift ideas based on', '/partners', 'sponsored', '<form', 'mailto:', 'tel:']) {
      expect(html).not.toContain(s);
    }
  });

  test('hidden rows are filtered in the page reads, not only at render', async () => {
    // Defence in depth: the view model also drops unapproved AI gifts and
    // hidden affiliations, so the HTML alone cannot show a dropped query
    // filter. This pins the fetch: the rows are never read at all.
    await render();
    expect(onlyStatement('profile_items', 'select').eq).toContainEqual(['approved', true]);
    expect(onlyStatement('school_affiliations', 'select').eq).toContainEqual(['show_on_profile', true]);
  });

  test('the page makes no read of the profiles base table, links or dismissals', async () => {
    await render();
    const tables = new Set(statementLog.all.map((s) => s.table));
    expect(tables.has('profiles')).toBe(false);
    expect(tables.has('external_links')).toBe(false);
    expect(tables.has('gift_suggestion_dismissals')).toBe(false);
  });

  test('JSON-LD is name, ID URL, photo and headline only', async () => {
    expect(jsonLd(await render())).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Alice Example',
      url: 'https://checklyra.com/alice',
      image: 'https://cdn.example.com/alice.jpg',
      description: 'Gardener and maker',
    });
  });

  test('the owner does not see the Report control; a visitor does', async () => {
    mockState.viewerId = 'u-alice';
    expect(await render()).not.toContain('Report this profile');
    mockState.viewerId = 'u-visitor';
    expect(await render()).toContain('Report this profile');
  });

  test('unknown slug calls notFound()', async () => {
    await expect(Page(params('nobody'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('KAN-488 page — metadata', () => {
  test('generateMetadata carries name, headline, canonical ID URL and photo — nothing else', async () => {
    await expect(generateMetadata(params('alice'))).resolves.toEqual({
      title: 'Alice Example — Lyra',
      description: 'Gardener and maker',
      alternates: { canonical: 'https://checklyra.com/alice' },
      openGraph: {
        title: 'Alice Example — Lyra',
        description: 'Gardener and maker',
        url: 'https://checklyra.com/alice',
        siteName: 'Lyra',
        type: 'profile',
        locale: 'en_GB',
        images: [{ url: 'https://cdn.example.com/alice.jpg', alt: 'Alice Example' }],
      },
      twitter: {
        card: 'summary',
        title: 'Alice Example — Lyra',
        description: 'Gardener and maker',
        images: ['https://cdn.example.com/alice.jpg'],
      },
    });
  });

  test('unknown slug gets the not-found title', async () => {
    await expect(generateMetadata(params('nobody'))).resolves.toEqual({ title: 'Profile not found — Lyra' });
  });
});
