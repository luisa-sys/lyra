/**
 * KAN-445 / KAN-484 — shared limits for the "Random Questions & Answers"
 * section (spec v0.8 §09).
 *
 * Lives here rather than in `conversation-starters-actions.ts` because that
 * file is `'use server'`, and a `'use server'` module may export ONLY async
 * functions — a plain `export const` there is accepted by the build and then
 * throws at action-invocation time in production (gotcha #18 / BUGS-12).
 *
 * Every number below mirrors a database constraint, so the two must move
 * together (20261122120000_kan484_question_bank.sql):
 *   CUSTOM_ANSWER_MAX  -> enforce_pcs_answer_max() for prompt_id IS NULL (500)
 *   CUSTOM_PROMPT_MAX  -> pcs_custom_prompt_length (180)
 *   CUSTOM_ANSWER_CAP  -> enforce_pcs_custom_cap() (10)
 *   ANSWER_HARD_MAX    -> pcs_answer_length (2000) — the table-level ceiling;
 *                         the real per-question limit is the prompt's
 *                         `answer_max`, enforced by enforce_pcs_answer_max().
 *
 * There is deliberately NO total-answer cap any more: v0.8 allows every active
 * preset plus 10 custom questions, and previously answered inactive presets
 * may remain on top, so "active + 10" is not a ceiling.
 */

/** Longest answer to a member-written question. */
export const CUSTOM_ANSWER_MAX = 500;

/** Longest member-written question, mirroring `pcs_custom_prompt_length`. */
export const CUSTOM_PROMPT_MAX = 180;

/** How many questions a member may write themselves. */
export const CUSTOM_ANSWER_CAP = 10;

/** Table-level ceiling on any answer, mirroring `pcs_answer_length`. */
export const ANSWER_HARD_MAX = 2000;

/** Fallback when a preset's `answer_max` is unavailable (matches the DB default). */
export const DEFAULT_PRESET_ANSWER_MAX = 500;

/**
 * The answer limit for one answer: the preset's own limit, or the custom
 * limit for a member-written question. Clamped to the table ceiling so a bad
 * value can never let the app send something the database will reject.
 */
export function answerLimitFor(answerMax: number | null | undefined, isCustom: boolean): number {
  if (isCustom) return CUSTOM_ANSWER_MAX;
  const n = typeof answerMax === 'number' && Number.isFinite(answerMax) ? answerMax : DEFAULT_PRESET_ANSWER_MAX;
  return Math.max(1, Math.min(n, ANSWER_HARD_MAX));
}
