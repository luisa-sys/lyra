'use client';

/**
 * KAN-487 — v0.8 profile editor, section 05 "To understand me a little
 * better" (spec v0.8 §05; plan §C row 05, §D copy).
 *
 *   - Intro and the six prompts in spec order, with the spec's exact labels
 *     and helper texts.
 *   - Every prompt is an optional multiline textarea with a live counter.
 *     Limits come from `MANUAL_OF_ME_MAX_LENGTHS` (500 each; "If you ever
 *     come to my house" 1000). Line breaks are kept.
 *   - Label → column mapping follows `MANUAL_OF_ME_LABELS`
 *     (field-validation.ts). The first prompt's visible label is the spec's
 *     full "Good to know about me / Things I'm into".
 *   - Errors (including the server's contact-details correction message)
 *     arrive as `manual_of_me.<column>`.
 */

import {
  MANUAL_OF_ME_MAX_LENGTHS,
  type ManualOfMeField,
} from '@/modules/profile/manual-of-me-fields';
import type { SectionProps } from './editor-context';
import { EditorSectionCard, type EditorSectionCardProps } from './editor-section-card';
import { TextArea } from './text-field';

export const UNDERSTAND_SECTION_ID = 'understand';
export const UNDERSTAND_LABEL = 'To understand me a little better';
export const UNDERSTAND_INTRO =
  'A few little prompts to help people understand you. They are all optional — fill in only what feels right.';

/** Spec v0.8 §05, in spec order. */
export const UNDERSTAND_PROMPTS: ReadonlyArray<{ field: ManualOfMeField; label: string; helper: string }> = [
  {
    field: 'good_to_know',
    label: 'Good to know about me / Things I’m into',
    helper:
      'Little things that help people get you; what makes you lose track of time; what are you unreasonably good at; small acts of kindness.',
  },
  {
    field: 'boundaries',
    label: 'My boundaries',
    helper: 'Anything you’d gently ask people to respect.',
  },
  {
    field: 'communication_style',
    label: 'How I find communication easier',
    helper: 'How you prefer people to communicate with you; do not share contact details.',
  },
  {
    field: 'working_preferences',
    label: 'If you ever come to my house',
    helper: 'Anything a visitor would love to know.',
  },
  {
    field: 'energises_me',
    label: 'What gives me energy',
    helper: 'The things that fill you up; small things that make you disproportionately happy.',
  },
  {
    field: 'drains_me',
    label: 'What drains me',
    helper: 'The things that wear you out.',
  },
];

export type SectionUnderstandProps = SectionProps & Pick<EditorSectionCardProps, 'open' | 'onToggle'>;

export function SectionUnderstand({ state, dispatch, errors, readOnly, open, onToggle }: SectionUnderstandProps) {
  return (
    <EditorSectionCard
      id={UNDERSTAND_SECTION_ID}
      number={5}
      label={UNDERSTAND_LABEL}
      description={UNDERSTAND_INTRO}
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-5">
        {UNDERSTAND_PROMPTS.map(({ field, label, helper }) => {
          const max = MANUAL_OF_ME_MAX_LENGTHS[field];
          return (
            <TextArea
              key={field}
              id={`understand-${field}`}
              label={label}
              helper={helper}
              value={state.manualOfMe[field]}
              onChange={(value) => dispatch({ type: 'setManualOfMe', field, value })}
              max={max}
              error={errors[`manual_of_me.${field}`]}
              readOnly={readOnly}
              rows={max > 500 ? 5 : 3}
            />
          );
        })}
      </div>
    </EditorSectionCard>
  );
}
