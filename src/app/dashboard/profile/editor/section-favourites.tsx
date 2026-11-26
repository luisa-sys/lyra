'use client';

/**
 * KAN-487 — v0.8 profile editor, section 06 "A few of my favourite things"
 * (spec v0.8 §06; plan §C row 06, §D copy).
 *
 * Five fixed sub-lists in the spec's fixed order, each up to 15 entries with
 * Add / Edit / Remove:
 *   Quotes                                         fav_quotes   (quotes)
 *   Movies / Theatre / TV                          fav_screen   (favourite_media; plays / favourite_tv shown)
 *   Books                                          fav_books    (favourite_books)
 *   Places (countries, venues, restaurants, etc.)  fav_places   (favourite_places; favourite_venues shown)
 *   Others                                         fav_others   (favourite_custom; favourite_music shown)
 *
 *   - Quotes: "Quote" required (500) + "Author / Speaker / Character"
 *     optional (120), no link. Stored as title = quote, description =
 *     author.
 *   - All others: title required (120), description optional (300), link
 *     optional (2,048).
 *   - A legacy `group_label` (Others) is shown by ItemListEditor as a muted,
 *     read-only tag; it is never asked for.
 * Caps and limits come from `ITEM_RULES` via ItemListEditor.
 */

import type { ListKey, SectionProps } from './editor-context';
import { EditorSectionCard, type EditorSectionCardProps } from './editor-section-card';
import { ItemListEditor, type ItemListFields } from './item-list-editor';

export const FAVOURITES_SECTION_ID = 'favourites';
export const FAVOURITES_LABEL = 'A few of my favourite things';

const QUOTE_FIELDS: ItemListFields = {
  title: { label: 'Quote', required: true },
  description: { label: 'Author / Speaker / Character' },
  url: false,
};

const ENTRY_FIELDS: ItemListFields = {
  title: { label: 'Title', required: true },
  description: { label: 'Description' },
  url: true,
};

/** Spec v0.8 §06: "Categories in fixed order". */
export const FAVOURITE_SUBLISTS: ReadonlyArray<{ listKey: ListKey; heading: string; fields: ItemListFields }> = [
  { listKey: 'fav_quotes', heading: 'Quotes', fields: QUOTE_FIELDS },
  { listKey: 'fav_screen', heading: 'Movies / Theatre / TV', fields: ENTRY_FIELDS },
  { listKey: 'fav_books', heading: 'Books', fields: ENTRY_FIELDS },
  { listKey: 'fav_places', heading: 'Places (countries, venues, restaurants, etc.)', fields: ENTRY_FIELDS },
  { listKey: 'fav_others', heading: 'Others', fields: ENTRY_FIELDS },
];

export type SectionFavouritesProps = SectionProps & Pick<EditorSectionCardProps, 'open' | 'onToggle'>;

export function SectionFavourites({ state, dispatch, errors, readOnly, open, onToggle }: SectionFavouritesProps) {
  return (
    <EditorSectionCard id={FAVOURITES_SECTION_ID} number={6} label={FAVOURITES_LABEL} open={open} onToggle={onToggle}>
      <div className="space-y-6">
        {FAVOURITE_SUBLISTS.map(({ listKey, heading, fields }) => (
          <ItemListEditor
            key={listKey}
            listKey={listKey}
            heading={heading}
            rows={state.lists[listKey]}
            fields={fields}
            dispatch={dispatch}
            errors={errors}
            undo={state.undo[listKey]}
            addLabel="Add"
            readOnly={readOnly}
          />
        ))}
      </div>
    </EditorSectionCard>
  );
}
