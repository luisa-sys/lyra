'use client';

import { useState } from 'react';
import { SaveButton, type ConversationPrompt, type ConversationAnswer } from './types';

/**
 * KAN-181: conversation-starter prompts wizard step.
 *
 * Two sections, each rendered conditionally:
 *
 *   1. **Answered** — prompts the user has already answered, with inline
 *      edit + remove. Edit is in-place (no separate route) to keep the
 *      flow tight in a multi-step wizard.
 *   2. **Unanswered** — prompts not yet answered, each clickable to
 *      expand into an answer form. Hidden when the 5-answer cap is hit
 *      so the user isn't tempted by something they can't add.
 *
 * 5-answer cap is enforced at the DB layer (BEFORE INSERT trigger); the
 * UI mirrors it for a friendly nudge and to hide the "add" affordances
 * when at limit.
 */

const ANSWER_MAX = 500;
const ANSWER_CAP = 5;

export function ConversationStartersStep({
  prompts,
  answers,
  onAdd,
  onUpdate,
  onRemove,
  onNext,
  isPending,
}: {
  prompts: ConversationPrompt[];
  answers: ConversationAnswer[];
  onAdd: (input: { promptId: string; answer: string }) => void;
  onUpdate: (id: string, answer: string) => void;
  onRemove: (id: string) => void;
  onNext: () => void;
  isPending: boolean;
}) {
  const [openPromptId, setOpenPromptId] = useState<string | null>(null);
  const [newAnswer, setNewAnswer] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingAnswer, setEditingAnswer] = useState('');

  const answeredPromptIds = new Set(answers.map((a) => a.prompt_id));
  const unanswered = prompts.filter((p) => !answeredPromptIds.has(p.id));
  const atCap = answers.length >= ANSWER_CAP;

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

  function handleStartEdit(answer: ConversationAnswer) {
    setEditingId(answer.id);
    setEditingAnswer(answer.answer);
  }

  function handleSaveEdit() {
    if (!editingId || !editingAnswer.trim()) return;
    onUpdate(editingId, editingAnswer.trim());
    setEditingId(null);
    setEditingAnswer('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Things to ask me about</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Pick a prompt and write a short answer. These give people something to ask you about
          beyond &ldquo;how are you?&rdquo;.
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
                  <textarea
                    value={editingAnswer}
                    onChange={(e) => setEditingAnswer(e.target.value.slice(0, ANSWER_MAX))}
                    rows={3}
                    className="w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-muted)]">{editingAnswer.length} / {ANSWER_MAX}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditingId(null); setEditingAnswer(''); }}
                        disabled={isPending}
                        className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={isPending || !editingAnswer.trim()}
                        className="px-3 py-1 rounded-full bg-[var(--color-sage)] text-white disabled:opacity-50"
                      >
                        Save
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
            Prompts to try ({ANSWER_CAP - answers.length} answer{ANSWER_CAP - answers.length === 1 ? '' : 's'} left)
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
                    placeholder="Write a short, honest answer — a few sentences."
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

      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}
