/**
 * KAN-445 — shared limits for the "A bit more about me" section.
 *
 * Lives here rather than in `conversation-starters-actions.ts` because that
 * file is `'use server'`, and a `'use server'` module may export ONLY async
 * functions — a plain `export const` there is accepted by the build and then
 * throws at action-invocation time in production (gotcha #18 / BUGS-12).
 *
 * Every number below mirrors a database constraint, so the two must move
 * together:
 *   ANSWER_MAX         -> profile_conversation_starters_answer_check (500)
 *   CUSTOM_PROMPT_MAX  -> pcs_custom_prompt_length (140)
 *   CUSTOM_ANSWER_CAP  -> enforce_pcs_custom_cap() (3)
 *   ANSWER_CAP         -> enforce_pcs_cap() (10 on dev/staging/prod today)
 */

/** Longest answer, mirroring the DB CHECK on `answer`. */
export const ANSWER_MAX = 500;

/** Longest member-written question, mirroring `pcs_custom_prompt_length`. */
export const CUSTOM_PROMPT_MAX = 140;

/** How many questions a member may write themselves. */
export const CUSTOM_ANSWER_CAP = 3;

/** Total answered prompts per profile, mirroring `enforce_pcs_cap()`. */
export const ANSWER_CAP = 10;
