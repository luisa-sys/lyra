/**
 * KAN-487 — v0.8 public profile view-model (spec v0.8 §1, §2 sections 01–10,
 * §3; plan §A "Pure logic", §F).
 *
 * Behavioural: builds editor states through the real `initialEditorState`
 * and feeds them to the real `buildPublicProfileView`. Expected values are
 * literals from the spec, never derived from the module under test
 * (CLAUDE.md failure mode 10).
 */
import { initialEditorState, type LoadedProfile, type LoadedItem } from '@/modules/profile/editor/editor-state';
import {
  buildPublicProfileView,
  type PublicViewAudience,
  type PublicSection,
} from '@/modules/profile/editor/public-view-model';

const PID = '00000000-0000-4000-8000-000000000001';
const AUDIENCES: PublicViewAudience[] = ['owner-preview', 'public'];

function item(over: Partial<LoadedItem> & Pick<LoadedItem, 'id' | 'category'>): LoadedItem {
  return {
    title: `title ${over.id}`,
    description: null,
    url: null,
    group_label: null,
    origin: 'user',
    approved: true,
    ...over,
  };
}

function loaded(over: Partial<LoadedProfile> = {}, profileOver: Partial<LoadedProfile['profile']> = {}): LoadedProfile {
  return {
    profile: {
      id: PID,
      display_name: '',
      slug: 'user_0123456789',
      slug_confirmed: false,
      first_published_at: null,
      is_published: false,
      avatar_url: null,
      headline: null,
      city: null,
      country: null,
      bio_short: null,
      gift_voucher_hint: null,
      billboard: null,
      updated_at: '2026-11-23T10:00:00.000Z',
      ...profileOver,
    },
    items: [],
    schools: [],
    manualOfMe: null,
    conversationPrompts: [],
    conversationAnswers: [],
    ...over,
  };
}

function view(l: LoadedProfile, audience: PublicViewAudience = 'public') {
  return buildPublicProfileView(initialEditorState(l), { audience });
}

function section<I extends PublicSection['id']>(
  sections: PublicSection[],
  id: I,
): Extract<PublicSection, { id: I }> | undefined {
  return sections.find((s) => s.id === id) as Extract<PublicSection, { id: I }> | undefined;
}

const SECRET = 'Hidden Grammar School';

function fullProfile(): LoadedProfile {
  return loaded(
    {
      items: [
        item({ id: 'c1', category: 'causes', title: 'Clean rivers' }),
        item({ id: 'p1', category: 'proud_of', title: 'Ran a marathon' }),
        item({ id: 'g1', category: 'gift_ideas', title: 'Fountain pen', url: 'https://pens.example/ink' }),
        item({ id: 'ai1', category: 'gift_ideas', title: 'Approved AI gift', origin: 'ai', approved: true }),
        item({ id: 'ai2', category: 'gift_ideas', title: 'Unapproved AI gift', origin: 'ai', approved: false }),
        item({ id: 'n1', category: 'gifts_to_avoid', title: 'Peanuts' }),
        item({ id: 'q1', category: 'quotes', title: 'Be kind', description: 'Anon' }),
        item({ id: 'b1', category: 'favourite_books', title: 'Middlemarch' }),
        item({ id: 't1', category: 'life_hacks', title: 'Batch cooking' }),
        item({ id: 'pr1', category: 'current_problems', title: 'Fixing my bike' }),
      ],
      schools: [
        {
          id: 's1',
          affiliation_type: 'school',
          school_name: 'Visible Primary',
          school_location: 'AB1 2CD',
          description: null,
          show_on_profile: true,
        },
        {
          id: 's2',
          affiliation_type: 'school',
          school_name: SECRET,
          school_location: 'ZZ9 9ZZ',
          description: 'secret description',
          show_on_profile: false,
        },
      ],
      manualOfMe: {
        communication_style: null,
        working_preferences: null,
        energises_me: 'Long walks',
        drains_me: null,
        good_to_know: 'I love maps',
        boundaries: null,
      },
      conversationPrompts: [{ id: 'pp1', prompt: 'What are the places you want to go?', sort_order: 6, answer_max: 350 }],
      conversationAnswers: [
        {
          id: 'a1',
          prompt_id: 'pp1',
          answer: 'Japan',
          prompt: 'What are the places you want to go?',
          custom_prompt: null,
          answer_max: 350,
        },
      ],
    },
    {
      display_name: 'Ada',
      slug: 'ada_l',
      slug_confirmed: true,
      avatar_url: 'https://cdn.example/a.jpg',
      country: 'GB',
      billboard: 'Be brave.\nBe kind.',
    },
  );
}

