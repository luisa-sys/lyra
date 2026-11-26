/**
 * KAN-489 — AI gift suggestions (spec v0.8 §03): shared types and the one
 * shared constant (the consent version).
 *
 * No imports and no side effects. Safe to import from client components (the
 * editor slot reads `GenerateResult` / `GeneratedSuggestion` /
 * `AI_CONSENT_VERSION`) and from the server pipeline.
 */

/**
 * The version of the data-sharing note (`AI_CONSENT_COPY` in
 * editor/ai-gifts-ui.ts) the member accepts before Generate. The editor sends
 * it with every request; the server refuses any other value
 * (`consent_required`) and records it on the claim row
 * (`ai_gift_generations.consent_version`). BUMP IT WHENEVER THE COPY CHANGES.
 * History: 'draft-2026-11-23' (draft for founder review) → 'v1-2026-11-23'
 * (the same text, approved by the founder in chat on 2026-11-23, KAN-489).
 */
export const AI_CONSENT_VERSION = 'v1-2026-11-23';

/** One labelled piece of MEMBER-AUTHORED profile text sent to the model. */
export interface AiGiftSourceField {
  /** Tag name used in the prompt, e.g. `headline`, `favourite_book`. */
  tag: string;
  /** Plain member text (never AI output, never an affiliation or a location). */
  text: string;
}

/** Everything the model may see: member-authored text only. */
export interface AiGiftSource {
  fields: AiGiftSourceField[];
  /** "Things that aren't really for me" titles: the model must avoid them. */
  avoid: string[];
  /** The member's own gift titles: the model must not repeat them. */
  existingGifts: string[];
}

/** A suggestion as the model returned it, after parsing. */
export interface AiSuggestion {
  title: string;
  description: string | null;
}

/** A stored, UNAPPROVED suggestion returned to the editor. */
export interface GeneratedSuggestion {
  id: string;
  title: string;
  description: string | null;
}

/** Why a generation did not run or did not finish. */
export type GenerateFailureReason =
  | 'unauthenticated'
  | 'rate_limited'
  | 'not_configured'
  | 'invalid_session'
  | 'consent_required'
  | 'suspended'
  | 'no_content'
  | 'cap_full'
  | 'session_limit'
  | 'monthly_limit'
  | 'cooldown'
  | 'refused'
  | 'busy'
  | 'failed';

export type GenerateResult =
  | {
      ok: true;
      inserted: GeneratedSuggestion[];
      /** Suggestions that passed every check but did not fit under the cap of 10. */
      droppedForCap: number;
      /** Suggestions removed by the limits, URL, contact, duplicate or moderation checks. */
      droppedByFilter: number;
      sessionRemaining: number;
      monthlyRemaining: number;
    }
  | {
      ok: false;
      reason: GenerateFailureReason;
      /** Present when the server knows the session allowance (claim refusals and later). */
      sessionRemaining?: number;
    };

/**
 * `approved_elsewhere`: the row still exists but is already approved (e.g. in
 * another tab and saved), so Delete removed nothing — it must stay in the
 * editor, which tells the member to reload. `not_found`: the row is gone.
 */
export type DismissResult =
  | { ok: true }
  | { ok: false; reason: 'unauthenticated' | 'rate_limited' | 'not_found' | 'approved_elsewhere' | 'failed' };
