/**
 * KAN-484 — data access for the admin question bank (spec v0.8 §09).
 *
 * The admin routes (src/app/admin/questions/**) call these instead of querying
 * directly, so they stay thin (CTL-056). Every function takes the service-role
 * client the caller already obtained AFTER verifying the requester is an admin;
 * `conversation_starter_prompts` has no write policy for any user role.
 *
 * There is deliberately no delete function. See question-bank.ts.
 */

import type { getAdminServiceClient } from './admin';
import type { QuestionInput, OrderedQuestion } from './question-bank';

type ServiceClient = ReturnType<typeof getAdminServiceClient>;

export interface QuestionRow {
  id: string;
  prompt: string;
  sort_order: number;
  is_active: boolean;
  answer_max: number;
}

export type StoreResult = { ok: true } | { ok: false; code: string | null; message: string };

function fail(error: { code?: string | null; message?: string | null }): StoreResult {
  return { ok: false, code: error.code ?? null, message: error.message ?? 'unknown database error' };
}

/** Every preset question, in display order. `*` so a DB without
 *  `answer_max` yet does not 42703 the admin screen. */
export async function listQuestions(svc: ServiceClient): Promise<QuestionRow[]> {
  const { data, error } = await svc
    .from('conversation_starter_prompts')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`Could not load questions: ${error.message}`);
  return (data ?? []) as QuestionRow[];
}

/** id + sort_order, optionally only the active questions. */
export async function listQuestionOrder(svc: ServiceClient, activeOnly: boolean): Promise<OrderedQuestion[]> {
  let query = svc.from('conversation_starter_prompts').select('id, sort_order');
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read questions: ${error.message}`);
  return (data ?? []) as OrderedQuestion[];
}

export async function insertQuestion(svc: ServiceClient, input: QuestionInput, sortOrder: number): Promise<StoreResult> {
  const { error } = await svc.from('conversation_starter_prompts').insert({
    prompt: input.prompt,
    answer_max: input.answerMax,
    sort_order: sortOrder,
    is_active: true,
  });
  return error ? fail(error) : { ok: true };
}

export async function updateQuestionText(svc: ServiceClient, id: string, input: QuestionInput): Promise<StoreResult> {
  const { error } = await svc
    .from('conversation_starter_prompts')
    .update({ prompt: input.prompt, answer_max: input.answerMax })
    .eq('id', id);
  return error ? fail(error) : { ok: true };
}

export async function setQuestionActiveFlag(svc: ServiceClient, id: string, active: boolean): Promise<StoreResult> {
  const { error } = await svc
    .from('conversation_starter_prompts')
    .update({ is_active: active })
    .eq('id', id);
  return error ? fail(error) : { ok: true };
}

export async function setQuestionSortOrder(svc: ServiceClient, id: string, sortOrder: number): Promise<StoreResult> {
  const { error } = await svc
    .from('conversation_starter_prompts')
    .update({ sort_order: sortOrder })
    .eq('id', id);
  return error ? fail(error) : { ok: true };
}
