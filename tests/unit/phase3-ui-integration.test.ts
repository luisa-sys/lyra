/**
 * KAN-234: Phase 3 UI integration tests.
 *
 * Two layers:
 *
 *  1. **Behavioural** — `addProfileItem` and `updateProfileItemVisibility`
 *     now treat empty/null visibility as "inherit from section default"
 *     (writes NULL). Explicit values continue to be coerced as before
 *     (KAN-143 behaviour preserved). These tests prove the contract
 *     that the items-step UI ("Use section default" option) relies on.
 *
 *  2. **Static regression guards** — items-step renders the new option,
 *     edit-profile-form imports the section-visibility helpers and
 *     uses them in the section-header toggle, [slug]/page.tsx uses
 *     `isItemVisibleUnderHybridModel` for the filter. Same cheap-coverage
 *     pattern as KAN-181 / KAN-182.
 *
 * `useTransition`-driven section-header toggle round-trip is covered
 * indirectly by KAN-221's `updateSectionVisibility` unit tests (server
 * action behaviour) + the static-grep assertions here (wiring).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

// ───────────── Mocks for action behaviour tests ─────────────

const mockInsertCapture = jest.fn();
const mockUpdateCapture = jest.fn();
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
        };
      }
      if (tableName === 'profile_items') {
        return {
          insert: (data: unknown) => {
            mockInsertCapture(data);
            return Promise.resolve({ error: null });
          },
          update: (data: unknown) => {
            mockUpdateCapture(data);
            // KAN-260: the action now chains .eq('id').eq('profile_id'),
            // so return a chainable, awaitable stub — each .eq returns the
            // same chain, and awaiting it resolves to { error: null }.
            const chain = {
              eq() { return chain; },
              then(resolve: (v: { error: null }) => unknown) {
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${tableName}`);
    }),
  }),
}));

import {
  addProfileItem,
  updateProfileItemVisibility,
} from '@/app/dashboard/profile/actions';

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockUpdateCapture.mockClear();
  mockRevalidatePath.mockClear();
});

// ───────────── 1. addProfileItem — visibility=inherit ─────────────

describe('KAN-234: addProfileItem inserts NULL visibility for inherit', () => {
  test('omitted visibility → NULL (inherits section default)', async () => {
    await addProfileItem({
      category: 'gift_ideas',
      title: 'Espresso machine',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: null, title: 'Espresso machine' }),
    );
  });

  test('empty-string visibility → NULL', async () => {
    await addProfileItem({
      category: 'gift_ideas',
      title: 'Empty viz',
      visibility: '',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: null }),
    );
  });

  test('explicit "public" → "public" (KAN-143 behaviour preserved)', async () => {
    await addProfileItem({
      category: 'likes',
      title: 'Coffee',
      visibility: 'public',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });

  test('explicit "members_only" → "members_only"', async () => {
    await addProfileItem({
      category: 'boundaries',
      title: 'No phone after 9pm',
      visibility: 'members_only',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'members_only' }),
    );
  });

  test('explicit "draft" → "draft"', async () => {
    await addProfileItem({
      category: 'questions',
      title: 'Why?',
      visibility: 'draft',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'draft' }),
    );
  });

  test('unknown visibility value → coerced to "public" (KAN-143 fail-safe)', async () => {
    await addProfileItem({
      category: 'likes',
      title: 'Test',
      visibility: 'totally_invalid',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });
});

// ───────────── 2. updateProfileItemVisibility ─────────────

describe('KAN-234: updateProfileItemVisibility writes NULL for inherit', () => {
  test('empty string → writes NULL', async () => {
    await updateProfileItemVisibility('item-1', '');
    expect(mockUpdateCapture).toHaveBeenCalledWith({ visibility: null });
  });

  test('explicit "public" still writes "public"', async () => {
    await updateProfileItemVisibility('item-1', 'public');
    expect(mockUpdateCapture).toHaveBeenCalledWith({ visibility: 'public' });
  });

  test('explicit "members_only" still writes "members_only"', async () => {
    await updateProfileItemVisibility('item-1', 'members_only');
    expect(mockUpdateCapture).toHaveBeenCalledWith({ visibility: 'members_only' });
  });

  test('explicit "draft" still writes "draft"', async () => {
    await updateProfileItemVisibility('item-1', 'draft');
    expect(mockUpdateCapture).toHaveBeenCalledWith({ visibility: 'draft' });
  });

  test('unknown value coerces to "public" (KAN-143 fail-safe preserved)', async () => {
    await updateProfileItemVisibility('item-1', 'bogus');
    expect(mockUpdateCapture).toHaveBeenCalledWith({ visibility: 'public' });
  });
});

// ───────────── 3. Static regression guards ─────────────

describe('KAN-234: surface-area regression guards', () => {
  test('items-step.tsx has the "Use section default" option (empty value)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/items-step.tsx'),
      'utf-8',
    );
    // The option's value is the empty string — distinctive label too.
    expect(src).toMatch(/Use section default/);
    // New-item form defaults to '' (inherit), not 'public'.
    expect(src).toMatch(/setItemVisibility\(['"]['"]\)/);
  });

  test('items-step.tsx handles null/undefined item.visibility in the per-item selector', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/items-step.tsx'),
      'utf-8',
    );
    // The select value derives '' from a null/undefined item.visibility.
    expect(src).toMatch(/item\.visibility == null/);
  });

  test('WizardProfile and WizardItem types declare section_visibility / nullable visibility', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/types.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/section_visibility:\s*Record<string,\s*string>\s*\|\s*null/);
    // Per-item visibility is now nullable in the type
    expect(src).toMatch(/visibility:\s*string\s*\|\s*null/);
  });

  test('edit-profile-form.tsx renders section-header visibility toggles via updateSectionVisibility', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/edit-profile-form.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/updateSectionVisibility/);
    expect(src).toMatch(/isControllableSectionKey/);
    expect(src).toMatch(/coerceSectionVisibility/);
    // The select's options are the three real values
    expect(src).toMatch(/<option value="public">/);
    expect(src).toMatch(/<option value="members_only">/);
    expect(src).toMatch(/<option value="draft">/);
  });

  test('[slug]/page.tsx uses the hybrid filter (isItemVisibleUnderHybridModel)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/[slug]/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/isItemVisibleUnderHybridModel/);
    expect(src).toMatch(/coerceSectionVisibility/);
    // ProfileData now declares section_visibility
    expect(src).toMatch(/section_visibility:\s*Record<string,\s*string>\s*\|\s*null/);
    // ProfileItem.visibility is nullable
    expect(src).toMatch(/visibility:\s*string\s*\|\s*null/);
  });

  test('[slug]/page.tsx removes the .in("visibility", [...]) query filter (hybrid model needs NULL rows too)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/[slug]/page.tsx'),
      'utf-8',
    );
    // The previous query had `.in('visibility', allowedVisibility)` — that
    // line is now gone for profile_items (the rest of the resources keep
    // their explicit filter).
    const itemsBlock = src.match(/\.from\(['"]profile_items['"][\s\S]*?\.order\([^)]+\)/);
    expect(itemsBlock).not.toBeNull();
    if (itemsBlock) {
      expect(itemsBlock[0]).not.toMatch(/\.in\(['"]visibility['"]/);
    }
  });
});
