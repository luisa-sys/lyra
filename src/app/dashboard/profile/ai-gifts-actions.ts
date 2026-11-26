'use server';

/**
 * KAN-489 — AI gift suggestion server actions (spec v0.8 §03).
 *
 *   generateAiGifts(sessionId, consentVersion)
 *                               one generation: auth → rate limit → the
 *                               pipeline in src/modules/profile/ai-gifts/
 *                               generate.ts (configured → consent → content →
 *                               cap → server-side claim → model → filter →
 *                               insert). `consentVersion` must be the
 *                               current AI_CONSENT_VERSION; it is recorded on
 *                               the claim row.
 *   dismissAiGift(id)           delete ONE pending (unapproved) suggestion
 *
 * Nothing here publishes: new suggestions are stored unapproved and private;
 * approving happens in the editor and is committed by Save (`ai_gifts`).
 *
 * CTL-056: zero `.from` / `.rpc` calls here. CTL-037: the key is read through
 * env.ts only and never logged or returned. Gotcha #18: a `'use server'` file
 * exports async functions only.
 */

import { createClient } from '@/modules/platform/supabase-server';
import { env } from '@/modules/platform/env';
import { checkProfileWriteRateLimit } from '@/modules/guards/profile-rate-limit';
import { createGiftModel } from '@/modules/profile/ai-gifts/client';
import { generateAiGiftSuggestions, isUuid } from '@/modules/profile/ai-gifts/generate';
import { dismissPendingSuggestion } from '@/modules/profile/ai-gifts/store';
import type { DismissResult, GenerateResult } from '@/modules/profile/ai-gifts/types';

export async function generateAiGifts(sessionId: string, consentVersion: string): Promise<GenerateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };

  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) return { ok: false, reason: 'rate_limited' };

  const model = env.aiGiftsConfigured() ? createGiftModel(env.anthropicApiKey()) : null;
  try {
    return await generateAiGiftSuggestions({ supabase, model }, { userId: user.id, sessionId, consentVersion });
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export async function dismissAiGift(id: string): Promise<DismissResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };

  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) return { ok: false, reason: 'rate_limited' };

  if (!isUuid(id)) return { ok: false, reason: 'not_found' };
  try {
    return await dismissPendingSuggestion(supabase, id);
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
