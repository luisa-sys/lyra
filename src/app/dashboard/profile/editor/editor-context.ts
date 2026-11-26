/**
 * KAN-487 — v0.8 profile editor: the contract every section component
 * implements (spec v0.8 §01–§10; plan §A "Component tree").
 *
 * Types only. Section components are `'use client'`, take `SectionProps`,
 * render `state`, call `dispatch` with reducer actions, and show the
 * `validateEditorState` error for each field. Error keys follow
 * `validate-save-payload.ts`: `profile.<field>`, `manual_of_me.<field>`,
 * `<rowKey>.<field>` (title, description, url, name, location,
 * custom_prompt, answer, …), `lists.<listKey>` / `affiliations.<type>` /
 * `questions.custom` for caps, and `photo`.
 */

import type { EditorRow, EditorState, UndoEntry } from '@/modules/profile/editor/editor-state';
import type { EditorAction } from '@/modules/profile/editor/editor-reducer';

export interface SectionProps {
  state: EditorState;
  dispatch: (a: EditorAction) => void;
  /** From `validateEditorState` (live) or the server's save result. */
  errors: Record<string, string>;
  /** True while a save is in flight. */
  readOnly?: boolean;
}

export type { EditorAction, RowPatch, AffPatch, QuestionPatch } from '@/modules/profile/editor/editor-reducer';
export type {
  AffRow,
  AffiliationType,
  AiGiftRow,
  CustomQuestionRow,
  EditorRow,
  EditorState,
  ListKey,
  PhotoState,
  PresetPrompt,
  PresetQuestionRow,
  ProfileFieldKey,
  QuestionRow,
  UndoEntry,
  UndoListKey,
} from '@/modules/profile/editor/editor-state';

/** The undo entry of a member item list (`state.undo[listKey]`). */
export type ListUndoEntry = Extract<UndoEntry, { row: EditorRow }>;
