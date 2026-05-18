/**
 * KAN-241 — moderation integration into profile-write server actions.
 *
 * Per action, two behavioural tests:
 *   - Clean input → write fires (proves moderation doesn't false-positive)
 *   - Profanity input → action returns success: false with the moderation
 *     error, NO write fires (proves moderation gates correctly)
 *
 * Plus static-grep regression guards that each action file imports +
 * calls `checkModeration`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

// ───────────── Mocks ─────────────

const mockInsertCapture = jest.fn();
const mockUpdateCapture = jest.fn();
const mockUpsertCapture = jest.fn();
const mockRevalidatePath = jest.fn();

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

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
          update: (data: unknown) => {
            mockUpdateCapture('profiles', data);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // All write tables: capture inserts + upserts + updates
      return {
        insert: (data: unknown) => {
          mockInsertCapture(tableName, data);
          return Promise.resolve({ error: null });
        },
        upsert: (data: unknown) => {
          mockUpsertCapture(tableName, data);
          return Promise.resolve({ error: null });
        },
        update: (data: unknown) => {
          mockUpdateCapture(tableName, data);
          return {
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        },
      };
    }),
  }),
}));

import {
  addProfileItem,
  addSchoolAffiliation,
  addExternalLink,
  updateProfileFields,
} from '@/app/dashboard/profile/actions';
import { updateManualOfMe } from '@/app/dashboard/profile/manual-of-me-actions';
import { addConversationStarter, updateConversationStarter } from '@/app/dashboard/profile/conversation-starters-actions';

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockUpdateCapture.mockClear();
  mockUpsertCapture.mockClear();
  mockRevalidatePath.mockClear();
});

// ───────────── addProfileItem ─────────────

describe('KAN-241: addProfileItem moderation', () => {
  test('clean title + description → write succeeds', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'Coffee',
      description: 'Single origin, light roast',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith('profile_items', expect.objectContaining({
      title: 'Coffee',
      description: 'Single origin, light roast',
    }));
  });

  test('profane title → blocked, no write to profile_items', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'fuck this',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/inappropriate language/i);
    }
    // KAN-244: audit-row writes to `content_moderation_flags` are
    // expected on a block; the original intent was "no write to the
    // *target* table" — assert against the target table specifically.
    expect(mockInsertCapture).not.toHaveBeenCalledWith('profile_items', expect.anything());
  });

  test('profane description → blocked, no write to profile_items', async () => {
    const result = await addProfileItem({
      category: 'likes',
      title: 'Coffee',
      description: 'this fuck is great',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalledWith('profile_items', expect.anything());
  });

  test('PII in description (international phone) → blocked', async () => {
    const result = await addProfileItem({
      category: 'gift_ideas',
      title: 'Bluetooth headphones',
      description: 'Call me on +44 7700 900123 for size',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/personal information/i);
    }
    expect(mockInsertCapture).not.toHaveBeenCalledWith('profile_items', expect.anything());
  });
});

// ───────────── updateProfileFields ─────────────

describe('KAN-241: updateProfileFields moderation', () => {
  test('clean fields → update succeeds', async () => {
    const result = await updateProfileFields({
      display_name: 'Sarah Patel',
      headline: 'Primary school teacher in London',
      bio_short: 'I love books, coffee and long walks.',
    });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith('profiles', expect.objectContaining({
      display_name: 'Sarah Patel',
    }));
  });

  test('profane bio → blocked, no write to profiles', async () => {
    const result = await updateProfileFields({
      bio_short: 'I love fuck and other things',
    });
    expect(result.success).toBe(false);
    // KAN-244: audit-row writes to `content_moderation_flags` are
    // expected on block; assert against the target table specifically.
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('profiles', expect.anything());
  });

  test('PII in display_name (email) → blocked', async () => {
    const result = await updateProfileFields({
      display_name: 'Contact me at sarah@example.com',
    });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('profiles', expect.anything());
  });
});

// ───────────── addSchoolAffiliation ─────────────

describe('KAN-241: addSchoolAffiliation moderation', () => {
  test('clean school name → write succeeds', async () => {
    const result = await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'London',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith('school_affiliations', expect.objectContaining({
      school_name: 'Greenfield Primary',
    }));
  });

  test('profane school name → blocked, no write to school_affiliations', async () => {
    const result = await addSchoolAffiliation({
      school_name: 'fuck primary school',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });
});

// ───────────── addExternalLink ─────────────

describe('KAN-241: addExternalLink moderation', () => {
  test('clean link title → write succeeds', async () => {
    const result = await addExternalLink({
      title: 'My favourite recipe blog',
      url: 'https://example.com/recipes',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith('external_links', expect.objectContaining({
      title: 'My favourite recipe blog',
    }));
  });

  test('profane link title → blocked, no write to external_links', async () => {
    const result = await addExternalLink({
      title: 'fuck this is my blog',
      url: 'https://example.com/blog',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });
});

// ───────────── updateManualOfMe ─────────────

describe('KAN-241: updateManualOfMe moderation', () => {
  test('clean Manual of Me fields → upsert succeeds', async () => {
    const result = await updateManualOfMe({
      communication_style: 'I prefer email over calls.',
      working_preferences: 'Early mornings are my deep-work time.',
    });
    expect(result).toEqual({ success: true });
    expect(mockUpsertCapture).toHaveBeenCalledWith('profile_manual_of_me', expect.objectContaining({
      communication_style: 'I prefer email over calls.',
    }));
  });

  test('profane communication_style → blocked, no upsert to profile_manual_of_me', async () => {
    const result = await updateManualOfMe({
      communication_style: 'fuck calls, only email',
    });
    expect(result.success).toBe(false);
    expect(mockUpsertCapture).not.toHaveBeenCalledWith('profile_manual_of_me', expect.anything());
  });
});

// ───────────── addConversationStarter / updateConversationStarter ─────────────

describe('KAN-241: conversation starter moderation', () => {
  const VALID_PROMPT_ID = '11111111-2222-3333-4444-555555555555';

  test('clean answer → add succeeds', async () => {
    const result = await addConversationStarter({
      promptId: VALID_PROMPT_ID,
      answer: 'I would take a Kindle to a desert island.',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith('profile_conversation_starters', expect.objectContaining({
      answer: 'I would take a Kindle to a desert island.',
    }));
  });

  test('profane answer → blocked on add, no insert to profile_conversation_starters', async () => {
    const result = await addConversationStarter({
      promptId: VALID_PROMPT_ID,
      answer: 'fuck this question',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalledWith('profile_conversation_starters', expect.anything());
  });

  test('profane answer → blocked on update too', async () => {
    const result = await updateConversationStarter('item-id', 'fuck this');
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('profile_conversation_starters', expect.anything());
  });
});

// ───────────── Static regression guards ─────────────

describe('KAN-241: surface-area regression guards', () => {
  test('moderation-policy module exists with checkModeration export', () => {
    const src = readFileSync(resolve(ROOT, 'src/lib/moderation-policy.ts'), 'utf-8');
    expect(src).toMatch(/export function checkModeration/);
    expect(src).toMatch(/moderateContent/); // pulls from content-moderation
  });

  // KAN-244: callers now route via the `moderateAndAudit` wrapper (which
  // internally calls `checkModeration` + writes a `content_moderation_flags`
  // row). The guards accept either entry point — the original intent
  // ("moderation is wired in this file") is preserved.
  test('actions.ts imports + calls moderation (checkModeration or moderateAndAudit)', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/dashboard/profile/actions.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{\s*(?:checkModeration|moderateAndAudit)\s*\}\s*from\s*['"]@\/lib\/moderation-(?:policy|audit)['"]/);
    // Used in at least 4 places (updateProfileFields, addProfileItem,
    // addSchoolAffiliation, addExternalLink)
    const callCount = (src.match(/(?:checkModeration|moderateAndAudit)\(/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(4);
  });

  test('manual-of-me-actions.ts imports + calls moderation', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/dashboard/profile/manual-of-me-actions.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{\s*(?:checkModeration|moderateAndAudit)\s*\}\s*from\s*['"]@\/lib\/moderation-(?:policy|audit)['"]/);
    expect(src).toMatch(/(?:checkModeration|moderateAndAudit)\(/);
  });

  test('conversation-starters-actions.ts imports + calls moderation in both add + update', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/dashboard/profile/conversation-starters-actions.ts'), 'utf-8');
    expect(src).toMatch(/import\s*\{\s*(?:checkModeration|moderateAndAudit)\s*\}\s*from\s*['"]@\/lib\/moderation-(?:policy|audit)['"]/);
    // One call in add path, one in update path
    const callCount = (src.match(/(?:checkModeration|moderateAndAudit)\(/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('moderation-policy.ts is NOT a use-server file (BUGS-12 safe)', () => {
    const src = readFileSync(resolve(ROOT, 'src/lib/moderation-policy.ts'), 'utf-8');
    expect(src).not.toMatch(/^['"]use server['"]/m);
  });
});
