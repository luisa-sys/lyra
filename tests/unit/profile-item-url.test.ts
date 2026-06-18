/**
 * KAN-219: URL field on profile items.
 *
 * Two layers of coverage:
 *
 * 1. Behavioural tests for `addProfileItem` — verify the URL is sanitised
 *    via `sanitiseUrl` (the same helper external_links uses) and that
 *    invalid URLs are REJECTED with an error rather than silently dropped.
 *    This is the security guarantee — `javascript:` / `data:` / malformed
 *    inputs cannot reach the DB column.
 *
 * 2. Static-grep regression guards — cheap checks that the UI components
 *    and public-profile renderer reference the URL plumbing, so a future
 *    refactor can't accidentally remove the field without a test failing.
 *    Same pattern as KAN-181 (conversation-starters.test.ts) and KAN-182
 *    (current-problems-category.test.ts).
 *
 * Why URL on items? Python `lyra-app/templates/edit_profile.html` shipped
 * a Link input alongside Title + Description for every item — the user
 * could attach a buy-it-here URL to a gift idea, an Amazon link to a
 * favourite book, etc. The Next.js wizard inherited the `url` DB column
 * but never wrote to it; this restores the missing surface.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ───────────── Mocks ─────────────

const mockInsertCapture = jest.fn();
const mockRevalidatePath = jest.fn();

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// addProfileItem invokes the chain
//   .from('profiles').select('id').eq('user_id', x).single() → look up profile_id
//   .from('profile_items').insert({...})                     → write the item
// Dispatch on the table name so each chain returns the right shape.
jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
      }),
    },
    from: jest.fn().mockImplementation((tableName: string) => {
      if (tableName === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: 'test-profile-id' } }),
            }),
          }),
        };
      }
      if (tableName === 'profile_items') {
        return {
          insert: (data: unknown) => {
            mockInsertCapture(data);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${tableName}`);
    }),
  }),
}));

import { addProfileItem } from '@/app/dashboard/profile/actions';

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockRevalidatePath.mockClear();
});

// ───────────── Behavioural tests ─────────────

describe('KAN-219: addProfileItem — URL handling', () => {
  test('persists a valid https URL', async () => {
    const result = await addProfileItem({
      category: 'favourite_books',
      title: 'The Hobbit',
      url: 'https://example.com/hobbit',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/hobbit',
        title: 'The Hobbit',
        category: 'favourite_books',
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
  });

  test('persists a valid http URL (not just https)', async () => {
    await addProfileItem({
      category: 'life_hacks',
      title: 'Old recipe site',
      url: 'http://example.com/recipe',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://example.com/recipe' }),
    );
  });

  test('REJECTS a javascript: URL with a clear error', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'Sneaky',
      url: 'javascript:alert(1)',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/invalid url/i);
    }
    // Critical: no DB write happened — the bad URL never reaches the column
    expect(mockInsertCapture).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  test('REJECTS a data: URL', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'Embedded',
      url: 'data:text/html,<script>alert(1)</script>',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('REJECTS a malformed URL', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'Broken',
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('REJECTS a file:// URL', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'Local file',
      url: 'file:///etc/passwd',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('stores NULL when url is omitted (backward compat with pre-KAN-219 callers)', async () => {
    await addProfileItem({
      category: 'likes',
      title: 'No link here',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ url: null, title: 'No link here' }),
    );
  });

  test('stores NULL when url is an empty string', async () => {
    await addProfileItem({
      category: 'likes',
      title: 'Also no link',
      url: '',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ url: null }),
    );
  });

  test('stores NULL when url is whitespace only', async () => {
    await addProfileItem({
      category: 'likes',
      title: 'Spaces only',
      url: '   ',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ url: null }),
    );
  });

  test('still sanitises title + description alongside the URL', async () => {
    // sanitiseText strips HTML tags but preserves text between them (React
    // also auto-escapes on render). We're checking that the title/description
    // path is unchanged by the addition of the url param — not testing
    // sanitiseText itself.
    await addProfileItem({
      category: 'gift_ideas',
      title: 'Camera <b>fancy</b>',
      description: '<p>Nice shot</p>',
      url: 'https://example.com/camera',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Camera fancy',
        description: 'Nice shot',
        url: 'https://example.com/camera',
      }),
    );
  });
});

// ───────────── Static-grep regression guards ─────────────

describe('KAN-219: surface-area regression guards', () => {
  const ROOT = resolve(__dirname, '../..');

  test('items-step.tsx renders a Link input with type="url"', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/items-step.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/Link \(optional\)/);
    expect(src).toMatch(/type="url"/);
    expect(src).toMatch(/itemUrl/);
  });

  test('items-step.tsx handleAdd passes the trimmed URL in onAdd payload', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/items-step.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/trimmedUrl/);
    expect(src).toMatch(/url: trimmedUrl/);
  });

  test('items-step.tsx renders ↗ link on saved items when url is present', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/items-step.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/item\.url/);
    expect(src).toMatch(/rel="noopener noreferrer"/);
  });

  test('actions.ts addProfileItem accepts url param and uses sanitiseUrl', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/actions.ts'),
      'utf-8',
    );
    // url is an optional param on the addProfileItem data type
    expect(src).toMatch(/url\?:\s*string/);
    // url is sanitised via sanitiseUrl (same helper external_links uses)
    expect(src).toMatch(/sanitiseUrl\(data\.url\)/);
    // The rejection path returns a clear error rather than silently dropping
    expect(src).toMatch(/Invalid URL/);
  });

  test('public profile [slug]/page.tsx renders item URLs as clickable links', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/[slug]/page.tsx'),
      'utf-8',
    );
    // The ProfileItem interface declares the url column
    expect(src).toMatch(/url:\s*string\s*\|\s*null/);
    // KAN-265: the card renderer branches on the item's url (it.url) to show a chip.
    expect(src).toMatch(/it\.url &&/);
    // Outbound links use rel="noopener noreferrer" to prevent tab-nabbing
    expect(src).toMatch(/rel="noopener noreferrer"/);
  });

  test('wizard.tsx uses the richer Python lyra-app prompts', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/wizard.tsx'),
      'utf-8',
    );
    // Replaces the terse one-liners with the Python predecessor's longer
    // prompts. We check for distinctive phrases that wouldn't appear by
    // accident, not the entire string, so minor copy edits won't break.
    expect(src).toMatch(/Tastes, interests, and favourites/);
    expect(src).toMatch(/luxuries you don't give yourself/);
    expect(src).toMatch(/things that help people respect/);
    expect(src).toMatch(/screen favourites that shaped you/);
    expect(src).toMatch(/Causes and charities you care about/);
    expect(src).toMatch(/billboard message/);
  });
});
