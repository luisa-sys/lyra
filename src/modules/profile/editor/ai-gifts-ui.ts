/**
 * KAN-489 — AI gift suggestions in the editor (spec v0.8 §03): the copy and
 * the pure decisions behind `gifts-ai-slot.tsx`, kept here so they can be
 * tested without a DOM.
 *
 * Copy sources: the toggle, Generate, counter, "AI suggestion" badge,
 * Approve / Delete, the refused / no-content / cap / filtered / didn't-fit
 * messages and the not-configured line are from the KAN-489 plan approved
 * against spec v0.8. The consent text was approved by the founder in chat on
 * 2026-11-23 (closing spec v0.8 §03 OPEN DECISION "Confirm AI
 * data-sharing/consent copy"). The limits (10 per editing session, 30 in any
 * 30 days) and the note telling members about them are a founder decision of
 * 2026-11-25 (KAN-492). The cooldown / rate-limit lines are still proposed
 * copy (not in the spec or the plan).
 *
 * PURE: no `'use client'`, no Supabase, no SDK.
 */

import { AI_GIFT_RULE } from '@/modules/profile/profile-rules';
import type { GenerateResult } from '@/modules/profile/ai-gifts/types';

/** Generations allowed per editing session (KAN-492; enforced server-side too). */
export const AI_SESSION_GENERATIONS = 10;

/** Generations allowed per member in any rolling 30 days (KAN-492; enforced server-side). */
export const AI_MONTHLY_GENERATIONS = 30;

/** Shown beside Generate so members know the limits (KAN-492, founder 2026-11-25). */
export const AI_LIMITS_NOTE =
  `You can generate suggestions up to ${AI_SESSION_GENERATIONS} times each time you edit your profile, and up to ${AI_MONTHLY_GENERATIONS} times in any 30 days.`;

export const AI_TOGGLE_LABEL = 'Suggest gift ideas with AI';
export const AI_GENERATE_LABEL = 'Generate suggestions';
export const AI_GENERATING_LABEL = 'Generating…';
export const AI_SUGGESTION_BADGE = 'AI suggestion';
export const AI_APPROVE_LABEL = 'Approve';
export const AI_DELETE_LABEL = 'Delete';
export const AI_APPROVED_PENDING_SAVE = 'Approved, publishes when you save';
export const AI_NOT_CONFIGURED_COPY = 'AI gift suggestions aren’t available yet.';
export const AI_CAP_FULL_COPY = 'Remove a suggestion to generate more';
export const AI_CONSENT_ACK_LABEL = 'Got it';

// Founder-approved consent copy (chat, 2026-11-23; spec v0.8 §03).
// Its version is AI_CONSENT_VERSION in src/modules/profile/ai-gifts/types.ts:
// bump that whenever this text changes (the server records the version).
export const AI_CONSENT_COPY =
  'When on, Lyra sends the text you’ve written on this profile (not your name, location, photo or affiliations) to our AI provider, Anthropic, to suggest gift ideas. Nothing is shown publicly until you approve it.';

export const AI_FILTERED_COPY = 'Some suggestions were filtered out.';
export const AI_REFUSED_COPY = 'We couldn’t generate suggestions from this profile.';
export const AI_FAILED_COPY = 'Something went wrong, try again later.';
export const AI_NO_CONTENT_COPY = 'Add a few things about yourself first.';
export const AI_SESSION_LIMIT_COPY = `You’ve used all ${AI_SESSION_GENERATIONS} generations for this session.`;
export const AI_MONTHLY_LIMIT_COPY = `You’ve used all ${AI_MONTHLY_GENERATIONS} generations for the last 30 days. Please try again later.`;
// Proposed copy (not in the spec or the plan).
export const AI_COOLDOWN_COPY = 'Please wait a few seconds before generating again.';
export const AI_RATE_LIMITED_COPY = 'You’re going a little fast. Please wait a moment and try again.';
export const AI_SIGNED_OUT_COPY = 'Please sign in again to generate suggestions.';
export const AI_CONSENT_REQUIRED_COPY = 'Please reload the editor and read the note about AI suggestions first.';
export const AI_SUSPENDED_COPY = 'AI gift suggestions aren’t available for this account.';
export const AI_APPROVED_ELSEWHERE_COPY =
  'This suggestion is already approved, possibly in another tab. Reload the editor to see its current state.';