describe('KAN-487 public view-model — section order (spec v0.8 §2)', () => {
  test('a fully populated profile yields all ten sections in spec order', () => {
    const v = view(fullProfile());
    expect(v.sections.map((s) => s.id)).toEqual([
      'about',
      'affiliations',
      'gifts',
      'notforme',
      'understand',
      'favourites',
      'tips',
      'problems',
      'starters',
      'billboard',
    ]);
  });

  test('section labels use the spec wording', () => {
    const v = view(fullProfile());
    expect(v.sections.map((s) => s.label)).toEqual([
      'About Me',
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
});

describe('KAN-487 public view-model — hidden affiliations never appear (spec §1, §02)', () => {
  test.each(AUDIENCES)('%s: only show_on_profile entries are present', (audience) => {
    const v = view(fullProfile(), audience);
    const aff = section(v.sections, 'affiliations');
    expect(aff?.groups).toEqual([
      { type: 'school', label: 'Schools', entries: [{ name: 'Visible Primary', location: 'AB1 2CD', description: null }] },
    ]);
    const serialised = JSON.stringify(v);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('ZZ9 9ZZ');
    expect(serialised).not.toContain('secret description');
  });

  test.each(AUDIENCES)('%s: all-hidden affiliations drop the section', (audience) => {
    const l = loaded({
      schools: [
        { id: 'o1', affiliation_type: 'organisation', school_name: SECRET, school_location: null, description: null, show_on_profile: false },
      ],
    });
    const v = view(l, audience);
    expect(v.sections.map((s) => s.id)).not.toContain('affiliations');
    expect(JSON.stringify(v)).not.toContain(SECRET);
  });

  test('groups in order Schools, Organisations, Communities; only populated', () => {
    const l = loaded({
      schools: [
        { id: 'm1', affiliation_type: 'community', school_name: 'Choir', school_location: null, description: null, show_on_profile: true },
        { id: 'm2', affiliation_type: 'school', school_name: 'High', school_location: 'N1 1AA', description: null, show_on_profile: true },
      ],
    });
    const aff = section(view(l).sections, 'affiliations');
    expect(aff?.groups.map((g) => g.label)).toEqual(['Schools', 'Communities']);
  });
});

describe('KAN-487 public view-model — gifts and AI suggestions (spec §03)', () => {
  test.each(AUDIENCES)('%s: unapproved AI suggestions never appear; approved ones are grouped "AI suggested"', (audience) => {
    const v = view(fullProfile(), audience);
    const gifts = section(v.sections, 'gifts');
    expect(gifts?.aiGroupLabel).toBe('AI suggested');
    expect(gifts?.aiSuggested.map((g) => g.title)).toEqual(['Approved AI gift']);
    expect(gifts?.userGifts).toEqual([
      { title: 'Fountain pen', description: null, url: 'https://pens.example/ink', tag: null },
    ]);
    expect(JSON.stringify(v)).not.toContain('Unapproved AI gift');
  });

  test('only unapproved AI gifts and nothing else → no gifts section', () => {
    const l = loaded({ items: [item({ id: 'ai', category: 'gift_ideas', title: 'Nope', origin: 'ai', approved: false })] });
    expect(view(l).sections.map((s) => s.id)).not.toContain('gifts');
  });

  test('preference text alone keeps the section, verbatim', () => {
    const l = loaded({}, { gift_voucher_hint: 'Surprises!\nSize M.' });
    const gifts = section(view(l).sections, 'gifts');
    expect(gifts?.preference).toBe('Surprises!\nSize M.');
    expect(gifts?.userGifts).toEqual([]);
  });
});

describe('KAN-487 public view-model — empty fields and sections dropped (spec §1)', () => {
  test('a blank new profile has no sections (blank gift / not-for-me rows dropped)', () => {
    expect(view(loaded()).sections).toEqual([]);
  });

  test('whitespace-only fields count as empty', () => {
    const l = loaded({}, { billboard: '  \n ', bio_short: '   ', headline: '\t' });
    expect(view(l).sections).toEqual([]);
  });

  test('about: empty fields are null, the unconfirmed signup ID is not shown', () => {
    const l = loaded({}, { display_name: 'Ada', slug: 'user_abcdef0123', slug_confirmed: false });
    const about = section(view(l).sections, 'about');
    expect(about).toEqual({
      id: 'about',
      label: 'About Me',
      photoUrl: null,
      displayName: 'Ada',
      lyraId: null,
      headline: null,
      city: null,
      country: null,
      intro: null,
      causes: [],
      proudOf: [],
    });
  });

  test('understand: only answered prompts, in spec order with spec labels', () => {
    const l = loaded({
      manualOfMe: {
        communication_style: 'Text first',
        working_preferences: 'Shoes off',
        energises_me: null,
        drains_me: 'Noise',
        good_to_know: '  ',
        boundaries: 'No calls after 9',
      },
    });
    const u = section(view(l).sections, 'understand');
    expect(u?.items.map((i) => [i.label, i.text])).toEqual([
      ['My boundaries', 'No calls after 9'],
      ['How I find communication easier', 'Text first'],
      ['If you ever come to my house', 'Shoes off'],
      ['What drains me', 'Noise'],
    ]);
  });

  test('random Q&A: unanswered presets dropped; preset wording kept for deactivated presets; customs after', () => {
    const l = loaded({
      conversationPrompts: [
        { id: 'p8', prompt: 'What don’t you leave the house with?', sort_order: 8, answer_max: 200 },
        { id: 'p1', prompt: 'Who you’d invite for a dinner party, dead or alive?', sort_order: 1, answer_max: 350 },
      ],
      conversationAnswers: [
        { id: 'x8', prompt_id: 'p8', answer: 'Keys', prompt: 'What don’t you leave the house with?', custom_prompt: null, answer_max: 200 },
        { id: 'xc', prompt_id: null, answer: 'Tea', prompt: 'Tea or coffee?', custom_prompt: 'Tea or coffee?', answer_max: 500, sort_order: 0 },
        { id: 'xo', prompt_id: 'old', answer: 'Yes', prompt: 'A retired question?', custom_prompt: null, answer_max: 350 },
        { id: 'x1', prompt_id: 'p1', answer: '   ', prompt: 'Who you’d invite for a dinner party, dead or alive?', custom_prompt: null, answer_max: 350 },
      ],
    });
    const q = section(view(l).sections, 'starters');
    expect(q?.items).toEqual([
      { question: 'What don’t you leave the house with?', answer: 'Keys' },
      { question: 'A retired question?', answer: 'Yes' },
      { question: 'Tea or coffee?', answer: 'Tea' },
    ]);
  });
});

describe('KAN-487 public view-model — favourites (spec §06)', () => {
  test('five fixed categories in order, only populated ones', () => {
    const l = loaded({
      items: [
        item({ id: 'o', category: 'favourite_music', title: 'Jazz', group_label: 'Music' }),
        item({ id: 'pl', category: 'favourite_venues', title: 'The Old Vic' }),
        item({ id: 'tv', category: 'plays', title: 'Hamlet' }),
        item({ id: 'qt', category: 'quotes', title: 'Carpe diem', description: 'Horace', url: 'https://x.example' }),
      ],
    });
    const fav = section(view(l).sections, 'favourites');
    expect(fav?.groups.map((g) => g.label)).toEqual(['Quotes', 'Movies / Theatre / TV', 'Places', 'Others']);
    // Quotes have no link field; Others keep the legacy group label as a tag.
    expect(fav?.groups[0].entries).toEqual([{ title: 'Carpe diem', description: 'Horace', url: null, tag: null }]);
    expect(fav?.groups[3].entries).toEqual([{ title: 'Jazz', description: null, url: null, tag: 'Music' }]);
  });
});

describe('KAN-487 public view-model — text, country, links (spec §01, §10, §3)', () => {
  test('billboard keeps line breaks verbatim', () => {
    const l = loaded({}, { billboard: 'Line one\n\nLine two' });
    expect(section(view(l).sections, 'billboard')?.text).toBe('Line one\n\nLine two');
  });

  test('country code shows as its name', () => {
    expect(section(view(fullProfile()).sections, 'about')?.country).toBe('United Kingdom');
  });

  test('links: only http/https survive', () => {
    const l = loaded({
      items: [
        item({ id: 'h1', category: 'life_hacks', title: 'Safe', url: 'http://ok.example/' }),
        item({ id: 'h2', category: 'life_hacks', title: 'Script', url: 'javascript:alert(1)' }),
        item({ id: 'h3', category: 'life_hacks', title: 'Data', url: 'data:text/html,hi' }),
      ],
    });
    const tips = section(view(l).sections, 'tips');
    expect(tips?.entries.map((e) => e.url)).toEqual(['http://ok.example/', null, null]);
  });

  test('lists without a link field never carry one (problems, causes)', () => {
    const l = loaded({
      items: [
        item({ id: 'pr', category: 'current_problems', title: 'Bike', url: 'https://bike.example/' }),
        item({ id: 'nf', category: 'gifts_to_avoid', title: 'Lilies', url: 'https://flowers.example/' }),
      ],
    });
    const v = view(l);
    expect(section(v.sections, 'problems')?.entries[0].url).toBeNull();
    expect(section(v.sections, 'notforme')?.entries[0].url).toBeNull();
  });

  test('a non-http stored photo URL is not shown', () => {
    const l = loaded({}, { avatar_url: 'javascript:alert(1)', display_name: 'Ada' });
    expect(section(view(l).sections, 'about')?.photoUrl).toBeNull();
  });
});

// KAN-487 PR2 review Major 4 — line-break decision: descriptions (all
// categories) and quote text keep their breaks; every other item title is one
// line, so the preview shows what the save stores.
describe('KAN-487 public view-model — line breaks (PR2 review Major 4)', () => {
  test('a description keeps its line break', () => {
    const l = loaded({
      items: [item({ id: 'h1', category: 'life_hacks', title: 'Batch cook', description: 'Sundays.\nFreeze it.' })],
    });
    expect(section(view(l).sections, 'tips')?.entries[0].description).toBe('Sundays.\nFreeze it.');
  });

  test('a non-quote title collapses its line break to a space', () => {
    const l = loaded({
      items: [
        item({ id: 'h1', category: 'life_hacks', title: 'Batch\ncook' }),
        item({ id: 'c1', category: 'causes', title: 'Clean\n\nrivers ' }),
      ],
    });
    const v = view(l);
    expect(section(v.sections, 'tips')?.entries[0].title).toBe('Batch cook');
    expect(section(v.sections, 'about')?.causes).toEqual(['Clean rivers']);
  });

  test('a quote keeps its line break', () => {
    const l = loaded({
      items: [item({ id: 'q1', category: 'quotes', title: 'Be brave.\nBe kind.', description: 'Someone' })],
    });
    const fav = section(view(l).sections, 'favourites');
    expect(fav?.groups[0].label).toBe('Quotes');
    expect(fav?.groups[0].entries[0].title).toBe('Be brave.\nBe kind.');
  });
});
