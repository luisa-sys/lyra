'use client';

/**
 * KAN-487 — v0.8 profile editor, section 07 "Tips & life hacks I can share"
 * (spec v0.8 §07; plan §C row 07, §D copy).
 *
 *   - Prompt (spec, exact): "Things that genuinely made your life better:
 *     great purchases, new habits, services you found out about."
 *   - Up to 15 entries; title required (120), description optional (500),
 *     URL optional (2,048). Caps and limits come from
 *     `ITEM_RULES.life_hacks` via ItemListEditor.
 */

import type { SectionProps } from './editor-context';
import { EditorSectionCard, type EditorSectionCardProps } from './editor-section-card';
import { ItemListEditor } from './item-list-editor';

export const TIPS_SECTION_ID = 'tips';
export const TIPS_LABEL = 'Tips & life hacks I can share';
export const TIPS_PROMPT =
  'Things that genuinely made your life better: great purchases, new habits, services you found out about.';

export type SectionTipsProps = SectionProps & Pick<EditorSectionCardProps, 'open' | 'onToggle'>;

export function SectionTips({ state, dispatch, errors, readOnly, open, onToggle }: SectionTipsProps) {
  return (
    <EditorSectionCard
      id={TIPS_SECTION_ID}
      number={7}
      label={TIPS_LABEL}
      description={TIPS_PROMPT}
      open={open}
      onToggle={onToggle}
    >
      <ItemListEditor
        listKey="life_hacks"
        listLabel={TIPS_LABEL}
        rows={state.lists.life_hacks}
        fields={{
          title: { label: 'Title', required: true },
          description: { label: 'Description' },
          url: true,
        }}
        dispatch={dispatch}
        errors={errors}
        undo={state.undo.life_hacks}
        addLabel="Add"
        readOnly={readOnly}
      />
    </EditorSectionCard>
  );
}
