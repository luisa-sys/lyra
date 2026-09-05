/**
 * KAN-241 (part of KAN-63 Tier 2): policy wrapper around `content-moderation`.
 *
 * The library exposes `moderateContent(text, fieldType)` which returns
 * structured flags + a severity grade. This wrapper consumes that result
 * and turns it into the action-decision the server actions need:
 *
 *   - severity 'block' → return a user-friendly error string; caller
 *     bails out without writing to the DB.
 *   - severity 'warn'  → return ok=true but log to console so admin
 *     monitoring picks it up. Future iteration replaces the console
 *     log with a `moderation_events` table insert.
 *   - severity 'none'  → return ok=true silently.
 *
 * The error string deliberately reports only category-level flags
 * ('profanity', 'pii', 'spam') and NOT the specific matched word.
 * Surfacing the exact match would let an attacker binary-search the
 * profanity wordlist by feeding inputs and reading rejection details.
 *
 * Lives in `src/lib/` (not in any `'use server'` file) per BUGS-12 —
 * non-async-function exports must stay outside server-action modules.
 */

import { moderateContent, type FieldType } from './content-moderation';

export type CheckResult =
  | { ok: true }
  | { ok: false; error: string; flags: string[] };

/**
 * Run text through the moderation library, apply the policy decision.
 *
 * @param text       The text to check. NULL/undefined/empty → pass.
 * @param fieldType  'public' (default) for fields that appear on the
 *                   public profile (item titles, bios, etc.). 'private'
 *                   for owner-only fields — currently none on Lyra; the
 *                   parameter exists so future private-field flows are
 *                   easy to wire.
 * @param fieldName  Optional — included in the warn-log so admin sees
 *                   which field triggered. Not surfaced in the error
 *                   string (keeps category-only error policy).
 */
export function checkModeration(
  text: string | null | undefined,
  fieldType: FieldType = 'public',
  fieldName?: string,
): CheckResult {
  if (!text) return { ok: true };

  const result = moderateContent(text, fieldType);

  if (result.severity === 'block') {
    return {
      ok: false,
      error: buildErrorMessage(result.flags),
      flags: result.flags,
    };
  }

  if (result.severity === 'warn') {
    // Console.warn lands in Vercel function logs + (after KAN-104)
    // Sentry breadcrumbs. Replace with a moderation_events table insert
    // when admin review surface lands.
    console.warn('[moderation] warn-level flag', {
      field: fieldName ?? '(unspecified)',
      flags: result.flags,
      preview: text.slice(0, 80),
    });
  }

  return { ok: true };
}

/**
 * Category-only error message. Never includes the exact match — that
 * would expose the wordlist by trial and error.
 */
function buildErrorMessage(flags: string[]): string {
  // flags look like 'profanity:fuck', 'pii:email', 'spam:repeated_chars'.
  // Keep only the category before the colon, dedupe.
  const categories = Array.from(
    new Set(flags.map((f) => f.split(':')[0]).filter(Boolean)),
  );
  const friendly = categories
    .map((c) =>
      c === 'profanity'
        ? 'inappropriate language'
        : c === 'pii'
          ? 'personal information that should not be in public fields (e.g. phone, email)'
          : c === 'spam'
            ? 'spam-like patterns'
            : c,
    )
    .join(', ');
  return `Content rejected: ${friendly}. Please edit and try again.`;
}
