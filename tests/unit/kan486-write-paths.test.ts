/**
 * KAN-486 — the v0.8 validators are WIRED into the profile write paths, not
 * merely declared. Each case drives the real server action against a mocked
 * Supabase client and asserts on what reaches the database (or that nothing
 * does). Add and edit paths are tested separately — fixing one call site but
 * not its sibling is the BUGS-74 / suspension-guard defect shape.
 *
 * Expected limits and messages are literals from spec v0.8.
 */

const mockInsertCapture = jest.fn();
const mockUpdateCapture = jest.fn();

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: jest.fn(async () => ({ allowed: true })),
}));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: 'profile-1' } }) }) }),
          update: (data: unknown) => {
            mockUpdateCapture('profiles', data);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return {
        insert: (data: unknown) => {
          mockInsertCapture(table, data);
          return Promise.resolve({ error: null });
        },
        update: (data: unknown) => {
          mockUpdateCapture(table, data);
          const chain = {
            eq: () => chain,
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: 'item-1', category: 'gift_ideas', title: 't', description: null, url: null, visibility: null },
                  error: null,
                }),
            }),
            then: (resolve: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
          return { eq: () => chain };
        },
      };
    }),
  }),
}));

import {
  addProfileItem,
  updateProfileItem,
  addSchoolAffiliation,
  addExternalLink,
  updateProfileFields,
} from '@/app/dashboard/profile/actions';

const CONTACT = (label: string) =>
  `${label}: please remove personal information such as contact details (email, phone number or postal address). Your profile is public.`;

function wrote(table: string, op: 'insert' | 'update'): Record<string, unknown> | undefined {
  const cap = op === 'insert' ? mockInsertCapture : mockUpdateCapture;
  const call = cap.mock.calls.find((c) => c[0] === table);
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockUpdateCapture.mockClear();
});

describe('KAN-486 updateProfileFields', () => {
  test('billboard is writable, keeps line breaks, and is limited to 200', async () => {
    expect(await updateProfileFields({ billboard: 'Be kind.\nCall your mum.' })).toEqual({ success: true });
    expect(wrote('profiles', 'update')).toEqual({ billboard: 'Be kind.\nCall your mum.' });

    mockUpdateCapture.mockClear();
    expect(await updateProfileFields({ billboard: 'x'.repeat(201) })).toEqual({
      success: false,
      error: 'Billboard is too long: 201 characters (limit 200, including spaces).',
    });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('headline over 100 is rejected, not cut', async () => {
    expect(await updateProfileFields({ headline: 'h'.repeat(101) })).toEqual({
      success: false,
      error: 'Headline is too long: 101 characters (limit 100, including spaces).',
    });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('short intro keeps line breaks; display name collapses them', async () => {
    await updateProfileFields({ bio_short: 'Line one\nLine two', display_name: 'Sam\nLee' });
    expect(wrote('profiles', 'update')).toEqual({ bio_short: 'Line one\nLine two', display_name: 'Sam Lee' });
  });

  test('contact details in the short intro are refused', async () => {
    expect(await updateProfileFields({ bio_short: 'Text me on 07700 900123' })).toEqual({
      success: false,
      error: CONTACT('Short intro'),
    });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('city is a place: a postcode is allowed there, a phone number is not', async () => {
    expect(await updateProfileFields({ city: 'London SW1A' })).toEqual({ success: true });
    expect(await updateProfileFields({ city: '07700 900123' })).toEqual({ success: false, error: CONTACT('City') });
  });

  test('gift preference allows 350 (was cut at 500 with no line breaks)', async () => {
    expect(await updateProfileFields({ gift_voucher_hint: 'g'.repeat(350) })).toEqual({ success: true });
    expect((await updateProfileFields({ gift_voucher_hint: 'g'.repeat(351) })).success).toBe(false);
  });

  test('avatar_url can no longer be written directly (photo pipeline only)', async () => {
    expect(await updateProfileFields({ avatar_url: 'https://evil.example/x.png' })).toEqual({
      success: false,
      error: 'Field(s) not permitted: avatar_url',
    });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });
});

describe('KAN-486 addProfileItem / updateProfileItem', () => {
  test('quote: 500-character quote stored whole on ADD; 501 rejected', async () => {
    expect(await addProfileItem({ category: 'quotes', title: 'q'.repeat(500) })).toEqual({ success: true });
    expect(wrote('profile_items', 'insert')?.title).toBe('q'.repeat(500));

    mockInsertCapture.mockClear();
    expect(await addProfileItem({ category: 'quotes', title: 'q'.repeat(501) })).toEqual({
      success: false,
      error: 'Quote is too long: 501 characters (limit 500, including spaces).',
    });
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('gift title limit is 100 on ADD', async () => {
    expect(await addProfileItem({ category: 'gift_ideas', title: 'g'.repeat(101) })).toEqual({
      success: false,
      error: 'Title is too long: 101 characters (limit 100, including spaces).',
    });
  });

  test('contact details in an item description are refused on ADD and on EDIT', async () => {
    expect(await addProfileItem({ category: 'life_hacks', title: 'Tip', description: 'mail me a@b.co' })).toEqual({
      success: false,
      error: CONTACT('Description'),
    });
    expect(await updateProfileItem('item-1', { description: 'mail me a@b.co' })).toEqual({
      success: false,
      error: CONTACT('Description'),
    });
    expect(mockInsertCapture).not.toHaveBeenCalled();
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('EDIT rejects text over the highest limit any category allows (title 500)', async () => {
    expect(await updateProfileItem('item-1', { title: 't'.repeat(501) })).toEqual({
      success: false,
      error: 'Title is too long: 501 characters (limit 500, including spaces).',
    });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('item URL: scheme-less is refused on ADD and EDIT; https is stored', async () => {
    const scheme = 'Invalid URL — must start with http:// or https://';
    expect(await addProfileItem({ category: 'gift_ideas', title: 'Kettle', url: 'example.com' })).toEqual({
      success: false,
      error: scheme,
    });
    expect(await updateProfileItem('item-1', { url: 'javascript:alert(1)' })).toEqual({ success: false, error: scheme });
    await addProfileItem({ category: 'gift_ideas', title: 'Kettle', url: 'https://shop.example/k' });
    expect(wrote('profile_items', 'insert')?.url).toBe('https://shop.example/k');
  });
});

describe('KAN-486 affiliations and links', () => {
  test('organisation location is a place (address allowed), description has the full filter', async () => {
    expect(
      await addSchoolAffiliation({
        school_name: 'Riverside Rowing Club',
        school_location: '12 Mill Lane, Oxford',
        affiliation_type: 'organisation',
      }),
    ).toEqual({ success: true });

    expect(
      await addSchoolAffiliation({
        school_name: 'Riverside Rowing Club',
        description: 'Ring the captain on 07700 900123',
        affiliation_type: 'organisation',
      }),
    ).toEqual({ success: false, error: CONTACT('Description') });
  });

  test('affiliation name over 120 is rejected', async () => {
    expect(
      await addSchoolAffiliation({ school_name: 'n'.repeat(121), affiliation_type: 'community' }),
    ).toEqual({ success: false, error: 'Name is too long: 121 characters (limit 120, including spaces).' });
  });

  test('external link: scheme-less URL refused, credentials refused', async () => {
    expect(await addExternalLink({ title: 'Blog', url: 'example.com' })).toEqual({
      success: false,
      error: 'Invalid URL — must start with http:// or https://',
    });
    expect(await addExternalLink({ title: 'Blog', url: 'https://u:p@example.com' })).toEqual({
      success: false,
      error: "Links can't include a username or password.",
    });
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });
});
