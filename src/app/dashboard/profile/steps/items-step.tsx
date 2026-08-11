'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardItem } from './types';

// KAN-143 — UI-visible visibility levels. Keep in sync with
// the profile module's visibility.ts (VISIBILITY_LEVELS).
//
// KAN-234: extended with a 4th "inherit" option (value=''). When chosen,
// the server writes NULL to profile_items.visibility, and the item's
// effective visibility is computed from the section default at render
// time (see section-visibility.ts → getEffectiveItemVisibility).
const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '↗ Use section default' },
  { value: 'public', label: '🌍 Public — anyone with the link' },
  { value: 'members_only', label: '🔒 Members only — signed-in users' },
  { value: 'draft', label: '✏️ Draft — only you can see this' },
];

const visibilityShort: Record<string, string> = {
  public: '🌍 Public',
  members_only: '🔒 Members',
  draft: '✏️ Draft',
  // 'private' is the legacy enum value (pre-KAN-143). Render as draft.
  private: '✏️ Draft',
};

// KAN-234: short label for the NULL/inherit case in the per-item selector.
const INHERIT_SHORT = '↗ Inherit';

export function ItemsStep({ title, description, categories, items, onAdd, onRemove, onUpdateVisibility, onEdit, onNext, isPending, hideVisibility = false, showContinue = true, categoryOptions, groupLabelCategory, labelForItem, rowLayout = 'label' }: {
  title: string; description: string; categories: string[]; items: WizardItem[];
  // KAN-219 — items now carry an optional URL (Python `lyra-app` parity).
  // Server-side `addProfileItem` runs the value through `sanitiseUrl`, which
  // rejects anything not http(s). UI emits the trimmed string; empty is
  // treated as "no URL".
  onAdd: (data: { category: string; title: string; description?: string; url?: string; visibility?: string; groupLabel?: string }) => void;
  onRemove: (id: string) => void;
  onUpdateVisibility: (id: string, visibility: string) => void;
  // KAN-404 (#12) — edit an existing item's text (title/description/url).
  // Optional so legacy wizard callers that don't pass it keep compiling and
  // simply don't render the inline Edit affordance. Returns the action result
  // so the row can surface a moderation error in place (same red-text pattern
  // as blocked adds) without a page reload.
  onEdit?: (id: string, data: { title?: string; description?: string; url?: string }) => Promise<{ success: boolean; error?: string }>;
  onNext: () => void; isPending: boolean;
  // KAN-266: the June-2026 redesign drops per-item visibility (the profile is
  // simply public; affiliations are the only hidden-by-default thing). When
  // hideVisibility is set, the per-item + new-item visibility selects are not
  // rendered and new items inherit the section default (NULL → public). The
  // legacy wizard still passes hideVisibility=false to keep its controls.
  hideVisibility?: boolean;
  // KAN-404 (#8/#9): the single-page editor sets showContinue={false} to drop
  // the misleading "Continue →" button (it only collapsed the section, which
  // read as navigation that went nowhere). The legacy wizard keeps the default
  // true so "Continue →" still advances steps there — zero legacy change.
  showContinue?: boolean;
  // KAN-444: the favourites section groups several categories under one
  // heading (films + plays + TV are one group), so its picker offers one
  // choice per GROUP rather than one per category. When supplied, these
  // options replace the default one-option-per-category list; the value is
  // the category a new item is written under. Sections that map 1:1 onto
  // categories omit it and keep the existing behaviour untouched.
  categoryOptions?: ReadonlyArray<{ value: string; label: string }>;
  // KAN-444: when the chosen category equals this, the member is naming a
  // group of their own, so a "Group name" field appears and its value is
  // passed to onAdd. Omitted everywhere else.
  groupLabelCategory?: string;
  // KAN-444: how to label an existing row in the list. Lets the favourites
  // section show the group heading a member will actually see on their
  // public profile instead of the raw per-category label. Returning null
  // falls back to the built-in category labels below.
  labelForItem?: (item: WizardItem) => string | null;
  // KAN-443: how an existing row is laid out.
  //   'label'  (default) — "🎁 Gift idea — Dark chocolate", description on a
  //                        second line, link as a ↗ chip after the title.
  //   'inline'           — "Dark chocolate — the really dark one", no category
  //                        prefix, and the link on its own line underneath.
  // The gifts section uses 'inline' because it holds ONE category, so the
  // prefix repeated the section heading on every row and pushed the thing the
  // member actually wrote off the start of the line. Everything else keeps the
  // default, so no other section changes.
  rowLayout?: 'label' | 'inline';
}) {
  const [category, setCategory] = useState(categoryOptions ? categoryOptions[0].value : categories[0]);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemUrl, setItemUrl] = useState('');
  // KAN-444: the member's heading for their own favourites group.
  const [groupLabel, setGroupLabel] = useState('');
  // KAN-234: new items default to '' (inherit from section default).
  const [itemVisibility, setItemVisibility] = useState<string>('');

  // KAN-404 (#12): inline edit state. Only one row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (item: WizardItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDesc(item.description ?? '');
    setEditUrl(item.url ?? '');
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (id: string) => {
    if (!onEdit || !editTitle.trim()) return;
    setEditSaving(true);
    setEditError(null);
    const res = await onEdit(id, {
      title: editTitle.trim(),
      // Send description/url even when empty so the user can CLEAR them
      // (the action treats '' description as null; '' url as "no URL").
      description: editDesc,
      url: editUrl.trim(),
    });
    setEditSaving(false);
    if (res.success) {
      setEditingId(null);
      setEditError(null);
    } else {
      setEditError(res.error ?? 'Could not save. Please try again.');
    }
  };

  const categoryLabels: Record<string, string> = {
    likes: '💚 Like', dislikes: '💔 Dislike',
    gift_ideas: '🎁 Gift idea', gifts_to_avoid: '🚫 Avoid',
    boundaries: '🛑 Boundary', helpful_to_know: '💡 Helpful to know',
    favourite_books: '📖 Book', favourite_media: '🎬 Movie',
    causes: '🌍 Cause', quotes: '💬 Quote',
    proud_of: '🏆 Proud of', life_hacks: '💡 Life hack',
    questions: '❓ Question', billboard: '📢 Billboard',
    // KAN-182: "Problems I'm trying to solve" — current
    // challenges / projects / interests for networking + collaboration.
    current_problems: '🧩 Currently solving',
    // KAN-263: favourites split out for the redesign favourites grid.
    favourite_tv: '📺 TV show', plays: '🎭 Play', favourite_places: '📍 Place', favourite_music: '🎵 Music',
    // KAN-444: a group the member named themselves.
    favourite_custom: '⭐ Your own group',
  };

  // KAN-444: the picker offers groups when the section supplies them.
  const pickerOptions = categoryOptions ?? categories.map((c) => ({ value: c, label: categoryLabels[c] || c }));
  const needsGroupLabel = groupLabelCategory != null && category === groupLabelCategory;
  const canAdd = itemTitle.trim() !== '' && (!needsGroupLabel || groupLabel.trim() !== '');

  const handleAdd = () => {
    if (!canAdd) return;
    const trimmedUrl = itemUrl.trim();
    onAdd({
      category,
      title: itemTitle,
      ...(itemDesc ? { description: itemDesc } : {}),
      ...(trimmedUrl ? { url: trimmedUrl } : {}),
      ...(needsGroupLabel ? { groupLabel: groupLabel.trim() } : {}),
      visibility: itemVisibility,
    });
    setItemTitle('');
    setItemDesc('');
    setItemUrl('');
    setGroupLabel('');
    setItemVisibility(''); // KAN-234: reset to inherit
  };

  return (
    <div className="space-y-6">
      {/* KAN-266: in the redesigned editor the warm section header already
          shows the title, so title='' suppresses the duplicate h2. */}
      {(title || description) && (
        <div>
          {title && <h2 className="text-xl font-medium text-[var(--color-ink)]">{title}</h2>}
          {description && <p className="text-sm text-[var(--color-muted)] mt-1">{description}</p>}
        </div>
      )}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item: WizardItem) => (
            <div key={item.id} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
              {onEdit && editingId === item.id ? (
                /* KAN-404 (#12): inline edit mode — reuses the add-form input
                   styling. Save runs onEdit; a moderation block shows in place. */
                <div className="space-y-3">
                  <Field label="Title" value={editTitle} onChange={setEditTitle} placeholder="Example: Dark chocolate, hiking boots" />
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Description (optional)</label>
                    <input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
                      placeholder="Example: the really dark one with sea salt"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-ink)] mb-1" htmlFor={`edit-item-url-${item.id}`}>
                      Link (optional)
                    </label>
                    <input
                      id={`edit-item-url-${item.id}`}
                      type="url"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
                      placeholder="Example: https://example.com/this-book"
                    />
                  </div>
                  {editError && <p role="alert" className="text-sm text-red-600">{editError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(item.id)}
                      disabled={editSaving || isPending || !editTitle.trim()}
                      className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={editSaving}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    {rowLayout === 'inline' ? (
                      /* KAN-443: name and note on ONE line, same weight
                         relationship as the public profile's list sections,
                         with any link underneath. No category prefix — this
                         layout is only used by single-category sections, where
                         it just repeated the heading. */
                      <>
                        <p className="text-sm text-[var(--color-ink)]">
                          <span className="font-medium">{item.title}</span>
                          {item.description && (
                            <span className="text-[var(--color-muted)]"> — {item.description}</span>
                          )}
                        </p>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-0.5 text-xs text-[var(--color-sage)] hover:underline"
                            aria-label={`Open link for ${item.title}`}
                          >
                            🔗 view link
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-[var(--color-ink)]">
                          {/* KAN-444: label the row with the heading it will
                              appear under publicly, when the section knows it. */}
                          <span className="opacity-60">{labelForItem?.(item) ?? categoryLabels[item.category] ?? item.category}</span> — {item.title}
                          {/* KAN-219: ↗ chip when an item has a URL. Open in new tab
                              with noopener+noreferrer to prevent tab-nabbing. */}
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1.5 text-xs text-[var(--color-sage)] hover:underline"
                              aria-label={`Open link for ${item.title}`}
                            >
                              ↗
                            </a>
                          )}
                        </p>
                        {item.description && <p className="text-xs text-[var(--color-muted)] mt-0.5">{item.description}</p>}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    {!hideVisibility && (
                      <>
                        <label className="sr-only" htmlFor={`vis-${item.id}`}>Visibility</label>
                        <select
                          id={`vis-${item.id}`}
                          aria-label={`Visibility for ${item.title}`}
                          // KAN-234: NULL stored visibility → '' in the form = inherit.
                          // Known string → its real value. Unknown string → 'public' (defence).
                          value={
                            item.visibility == null || item.visibility === ''
                              ? ''
                              : visibilityShort[item.visibility]
                                ? item.visibility
                                : 'public'
                          }
                          onChange={(e) => onUpdateVisibility(item.id, e.target.value)}
                          disabled={isPending}
                          className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-white text-[var(--color-ink)]"
                        >
                          {VISIBILITY_OPTIONS.map((opt) => (
                            <option key={opt.value || 'inherit'} value={opt.value}>
                              {opt.value === '' ? INHERIT_SHORT : visibilityShort[opt.value]}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {/* KAN-404 (#12): Edit is only offered when a handler is wired
                        (redesign editor); the legacy wizard omits onEdit. */}
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        disabled={isPending}
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      >
                        Edit
                      </button>
                    )}
                    <button onClick={() => onRemove(item.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 bg-white rounded-lg border border-[var(--color-border)] p-4">
        {pickerOptions.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-ink)] mb-1" htmlFor="new-item-category">
              {categoryOptions ? 'Group' : 'Category'}
            </label>
            <select id="new-item-category" value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm">
              {pickerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
        {/* KAN-444: naming a group of your own. Only shown once the member
            has chosen to add one, so the common path stays a single pick. */}
        {needsGroupLabel && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-ink)] mb-1" htmlFor="new-item-group-label">
              Group name
            </label>
            <input
              id="new-item-group-label"
              value={groupLabel}
              onChange={(e) => setGroupLabel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
              placeholder="Example: Board games"
            />
            <p className="text-xs text-[var(--color-muted)] mt-1">
              Use the same name again to add more to this group.
            </p>
          </div>
        )}
        <Field label="Title" value={itemTitle} onChange={setItemTitle} placeholder="Example: Dark chocolate, hiking boots" />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Description (optional)</label>
          <input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
            placeholder="Example: the really dark one with sea salt" />
        </div>
        {/* KAN-219: optional URL on items (Python lyra-app parity).
            Server-side sanitiseUrl rejects anything that's not http(s);
            the user gets a clear error rather than silent drop. */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1" htmlFor="new-item-url">
            Link (optional)
          </label>
          <input
            id="new-item-url"
            type="url"
            value={itemUrl}
            onChange={(e) => setItemUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
            placeholder="Example: https://example.com/this-book"
          />
        </div>
        {!hideVisibility && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-ink)] mb-1" htmlFor="new-item-visibility">
              Visibility
            </label>
            <select
              id="new-item-visibility"
              value={itemVisibility}
              onChange={(e) => setItemVisibility(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm"
            >
              {VISIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={handleAdd} disabled={isPending || !canAdd}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-40 transition-colors">
          + Add item
        </button>
      </div>
      {showContinue && <SaveButton onClick={onNext} isPending={false} label="Continue →" />}
    </div>
  );
}
