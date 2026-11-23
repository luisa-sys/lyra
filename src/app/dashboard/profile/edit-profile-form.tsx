'use client';

/**
 * KAN-487 — v0.8 profile editor (spec v0.8 §1–§3; plan §A component tree,
 * §B "Modes", §C section-by-section UI and "Action bar").
 *
 * Replaces the KAN-220 / KAN-266 autosave editor in place (same export, same
 * props from `page.tsx`). Every edit is held CLIENT-SIDE in one reducer
 * state until the member saves; nothing reaches the database (or the public
 * page) before that:
 *   - before first publication: Save Draft / Preview / Publish;
 *   - after publication: one Save Changes, which saves all ten sections in
 *     one atomic `save_profile` call and then shows exactly
 *     "Changes saved successfully". On failure the edits stay, the
 *     server's message shows under the generic copy, and "Try again"
 *     re-runs the failed save with the same intent (a failed Publish is
 *     retried as a Publish; if its save step already went through, only the
 *     publish step is left, re-sent against the fresh baseline). When the
 *     server says the editor is out of date, "Reload" replaces it.
 *
 * Save flow: the payload is the DIFF between the baseline (the state after
 * the last load or successful save) and the snapshot taken when the button
 * was pressed. On success the new baseline is that SENT snapshot with the
 * save result applied (`rebaseAfterSave`), never the live state, so anything
 * typed while the save was in flight is still sent next time.
 *
 * Validation errors (`validateEditorState`) show after a save attempt, or
 * once the member leaves THAT field — not while they first type. A server
 * field error shows until its field's value changes. The pure
 * decisions live in `src/modules/profile/editor/*` (tested without a DOM);
 * this component only wires them.
 *
 * Retired from the editor: per-section autosave, the "Use legacy wizard"
 * link, the intro note and the Links section (their files were deleted in
 * KAN-487 part 3). The Convene link is kept.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ManualOfMe } from '@/modules/profile/manual-of-me-fields';
import {
  initialEditorState,
  type EditorState,
  type LoadedAffiliation,
  type LoadedAnswer,
  type LoadedItem,
  type LoadedProfileRow,
  type LoadedPrompt,
  type SavePayload,
  type SaveResult,
} from '@/modules/profile/editor/editor-state';
import { editorReducer, saveBaselineFromResult } from '@/modules/profile/editor/editor-reducer';
import { buildSavePayload, isDirty } from '@/modules/profile/editor/editor-diff';
import { validateEditorState, validateForPublish } from '@/modules/profile/editor/validate-save-payload';
import {
  DRAFT_SAVED_COPY,
  MODE_FOR_INTENT,
  SAVE_FAILED_COPY,
  SAVE_SUCCESS_COPY,
  UNSAVED_COPY,
  applyAiGiftChangeToBaseline,
  editorShellReducer,
  failedIntentAfter,
  liveServerErrors,
  lyraIdWarningMessage,
  publishBlockerErrors,
  publishBlockers,
  replayAiGiftChanges,
  retryIntent,
  saveChangesDisabled,
  saveFailureStatus,
  touchField,
  savedApprovedAiGiftIds,
  visibleErrors,
  type CommittedAiGiftChange,
  type PublishBlocker,
  type SaveIntent,
} from '@/modules/profile/editor/editor-shell';
import type { GeneratedSuggestion } from '@/modules/profile/ai-gifts/types';
import type { EditorPublishResult } from '@/modules/profile/save-profile';
import { publishProfileFromEditor, saveProfileChanges, saveProfileDraft } from './editor-actions';
import { EditorHeader, HEADER_LINK_FOCUS } from './editor/editor-header';
import { EditorToc } from './editor/editor-toc';
import { EditorActionBar, type ActionBarStatus } from './editor/editor-action-bar';
import { ProfilePreview } from './editor/profile-preview';
import { useUnsavedGuard } from './editor/use-unsaved-guard';
import { SaveKeyMapContext } from './editor/use-expanded-rows';
import { AiGiftsContext, type AiGiftsContextValue } from './editor/ai-gifts-context';
import { revealAndFocus } from './editor/editor-section-card';
import { SectionAbout } from './editor/section-about';
import { SectionAffiliations } from './editor/section-affiliations';
import { SectionGifts } from './editor/section-gifts';
import { SectionNotForMe } from './editor/section-not-for-me';
import { SectionUnderstand } from './editor/section-understand';
import { SectionFavourites } from './editor/section-favourites';
import { SectionTips } from './editor/section-tips';
import { SectionProblems } from './editor/section-problems';
import { SectionQuestions } from './editor/section-questions';
import { SectionBillboard } from './editor/section-billboard';

interface SectionDef {
  id: string;
  number: number;
  label: string;
}

// Spec v0.8 order; ids are the section anchors (and what tests parse).
const SECTIONS: SectionDef[] = [
  { id: 'about', number: 1, label: 'About Me' },
  { id: 'affiliations', number: 2, label: 'Where you might know me from' },
  { id: 'gifts', number: 3, label: "Gifts: Things I love, can’t get enough of, or have been dreaming about" },
  { id: 'notforme', number: 4, label: 'Things that aren’t really for me' },
  { id: 'understand', number: 5, label: 'To understand me a little better' },
  { id: 'favourites', number: 6, label: 'A few of my favourite things' },
  { id: 'tips', number: 7, label: 'Tips & life hacks I can share' },
  { id: 'problems', number: 8, label: 'Problems I’m trying to solve — ideas welcome' },
  { id: 'starters', number: 9, label: 'Random Questions & Answers' },
  { id: 'billboard', number: 10, label: 'Billboard' },
];

/** One save as sent. */
interface SaveAttempt {
  intent: SaveIntent;
  sent: EditorState;
  payload: SavePayload;
  /** KAN-489: length of the committed AI-gift change log when the save started. */
  aiLogAt: number;
}

