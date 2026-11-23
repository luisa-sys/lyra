'use client';

/**
 * KAN-487 — v0.8 profile editor, section 04 "Things that aren't really for
 * me" (spec v0.8 §04; plan §C row 04, §D copy).
 *
 *   - Prompt (spec, exact): "Thank you but no thank you: allergies, things
 *     you can't use, etc."
 *   - Up to 15 entries; title required (100), description optional (200);
 *     no link field. Caps and limits come from `ITEM_RULES.gifts_to_avoid`
 *     via ItemListEditor.
 *   - Three blank rows initially when there are none: `initialEditorState`
 *     already provides them, so this component just renders the list.
 *   - Legacy `dislikes` rows are excluded by the state loader, never shown.
 */

import type { SectionProps } from './editor-context';
import { EditorSectionCard, type EditorSectionCardProps } from './editor-section-card';
import { ItemListEditor } from './item-list-editor';

export const NOT_FOR_ME_SECTION_ID = 'notforme';
export const NOT_FOR_ME_LABEL = 'Things that aren’t really for me';
export const NOT_FOR_ME_PROMPT = 'Thank you but no thank you: allergies, things you can’t use, etc.';

export type SectionNotForMeProps = SectionProps & Pick<EditorSectionCardProps, 'open' | 'onToggle'>;

export function SectionNotForMe({ state, dispatch, errors, readOnly, open, onToggle }: SectionNotForMeProps) {
  return (
    <EditorSectionCard
      id={NOT_FOR_ME_SECTION_ID}
      number={4}
      label={NOT_FOR_ME_LABEL}
      description={NOT_FOR_ME_PROMPT}
      open={open}
      onToggle={onToggle}
    >
      <ItemListEditor
        listKey="gifts_to_avoid"
        listLabel={NOT_FOR_ME_LABEL}
        rows={state.lists.gifts_to_avoid}
        fields={{
          title: { label: 'Title', required: true },
          description: { label: 'Description' },
          url: false,
        }}
        dispatch={dispatch}
        errors={errors}
        undo={state.undo.gifts_to_avoid}
        addLabel="Add"
        readOnly={readOnly}
      />
    </EditorSectionCard>
  );
}
