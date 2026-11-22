/**
 * KAN-484 — pure rules for the admin question bank (spec v0.8 §09).
 *
 * Kept free of I/O so it can be unit-tested directly and imported by the
 * `'use server'` actions file (which may only export async functions —
 * gotcha #18).
 *
 * The rules that matter, from v0.8 §09:
 *   - Each preset has a permanent ID, wording, answer limit, active flag and
 *     display order; answers refer to the permanent ID.
 *   - Deactivating never removes answers. There is therefore NO delete here —
 *     not as an action, not as a helper.
 *   - A substantive rewrite should use a NEW question (new ID) so older answers
 *     keep their meaning. The admin screen says so beside the wording field;
 *     this module cannot judge meaning, only shape.
 */

/** Bounds an admin may set for a preset's answer limit — mirrors the DB
 *  CHECK `csp_answer_max_range` (20261122120000_kan484_question_bank.sql). */
export const PRESET_ANSWER_MAX_MIN = 50;
export const PRESET_ANSWER_MAX_MAX = 2000;

/** Longest preset question wording an admin may enter. */
export const PRESET_PROMPT_MAX = 300;

export interface QuestionInput {
  prompt: string;
  answerMax: number;
}

export type QuestionValidation = { ok: true; value: QuestionInput } | { ok: false; error: string };

/** Collapse internal whitespace and trim; strip anything that looks like markup. */
export function cleanPromptText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Validate an admin-entered question. Never truncates: too long is an error. */
export function validateQuestionInput(rawPrompt: unknown, rawAnswerMax: unknown): QuestionValidation {
  const prompt = cleanPromptText(rawPrompt);
  if (prompt.length === 0) return { ok: false, error: 'The question cannot be empty.' };
  if (prompt.length > PRESET_PROMPT_MAX) {
    return { ok: false, error: `The question must be ${PRESET_PROMPT_MAX} characters or fewer.` };
  }
  const n = typeof rawAnswerMax === 'number' ? rawAnswerMax : Number(String(rawAnswerMax ?? '').trim());
  if (!Number.isInteger(n) || n < PRESET_ANSWER_MAX_MIN || n > PRESET_ANSWER_MAX_MAX) {
    return {
      ok: false,
      error: `The answer limit must be a whole number from ${PRESET_ANSWER_MAX_MIN} to ${PRESET_ANSWER_MAX_MAX}.`,
    };
  }
  return { ok: true, value: { prompt, answerMax: n } };
}

export interface OrderedQuestion {
  id: string;
  sort_order: number;
}

/** The sort_order for a newly added question: after every existing one. */
export function nextSortOrder(rows: readonly OrderedQuestion[]): number {
  const max = rows.reduce((m, r) => Math.max(m, Number.isFinite(r.sort_order) ? r.sort_order : 0), 0);
  return max + 10;
}

/**
 * Moving a question up or down swaps its sort_order with its neighbour in
 * the given (already-sorted) list. Returns the two updates to apply, or null
 * when the move is impossible (unknown id, or already at that end).
 *
 * Only sort_order changes — never the id — which is why reordering can never
 * reassign an answer (answers key on id).
 */
export function swapForMove(
  rows: readonly OrderedQuestion[],
  id: string,
  direction: 'up' | 'down',
): [{ id: string; sort_order: number }, { id: string; sort_order: number }] | null {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const i = sorted.findIndex((r) => r.id === id);
  if (i === -1) return null;
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= sorted.length) return null;
  const a = sorted[i];
  const b = sorted[j];
  // Equal sort_orders would make a swap a no-op; space them apart first.
  const aOrder = a.sort_order === b.sort_order ? b.sort_order + (direction === 'up' ? -1 : 1) : b.sort_order;
  return [
    { id: a.id, sort_order: aOrder },
    { id: b.id, sort_order: a.sort_order },
  ];
}
