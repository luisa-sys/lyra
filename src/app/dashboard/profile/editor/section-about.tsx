'use client';

/**
 * KAN-487 — v0.8 profile editor, section 01 "About Me" (spec v0.8 §01; plan
 * §C row 01, §D field labels).
 *
 *   Profile photo (required to publish)  photo-field.tsx
 *   Display name (required to publish)   60
 *   CheckLyra ID (required to publish)   lyra-id-field.tsx
 *   Headline                             100
 *   City                                 80, free text
 *   Country                              country-select.tsx
 *   A short intro                        500, multiline
 *   Causes close to my heart             ×6, title only, 250
 *   Things I’m proud of                  ×6, title only, 250
 *
 * Limits come from PROFILE_FIELD_MAX / ITEM_RULES (profile-rules.ts). Field
 * ids are `profile-<field>` (and `profile-photo`), matching the error keys
 * `profile.<field>` / `photo`, so a publish-error list can link to them.
 */

import { PROFILE_FIELD_MAX } from '@/modules/profile/profile-rules';
import type { ProfileFieldKey, SectionProps } from './editor-context';
import { CountrySelect } from './country-select';
import { EditorSectionCard, type EditorSectionCardProps } from './editor-section-card';
import { ItemListEditor } from './item-list-editor';
import { LyraIdField } from './lyra-id-field';
import { PhotoField } from './photo-field';
import { TextArea, TextField } from './text-field';

export const ABOUT_SECTION_ID = 'about';
export const ABOUT_LABEL = 'About Me';

export type SectionAboutProps = SectionProps & Pick<EditorSectionCardProps, 'open' | 'onToggle'>;

export function SectionAbout({ state, dispatch, errors, readOnly, open, onToggle }: SectionAboutProps) {
  const field = (key: Exclude<ProfileFieldKey, 'country'>) => ({
    id: `profile-${key}`,
    value: state.fields[key],
    onChange: (value: string) => dispatch({ type: 'setField', field: key, value }),
    max: PROFILE_FIELD_MAX[key],
    error: errors[`profile.${key}`],
    readOnly,
  });

  return (
    <EditorSectionCard id={ABOUT_SECTION_ID} number={1} label={ABOUT_LABEL} open={open} onToggle={onToggle}>
      <div className="space-y-5">
        <PhotoField
          photo={state.photo}
          isPublished={state.isPublished}
          dispatch={dispatch}
          error={errors.photo}
          readOnly={readOnly}
        />
        <TextField label="Display name" required autoComplete="name" {...field('display_name')} />
        <LyraIdField
          value={state.lyraId}
          locked={state.lyraIdLocked}
          firstPublishedAt={state.firstPublishedAt}
          dispatch={dispatch}
          error={errors['profile.lyra_id']}
          readOnly={readOnly}
        />
        <TextField label="Headline" {...field('headline')} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="City" autoComplete="address-level2" {...field('city')} />
          <CountrySelect
            value={state.fields.country}
            dispatch={dispatch}
            error={errors['profile.country']}
            readOnly={readOnly}
          />
        </div>
        <TextArea label="A short intro" rows={4} {...field('bio_short')} />
        <ItemListEditor
          listKey="causes"
          heading="Causes close to my heart"
          rows={state.lists.causes}
          fields={{ title: { label: 'Causes close to my heart', required: true }, url: false }}
          dispatch={dispatch}
          errors={errors}
          undo={state.undo.causes}
          addLabel="Add"
          readOnly={readOnly}
        />
        <ItemListEditor
          listKey="proud_of"
          heading="Things I’m proud of"
          rows={state.lists.proud_of}
          fields={{ title: { label: 'Things I’m proud of', required: true }, url: false }}
          dispatch={dispatch}
          errors={errors}
          undo={state.undo.proud_of}
          addLabel="Add"
          readOnly={readOnly}
        />
      </div>
    </EditorSectionCard>
  );
}
