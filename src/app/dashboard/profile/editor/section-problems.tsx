'use client';

/**
 * KAN-487 — v0.8 profile editor, section 08 "Problems I'm trying to solve —
 * ideas welcome" (spec v0.8 §08; plan §C row 08, §D copy).
 *
 *   - Up to 10 entries (founder update); title required (120), description
 *     optional (500); no link field. Caps and limits come from
 *     `ITEM_RULES.current_problems` via ItemListEditor.
 *   - "Ideas welcome" is descriptive only: no reply, contact or message
 *     controls (spec §1 "No messages, likes, comments, contact buttons or
 *     in-product replies").
 */

import type { SectionProps } from './editor-context';
import { EditorSectionCard, type EditorSectionCardProps } from './editor-section-card';
import { ItemListEditor } from './item-list-editor';

export const PROBLEMS_SECTION_ID = 'problems';
export const PROBLEMS_LABEL = 'Problems I’m trying to solve — ideas welcome';

export type SectionProblemsProps = SectionProps & Pick<EditorSectionCardProps, 'open' | 'onToggle'>;

export function SectionProblems({ state, dispatch, errors, readOnly, open, onToggle }: SectionProblemsProps) {
  return (
    <EditorSectionCard id={PROBLEMS_SECTION_ID} number={8} label={PROBLEMS_LABEL} open={open} onToggle={onToggle}>
      <ItemListEditor
        listKey="current_problems"
        listLabel={PROBLEMS_LABEL}
        rows={state.lists.current_problems}
        fields={{
          title: { label: 'Title', required: true },
          description: { label: 'Description' },
          url: false,
        }}
        dispatch={dispatch}
        errors={errors}
        undo={state.undo.current_problems}
        addLabel="Add"
        readOnly={readOnly}
      />
    </EditorSectionCard>
  );
}