/** "n of 10 left this session" (never below 0 or above 10). */
export function aiCounterText(remaining: number): string {
  const n = Math.max(0, Math.min(AI_SESSION_GENERATIONS, Math.floor(remaining)));
  return `${n} of ${AI_SESSION_GENERATIONS} left this session`;
}

export interface GenerateButtonState {
  readOnly: boolean;
  pending: boolean;
  sessionRemaining: number;
  /** AI suggestions held, pending + approved (the cap of 10 counts both). */
  retained: number;
}

/** Generate is off while a request runs, at 0 left, at 10 retained, or read-only. */
export function aiGenerateDisabled(s: GenerateButtonState): boolean {
  return s.readOnly || s.pending || s.sessionRemaining <= 0 || s.retained >= AI_GIFT_RULE.cap;
}

/** True once the member holds the maximum number of AI suggestions. */
export function aiCapReached(retained: number): boolean {
  return retained >= AI_GIFT_RULE.cap;
}

function addedCopy(n: number): string {
  return n === 1 ? 'Added 1 suggestion.' : `Added ${n} suggestions.`;
}

function didntFitCopy(m: number): string {
  const more = m === 1 ? '1 more didn’t fit' : `${m} more didn’t fit`;
  return `${more}: you can keep up to ${AI_GIFT_RULE.cap}. Remove one to make room.`;
}

/** The status line after a Generate. */
export function aiResultMessage(r: GenerateResult): string {
  if (r.ok) {
    const parts: string[] = [];
    if (r.inserted.length > 0) parts.push(addedCopy(r.inserted.length));
    if (r.droppedForCap > 0) parts.push(didntFitCopy(r.droppedForCap));
    if (r.droppedByFilter > 0) parts.push(AI_FILTERED_COPY);
    return parts.length > 0 ? parts.join(' ') : AI_FAILED_COPY;
  }
  switch (r.reason) {
    case 'not_configured':
      return AI_NOT_CONFIGURED_COPY;
    case 'no_content':
      return AI_NO_CONTENT_COPY;
    case 'cap_full':
      return AI_CAP_FULL_COPY;
    case 'session_limit':
      return AI_SESSION_LIMIT_COPY;
    case 'monthly_limit':
      return AI_MONTHLY_LIMIT_COPY;
    case 'cooldown':
      return AI_COOLDOWN_COPY;
    case 'refused':
      return AI_REFUSED_COPY;
    case 'rate_limited':
      return AI_RATE_LIMITED_COPY;
    case 'unauthenticated':
      return AI_SIGNED_OUT_COPY;
    case 'consent_required':
      return AI_CONSENT_REQUIRED_COPY;
    case 'suspended':
      return AI_SUSPENDED_COPY;
    case 'busy':
    case 'failed':
    case 'invalid_session':
      return AI_FAILED_COPY;
    default: {
      const never: never = r.reason;
      return never;
    }
  }
}

/**
 * The counter after a result: the server's figure when it sent one. After a
 * success it is the SMALLER of the session and the rolling 30-day allowance,
 * so the counter never promises a generation the server will refuse; the
 * session or 30-day limit refusals set it to 0.
 */
export function aiRemainingAfter(previous: number, r: GenerateResult): number {
  if (r.ok) return Math.min(r.sessionRemaining, r.monthlyRemaining);
  if (r.reason === 'session_limit' || r.reason === 'monthly_limit') return 0;
  if (r.sessionRemaining !== undefined) return r.sessionRemaining;
  return previous;
}
