/**
 * KAN-484 — read a preset question's answer limit (spec v0.8 §09).
 *
 * Lives in the module, not the route file, so
 * src/app/dashboard/profile/conversation-starters-actions.ts stays thin
 * (CTL-056). RLS lets a member read active presets and presets their own
 * answers already reference, so an unknown or retired-and-unanswered question
 * resolves to `{ found: false }`.
 *
 * Returns the RAW `answer_max`; the caller clamps it with `answerLimitFor`
 * from src/app/dashboard/profile/conversation-starters-fields.ts. (A module may
 * not import from src/app — the blocking `no-module-to-app` rule — so the
 * constants stay in that app-side file.)
 *
 * The app-level cap is a courtesy: the DB trigger `enforce_pcs_answer_max()`
 * is the real gate.
 */

import type { createClient } from '@/modules/platform/supabase-server';

type SessionClient = Awaited<ReturnType<typeof createClient>>;

export type PresetLimitLookup = { found: true; answerMax: number | null } | { found: false };

export async function fetchPresetAnswerMax(supabase: SessionClient, promptId: string): Promise<PresetLimitLookup> {
  const { data, error } = await supabase
    .from('conversation_starter_prompts')
    .select('answer_max')
    .eq('id', promptId)
    .single();
  if (error || !data) return { found: false };
  const raw = (data as { answer_max?: number | null }).answer_max;
  return { found: true, answerMax: typeof raw === 'number' ? raw : null };
}
