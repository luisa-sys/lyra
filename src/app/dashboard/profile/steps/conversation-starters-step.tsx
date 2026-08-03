'use client';

import { useState } from 'react';
import { SaveButton, type ConversationPrompt, type ConversationAnswer } from './types';
import {
  ANSWER_MAX,
  ANSWER_CAP,
  CUSTOM_PROMPT_MAX,
  CUSTOM_ANSWER_CAP,
} from '../conversation-starters-fields';

/**
 * KAN-181 / KAN-445: the "A bit more about me" step.
 *
 * Three sections, each rendered conditionally:
 *
 *   1. **Answered** — questions the user has already answered, with inline
 *      edit + remove. Edit is in-place (no separate route) to keep the
 *      flow tight in a multi-step wizard. A question the member wrote
 *      themselves can have its wording edited too.
 *   2. **Unanswered** — offered prompts not yet answered, each clickable to
 *      expand into an answer form. Hidden when the answer cap is hit
 *      so the user isn't tempted by something they can't add.
 *   3. **Write your own** (KAN-445) — up to three questions of the member's
 *      own, question and answer both supplied by them.
 *
 * Both caps are enforced at the DB layer (BEFORE INSERT/UPDATE triggers); the
 * UI mirrors them for a friendly nudge and to hide the "add" affordances
 * when at limit.
 */

