/**
 * BUGS-87 — one place that turns a database error into something a member
 * should read, and records the real one where an engineer can find it.
 *
 * WHY THIS EXISTS
 * ---------------
 * 33 sites across 12 server-action files returned a raw Supabase/Postgres
 * `error.message` straight to the caller. 11 of those reach a member's screen
 * — `gift-extras-section.tsx` renders the string verbatim inside a
 * `role="alert"` paragraph — so a member could be shown
 * `relation "public.gift_suggestion_dismissals" does not exist`, or an
 * internal constraint name like `pcs_prompt_source_xor`.
 *
 * NOT A PLAIN SWEEP: the diagnostic matters more than the leak
 * ------------------------------------------------------------
 * Those files had ZERO logging. The leaked string was the only record the
 * failure had happened anywhere. Replacing it with a generic sentence and
 * stopping there would be a net loss — a silent failure is worse than an ugly
 * one. So `dbErrorFor` does both halves in one call: it reports the real error
 * to Sentry and returns the member-facing copy.
 *
 * ⚠️ WHY THE MATCHERS ARE ANCHORED, NOT GENERIC
 * ---------------------------------------------
 * The mapper this replaces (`capErrorCopy`) used
 *     /limit \(\d+\) reached/
 * deliberately, so "the copy survives future cap changes without a code edit".
 * That generality is a trap the moment the function is shared: it also matches
 * `Profile file limit (10) reached` (20260516180000_profile_files.sql:46).
 * Lifting it verbatim into a shared helper would tell a member who exceeded
 * the TEN-FILE UPLOAD CAP: "You can answer up to 10 prompts. Remove one to add
 * another."
 *
 * That would have landed invisibly — `wizard.tsx` discards the file-upload
 * result today, so no screen or test exercises it — and surfaced later, with
 * no code change, the moment file errors get wired to the UI (which
 * `files-step.tsx` says is the intent).
 *
 * So every matcher below is anchored to its OWN trigger message. Adding a new
 * cap means adding a line here, which is the correct amount of friction for a
 * string a member reads.
 */
import * as Sentry from '@sentry/nextjs';

/** The shape both `supabase-js` errors and thrown Postgres errors satisfy. */
export type DbErrorLike = {
  message?: string | null;
  code?: string | null;
} | null | undefined;

/**
 * What a member sees when we have nothing specific and useful to tell them.
 * Deliberately actionable and free of internal vocabulary.
 */
export const GENERIC_DB_ERROR = 'Something went wrong saving that. Please try again.';

/**
 * Anchored, per-trigger copy. Order still matters for the two
 * conversation-starter caps: `Custom question limit` must be tested before any
 * looser sibling, which is why each entry is anchored at the start of the
 * message rather than searched for anywhere within it.
 *
 * Every message here is quoted verbatim from the migration that raises it, so
 * a `grep` from either direction finds the pair.
 */
const TRIGGER_COPY: ReadonlyArray<readonly [RegExp, string]> = [
  // 20260803160000_kan445_custom_conversation_prompts.sql:248
  [
    /^custom question limit \(\d+\) reached/i,
    'You can write up to 3 of your own questions. Remove one to add another.',
  ],
  // 20260516200200_conversation_starters.sql:31 and its later 5-cap sibling
  [
    /^conversation-starter answer limit \(\d+\) reached/i,
    'You can answer up to 10 prompts. Remove one to add another.',
  ],
  // 20260516180000_profile_files.sql:46 — NOT previously mapped anywhere.
  // Its absence is exactly the collision described in the header: without its
  // own entry it would fall into the conversation-starter copy.
  [
    /^profile file limit \(\d+\) reached/i,
    'You can upload up to 10 files. Remove one to add another.',
  ],
];

/** Postgres SQLSTATEs with copy that is genuinely more useful than the generic. */
const CODE_COPY: Readonly<Record<string, string>> = {
  // unique_violation. The only current use is (profile_id, prompt_id) on
  // profile_conversation_starters — see conversation-starters-actions.ts.
  '23505': 'You already answered this prompt — edit your existing answer instead.',
};

/**
 * Member-facing copy for a database error. PURE — no logging, no side effects,
 * so it can be unit-tested directly. Prefer `dbErrorFor` at call sites, which
 * also records the real error.
 */
export function memberFacingDbError(error: DbErrorLike): string {
  if (!error) return GENERIC_DB_ERROR;

  const message = (error.message ?? '').trim();
  for (const [pattern, copy] of TRIGGER_COPY) {
    if (pattern.test(message)) return copy;
  }

  const code = (error.code ?? '').trim();
  if (code && code in CODE_COPY) return CODE_COPY[code];

  return GENERIC_DB_ERROR;
}

/**
 * Record the real error, return what the member should read.
 *
 * `area` is a short, stable identifier for the call site (e.g.
 * 'gift-dismissals'). It is the thing an engineer greps for when a member says
 * "it just said something went wrong", so make it specific.
 *
 * A recognised trigger message is NOT reported to Sentry: hitting a documented
 * cap is the product working, not a fault, and paging on it would train people
 * to ignore the channel.
 */
export function dbErrorFor(area: string, error: DbErrorLike): string {
  const copy = memberFacingDbError(error);

  if (error && copy === GENERIC_DB_ERROR) {
    Sentry.captureException(
      new Error(`${area}: ${error.message ?? 'unknown database error'}`),
      { tags: { area, ticket: 'BUGS-87' }, extra: { code: error.code ?? null } },
    );
  }

  return copy;
}
