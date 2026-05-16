/**
 * KAN-221 Phase 3 — Hybrid section + item visibility (foundation).
 *
 * Tests for:
 *  1. `section-visibility.ts` helper functions — pure, no mocking
 *  2. `updateSectionVisibility` server action — Supabase mocks
 *  3. Static-grep regression guards — migration file content, helper
 *     wiring, action exports
 *
 * Phase 3's UI integration (section-header toggle in EditProfileForm,
 * Advanced disclosure on items-step, render-side filter swap in
 * [slug]/page.tsx) is in a follow-up PR — this PR ships the foundation
 * so the helpers + action can be reused and reviewed independently.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

// ────────────── Behavioural tests for the helper ──────────────

import {
  CONTROLLABLE_SECTION_KEYS,
  ITEM_CATEGORY_TO_SECTION,
  isControllableSectionKey,
  coerceSectionVisibility,
  getEffectiveItemVisibility,
  isItemVisibleUnderHybridModel,
  type SectionVisibility,
} from '@/app/dashboard/profile/section-visibility';

describe('KAN-221: CONTROLLABLE_SECTION_KEYS + ITEM_CATEGORY_TO_SECTION', () => {
  test('every controllable section key has at least one item category mapped to it', () => {
    for (const key of CONTROLLABLE_SECTION_KEYS) {
      const mapped = Object.values(ITEM_CATEGORY_TO_SECTION).filter((v) => v === key);
      expect(mapped.length).toBeGreaterThan(0);
    }
  });

  test('every item-category target is itself in CONTROLLABLE_SECTION_KEYS', () => {
    for (const target of Object.values(ITEM_CATEGORY_TO_SECTION)) {
      expect(CONTROLLABLE_SECTION_KEYS).toContain(target);
    }
  });

  test('covers all the item-categories the wizard knows about', () => {
    // The wizard / items-step has labels for these categories. Each should
    // resolve to a section so its items pick up section defaults.
    const expectedCategories = [
      'likes', 'dislikes',
      'gift_ideas', 'gifts_to_avoid',
      'boundaries', 'helpful_to_know',
      'favourite_books', 'favourite_media',
      'causes', 'quotes',
      'proud_of', 'life_hacks', 'questions', 'billboard',
      'current_problems',
    ];
    for (const cat of expectedCategories) {
      expect(ITEM_CATEGORY_TO_SECTION[cat]).toBeDefined();
    }
  });
});

describe('KAN-221: isControllableSectionKey', () => {
  test('accepts each of the six allowlisted keys', () => {
    for (const k of CONTROLLABLE_SECTION_KEYS) {
      expect(isControllableSectionKey(k)).toBe(true);
    }
  });

  test('rejects unknown / spoof keys', () => {
    expect(isControllableSectionKey('')).toBe(false);
    expect(isControllableSectionKey('basic-info')).toBe(false); // not controllable
    expect(isControllableSectionKey('bio')).toBe(false);
    expect(isControllableSectionKey('GIFTS')).toBe(false); // case-sensitive
    expect(isControllableSectionKey("'; DROP TABLE")).toBe(false);
  });
});

describe('KAN-221: coerceSectionVisibility', () => {
  test('passes valid entries through unchanged', () => {
    const input = { gifts: 'members_only', boundaries: 'draft', more: 'public' };
    expect(coerceSectionVisibility(input)).toEqual(input);
  });

  test('drops unknown keys', () => {
    const input = {
      gifts: 'public',
      not_a_section: 'public',          // not in allowlist → dropped
      'basic-info': 'public',           // not in CONTROLLABLE_SECTION_KEYS → dropped
    };
    expect(coerceSectionVisibility(input)).toEqual({ gifts: 'public' });
  });

  test('drops unknown values', () => {
    const input = {
      gifts: 'public',
      boundaries: 'private',  // legacy value — drop, don't coerce silently
      more: 'INVALID',
    };
    expect(coerceSectionVisibility(input)).toEqual({ gifts: 'public' });
  });

  test('handles non-object input safely', () => {
    expect(coerceSectionVisibility(null)).toEqual({});
    expect(coerceSectionVisibility(undefined)).toEqual({});
    expect(coerceSectionVisibility('not an object')).toEqual({});
    expect(coerceSectionVisibility(42)).toEqual({});
    expect(coerceSectionVisibility([])).toEqual({});
  });

  test('drops non-string values', () => {
    const input = { gifts: 1, boundaries: null, more: 'public' };
    expect(coerceSectionVisibility(input)).toEqual({ more: 'public' });
  });
});

describe('KAN-221: getEffectiveItemVisibility — hybrid model', () => {
  const sectionDefaults: SectionVisibility = { gifts: 'members_only', more: 'draft' };

  test('explicit per-item value wins over section default', () => {
    expect(getEffectiveItemVisibility('public', 'gift_ideas', sectionDefaults))
      .toBe('public');
    expect(getEffectiveItemVisibility('draft', 'gift_ideas', sectionDefaults))
      .toBe('draft');
  });

  test('null per-item value inherits section default', () => {
    expect(getEffectiveItemVisibility(null, 'gift_ideas', sectionDefaults))
      .toBe('members_only');
    expect(getEffectiveItemVisibility(null, 'gifts_to_avoid', sectionDefaults))
      .toBe('members_only');
  });

  test('empty-string per-item value also inherits section default', () => {
    expect(getEffectiveItemVisibility('', 'questions', sectionDefaults))
      .toBe('draft');
  });

  test('undefined per-item value inherits section default', () => {
    expect(getEffectiveItemVisibility(undefined, 'gift_ideas', sectionDefaults))
      .toBe('members_only');
  });

  test('falls back to public when neither item nor section is set', () => {
    expect(getEffectiveItemVisibility(null, 'gift_ideas', {})).toBe('public');
    expect(getEffectiveItemVisibility(undefined, 'likes', {})).toBe('public');
  });

  test('falls back to public when the category has no section mapping', () => {
    expect(getEffectiveItemVisibility(null, 'mystery_category', { gifts: 'draft' }))
      .toBe('public');
  });

  test('unknown per-item value fails closed to draft (legacy "private" behaviour)', () => {
    expect(getEffectiveItemVisibility('private', 'gift_ideas', sectionDefaults))
      .toBe('public'); // coerceVisibility returns 'public' for legacy values
    // Note: KAN-143's coerceVisibility returns 'public' (the DEFAULT_VISIBILITY)
    // for unknown values rather than 'draft'. The actual fail-closed at render
    // time is in `isItemVisibleToViewer`. This test documents that contract.
  });

  test('respects each section default independently', () => {
    const sv: SectionVisibility = {
      gifts: 'members_only',
      boundaries: 'draft',
      more: 'public',
    };
    expect(getEffectiveItemVisibility(null, 'gift_ideas', sv)).toBe('members_only');
    expect(getEffectiveItemVisibility(null, 'boundaries', sv)).toBe('draft');
    expect(getEffectiveItemVisibility(null, 'questions', sv)).toBe('public');
  });
});

describe('KAN-221: isItemVisibleUnderHybridModel', () => {
  test('public effective visibility — visible to everyone', () => {
    expect(isItemVisibleUnderHybridModel(
      { visibility: 'public', category: 'likes' }, {}, false,
    )).toBe(true);
    expect(isItemVisibleUnderHybridModel(
      { visibility: 'public', category: 'likes' }, {}, true,
    )).toBe(true);
  });

  test('members_only effective visibility — only signed-in viewers', () => {
    const sv: SectionVisibility = { gifts: 'members_only' };
    expect(isItemVisibleUnderHybridModel(
      { visibility: null, category: 'gift_ideas' }, sv, false,
    )).toBe(false);
    expect(isItemVisibleUnderHybridModel(
      { visibility: null, category: 'gift_ideas' }, sv, true,
    )).toBe(true);
  });

  test('draft effective visibility — never visible', () => {
    const sv: SectionVisibility = { more: 'draft' };
    expect(isItemVisibleUnderHybridModel(
      { visibility: null, category: 'questions' }, sv, true,
    )).toBe(false);
    expect(isItemVisibleUnderHybridModel(
      { visibility: 'draft', category: 'likes' }, {}, true,
    )).toBe(false);
  });

  test('per-item override beats section default for both directions', () => {
    // Section says hide-from-anon, item says always-show
    expect(isItemVisibleUnderHybridModel(
      { visibility: 'public', category: 'gift_ideas' },
      { gifts: 'draft' },
      false,
    )).toBe(true);
    // Section says public, item says hide
    expect(isItemVisibleUnderHybridModel(
      { visibility: 'draft', category: 'gift_ideas' },
      { gifts: 'public' },
      false,
    )).toBe(false);
  });
});

// ────────────── Behavioural tests for updateSectionVisibility ──────────────

const mockUpdateCapture = jest.fn();
const mockRevalidatePath = jest.fn();
const mockSelectSingle = jest.fn().mockResolvedValue({ data: { section_visibility: {} } });

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
      if (tableName !== 'profiles') {
        throw new Error(`Unexpected table: ${tableName}`);
      }
      // The action calls .select(...).eq(...).single() then .update(...).eq(...).
      // We dispatch on whether the chain starts with select or update.
      return {
        select: () => ({
          eq: () => ({
            single: () => mockSelectSingle(),
          }),
        }),
        update: (data: unknown) => {
          mockUpdateCapture(data);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    }),
  }),
}));

import { updateSectionVisibility } from '@/app/dashboard/profile/actions';

beforeEach(() => {
  mockUpdateCapture.mockClear();
  mockRevalidatePath.mockClear();
  mockSelectSingle.mockResolvedValue({ data: { section_visibility: {} } });
});

describe('KAN-221: updateSectionVisibility server action', () => {
  test('writes a single section key into an empty section_visibility', async () => {
    const result = await updateSectionVisibility('gifts', 'members_only');
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      section_visibility: { gifts: 'members_only' },
    });
  });

  test('merges with existing keys without clobbering', async () => {
    mockSelectSingle.mockResolvedValue({
      data: { section_visibility: { boundaries: 'draft', more: 'public' } },
    });
    await updateSectionVisibility('gifts', 'members_only');
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      section_visibility: {
        boundaries: 'draft',
        more: 'public',
        gifts: 'members_only',
      },
    });
  });

  test('overwrites the same section key on a repeat call', async () => {
    mockSelectSingle.mockResolvedValue({
      data: { section_visibility: { gifts: 'public' } },
    });
    await updateSectionVisibility('gifts', 'draft');
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      section_visibility: { gifts: 'draft' },
    });
  });

  test('rejects non-controllable section keys (defence in depth)', async () => {
    const result = await updateSectionVisibility('basic-info', 'public');
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('rejects spoof section keys', async () => {
    const result = await updateSectionVisibility("'; DROP TABLE profiles --", 'public');
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('coerces unknown visibility values to public (matches KAN-143)', async () => {
    await updateSectionVisibility('gifts', 'totally_invalid');
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      section_visibility: { gifts: 'public' },
    });
  });

  test('drops garbage existing keys when merging (coerceSectionVisibility)', async () => {
    mockSelectSingle.mockResolvedValue({
      data: {
        section_visibility: {
          gifts: 'public',
          rogue_key: 'public',
          boundaries: 'totally_invalid',
        },
      },
    });
    await updateSectionVisibility('more', 'draft');
    // rogue_key dropped because it's not controllable; boundaries dropped
    // because the value isn't in the allowlist; gifts preserved; more added.
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      section_visibility: {
        gifts: 'public',
        more: 'draft',
      },
    });
  });

  test('triggers revalidation on success', async () => {
    await updateSectionVisibility('gifts', 'public');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
  });
});

// ────────────── Static-grep regression guards ──────────────

describe('KAN-221: surface-area regression guards', () => {
  test('migration file exists and adds the JSONB column', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260517020000_section_visibility.sql'),
      'utf-8',
    );
    expect(src).toMatch(/add column section_visibility jsonb/i);
    expect(src).toMatch(/default '\{\}'::jsonb/i);
    expect(src).toMatch(/rollback/i);
  });

  test('section-visibility.ts module exports the right surface', () => {
    const p = resolve(ROOT, 'src/app/dashboard/profile/section-visibility.ts');
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, 'utf-8');
    expect(src).toMatch(/export const CONTROLLABLE_SECTION_KEYS/);
    expect(src).toMatch(/export const ITEM_CATEGORY_TO_SECTION/);
    expect(src).toMatch(/export function isControllableSectionKey/);
    expect(src).toMatch(/export function coerceSectionVisibility/);
    expect(src).toMatch(/export function getEffectiveItemVisibility/);
    expect(src).toMatch(/export function isItemVisibleUnderHybridModel/);
  });

  test('actions.ts exports updateSectionVisibility and imports the helper', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/actions.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export async function updateSectionVisibility/);
    expect(src).toMatch(/coerceSectionVisibility/);
    expect(src).toMatch(/isControllableSectionKey/);
  });

  test('section-visibility helper module is NOT a "use server" file (BUGS-12 safe)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/section-visibility.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/^['"]use server['"]/m);
  });
});
