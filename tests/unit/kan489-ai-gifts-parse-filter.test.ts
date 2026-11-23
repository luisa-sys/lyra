/**
 * KAN-489 — model output is untrusted: parse.ts (shape) and filter.ts
 * (limits 100 / 250, the KAN-486 contact filter, no URLs / handles, no
 * duplicates, moderation). Real validators; moderation is a spy so a single
 * item can be blocked. Every expected value is a literal here.
 */

import { MAX_SUGGESTIONS, parseSuggestions } from '@/modules/profile/ai-gifts/parse';
import { containsLinkOrHandle, filterSuggestions, mentionsAvoided, type Moderate } from '@/modules/profile/ai-gifts/filter';
import type { AiSuggestion } from '@/modules/profile/ai-gifts/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SUPABASE = {} as any;

function passModerate(): jest.MockedFunction<Moderate> {
  return jest.fn<ReturnType<Moderate>, Parameters<Moderate>>(async () => ({ ok: true as const }));
}

async function run(items: AiSuggestion[], existingTitles: string[] = [], moderate = passModerate(), avoid: string[] = []) {
  return { ...(await filterSuggestions(SUPABASE, items, { existingTitles, avoid, profileId: 'p-1' }, moderate)), moderate };
}

describe('parseSuggestions', () => {
  it('keeps at most 10 of 12', () => {
    expect(MAX_SUGGESTIONS).toBe(10);
    const json = { suggestions: Array.from({ length: 12 }, (_, i) => ({ title: `Gift ${i}`, description: `D${i}` })) };
    const out = parseSuggestions(json);
    expect(out.length).toBe(10);
    expect(out[9]).toEqual({ title: 'Gift 9', description: 'D9' });
  });

  it('drops malformed items, collapses whitespace, empty description → null', () => {
    expect(
      parseSuggestions({
        suggestions: [
          { title: '  Kite \n kit ', description: ' fly\tit ' },
          { title: 42, description: 'x' },
          { title: '   ', description: 'x' },
          null,
          'string',
          { title: 'Mug', description: '   ' },
          { title: 'Map' },
        ],
      }),
    ).toEqual([
      { title: 'Kite kit', description: 'fly it' },
      { title: 'Mug', description: null },
      { title: 'Map', description: null },
    ]);
  });

  it('anything that is not {suggestions: [...]} → []', () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions('{"suggestions":[]}')).toEqual([]);
    expect(parseSuggestions({ suggestions: 'nope' })).toEqual([]);
    expect(parseSuggestions([{ title: 'x' }])).toEqual([]);
  });
});

describe('filterSuggestions — limits (spec v0.8 §03: title 100, description 250)', () => {
  it('a 100-character title passes, 101 is dropped; 250 / 251 description likewise', async () => {
    const t100 = 'T'.repeat(100);
    const t101 = 'U'.repeat(101);
    const d250 = 'd'.repeat(250);
    const d251 = 'e'.repeat(251);
    const r = await run([
      { title: t100, description: null },
      { title: t101, description: null },
      { title: 'Ok desc', description: d250 },
      { title: 'Long desc', description: d251 },
    ]);
    expect(r.kept).toEqual([
      { title: t100, description: null },
      { title: 'Ok desc', description: d250 },
    ]);
    expect(r.droppedByFilter).toBe(2);
  });
});

describe('filterSuggestions — contact details, links and handles', () => {
  it.each([
    ['phone number', { title: 'Call 07700 900123 for a kite', description: null }],
    ['spaced email', { title: 'Kite', description: 'Write to jane @ gmail . com' }],
    ['postcode', { title: 'Kite shop at SW1A 1AA', description: null }],
    ['https link', { title: 'Kite', description: 'See https://kites.example/buy' }],
    ['www link', { title: 'Kite from www.kiteshop', description: null }],
    ['bare domain', { title: 'Kite', description: 'Order at example.com today' }],
    ['handle', { title: 'Kite', description: 'Ask @kitelover about it' }],
    // Review fix: the old TLD allowlist let these through.
    ['.club domain', { title: 'Kite', description: 'Join at kites.club' }],
    ['.art domain', { title: 'Prints from inkwell.art', description: null }],
    ['.fun domain', { title: 'Kite', description: 'Order from gifts.fun now' }],
    ['spelled-out domain', { title: 'Kite', description: 'Order at example dot com' }],
    ['bracketed dot domain', { title: 'Kite', description: 'Order at example[.]com' }],
  ])('%s → dropped', async (_label, item) => {
    const r = await run([item as AiSuggestion, { title: 'Clean gift', description: 'A nice one' }]);
    expect(r.kept).toEqual([{ title: 'Clean gift', description: 'A nice one' }]);
    expect(r.droppedByFilter).toBe(1);
  });

  it('containsLinkOrHandle: ordinary prose is not a link', () => {
    expect(containsLinkOrHandle('A day out at the coast, e.g. St Ives.')).toBe(false);
    expect(containsLinkOrHandle('Tea at 4 p.m. with friends')).toBe(false);
    expect(containsLinkOrHandle('gifts.co.uk')).toBe(true);
    expect(containsLinkOrHandle('ftp://files')).toBe(true);
    expect(containsLinkOrHandle('Version 3.5 of the kit, rated 4.8 stars')).toBe(false);
    expect(containsLinkOrHandle('Polka dot cushions')).toBe(false);
    expect(containsLinkOrHandle('i.e. something handmade, etc. and so on')).toBe(false);
  });
});

