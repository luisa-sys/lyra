'use server';

/**
 * KAN-484 — admin question bank (spec v0.8 §09; founder decision 2026-11-22:
 * managed from an admin screen rather than a config file).
 *
 * Every action follows the setGlobalFeature pattern
 * (src/app/admin/features/actions.ts):
 *   1. Re-check admin — never trust the client.
 *   2. Validate input with the pure rules in src/modules/admin/question-bank.ts.
 *   3. Audit-first: one moderation_logs row, abort if it fails.
 *   4. Service-role write through src/modules/admin/question-bank-store.ts
 *      (conversation_starter_prompts has no write policy for any user role).
 *
 * There is deliberately NO delete action. v0.8: deactivating a preset never
 * removes existing answers, and answers reference the permanent ID — a deleted
 * row would orphan them (and the FK would refuse it anyway).
 */

import { revalidatePath } from 'next/cache';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/modules/admin/admin';
import { validateQuestionInput, nextSortOrder, swapForMove } from '@/modules/admin/question-bank';
import {
  listQuestionOrder,
  insertQuestion,
  updateQuestionText,
  setQuestionActiveFlag,
  setQuestionSortOrder,
} from '@/modules/admin/question-bank-store';

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function requireAdmin() {
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error('Not authorised');
  return admin;
}

function revalidateQuestionViews() {
  revalidatePath('/admin/questions');
  revalidatePath('/dashboard/profile');
}

function requireId(formData: FormData): string {
  const id = String(formData.get('id') ?? '');
  if (!UUID_RE.test(id)) throw new Error('Invalid question');
  return id;
}

export async function addQuestion(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const checked = validateQuestionInput(formData.get('prompt'), formData.get('answerMax'));
  if (!checked.ok) throw new Error(checked.error);

  const svc = getAdminServiceClient();
  const order = await listQuestionOrder(svc, false);

  await logModerationAction({
    admin,
    action: 'add_question',
    metadata: { prompt: checked.value.prompt, answer_max: checked.value.answerMax },
  });

  const res = await insertQuestion(svc, checked.value, nextSortOrder(order));
  if (!res.ok) {
    // 23505 = the unique index on `prompt`: the same wording already exists.
    if (res.code === '23505') throw new Error('That question already exists — switch it on instead.');
    throw new Error(`Could not add the question: ${res.message}`);
  }
  revalidateQuestionViews();
}

export async function updateQuestion(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = requireId(formData);
  const checked = validateQuestionInput(formData.get('prompt'), formData.get('answerMax'));
  if (!checked.ok) throw new Error(checked.error);

  await logModerationAction({
    admin,
    action: 'update_question',
    metadata: { question_id: id, prompt: checked.value.prompt, answer_max: checked.value.answerMax },
  });

  const res = await updateQuestionText(getAdminServiceClient(), id, checked.value);
  if (!res.ok) {
    if (res.code === '23505') throw new Error('Another question already has that wording.');
    throw new Error(`Could not update the question: ${res.message}`);
  }
  revalidateQuestionViews();
}

export async function setQuestionActive(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = requireId(formData);
  const active = String(formData.get('active') ?? '') === 'true';

  await logModerationAction({
    admin,
    action: active ? 'activate_question' : 'deactivate_question',
    metadata: { question_id: id },
  });

  const res = await setQuestionActiveFlag(getAdminServiceClient(), id, active);
  if (!res.ok) throw new Error(`Could not change the question: ${res.message}`);
  revalidateQuestionViews();
}

export async function moveQuestion(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = requireId(formData);
  const direction = String(formData.get('direction') ?? '');
  if (direction !== 'up' && direction !== 'down') throw new Error('Invalid direction');

  const svc = getAdminServiceClient();
  // Reorder within the ACTIVE list only — that is the order members see.
  const swap = swapForMove(await listQuestionOrder(svc, true), id, direction);
  if (!swap) return; // already at that end — nothing to do

  await logModerationAction({
    admin,
    action: 'reorder_question',
    metadata: { question_id: id, direction },
  });

  for (const update of swap) {
    const res = await setQuestionSortOrder(svc, update.id, update.sort_order);
    if (!res.ok) throw new Error(`Could not reorder: ${res.message}`);
  }
  revalidateQuestionViews();
}
