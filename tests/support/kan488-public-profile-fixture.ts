/**
 * KAN-488 — shared fixture for the public-profile loader and page tests.
 *
 * One published profile ("alice") carrying every kind of row a visitor must
 * NOT see next to rows they must see. The SECRET / LEGACY / MEMBERS-ONLY
 * tokens are deliberately unique strings so a test can assert their absence
 * from rendered HTML (including JSON-LD) with a plain substring check.
 *
 * Rows are plain objects handed to `createStatementMockClient({ rows })`,
 * which filters them by each statement's own `.eq()` / `.in()` calls — so a
 * filter the code under test drops really lets the row through.
 */

export const SECRET_TOKENS = ['SECRET-AI-GIFT', 'SECRET-SCHOOL', 'LEGACY-DISLIKE', 'MEMBERS-ONLY-TIP'] as const;

export type FixtureRows = Record<string, Array<Record<string, unknown>>>;

const PROFILE_ID = 'p-alice';

function item(over: Record<string, unknown>): Record<string, unknown> {
  return {
    profile_id: PROFILE_ID,
    description: null,
    url: null,
    visibility: null,
    group_label: null,
    origin: 'user',
    approved: true,
    sort_order: 0,
    created_at: '2026-11-01T00:00:00Z',
    ...over,
  };
}

export function aliceProfileRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    user_id: 'u-alice',
    slug: 'alice',
    display_name: 'Alice Example',
    headline: 'Gardener and maker',
    bio_short: 'Hello there.\nI grow tomatoes.',
    city: 'Leeds',
    country: 'GB',
    avatar_url: 'https://cdn.example.com/alice.jpg',
    gift_voucher_hint: 'Surprises welcome.\nSize M.',
    section_visibility: {},
    delivery_country_code: null,
    updated_at: '2026-11-20T10:00:00Z',
    is_homepage_example: false,
    homepage_example_order: null,
    is_published: true,
    is_suspended: false,
    billboard: 'Be kind\nShip it',
    ...over,
  };
}

/** The full "alice" fixture. Pass overrides per table to vary it. */
export function aliceRows(over: Partial<FixtureRows> = {}): FixtureRows {
  return {
    public_profiles: [aliceProfileRow()],
    profile_items: [
      item({ id: 'i-cause', category: 'causes', title: 'Clean rivers' }),
      item({ id: 'i-proud', category: 'proud_of', title: 'Ran a marathon' }),
      item({
        id: 'i-gift',
        category: 'gift_ideas',
        title: 'Pottery class',
        description: 'Any local studio',
        url: 'https://pottery.example.com/classes',
      }),
      item({ id: 'i-ai-ok', category: 'gift_ideas', title: 'Kite kit', origin: 'ai', approved: true }),
      item({ id: 'i-ai-secret', category: 'gift_ideas', title: 'SECRET-AI-GIFT', origin: 'ai', approved: false }),
      item({ id: 'i-avoid', category: 'gifts_to_avoid', title: 'Perfume', description: 'Allergic' }),
      item({ id: 'i-legacy', category: 'dislikes', title: 'LEGACY-DISLIKE' }),
      item({ id: 'i-quote', category: 'quotes', title: 'Stay curious', description: 'My gran' }),
      item({ id: 'i-book', category: 'favourite_books', title: 'Middlemarch', url: 'javascript:alert(1)' }),
      item({ id: 'i-tip', category: 'life_hacks', title: 'Batch cooking', url: 'https://tips.example.com/' }),
      item({ id: 'i-members', category: 'life_hacks', title: 'MEMBERS-ONLY-TIP', visibility: 'members_only' }),
      item({ id: 'i-problem', category: 'current_problems', title: 'Finding a plumber' }),
      item({ id: 'i-other', category: 'gift_ideas', title: 'OTHER-PROFILE-GIFT', profile_id: 'p-bob' }),
    ],
    school_affiliations: [
      {
        id: 'a-secret',
        profile_id: PROFILE_ID,
        affiliation_type: 'school',
        school_name: 'SECRET-SCHOOL',
        school_location: 'LS1 1AA',
        description: null,
        show_on_profile: false,
        created_at: '2026-11-01T00:00:00Z',
      },
      {
        id: 'a-choir',
        profile_id: PROFILE_ID,
        affiliation_type: 'community',
        school_name: 'Hillside Choir',
        school_location: 'Leeds',
        description: 'Tenor',
        show_on_profile: true,
        created_at: '2026-11-02T00:00:00Z',
      },
    ],
    profile_manual_of_me: [
      {
        profile_id: PROFILE_ID,
        good_to_know: 'Loves tea\nand cake',
        boundaries: null,
        communication_style: null,
        working_preferences: null,
        energises_me: null,
        drains_me: null,
      },
    ],
    profile_conversation_starters: [
      {
        id: 's-preset',
        profile_id: PROFILE_ID,
        prompt_id: 'q-dinner',
        custom_prompt: null,
        answer: 'Ada Lovelace',
        sort_order: null,
        created_at: '2026-11-01T00:00:00Z',
        prompt: { prompt: 'Who you’d invite for a dinner party, dead or alive?', sort_order: 1, is_active: true },
      },
      {
        id: 's-custom',
        profile_id: PROFILE_ID,
        prompt_id: null,
        custom_prompt: 'Favourite tool?',
        answer: 'A good pen\nand paper',
        sort_order: 1,
        created_at: '2026-11-02T00:00:00Z',
        prompt: null,
      },
    ],
    ...over,
  };
}
