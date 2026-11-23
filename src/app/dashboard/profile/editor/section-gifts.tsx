'use client';

/**
 * KAN-487 — v0.8 profile editor, section 03 "Gifts: Things I love, can't get
 * enough of, or have been dreaming about" (spec v0.8 §03; plan §C row 03,
 * §D copy).
 *
 *   - Heading, subtitle and general preference prompt: spec copy, verbatim.
 *   - Preference: optional multiline textarea, 350 characters
 *     (`PROFILE_FIELD_MAX.gift_voucher_hint`), written to `gift_voucher_hint`
 *     via `setField`; error key `profile.gift_voucher_hint`.
 *   - Member gifts (`gift_ideas`): title* 100, description 250, link; up to
 *     25; "Add gift". `initialEditorState` gives ONE empty row when there are
 *     none, and `ItemListEditor` opens blank rows expanded, so the member
 *     sees one empty input initially.
 *   - `GiftsAiSlot` (KAN-489): the AI suggestions switch, Generate, the
 *     session counter, pending suggestions to approve or delete, and approved
 *     ones under "AI suggested". Its props are unchanged; it reads the
 *     session and baseline hooks from `AiGiftsContext`.
 *
 * Renders its own `EditorSectionCard` (id `gifts`, number 3).
 */

import { ITEM_RULES, PROFILE_FIELD_MAX } from '@/modules/profile/profile-rules';
import type { SectionProps } from './editor-context';
import { EditorSectionCard } from './editor-section-card';
import { ItemListEditor } from './item-list-editor';
import { TextArea } from './text-field';
import { GiftsAiSlot } from './gifts-ai-slot';

/** Spec v0.8 §03 copy, verbatim. */
export const GIFTS_HEADING = 'Gifts: Things I love, can’t get enough of, or have been dreaming about';
export const GIFTS_SUBTITLE =
  'The things you’d genuinely love — to receive, to do, or to be surprised by. You can add themes and/or specific items.';
export const GIFTS_PREFERENCE_PROMPT =
  'Do you prefer surprise gifts, or ideally items in your wish list? Hints for sizes, or other general preferences.';
export const ADD_GIFT_LABEL = 'Add gift';

export interface SectionGiftsProps extends SectionProps {
  /** Controlled collapse (optional; the card is uncontrolled otherwise). */
  open?: boolean;
  onToggle?: (id: string, nextOpen: boolean) => void;
}

export function SectionGifts({ state, dispatch, errors, readOnly = false, open, onToggle }: SectionGiftsProps) {
  const rule = ITEM_RULES.gift_ideas;
  return (
    <EditorSectionCard
      id="gifts"
      number={3}
      label={GIFTS_HEADING}
      open={open}
      onToggle={onToggle}
      description={<p>{GIFTS_SUBTITLE}</p>}
    >
      <div className="space-y-6">
        <TextArea
          id="profile-gift_voucher_hint"
          label={GIFTS_PREFERENCE_PROMPT}
          value={state.fields.gift_voucher_hint}
          onChange={(v) => dispatch({ type: 'setField', field: 'gift_voucher_hint', value: v })}
          max={PROFILE_FIELD_MAX.gift_voucher_hint}
          error={errors['profile.gift_voucher_hint']}
          readOnly={readOnly}
          rows={3}
        />
        <ItemListEditor
          listKey="gift_ideas"
          listLabel="Gifts"
          rows={state.lists.gift_ideas}
          fields={{
            title: { label: 'Title', max: rule.titleMax, required: true },
            description: { label: 'Description', max: rule.descriptionMax },
            url: true,
          }}
          cap={rule.cap}
          dispatch={dispatch}
          errors={errors}
          undo={state.undo.gift_ideas}
          addLabel={ADD_GIFT_LABEL}
          readOnly={readOnly}
        />
        <GiftsAiSlot aiItems={state.aiGifts} dispatch={dispatch} readOnly={readOnly} />
      </div>
    </EditorSectionCard>
  );
}