function callSave(a: SaveAttempt): Promise<EditorPublishResult | SaveResult> {
  if (a.intent === 'draft') return saveProfileDraft(a.payload);
  if (a.intent === 'publish') return publishProfileFromEditor(a.payload, a.sent);
  return saveProfileChanges(a.payload);
}

export function EditProfileForm({
  profile,
  items,
  schools,
  manualOfMe,
  conversationPrompts,
  conversationAnswers,
  conveneEnabled = false,
  aiGiftsConfigured = false,
}: {
  profile: LoadedProfileRow;
  items: LoadedItem[];
  schools: LoadedAffiliation[];
  manualOfMe: ManualOfMe;
  conversationPrompts: LoadedPrompt[];
  conversationAnswers: LoadedAnswer[];
  conveneEnabled?: boolean;
  /** KAN-489: ANTHROPIC_API_KEY is set (a boolean; the value never reaches the browser). */
  aiGiftsConfigured?: boolean;
}) {
  const router = useRouter();

  // `editorShellReducer` is `editorReducer` plus the post-save live rebase.
  const [state, dispatch] = useReducer(
    editorShellReducer,
    { profile, items, schools, manualOfMe, conversationPrompts, conversationAnswers },
    initialEditorState,
  );

  // Baseline = state after the last load / successful save. The ref serves
  // the async save handlers; the state copy drives rendering (dirty check).
  const baselineRef = useRef<EditorState>(state);
  const [baseline, setBaseline] = useState<EditorState>(state);
  const [publicSlug, setPublicSlug] = useState<string>(profile.slug ?? '');

  // KAN-489 — AI gift suggestions. One session id per editor load (survives
  // Saves, resets on reload). Changes the server has already committed
  // (suggestions stored, a pending one dismissed) go to the live state AND
  // the baseline, so they never mark the editor dirty and an approval of a
  // new suggestion is sent as ai_gifts.approve. The log lets a save that was
  // in flight replay them onto its new baseline.
  const [aiSessionId] = useState<string>(() => crypto.randomUUID());
  const aiChangesRef = useRef<CommittedAiGiftChange[]>([]);
  const commitAiChange = useCallback((change: CommittedAiGiftChange) => {
    aiChangesRef.current.push(change);
    dispatch(change);
    const next = applyAiGiftChangeToBaseline(baselineRef.current, change);
    baselineRef.current = next;
    setBaseline(next);
  }, []);

  const [status, setStatus] = useState<ActionBarStatus>({ kind: 'idle' });
  const [blockers, setBlockers] = useState<PublishBlocker[]>([]);
  // Server field errors + the state they were reported against (taken in
  // the render that first shows them), so each clears once its field changes.
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [serverErrorsSeen, setServerErrorsSeen] = useState<Record<string, string>>(serverErrors);
  const [serverErrorsBase, setServerErrorsBase] = useState<EditorState | null>(null);
  if (serverErrorsSeen !== serverErrors) {
    setServerErrorsSeen(serverErrors);
    setServerErrorsBase(state);
  }
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  // Intent of the last FAILED save; kept until a save completes ("Try again").
  const [failedIntent, setFailedIntent] = useState<SaveIntent | null>(null);
  // Every new-row key → stored id from this session's saves (expanded rows).
  const [keyMap, setKeyMap] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [focusErrorTick, setFocusErrorTick] = useState(0);

  const saving = status.kind === 'saving';
  const dirty = useMemo(() => isDirty(baseline, state), [baseline, state]);
  const validation = useMemo(() => validateEditorState(state), [state]);
  const liveErrors = useMemo(() => (validation.ok ? {} : validation.errors), [validation]);
  const shownServerErrors = useMemo(
    () => liveServerErrors(serverErrors, serverErrorsBase, state),
    [serverErrors, serverErrorsBase, state],
  );
  const errors = useMemo(
    () => visibleErrors(liveErrors, touched, attempted, shownServerErrors),
    [liveErrors, touched, attempted, shownServerErrors],
  );

  const { allowLeave } = useUnsavedGuard(dirty);

  // Move focus to the first invalid field after a blocked save (opening its
  // section first if it is collapsed).
  useEffect(() => {
    if (focusErrorTick === 0) return;
    const el = document.querySelector<HTMLElement>('main [aria-invalid="true"]');
    if (el) revealAndFocus(el);
  }, [focusErrorTick]);

  const applySuccess = useCallback(
    (sent: EditorState, res: Extract<SaveResult, { ok: true }>, aiLogAt: number) => {
      const newBaseline = saveBaselineFromResult(res);
      const next = replayAiGiftChanges(
        editorReducer(sent, { type: 'applySaveResult', idMap: res.idMap, newBaseline }),
        aiChangesRef.current.slice(aiLogAt),
      );
      baselineRef.current = next;
      setBaseline(next);
      dispatch({ type: 'rebaseAfterSave', sent, idMap: res.idMap, newBaseline });
      if (Object.keys(res.idMap).length > 0) setKeyMap((m) => ({ ...m, ...res.idMap }));
      if (res.slug) setPublicSlug(res.slug);
    },
    [],
  );

  const submit = useCallback(
    async (attempt: SaveAttempt) => {
      setStatus({ kind: 'saving' });
      setBlockers([]);
      let res: EditorPublishResult | SaveResult;
      try {
        res = await callSave(attempt);
      } catch {
        res = { ok: false, error: SAVE_FAILED_COPY };
      }

      setFailedIntent(failedIntentAfter(attempt.intent, res.ok));

      if (res.ok) {
        applySuccess(attempt.sent, res, attempt.aiLogAt);
        setAttempted(false);
        setTouched(new Set());
        const idWarning = lyraIdWarningMessage(res.warnings.lyra_id);
        setServerErrors(idWarning ? { 'profile.lyra_id': idWarning } : {});
        if (attempt.intent === 'publish') {
          // Published (a `warnings.publish` note means the fresh row could
          // not be re-read; the dashboard load below is that reload).
          allowLeave();
          setStatus({ kind: 'idle' });
          router.refresh();
          router.push('/dashboard');
          return;
        }
        setStatus({
          kind: 'success',
          message: attempt.intent === 'published' ? SAVE_SUCCESS_COPY : DRAFT_SAVED_COPY,
        });
        return;
      }

      // Rows were saved but publishing failed: rebase, so the next save does
      // not trip the "saved somewhere else" check. "Try again" stays a
      // Publish (failedIntent) and re-diffs against this fresh baseline, so
      // only the publish step is left to run.
      if ('saved' in res && res.saved) {
        applySuccess(attempt.sent, res.saved, attempt.aiLogAt);
      }

      const fieldErrors = res.fieldErrors ?? {};
      setServerErrors(fieldErrors);
      setAttempted(true);
      const blocked = publishBlockers(Object.values(fieldErrors)).filter((b) => b.fieldId !== null);
      if (attempt.intent === 'publish' && blocked.length > 0) {
        setBlockers(blocked);
        setStatus({ kind: 'idle' });
        return;
      }
      setStatus({ kind: 'error', message: SAVE_FAILED_COPY, ...saveFailureStatus(res.error) });
      if (Object.keys(fieldErrors).length > 0) setFocusErrorTick((t) => t + 1);
    },
    [allowLeave, applySuccess, router],
  );

  const startSave = (intent: SaveIntent) => {
    if (saving) return;
    setAttempted(true);
    setServerErrors({});
    if (!validation.ok) {
      setBlockers([]);
      setStatus({ kind: 'idle' });
      setFocusErrorTick((t) => t + 1);
      return;
    }
    if (intent === 'publish') {
      const missing = validateForPublish(state);
      if (missing.length > 0) {
        setBlockers(publishBlockers(missing));
        setServerErrors(publishBlockerErrors(missing));
        setStatus({ kind: 'idle' });
        return;
      }
    }
    const sent = state;
    const payload = buildSavePayload(baselineRef.current, sent, MODE_FOR_INTENT[intent]);
    void submit({ intent, sent, payload, aiLogAt: aiChangesRef.current.length });
  };

  // "Try again": the failed save's own intent, with a payload built from the
  // current baseline (unchanged after a plain failure → the same payload;
  // rebased after a Publish whose save step went through → publish only).
  const retry = () => {
    if (saving) return;
    startSave(retryIntent(failedIntent, state.isPublished));
  };

  // "Reload" (editor out of date): the edits are lost, so ask first.
  const reload = () => {
    if (dirty && !window.confirm(UNSAVED_COPY)) return;
    allowLeave();
    window.location.reload();
  };

  // Mark only the field the member just left as touched.
  const onFieldBlur = (e: React.FocusEvent<HTMLElement>) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
      if (t.id) setTouched((prev) => touchField(prev, t.id, liveErrors));
    }
  };

  const sectionProps = { state, dispatch, errors, readOnly: saving };
  const savedApprovedIds = useMemo(() => savedApprovedAiGiftIds(baseline), [baseline]);
  const aiGifts = useMemo<AiGiftsContextValue>(
    () => ({
      configured: aiGiftsConfigured,
      sessionId: aiSessionId,
      savedApprovedIds,
      onGenerated: (rows: readonly GeneratedSuggestion[]) => commitAiChange({ type: 'aiGiftsGenerated', rows }),
      onDismissed: (id: string) => commitAiChange({ type: 'aiGiftDismissed', id }),
    }),
    [aiGiftsConfigured, aiSessionId, savedApprovedIds, commitAiChange],
  );
  const shownStatus: ActionBarStatus = status.kind === 'success' && dirty ? { kind: 'idle' } : status;

  return (
    <main className="min-h-screen bg-[var(--color-paper)] pb-40">
      <EditorHeader
        isPublished={state.isPublished}
        publicSlug={publicSlug}
        extraLinks={
          conveneEnabled && (
            <Link
              href="/dashboard/convene/gatherings"
              className={`text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors ${HEADER_LINK_FOCUS}`}
            >
              Convene
            </Link>
          )
        }
      />

      <div className="max-w-5xl mx-auto px-4 py-6 md:grid md:grid-cols-[220px_1fr] md:gap-8">
        <EditorToc sections={SECTIONS} />

        <SaveKeyMapContext.Provider value={keyMap}>
          <AiGiftsContext.Provider value={aiGifts}>
            <div className="space-y-3" onBlur={onFieldBlur}>
              <SectionAbout {...sectionProps} />
              <SectionAffiliations {...sectionProps} />
              <SectionGifts {...sectionProps} />
              <SectionNotForMe {...sectionProps} />
              <SectionUnderstand {...sectionProps} />
              <SectionFavourites {...sectionProps} />
              <SectionTips {...sectionProps} />
              <SectionProblems {...sectionProps} />
              <SectionQuestions {...sectionProps} />
              <SectionBillboard {...sectionProps} />
            </div>
          </AiGiftsContext.Provider>
        </SaveKeyMapContext.Provider>
      </div>

      <EditorActionBar
        isPublished={state.isPublished}
        status={shownStatus}
        blockers={blockers}
        saveChangesDisabled={saveChangesDisabled(state, dirty, saving)}
        onSaveDraft={() => startSave('draft')}
        onPreview={() => setPreviewOpen(true)}
        onPublish={() => startSave('publish')}
        onSaveChanges={() => startSave('published')}
        onRetry={retry}
        onReload={reload}
      />

      <ProfilePreview open={previewOpen} state={state} onClose={() => setPreviewOpen(false)} />
    </main>
  );
}
