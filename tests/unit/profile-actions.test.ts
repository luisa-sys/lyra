/**
 * Real updateProfileFields tests with mocked Supabase
 *
 * KAN-167 / CodeQL alert #2: This test exists primarily to enforce that
 * remote property injection cannot occur in updateProfileFields. The
 * function previously had a sibling `updateProfile(formData)` that wrote
 * `{ [field]: value }` directly from FormData — that function has been
 * deleted, and updateProfileFields now applies an allowlist.
 *
 * What this test covers:
 * - Allowlisted fields are accepted and written
 * - Non-allowlisted fields are REJECTED with a clear error
 * - String values are sanitised (HTML stripped) before write
 * - Boolean / number / null values pass through unchanged
 * - Empty input is a no-op success (no UPDATE fired)
 * - Mixed input (some allowed, some not) is rejected wholesale
 * - Static regression guard: the dangerous `[field]: value` pattern from
 *   the old updateProfile must never reappear in actions.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Mock next/cache
const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Mock Supabase client. The mock chain is .from().update().eq() — we capture
// what gets passed to update() so the test can assert on it.
const mockUpdateCapture = jest.fn();
const mockEqResolve = jest.fn().mockResolvedValue({ error: null });

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } },
      }),
    },
    from: jest.fn().mockImplementation(() => ({
      update: (data: unknown) => {
        mockUpdateCapture(data);
        return { eq: mockEqResolve };
      },
    })),
  }),
}));

import { updateProfileFields, ALLOWED_PROFILE_FIELDS } from '@/app/dashboard/profile/actions';

beforeEach(() => {
  mockUpdateCapture.mockClear();
  mockRevalidatePath.mockClear();
  mockEqResolve.mockClear();
  mockEqResolve.mockResolvedValue({ error: null });
});

describe('updateProfileFields — allowlist enforcement', () => {
  test('accepts a single allowlisted string field and sanitises HTML', async () => {
    const result = await updateProfileFields({ display_name: 'Alice <script>x</script>' });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith({ display_name: 'Alice x' });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
  });

  test('accepts multiple allowlisted fields in a single call', async () => {
    const result = await updateProfileFields({
      display_name: 'Bob',
      headline: 'Hello',
      city: 'London',
      country: 'GB',
    });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      display_name: 'Bob',
      headline: 'Hello',
      city: 'London',
      country: 'GB',
    });
  });

  test('passes booleans through without sanitisation', async () => {
    await updateProfileFields({ is_published: true, onboarding_complete: false });
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      is_published: true,
      onboarding_complete: false,
    });
  });

  test('passes numbers through without sanitisation', async () => {
    await updateProfileFields({ completion_score: 75 });
    expect(mockUpdateCapture).toHaveBeenCalledWith({ completion_score: 75 });
  });

  test('passes null through without sanitisation', async () => {
    await updateProfileFields({ bio_short: null });
    expect(mockUpdateCapture).toHaveBeenCalledWith({ bio_short: null });
  });

  test('REJECTS a non-allowlisted field (the property injection attack)', async () => {
    const result = await updateProfileFields({ user_id: 'someone-else' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('user_id');
      expect(result.error).toMatch(/not permitted/i);
    }
    // Critically: no DB write happened
    expect(mockUpdateCapture).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  test('REJECTS even a non-allowlisted field that LOOKS innocent', async () => {
    const result = await updateProfileFields({ admin_notes: 'hello' });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('REJECTS the entire request if ANY field is non-allowlisted', async () => {
    // Mixed payload: display_name OK, role NOT OK.
    const result = await updateProfileFields({
      display_name: 'Eve',
      role: 'admin',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('role');
      // display_name is NOT mentioned because it WAS allowed; only the rejected
      // keys appear in the error
      expect(result.error).not.toContain('display_name');
    }
    // No partial write — request is rejected wholesale
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('REJECTS attempts to write system columns', async () => {
    for (const dangerous of ['id', 'user_id', 'created_at', 'updated_at']) {
      mockUpdateCapture.mockClear();
      const result = await updateProfileFields({ [dangerous]: 'attacker-value' });
      expect(result.success).toBe(false);
      expect(mockUpdateCapture).not.toHaveBeenCalled();
    }
  });

  test('REJECTS attempts to write to slug (intentionally not in allowlist)', async () => {
    const result = await updateProfileFields({ slug: 'attacker-slug' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('slug');
    }
  });

  test('returns success without any DB write when input is empty', async () => {
    const result = await updateProfileFields({});
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });
});

describe('ALLOWED_PROFILE_FIELDS — allowlist contents', () => {
  test('exists and is non-empty', () => {
    expect(ALLOWED_PROFILE_FIELDS).toBeDefined();
    expect(Array.isArray(ALLOWED_PROFILE_FIELDS)).toBe(true);
    expect(ALLOWED_PROFILE_FIELDS.length).toBeGreaterThan(0);
  });

  test('does NOT include any system-managed columns', () => {
    const dangerous = ['id', 'user_id', 'created_at', 'updated_at'];
    for (const col of dangerous) {
      expect(ALLOWED_PROFILE_FIELDS).not.toContain(col);
    }
  });

  test('does NOT include slug (deliberately handled separately)', () => {
    expect(ALLOWED_PROFILE_FIELDS).not.toContain('slug');
  });

  test('includes the fields the wizard actually uses', () => {
    // Source: src/app/dashboard/profile/steps/identity-step.tsx onSave
    expect(ALLOWED_PROFILE_FIELDS).toContain('display_name');
    expect(ALLOWED_PROFILE_FIELDS).toContain('headline');
    expect(ALLOWED_PROFILE_FIELDS).toContain('city');
    expect(ALLOWED_PROFILE_FIELDS).toContain('country');
    // Source: src/app/dashboard/profile/steps/bio-step.tsx onSave
    expect(ALLOWED_PROFILE_FIELDS).toContain('bio_short');
  });
});

describe('Regression guard — actions.ts must never reintroduce the property injection pattern', () => {
  const actionsPath = path.join(__dirname, '../..', 'src/app/dashboard/profile/actions.ts');
  const source = fs.readFileSync(actionsPath, 'utf8');

  test('the deleted updateProfile function MUST NOT be re-added without an allowlist', () => {
    // Specifically guard against the original bug: writing FormData.get('field')
    // straight to a DB column. This grep is conservative — it matches any
    // .update with a computed key built from a variable named `field`.
    const dangerousPatterns = [
      /update\(\s*\{\s*\[field\]:\s*value/,
      /\.update\(\s*\{\s*\[\s*formData\.get\(/,
    ];
    for (const pattern of dangerousPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  test('updateProfileFields source must reference ALLOWED_PROFILE_FIELDS or isAllowedProfileField', () => {
    // Forces future maintainers to see the allowlist when editing this fn.
    // The function must use ONE of these guards.
    const fnStart = source.indexOf('export async function updateProfileFields');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf('export async function', fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd);
    const usesAllowlist =
      fnBody.includes('isAllowedProfileField') ||
      fnBody.includes('ALLOWED_PROFILE_FIELDS');
    expect(usesAllowlist).toBe(true);
  });
});
