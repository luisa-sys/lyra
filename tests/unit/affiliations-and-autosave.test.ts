/**
 * KAN-220 Phase 2 — coverage for the single-page profile editor.
 *
 * Three layers:
 *
 * 1. **Static-grep regression guards** — migration file, affiliation-fields
 *    module, new section components, legacy route, and edit-profile-form
 *    orchestrator all exist and reference each other by name. Same cheap-
 *    coverage pattern as `current-problems-category.test.ts` (KAN-182)
 *    and `conversation-starters.test.ts` (KAN-181).
 *
 * 2. **Behavioural tests for the `affiliation-fields` helpers** — `coerceAffiliationType`
 *    must default to 'school' on unknown values (including the SQL
 *    injection-style strings someone could put on the wire), and
 *    `ALLOWED_AFFILIATION_TYPES` must match the DB CHECK constraint
 *    exactly so the two stay in sync.
 *
 * 3. **Behavioural tests for `addSchoolAffiliation`** — accepts each of
 *    the three legitimate types, coerces unknown to 'school' (defence
 *    in depth alongside the DB CHECK), backward-compat when
 *    `affiliation_type` is omitted.
 *
 * The `useAutoSave` hook isn't unit-tested here — exercising it
 * meaningfully needs a React testing environment (which the Jest config
 * doesn't currently provide); it's covered indirectly by the E2E pass
 * that loads the edit page and types into a field, and the static guard
 * test that confirms the hook exists and is imported by the sections
 * that use it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

// ─────────── Mocks for behavioural tests ───────────

const mockInsertCapture = jest.fn();
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
      if (tableName === 'school_affiliations') {
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

import { addSchoolAffiliation } from '@/app/dashboard/profile/actions';
import {
  ALLOWED_AFFILIATION_TYPES,
  AFFILIATION_LABELS,
  AFFILIATION_SINGULAR,
  coerceAffiliationType,
  isAffiliationType,
} from '@/app/dashboard/profile/affiliation-fields';

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockRevalidatePath.mockClear();
});

// ─────────── 2. affiliation-fields helpers ───────────

describe('KAN-220: affiliation-fields helpers', () => {
  test('ALLOWED_AFFILIATION_TYPES matches the DB CHECK constraint exactly', () => {
    expect(ALLOWED_AFFILIATION_TYPES).toEqual(['school', 'organisation', 'community']);
  });

  test('AFFILIATION_LABELS has a label for each type', () => {
    for (const t of ALLOWED_AFFILIATION_TYPES) {
      expect(AFFILIATION_LABELS[t]).toBeTruthy();
      expect(typeof AFFILIATION_LABELS[t]).toBe('string');
    }
  });

  test('AFFILIATION_SINGULAR has a singular form for each type', () => {
    for (const t of ALLOWED_AFFILIATION_TYPES) {
      expect(AFFILIATION_SINGULAR[t]).toBeTruthy();
    }
  });

  test('isAffiliationType accepts all valid types', () => {
    for (const t of ALLOWED_AFFILIATION_TYPES) {
      expect(isAffiliationType(t)).toBe(true);
    }
  });

  test('isAffiliationType rejects unknown values', () => {
    expect(isAffiliationType('')).toBe(false);
    expect(isAffiliationType('club')).toBe(false);
    expect(isAffiliationType('SCHOOL')).toBe(false);
    expect(isAffiliationType("school'; DROP TABLE")).toBe(false);
    expect(isAffiliationType('undefined')).toBe(false);
  });

  test('coerceAffiliationType passes valid values through', () => {
    expect(coerceAffiliationType('school')).toBe('school');
    expect(coerceAffiliationType('organisation')).toBe('organisation');
    expect(coerceAffiliationType('community')).toBe('community');
  });

  test('coerceAffiliationType defaults unknown values to "school"', () => {
    expect(coerceAffiliationType(undefined)).toBe('school');
    expect(coerceAffiliationType('')).toBe('school');
    expect(coerceAffiliationType('club')).toBe('school');
    expect(coerceAffiliationType('Organisation')).toBe('school'); // case-sensitive
    expect(coerceAffiliationType("'; DROP TABLE")).toBe('school');
  });
});

// ─────────── 3. addSchoolAffiliation server action ───────────

describe('KAN-220: addSchoolAffiliation — affiliation_type handling', () => {
  test('inserts with affiliation_type=school by default (pre-KAN-220 caller compat)', async () => {
    const result = await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliation_type: 'school',
        school_name: 'Greenfield Primary',
      }),
    );
  });

  test('accepts affiliation_type=organisation', async () => {
    await addSchoolAffiliation({
      school_name: 'Acme Ltd',
      affiliation_type: 'organisation',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ affiliation_type: 'organisation', school_name: 'Acme Ltd' }),
    );
  });

  test('accepts affiliation_type=community', async () => {
    await addSchoolAffiliation({
      school_name: 'Local running club',
      affiliation_type: 'community',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ affiliation_type: 'community' }),
    );
  });

  test('coerces unknown affiliation_type to "school" (defence in depth alongside DB CHECK)', async () => {
    await addSchoolAffiliation({
      school_name: 'Attempted bypass',
      affiliation_type: 'club',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ affiliation_type: 'school' }),
    );
  });

  test('still sanitises school_name + location alongside affiliation_type', async () => {
    await addSchoolAffiliation({
      school_name: 'School <b>name</b>',
      school_location: '<p>London</p>',
      affiliation_type: 'school',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        school_name: 'School name',
        school_location: 'London',
        affiliation_type: 'school',
      }),
    );
  });

  test('relationship defaults to "parent" alongside affiliation_type=school', async () => {
    await addSchoolAffiliation({
      school_name: 'Primary',
      affiliation_type: 'school',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ relationship: 'parent', affiliation_type: 'school' }),
    );
  });
});

// ─────────── 1. Static-grep regression guards ───────────

describe('KAN-220: surface-area regression guards', () => {
  test('migration file exists with the affiliation_type CHECK constraint', () => {
    const src = readFileSync(
      resolve(ROOT, 'supabase/migrations/20260517010000_affiliation_type.sql'),
      'utf-8',
    );
    expect(src).toMatch(/add column affiliation_type/i);
    expect(src).toMatch(/check \(affiliation_type in \('school',\s*'organisation',\s*'community'\)\)/i);
    expect(src).toMatch(/school_affiliations_profile_type_idx/);
    // Rollback documented in the file comment per CLAUDE.md
    expect(src).toMatch(/rollback/i);
  });

  test('affiliation-fields module exists and exports the right surface', () => {
    const path = resolve(ROOT, 'src/app/dashboard/profile/affiliation-fields.ts');
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, 'utf-8');
    expect(src).toMatch(/export const ALLOWED_AFFILIATION_TYPES/);
    expect(src).toMatch(/export function coerceAffiliationType/);
    expect(src).toMatch(/export function isAffiliationType/);
    expect(src).toMatch(/export const AFFILIATION_LABELS/);
  });

  test('actions.ts addSchoolAffiliation accepts affiliation_type', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/actions.ts'),
      'utf-8',
    );
    expect(src).toMatch(/affiliation_type\?:\s*string/);
    expect(src).toMatch(/coerceAffiliationType/);
  });

  test('WizardSchool type declares affiliation_type', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/steps/types.tsx'),
      'utf-8',
    );
    // Type now carries affiliation_type — KAN-220 schools/orgs/communities split
    expect(src).toMatch(/affiliation_type:\s*string/);
  });

  test('new section components exist', () => {
    for (const name of [
      'basic-info-section.tsx',
      'bio-section.tsx',
      'manual-of-me-section.tsx',
      'affiliations-section.tsx',
      'use-auto-save.tsx',
      'index.ts',
    ]) {
      const p = resolve(ROOT, `src/app/dashboard/profile/sections/${name}`);
      expect(existsSync(p)).toBe(true);
    }
  });

  test('edit-profile-form orchestrator imports all four new sections + uses ItemsStep for lists', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/edit-profile-form.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/BasicInfoSection/);
    expect(src).toMatch(/BioSection/);
    expect(src).toMatch(/ManualOfMeSection/);
    expect(src).toMatch(/AffiliationsSection/);
    expect(src).toMatch(/ItemsStep/);  // reused from legacy steps
    expect(src).toMatch(/LinksStep/);
    expect(src).toMatch(/FilesStep/);
    expect(src).toMatch(/ConversationStartersSection|ConversationStartersStep/);
  });

  test('useAutoSave hook is referenced by the autosave sections', () => {
    for (const name of [
      'basic-info-section.tsx',
      'bio-section.tsx',
      'manual-of-me-section.tsx',
    ]) {
      const src = readFileSync(
        resolve(ROOT, `src/app/dashboard/profile/sections/${name}`),
        'utf-8',
      );
      expect(src).toMatch(/useAutoSave/);
    }
  });

  test('legacy wizard route exists at /dashboard/profile/legacy', () => {
    const p = resolve(ROOT, 'src/app/dashboard/profile/legacy/page.tsx');
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, 'utf-8');
    expect(src).toMatch(/ProfileWizard/);
    expect(src).toMatch(/robots:\s*\{[^}]*index:\s*false/); // SEO-hidden — should not be indexed
  });

  test('main /dashboard/profile route renders EditProfileForm (new single-page editor)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/EditProfileForm/);
    expect(src).not.toMatch(/ProfileWizard/); // wizard moved to /legacy
  });

  test('main /dashboard/profile page.tsx still fetches conversation starter data (KAN-181 guard)', () => {
    // The KAN-181 regression guard greps page.tsx directly. After the
    // KAN-220 refactor I'd briefly extracted data fetching into a shared
    // module, which broke that test by hiding the strings — reverted.
    // This sibling assertion documents the intent.
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/conversation_starter_prompts/);
    expect(src).toMatch(/profile_conversation_starters/);
  });

  test('legacy /dashboard/profile/legacy page also fetches the full dataset', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/legacy/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/conversation_starter_prompts/);
    expect(src).toMatch(/profile_conversation_starters/);
    expect(src).toMatch(/school_affiliations/);
  });

  test('public profile [slug]/page.tsx groups Schools / Orgs / Communities', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/[slug]/page.tsx'),
      'utf-8',
    );
    // The render groups by affiliation_type — checking distinctive strings
    expect(src).toMatch(/affiliation_type/);
    expect(src).toMatch(/Organisations/);
    expect(src).toMatch(/Communities/);
  });

  test('legacy wizard.tsx left untouched (preserves profile-sections.test.js assertions)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/wizard.tsx'),
      'utf-8',
    );
    // These strings are still expected by tests/unit/profile-sections.test.js
    expect(src).toMatch(/'Books & Media'/);
    expect(src).toMatch(/'Causes & Quotes'/);
    expect(src).toMatch(/More about you/);
  });
});
