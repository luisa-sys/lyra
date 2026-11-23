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

/**
 * The shape both `supabase-js` errors and thrown Postgres errors satisfy.
 * `details` / `hint` are PostgREST's names for Postgres DETAIL / HINT
 * (KAN-487: `save_profile` puts its jsonb error context in DETAIL).
 */
export type DbErrorLike = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
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
  // 20261122120000_kan484_question_bank.sql (cap raised 3 -> 10, spec v0.8 §09;
  // first introduced in 20260803160000_kan445_custom_conversation_prompts.sql)
  [
    /^custom question limit \(\d+\) reached/i,
    'You can write up to 10 of your own questions. Remove one to add another.',
  ],
  // 20261122120000_kan484_question_bank.sql — enforce_pcs_answer_max()
  [
    /^answer is longer than \d+ characters/i,
    'That answer is longer than this question allows. Please shorten it.',
  ],
  // 20261122120000_kan484_question_bank.sql — enforce_pcs_answer_max()
  [
    /^unknown question/i,
    'That question is no longer available.',
  ],
  // 20260516200200_conversation_starters.sql:31 and its later 5-cap sibling.
  // KAN-484 drops this trigger; the entry stays until the migration has
  // reached every environment, because code is promoted ahead of migrations.
  [
    /^conversation-starter answer limit \(\d+\) reached/i,
    'You can answer up to 10 prompts. Remove one to add another.',
  ],
  // 20261123090000_kan485_profile_model_v08.sql — enforce_profile_item_rules()
  // and enforce_affiliation_rules() (spec v0.8 per-section caps and limits).
  [/^section limit \(\d+\) reached/i, 'You’ve reached the limit for this section. Remove an entry to add another.'],
  [/^title is required/i, 'Please add a title.'],
  [/^title is longer than \d+ characters/i, 'That title is too long. Please shorten it.'],
  [/^description is longer than \d+ characters/i, 'That description is too long. Please shorten it.'],
  [/^links must start with http/i, 'Links must start with http:// or https://.'],
  [/^name is required/i, 'Please add a name.'],
  [/^name is longer than \d+ characters/i, 'That name is too long. Please shorten it.'],
  [/^location is longer than \d+ characters/i, 'That location is too long. Please shorten it.'],
  [/^postcode is required for a school/i, 'Please add the school’s postcode.'],
  [/^postcode is longer than \d+ characters/i, 'That postcode is too long.'],
  // 20261123090000_kan485_profile_model_v08.sql — enforce_profile_identity_rules()
  [/^invalid checklyra id/i, 'Use 3–30 letters, numbers or underscores for your CheckLyra ID.'],
  [/^reserved checklyra id/i, 'That ID is reserved. Please choose another.'],
  // 20261123130000_kan490_v08_data_migration.sql — enforce_lyra_id_not_retired()
  // (another profile's pre-v0.8 slug, kept so its old links still redirect)
  [/^retired checklyra id/i, 'That CheckLyra ID is already taken.'],
  [/^checklyra id cannot be changed after publishing/i, 'Your CheckLyra ID can’t be changed after publishing.'],
  [/^publishing needs a profile photo/i, 'Add a profile photo to publish.'],
  [/^publishing needs a display name/i, 'Add a display name to publish.'],
  [/^publishing needs a checklyra id/i, 'Choose your CheckLyra ID to publish.'],
  [/^a published profile needs a profile photo/i, 'A published profile needs a photo. Add a new photo before removing this one.'],
  // KAN-487 (spec v0.8 §1/§3) — public.save_profile(jsonb, text). The first
  // two are already member copy and pass through verbatim.
  [
    /^your profile was saved somewhere else/i,
    'Your profile was saved somewhere else. Reload to see the latest version.',
  ],
  [
    /^some entries no longer exist/i,
    'Some entries no longer exist. Reload to see your latest profile.',
  ],
  [/^editor is out of date/i, 'Editor is out of date. Reload to continue.'],
  // save_profile refuses a blank display_name on a published profile.
  [/^add a display name$/i, 'Add a display name'],
  // 20260516180000_profile_files.sql:46 — NOT previously mapped anywhere.
  // Its absence is exactly the collision described in the header: without its
  // own entry it would fall into the conversation-starter copy.
  [
    /^profile file limit \(\d+\) reached/i,
    'You can upload up to 10 files. Remove one to add another.',
  ],
];

/**
 * KAN-487 — unique violations keyed on the constraint they name. Before this,
 * every 23505 got the conversation-starter copy, so a taken CheckLyra ID told
 * the member "You already answered this prompt". Postgres puts the constraint
 * name in the message (`duplicate key value violates unique constraint "…"`);
 * `details` is searched too because callers may surface it there.
 *
 *   profiles_slug_lower_key — 20261123090000_kan485_profile_model_v08.sql:72
 *   profiles_slug_idx       — 20260324061701_create_lyra_schema.sql:29
 *   profiles_slug_key       — the implicit `slug text unique` constraint (:14)
 */
const UNIQUE_CONSTRAINT_COPY: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bprofiles_slug_(lower_key|key|idx)\b/i, 'That CheckLyra ID is already taken.'],
];

/** Postgres SQLSTATEs with copy that is genuinely more useful than the generic. */
const CODE_COPY: Readonly<Record<string, string>> = {
  // unique_violation not matched above. The remaining use is
  // (profile_id, prompt_id) on profile_conversation_starters — see
  // conversation-starters-actions.ts.
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
  if (code === '23505') {
    const haystack = `${message}\n${error.details ?? ''}`;
    for (const [pattern, copy] of UNIQUE_CONSTRAINT_COPY) {
      if (pattern.test(haystack)) return copy;
    }
  }
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
      {
        tags: { area, ticket: 'BUGS-87' },
        extra: { code: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null },
      },
    );
  }

  return copy;
}

/** Where in a `save_profile` payload the failing statement was (KAN-487). */
export type SaveErrorDetail = { section: string; clientKey: string | null };

/**
 * KAN-487 (plan §B "Error context") — parse the DETAIL that `save_profile`
 * attaches to every error it re-raises:
 *     jsonb_build_object('section', v_section, 'client_key', v_client_key)::text
 * so the editor can point at the row that failed. PURE. Returns null for
 * anything that is not exactly that shape (a plain Postgres DETAIL such as
 * `Key (lower(slug))=(x) already exists.`, invalid JSON, a missing or empty
 * section, a non-string client_key).
 */
export function parseSaveErrorDetail(details: string | null | undefined): SaveErrorDetail | null {
  if (typeof details !== 'string' || details.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { section, client_key: clientKey } = parsed as Record<string, unknown>;
  if (typeof section !== 'string' || section.trim() === '') return null;
  if (clientKey === undefined || clientKey === null) return { section, clientKey: null };
  if (typeof clientKey !== 'string' || clientKey === '') return null;
  return { section, clientKey };
}
