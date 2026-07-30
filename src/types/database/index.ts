/**
 * KAN-414 F6 — the generated `Database` schema type.
 *
 * WHY THREE FILES
 * ---------------
 * `dev.ts`, `staging.ts` and `prod.ts` are the schemas of the three Supabase
 * projects, generated verbatim and committed unmodified. They are NOT
 * interchangeable: the environments have measured, intentional drift (KAN-420
 * R5), so no single file is a truthful description of all three.
 *
 *   staging -> prod   prod is MISSING: discoverable_by_phone,
 *                     discoverable_by_postcode, phone_search_hash,
 *                     postcode_search_hash (KAN-153); the `draft` label on
 *                     visibility_level (KAN-143); and the functions
 *                     search_by_contact_hash + e2e_fix_auth_tokens.
 *   dev -> staging    dev is MISSING gathering_invite_messages.claimed_at
 *                     (BUGS-62 — promotion ran backwards past dev).
 *
 * Those files carry no hand-written header on purpose. They must stay
 * byte-identical to `supabase gen types` output so a regeneration diff is
 * signal, not noise — a header would show up in every regeneration and train
 * a reader to skim the diff.
 *
 * WHY `dev` IS THE ONE THE APP COMPILES AGAINST
 * ----------------------------------------------
 * It is the superset, and it is where code is written. The alternatives are
 * both worse:
 *
 *   * Typing against `prod` would fail the build on code that legitimately
 *     exists and is exercised on dev and staging (the KAN-153 discoverability
 *     path). A type that will not compile working code gets deleted.
 *   * Typing against an intersection would leave real columns untyped, which
 *     is the status quo this ticket exists to end.
 *
 * The cost is explicit and must not be forgotten: **this type asserts that
 * prod has columns it does not have.** `phone_search_hash`,
 * `postcode_search_hash`, `discoverable_by_phone`, `discoverable_by_postcode`
 * and the `draft` visibility label typecheck everywhere and are absent on
 * production. TypeScript will not catch that; only the drift gate will, which
 * is why `scripts/check-schema-type-parity.py` is a blocking control and not
 * a report. Closing the gap is F7's job (SEC-107).
 *
 * Import from here, never from `dev.ts` directly — the indirection is what
 * lets F7 change the canonical target in one line once parity lands.
 */

export type { Database, Json } from './dev';

/**
 * The Supabase project each committed schema was generated from. Used by the
 * drift gate and by anything that needs to name an environment's schema
 * without hardcoding a ref in two places.
 */
export const SCHEMA_PROJECT_REFS = {
  dev: 'ilprytcrnqyrsbsrfujj',
  staging: 'uobmlkzrjkptwhttzmmi',
  prod: 'llzkgprqewuwkiwclowi',
} as const;

export type SchemaEnv = keyof typeof SCHEMA_PROJECT_REFS;
