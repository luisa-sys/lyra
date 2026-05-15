/**
 * KAN-154 — "Manual of Me" field allowlist + per-field max-length limits.
 *
 * Lives in this sibling module (rather than alongside the server action
 * in `manual-of-me-actions.ts`) because Next.js 16+ rejects non-async-function
 * exports from `'use server'` files at action-invocation time. See BUGS-12 /
 * CLAUDE.md gotcha #18.
 *
 * v1 fields (4):
 *   - communication_style   — how the user likes to be communicated with
 *   - working_preferences   — best ways to work with this person (long text)
 *   - energises_me          — what energises them at work
 *   - drains_me             — what drains their energy
 *
 * Excluded for v1:
 *   - "hot buttons"               (overlaps with dislikes/boundaries items)
 *   - "how I handle disagreement" (niche, low demand)
 *   - "preferred feedback style"  (possible v2)
 */

export const MANUAL_OF_ME_FIELDS = [
  'communication_style',
  'working_preferences',
  'energises_me',
  'drains_me',
] as const;

export type ManualOfMeField = typeof MANUAL_OF_ME_FIELDS[number];

/** Per-field max length (passed to sanitiseText). working_preferences is
 * intentionally longer because it's the "main" free-text field. */
export const MANUAL_OF_ME_MAX_LENGTHS: Record<ManualOfMeField, number> = {
  communication_style: 500,
  working_preferences: 1000,
  energises_me: 500,
  drains_me: 500,
};

export function isManualOfMeField(key: string): key is ManualOfMeField {
  return (MANUAL_OF_ME_FIELDS as readonly string[]).includes(key);
}

/** Shape returned by the loader and used by the wizard step + public view. */
export interface ManualOfMe {
  communication_style: string | null;
  working_preferences: string | null;
  energises_me: string | null;
  drains_me: string | null;
}

/** True if every field is null or empty-after-trim. Public view uses this to
 * decide whether to skip the entire "How to work with me" section. */
export function isManualOfMeEmpty(m: ManualOfMe | null | undefined): boolean {
  if (!m) return true;
  return MANUAL_OF_ME_FIELDS.every((k) => {
    const v = m[k];
    return v === null || v === undefined || v.trim() === '';
  });
}
