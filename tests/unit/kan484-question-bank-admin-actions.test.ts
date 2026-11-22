/**
 * KAN-484 — admin question-bank server actions (src/app/admin/questions/actions.ts).
 *
 * Asserts the contract the screen depends on:
 *   - a non-admin can change nothing, and nothing is written or logged;
 *   - invalid input is refused before the audit log or any write;
 *   - every change is audited FIRST, then written (audit-first, as
 *     setGlobalFeature does);
 *   - moving at the end of the list is a silent no-op;
 *   - there is no delete action at all (v0.8: deactivating never removes answers).
 */

const events: string[] = [];
let admin: { userId: string; profileId: string; email: null; displayName: null } | null = null;
let order: { id: string; sort_order: number }[] = [];

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/modules/admin/admin', () => ({
  getCurrentAdmin: jest.fn(async () => admin),
  getAdminServiceClient: jest.fn(() => ({ svc: true })),
  logModerationAction: jest.fn(async (input: { action: string }) => {
    events.push(`audit:${input.action}`);
    return 'log-id';
  }),
}));
jest.mock('@/modules/admin/question-bank-store', () => ({
  listQuestionOrder: jest.fn(async () => order),
  insertQuestion: jest.fn(async (_svc: unknown, input: { prompt: string; answerMax: number }, sortOrder: number) => {
    events.push(`insert:${input.prompt}|${input.answerMax}|${sortOrder}`);
    return { ok: true };
  }),
  updateQuestionText: jest.fn(async (_svc: unknown, id: string, input: { prompt: string }) => {
    events.push(`update:${id}|${input.prompt}`);
    return { ok: true };
  }),
  setQuestionActiveFlag: jest.fn(async (_svc: unknown, id: string, active: boolean) => {
    events.push(`active:${id}|${active}`);
    return { ok: true };
  }),
  setQuestionSortOrder: jest.fn(async (_svc: unknown, id: string, sortOrder: number) => {
    events.push(`order:${id}|${sortOrder}`);
    return { ok: true };
  }),
}));

import * as actions from '@/app/admin/questions/actions';

const ID_A = '11111111-1111-1111-1111-111111111111';
const ID_B = '22222222-2222-2222-2222-222222222222';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  events.length = 0;
  admin = { userId: 'u1', profileId: 'p1', email: null, displayName: null };
  order = [{ id: ID_A, sort_order: 10 }, { id: ID_B, sort_order: 20 }];
});

describe('admin question-bank actions', () => {
  it('exposes no delete action', () => {
    const names = Object.keys(actions);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });

  it('refuses a non-admin and writes nothing', async () => {
    admin = null;
    await expect(actions.addQuestion(form({ prompt: 'Q?', answerMax: '300' }))).rejects.toThrow(/not authorised/i);
    await expect(actions.setQuestionActive(form({ id: ID_A, active: 'false' }))).rejects.toThrow(/not authorised/i);
    expect(events).toEqual([]);
  });

  it('refuses invalid input before auditing or writing', async () => {
    await expect(actions.addQuestion(form({ prompt: '', answerMax: '300' }))).rejects.toThrow();
    await expect(actions.updateQuestion(form({ id: ID_A, prompt: 'Q?', answerMax: '9999' }))).rejects.toThrow();
    await expect(actions.updateQuestion(form({ id: 'not-a-uuid', prompt: 'Q?', answerMax: '300' }))).rejects.toThrow();
    expect(events).toEqual([]);
  });

  it('audits before inserting, and appends the new question after the rest', async () => {
    await actions.addQuestion(form({ prompt: 'What makes you laugh?', answerMax: '400' }));
    expect(events).toEqual(['audit:add_question', 'insert:What makes you laugh?|400|30']);
  });

  it('audits before updating wording and limit', async () => {
    await actions.updateQuestion(form({ id: ID_A, prompt: 'Fixed typo?', answerMax: '350' }));
    expect(events).toEqual(['audit:update_question', `update:${ID_A}|Fixed typo?`]);
  });

  it('switches a question off (audited as deactivate) and back on', async () => {
    await actions.setQuestionActive(form({ id: ID_A, active: 'false' }));
    await actions.setQuestionActive(form({ id: ID_A, active: 'true' }));
    expect(events).toEqual([
      'audit:deactivate_question',
      `active:${ID_A}|false`,
      'audit:activate_question',
      `active:${ID_A}|true`,
    ]);
  });

  it('moves a question by swapping sort_order, audited first', async () => {
    await actions.moveQuestion(form({ id: ID_B, direction: 'up' }));
    expect(events).toEqual(['audit:reorder_question', `order:${ID_B}|10`, `order:${ID_A}|20`]);
  });

  it('treats a move past the end as a silent no-op (no audit, no write)', async () => {
    await actions.moveQuestion(form({ id: ID_A, direction: 'up' }));
    expect(events).toEqual([]);
  });
});
