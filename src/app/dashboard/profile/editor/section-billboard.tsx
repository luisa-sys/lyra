'use client';

/**
 * KAN-487 — v0.8 profile editor §10 "Billboard" (spec v0.8 §10; plan §C
 * row 10, §D prompt).
 *
 * One optional multiline statement, at most 200 characters (counted in code
 * points, `PROFILE_FIELD_MAX.billboard`), writing `profiles.billboard`.
 * Intentional line breaks are kept: the textarea passes them through as
 * typed and the validator's multiline rule keeps single blank lines.
 * Errors come from `validateEditorState` under `profile.billboard`.
 */

import { PROFILE_FIELD_MAX } from '@/modules/profile/profile-rules';
import type { SectionProps } from './editor-context';
import { EditorSectionCard } from './editor-section-card';
import { TextArea } from './text-field';

const BILLBOARD_PROMPT = 'If you could have a billboard, what would you say on it?';

export function SectionBillboard({ state, dispatch, errors, readOnly = false }: SectionProps) {
  return (
    <EditorSectionCard id="billboard" number={10} label="Billboard">
      <TextArea
        id="profile-billboard"
        label={BILLBOARD_PROMPT}
        value={state.fields.billboard}
        onChange={(value) => dispatch({ type: 'setField', field: 'billboard', value })}
        max={PROFILE_FIELD_MAX.billboard}
        error={errors['profile.billboard']}
        readOnly={readOnly}
        rows={3}
      />
    </EditorSectionCard>
  );
}