describe('filterSuggestions — the avoid list (review fix: enforced on output, not only in the prompt)', () => {
  it('drops an item whose title or description contains an avoided title as whole words', async () => {
    const r = await run(
      [
        { title: 'Cashmere socks', description: 'Warm' },
        { title: 'Kite', description: 'Comes with SOCKS, too' },
        { title: 'Scented candle set', description: null },
        { title: 'Socket wrench', description: 'Not socks' },
        { title: 'Clay', description: 'Air-dry clay set' },
      ],
      [],
      passModerate(),
      ['Socks', 'Scented candles'],
    );
    // "Socket wrench" survives the title check but its description says "socks".
    expect(r.kept).toEqual([
      { title: 'Scented candle set', description: null },
      { title: 'Clay', description: 'Air-dry clay set' },
    ]);
    expect(r.droppedByFilter).toBe(3);
  });

  it('mentionsAvoided: whole words only, case/punctuation-insensitive, entries under 3 characters ignored', () => {
    expect(mentionsAvoided('Socket wrench', ['socks'])).toBe(false);
    expect(mentionsAvoided('A smart watch', ['art'])).toBe(false); // substring, not a word
    expect(mentionsAvoided('Wool socks!', ['Socks'])).toBe(true);
    expect(mentionsAvoided('A tea-set for two', ['Tea set'])).toBe(true);
    expect(mentionsAvoided('A kite', ['a'])).toBe(false);
    expect(mentionsAvoided('An art print', ['art'])).toBe(true);
    expect(mentionsAvoided('Anything', [])).toBe(false);
  });
});

describe('filterSuggestions — duplicates', () => {
  it('case-insensitive against member and AI titles, and within the batch', async () => {
    const r = await run(
      [
        { title: 'pottery WHEEL class', description: null },
        { title: 'Kite', description: null },
        { title: 'KITE', description: null },
        { title: 'Old AI idea', description: null },
        { title: 'Fresh idea', description: null },
      ],
      ['Pottery wheel class', 'old ai  IDEA'],
    );
    expect(r.kept).toEqual([
      { title: 'Kite', description: null },
      { title: 'Fresh idea', description: null },
    ]);
    expect(r.droppedByFilter).toBe(3);
  });
});

describe('filterSuggestions — moderation', () => {
  it('a block drops only that item; title and description are both checked with the AI field names', async () => {
    const moderate: jest.MockedFunction<Moderate> = jest.fn(async (_s, args) =>
      args.text === 'BLOCKED description' ? { ok: false as const, error: 'nope', flags: ['x'] } : { ok: true as const },
    );
    const r = await run(
      [
        { title: 'Good one', description: 'Fine' },
        { title: 'Bad one', description: 'BLOCKED description' },
        { title: 'Another', description: null },
      ],
      [],
      moderate,
    );
    expect(r.kept).toEqual([
      { title: 'Good one', description: 'Fine' },
      { title: 'Another', description: null },
    ]);
    expect(r.droppedByFilter).toBe(1);
    expect(moderate.mock.calls.map((c) => [c[1].field, c[1].text, c[1].fieldType, c[1].profileId, c[1].source])).toEqual([
      ['profile_items.ai_title', 'Good one', 'public', 'p-1', 'web_app'],
      ['profile_items.ai_description', 'Fine', 'public', 'p-1', 'web_app'],
      ['profile_items.ai_title', 'Bad one', 'public', 'p-1', 'web_app'],
      ['profile_items.ai_description', 'BLOCKED description', 'public', 'p-1', 'web_app'],
      ['profile_items.ai_title', 'Another', 'public', 'p-1', 'web_app'],
    ]);
  });

  it('a blocked title drops the item', async () => {
    const moderate: jest.MockedFunction<Moderate> = jest.fn(async (_s, args) =>
      args.text === 'Bad title' ? { ok: false as const, error: 'nope', flags: ['x'] } : { ok: true as const },
    );
    const r = await run([{ title: 'Bad title', description: 'fine' }, { title: 'Good', description: null }], [], moderate);
    expect(r.kept).toEqual([{ title: 'Good', description: null }]);
  });

  it('a dropped item does not reserve its title (a later clean duplicate is kept)', async () => {
    const r = await run([
      { title: 'Kite', description: 'see example.com' },
      { title: 'kite', description: 'Fly it on the beach' },
    ]);
    expect(r.kept).toEqual([{ title: 'kite', description: 'Fly it on the beach' }]);
  });
});
