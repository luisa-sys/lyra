/**
 * KAN-143 — Per-item visibility levels.
 *
 * The canonical enum values live in the Postgres `visibility_level` type
 * (see supabase/migrations/20260324061701_create_lyra_schema.sql and
 *  20260514054350_profile_items_visibility.sql).
 *
 * This module is imported from `'use server'` files. Per BUGS-12, runtime
 * constants must NOT be exported from action files — so they live here.
 */

export const VISIBILITY_LEVELS = ['public', 'members_only', 'draft'] as const;

export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number];

export const DEFAULT_VISIBILITY: VisibilityLevel = 'public';

/**
 * Legacy alias: 'private' was the original third value before KAN-143 renamed
 * it to 'draft'. We treat 'private' as equivalent to 'draft' on read so old
 * rows continue to be hidden from public viewers. The enum keeps 'private' for
 * backward-compat; new writes should use 'draft'.
 */
export function isAllowedVisibility(value: unknown): value is VisibilityLevel {
  return (
    typeof value === 'string' &&
    (VISIBILITY_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Coerce any string into a valid VisibilityLevel; unknown values fall back
 * to the default ('public'). 'private' is preserved as-is (treated as draft
 * by the filter functions below).
 */
export function coerceVisibility(value: unknown): VisibilityLevel {
  return isAllowedVisibility(value) ? value : DEFAULT_VISIBILITY;
}

/**
 * Decide whether a single item is visible to a given viewer.
 *
 * @param visibility  the item's stored visibility ('public' | 'members_only' | 'draft' | 'private' | unknown)
 * @param isAuthenticated  true if the viewer is signed in
 * @returns true if the viewer should see the item, false otherwise
 */
export function isItemVisibleToViewer(
  visibility: unknown,
  isAuthenticated: boolean,
): boolean {
  // Normalise: treat anything we don't recognise (including 'private' and
  // unexpected strings) as draft — fail closed.
  if (visibility === 'public') return true;
  if (visibility === 'members_only') return isAuthenticated;
  // 'draft', 'private', null, undefined, garbage → hidden from public view.
  return false;
}

/**
 * Filter an array of items down to those visible to the viewer. Stable order.
 */
export function filterItemsByVisibility<T extends { visibility?: unknown }>(
  items: readonly T[],
  isAuthenticated: boolean,
): T[] {
  return items.filter((item) => isItemVisibleToViewer(item.visibility, isAuthenticated));
}
