/**
 * KAN-484 — admin question bank (spec v0.8 §09).
 *
 * Lists every preset question: the active ones in the order members see them,
 * then the inactive ones. An admin can add a question, edit its wording or
 * answer limit, switch it on or off, and move it up or down. There is no
 * delete, by design: v0.8 says deactivating must never remove existing
 * answers, and answers point at the question's permanent ID.
 *
 * Admin pages sit outside the founder-owned UI gate (src/app/admin/** is a
 * carve-out in scripts/check-ui-copy-ownership.sh).
 */

import { getCurrentAdmin, getAdminServiceClient } from '@/modules/admin/admin';
import { PRESET_ANSWER_MAX_MIN, PRESET_ANSWER_MAX_MAX, PRESET_PROMPT_MAX } from '@/modules/admin/question-bank';
import { listQuestions, type QuestionRow } from '@/modules/admin/question-bank-store';
import { addQuestion, updateQuestion, setQuestionActive, moveQuestion } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full p-2 text-sm rounded border border-[var(--color-border)] bg-white';
const buttonClass =
  'px-3 py-1 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-paper)]';

function QuestionEditor({ q, index, total }: { q: QuestionRow; index: number; total: number }) {
  return (
    <li className="bg-white rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <form action={updateQuestion} className="space-y-2">
        <input type="hidden" name="id" value={q.id} />
        <label className="block text-xs font-medium text-[var(--color-muted)]" htmlFor={`prompt-${q.id}`}>
          Question
        </label>
        <textarea
          id={`prompt-${q.id}`}
          name="prompt"
          defaultValue={q.prompt}
          maxLength={PRESET_PROMPT_MAX}
          rows={2}
          required
          className={inputClass}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--color-muted)]" htmlFor={`max-${q.id}`}>
              Answer limit (characters)
            </label>
            <input
              id={`max-${q.id}`}
              name="answerMax"
              type="number"
              min={PRESET_ANSWER_MAX_MIN}
              max={PRESET_ANSWER_MAX_MAX}
              defaultValue={q.answer_max}
              required
              className="w-28 p-2 text-sm rounded border border-[var(--color-border)] bg-white"
            />
          </div>
          <button type="submit" className={buttonClass}>Save wording &amp; limit</button>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Only fix typos or small wording here. If the meaning changes, switch this question off and add
          a new one, so people&rsquo;s existing answers keep their meaning.
        </p>
      </form>
      <div className="flex flex-wrap gap-2">
        <form action={setQuestionActive}>
          <input type="hidden" name="id" value={q.id} />
          <input type="hidden" name="active" value={q.is_active ? 'false' : 'true'} />
          <button type="submit" className={buttonClass}>{q.is_active ? 'Switch off' : 'Switch on'}</button>
        </form>
        {q.is_active && index > 0 && (
          <form action={moveQuestion}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="direction" value="up" />
            <button type="submit" className={buttonClass} aria-label="Move up">↑ Move up</button>
          </form>
        )}
        {q.is_active && index < total - 1 && (
          <form action={moveQuestion}>
            <input type="hidden" name="id" value={q.id} />
            <input type="hidden" name="direction" value="down" />
            <button type="submit" className={buttonClass} aria-label="Move down">↓ Move down</button>
          </form>
        )}
      </div>
    </li>
  );
}

export default async function QuestionBankPage() {
  await getCurrentAdmin(); // layout already gated; keep the type honest
  const rows = await listQuestions(getAdminServiceClient());
  const active = rows.filter((r) => r.is_active);
  const inactive = rows.filter((r) => !r.is_active);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Random Questions
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          {active.length} active question{active.length === 1 ? '' : 's'}, shown to members in this order,
          plus the questions each member writes for themselves. Switching a question off
          hides it from people who have not answered it; anyone who already answered keeps their answer.
        </p>
      </header>

      <section aria-labelledby="add-heading" className="bg-white rounded-lg border border-[var(--color-border)] p-4 space-y-2">
        <h2 id="add-heading" className="text-sm font-medium text-[var(--color-ink)]">Add a question</h2>
        <form action={addQuestion} className="space-y-2">
          <label className="sr-only" htmlFor="new-prompt">New question</label>
          <textarea id="new-prompt" name="prompt" maxLength={PRESET_PROMPT_MAX} rows={2} required className={inputClass} />
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted)]" htmlFor="new-max">
                Answer limit (characters)
              </label>
              <input
                id="new-max"
                name="answerMax"
                type="number"
                min={PRESET_ANSWER_MAX_MIN}
                max={PRESET_ANSWER_MAX_MAX}
                defaultValue={350}
                required
                className="w-28 p-2 text-sm rounded border border-[var(--color-border)] bg-white"
              />
            </div>
            <button type="submit" className={buttonClass}>Add question</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="active-heading" className="space-y-3">
        <h2 id="active-heading" className="text-sm font-medium text-[var(--color-ink)]">Active ({active.length})</h2>
        <ol className="space-y-3">
          {active.map((q, i) => (
            <QuestionEditor key={q.id} q={q} index={i} total={active.length} />
          ))}
        </ol>
      </section>

      {inactive.length > 0 && (
        <section aria-labelledby="inactive-heading" className="space-y-3">
          <h2 id="inactive-heading" className="text-sm font-medium text-[var(--color-ink)]">
            Switched off ({inactive.length})
          </h2>
          <ul className="space-y-3">
            {inactive.map((q, i) => (
              <QuestionEditor key={q.id} q={q} index={i} total={inactive.length} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