export function ConversationStartersStep({
  prompts,
  answers,
  onAdd,
  onUpdate,
  onRemove,
  onNext,
  isPending,
  showContinue = true,
}: {
  prompts: ConversationPrompt[];
  answers: ConversationAnswer[];
  // KAN-445: exactly one of promptId / customPrompt, mirroring the DB's
  // `pcs_prompt_source_xor`.
  onAdd: (input: { promptId?: string; customPrompt?: string; answer: string }) => void;
  // KAN-448 — the caller awaits the update action and hands back its result so
  // a moderation rejection surfaces on the row it belongs to, rather than
  // disappearing into a transition. Same shape as ItemsStep's onEdit.
  // `customPrompt` is omitted when the member edited only the answer, so the
  // saved question is left untouched.
  onUpdate: (
    id: string,
    answer: string,
    customPrompt?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onRemove: (id: string) => void;
  onNext: () => void;
  isPending: boolean;
  // KAN-404 (#8/#9): the single-page editor sets showContinue={false} to drop
  // the misleading "Continue →" button; the legacy wizard keeps the default.
  showContinue?: boolean;
}) {
  const [openPromptId, setOpenPromptId] = useState<string | null>(null);
  const [newAnswer, setNewAnswer] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAnswer, setEditingAnswer] = useState('');
  const [editingPrompt, setEditingPrompt] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownPrompt, setOwnPrompt] = useState('');
  const [ownAnswer, setOwnAnswer] = useState('');

  const answeredPromptIds = new Set(answers.map((a) => a.prompt_id));
  const unanswered = prompts.filter((p) => !answeredPromptIds.has(p.id));
  const atCap = answers.length >= ANSWER_CAP;
  const ownCount = answers.filter((a) => a.prompt_id === null).length;
  const ownLeft = Math.max(0, CUSTOM_ANSWER_CAP - ownCount);

  function handleStartAnswer(promptId: string) {
    setOpenPromptId(promptId);
    setNewAnswer('');
  }

  function handleSubmitNew() {
    if (!openPromptId || !newAnswer.trim()) return;
    onAdd({ promptId: openPromptId, answer: newAnswer.trim() });
    setOpenPromptId(null);
    setNewAnswer('');
  }

  function handleSubmitOwn() {
    if (!ownPrompt.trim() || !ownAnswer.trim()) return;
    onAdd({ customPrompt: ownPrompt.trim(), answer: ownAnswer.trim() });
    setOwnOpen(false);
    setOwnPrompt('');
    setOwnAnswer('');
  }

  function handleStartEdit(answer: ConversationAnswer) {
    setEditingId(answer.id);
    setEditingAnswer(answer.answer);
    setEditingPrompt(answer.custom_prompt ?? '');
    setEditError(null);
  }

  async function handleSaveEdit(isOwnQuestion: boolean) {
    if (!editingId || !editingAnswer.trim()) return;
    if (isOwnQuestion && !editingPrompt.trim()) return;
    setEditSaving(true);
    setEditError(null);
    // A seeded prompt has no editable question, so nothing is sent for it —
    // which is also what keeps `custom_prompt` out of that payload entirely.
    const res = await onUpdate(
      editingId,
      editingAnswer.trim(),
      isOwnQuestion ? editingPrompt.trim() : undefined,
    );
    setEditSaving(false);
    if (!res.success) {
      setEditError(res.error ?? 'Could not save. Please try again.');
      return;
    }
    setEditingId(null);
    setEditingAnswer('');
    setEditingPrompt('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">A bit more about me</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Random things about you. Answer any that take your fancy, skip the rest — or write a
          question of your own.
        </p>
      </div>

      {answers.length > 0 && (
        <div className="space-y-2">
          {answers.map((a) => (
            <div
              key={a.id}
              className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3"
            >
              <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-1">
                {a.prompt}
              </p>
              {editingId === a.id ? (
                <div className="space-y-2">
                  {a.prompt_id === null && (
                    <input
                      value={editingPrompt}
                      onChange={(e) => setEditingPrompt(e.target.value.slice(0, CUSTOM_PROMPT_MAX))}
                      aria-label="Your question"
                      placeholder="Your question"
                      className="w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white"
                    />
                  )}
                  <textarea
                    value={editingAnswer}
                    onChange={(e) => setEditingAnswer(e.target.value.slice(0, ANSWER_MAX))}
                    rows={3}
                    className="w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white"
                  />
                  {editError && <p role="alert" className="text-xs text-red-600">{editError}</p>}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-muted)]">{editingAnswer.length} / {ANSWER_MAX}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setEditingAnswer(''); setEditingPrompt(''); setEditError(null); }}
                        disabled={editSaving}
                        className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(a.prompt_id === null)}
                        disabled={
                          editSaving
                          || isPending
                          || !editingAnswer.trim()
                          || (a.prompt_id === null && !editingPrompt.trim())
                        }
                        className="px-3 py-1 rounded-full bg-[var(--color-sage)] text-white disabled:opacity-50"
                      >
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-ink)] leading-relaxed">{a.answer}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(a)}
                      disabled={isPending}
                      className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(a.id)}
                      disabled={isPending}
                      className="text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {atCap ? (
        <p className="text-sm text-[var(--color-muted)] italic">
          You&rsquo;ve answered {ANSWER_CAP} prompts — the max. Remove one to add another.
        </p>
      ) : unanswered.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)] italic">
          You&rsquo;ve answered all available prompts. Nice.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
            Questions you could answer ({ANSWER_CAP - answers.length} answer{ANSWER_CAP - answers.length === 1 ? '' : 's'} left)
          </p>
          {unanswered.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-lg border border-[var(--color-border)]"
            >
              <button
                type="button"
                onClick={() => handleStartAnswer(p.id)}
                disabled={isPending}
                className="w-full text-left px-4 py-3 text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-60"
              >
                {openPromptId === p.id ? '▼' : '▸'} {p.prompt}
              </button>
              {openPromptId === p.id && (
                <div className="p-4 pt-0 space-y-2">
                  <textarea
                    autoFocus
                    value={newAnswer}
                    onChange={(e) => setNewAnswer(e.target.value.slice(0, ANSWER_MAX))}
                    rows={3}
                    placeholder="Example: I'd take one battered paperback and a very large pot of coffee."
                    className="w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-muted)]">{newAnswer.length} / {ANSWER_MAX}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setOpenPromptId(null); setNewAnswer(''); }}
                        disabled={isPending}
                        className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitNew}
                        disabled={isPending || !newAnswer.trim()}
                        className="px-3 py-1 rounded-full bg-[var(--color-sage)] text-white disabled:opacity-50"
                      >
                        Save answer
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* KAN-445 — write your own. Hidden at either cap so the member is never
          offered something the database would refuse. */}
      {!atCap && ownLeft > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
            Or ask yourself something ({ownLeft} of your own left)
          </p>
          <div className="bg-white rounded-lg border border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => setOwnOpen((open) => !open)}
              disabled={isPending}
              className="w-full text-left px-4 py-3 text-sm text-[var(--color-ink)] hover:bg-[var(--color-paper)] disabled:opacity-60"
            >
              {ownOpen ? '▼' : '▸'} Write your own question
            </button>
            {ownOpen && (
              <div className="p-4 pt-0 space-y-2">
                <input
                  autoFocus
                  value={ownPrompt}
                  onChange={(e) => setOwnPrompt(e.target.value.slice(0, CUSTOM_PROMPT_MAX))}
                  aria-label="Your question"
                  placeholder="Example: What's the best thing in my kitchen?"
                  className="w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white"
                />
                <textarea
                  value={ownAnswer}
                  onChange={(e) => setOwnAnswer(e.target.value.slice(0, ANSWER_MAX))}
                  rows={3}
                  aria-label="Your answer"
                  placeholder="Your answer"
                  className="w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white"
                />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-muted)]">
                    {ownPrompt.length} / {CUSTOM_PROMPT_MAX} · {ownAnswer.length} / {ANSWER_MAX}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setOwnOpen(false); setOwnPrompt(''); setOwnAnswer(''); }}
                      disabled={isPending}
                      className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitOwn}
                      disabled={isPending || !ownPrompt.trim() || !ownAnswer.trim()}
                      className="px-3 py-1 rounded-full bg-[var(--color-sage)] text-white disabled:opacity-50"
                    >
                      Save answer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showContinue && <SaveButton onClick={onNext} isPending={false} label="Continue →" />}
    </div>
  );
}
