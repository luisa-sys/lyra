/**
 * KAN-489 — AI gift suggestions: one generation, end to end (spec v0.8 §03).
 *
 * Order matters — every check that can refuse WITHOUT spending money runs
 * before the claim:
 *   1. configured? (no key or switch off → `not_configured`, nothing else runs)
 *   2. the member accepted the CURRENT data-sharing note? (`consent_required`)
 *   3. session id is a UUID?
 *   4. load the member-authored source; nothing usable → `no_content`
 *   5. already 10 AI suggestions held → `cap_full`
 *   6. claim a generation (server-side limits: 5 per session, 20 per 24 h,
 *      10 s cooldown; suspended accounts refused). The claim records the
 *      consent version. A refusal is returned as is; a claim ERROR is
 *      `failed` and the model is NOT called (fail closed).
 *   7. model → parse → filter (incl. the avoid list) → insert (unapproved,
 *      private). Once a claim is spent, any exception still returns the
 *      server's `sessionRemaining`, so the editor's counter never overstates.
 *
 * `deps` are injected so tests run without Supabase or the SDK.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_GIFT_RULE } from '@/modules/profile/profile-rules';
import type { GiftModel } from './client';
import { filterSuggestions, type Moderate } from './filter';
import { parseSuggestions } from './parse';
import { buildGiftPrompt, hasUsableContent } from './prompt';
import { loadMemberAuthoredSource, type LoadedAiGiftSource } from './source';
import { claimGeneration, insertSuggestions, type ClaimResult, type InsertResult } from './store';
import { AI_CONSENT_VERSION, type AiSuggestion, type GenerateResult } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export interface GenerateDeps {
  supabase: SupabaseClient;
  /** Null when no API key is configured. */
  model: GiftModel | null;
  moderate?: Moderate;
  loadSource?: (supabase: SupabaseClient, userId: string) => Promise<LoadedAiGiftSource | null>;
  claim?: (supabase: SupabaseClient, sessionId: string, consentVersion: string) => Promise<ClaimResult>;
  insert?: (supabase: SupabaseClient, kept: readonly AiSuggestion[]) => Promise<InsertResult>;
}

export async function generateAiGiftSuggestions(
  deps: GenerateDeps,
  input: { userId: string; sessionId: unknown; consentVersion: unknown },
): Promise<GenerateResult> {
  const { supabase, model } = deps;
  const loadSource = deps.loadSource ?? loadMemberAuthoredSource;
  const claim = deps.claim ?? claimGeneration;
  const insert = deps.insert ?? insertSuggestions;

  if (model === null) return { ok: false, reason: 'not_configured' };
  if (input.consentVersion !== AI_CONSENT_VERSION) return { ok: false, reason: 'consent_required' };
  if (!isUuid(input.sessionId)) return { ok: false, reason: 'invalid_session' };

  const loaded = await loadSource(supabase, input.userId);
  if (loaded === null) return { ok: false, reason: 'failed' };
  if (!hasUsableContent(loaded.source)) return { ok: false, reason: 'no_content' };
  if (loaded.aiCount >= AI_GIFT_RULE.cap) return { ok: false, reason: 'cap_full' };

  const claimed = await claim(supabase, input.sessionId, AI_CONSENT_VERSION);
  if (!claimed.ok) {
    if (claimed.reason === 'error') return { ok: false, reason: 'failed' };
    return claimed.sessionRemaining === null
      ? { ok: false, reason: claimed.reason }
      : { ok: false, reason: claimed.reason, sessionRemaining: claimed.sessionRemaining };
  }
  const sessionRemaining = claimed.sessionRemaining;

  try {
    const outcome = await model.suggest(buildGiftPrompt(loaded.source));
    if (!outcome.ok) return { ok: false, reason: outcome.reason, sessionRemaining };

    const parsed = parseSuggestions(outcome.json);
    const filtered = await filterSuggestions(
      supabase,
      parsed,
      { existingTitles: loaded.existingTitles, avoid: loaded.source.avoid, profileId: loaded.profileId },
      deps.moderate,
    );

    const stored = await insert(supabase, filtered.kept);
    if (!stored.ok) return { ok: false, reason: 'failed', sessionRemaining };

    return {
      ok: true,
      inserted: stored.inserted,
      droppedForCap: stored.droppedForCap,
      droppedByFilter: filtered.droppedByFilter,
      sessionRemaining,
      dailyRemaining: claimed.dailyRemaining,
    };
  } catch {
    // The claim is spent (no refund by design): report the real allowance.
    return { ok: false, reason: 'failed', sessionRemaining };
  }
}
