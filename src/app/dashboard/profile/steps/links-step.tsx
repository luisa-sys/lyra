'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardLink } from './types';

export function LinksStep({ links, onAdd, onRemove, onEdit, onNext, isPending, showContinue = true }: {
  links: WizardLink[];
  // KAN-447 — links carry an optional one-line description. The column has
  // existed since the first schema migration; the editor now writes it.
  onAdd: (data: { title: string; url: string; link_type?: string; description?: string }) => void;
  onRemove: (id: string) => void;
  // KAN-447 — edit an existing link's title/description/url. Optional so the
  // legacy wizard, which doesn't pass it, keeps compiling and simply doesn't
  // render the inline Edit affordance. Returns the action result so the row can
  // surface a moderation error in place (same pattern as ItemsStep).
  onEdit?: (id: string, data: { title?: string; description?: string; url?: string }) => Promise<{ success: boolean; error?: string }>;
  onNext: () => void; isPending: boolean;
  // KAN-404 (#8/#9): the single-page editor sets showContinue={false} to drop
  // the misleading "Continue →" button; the legacy wizard keeps the default.
  showContinue?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [linkType, setLinkType] = useState('general');

  // KAN-447: inline edit state. Only one row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (link: WizardLink) => {
    setEditingId(link.id);
    setEditTitle(link.title);
    setEditDesc(link.description ?? '');
    setEditUrl(link.url);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (id: string) => {
    if (!onEdit || !editTitle.trim() || !editUrl.trim()) return;
    setEditSaving(true);
    setEditError(null);
    const res = await onEdit(id, {
      title: editTitle.trim(),
      // Send the description even when empty so the user can CLEAR it
      // (the action treats '' as null).
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

  const handleAdd = () => {
    if (!title.trim() || !url.trim()) return;
    onAdd({
      title,
      url,
      link_type: linkType,
      ...(description.trim() ? { description } : {}),
    });
    setTitle('');
    setUrl('');
    setDescription('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Links & wishlists</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">Share wishlists, favourite shops, or articles about you.</p>
      </div>
      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((l: WizardLink) => (
            <div key={l.id} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
              {onEdit && editingId === l.id ? (
                /* KAN-447: inline edit mode — reuses the add-form input
                   styling. Save runs onEdit; a moderation block shows in place. */
                <div className="space-y-3">
                  <Field label="Title" value={editTitle} onChange={setEditTitle} placeholder="Example: My birthday wishlist" />
                  <Field label="Description (optional)" value={editDesc} onChange={setEditDesc} placeholder="Example: things I've had my eye on all year" />
                  <Field label="URL" value={editUrl} onChange={setEditUrl} placeholder="Example: https://example.com/my-wishlist" />
                  {editError && <p role="alert" className="text-sm text-red-600">{editError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(l.id)}
                      disabled={editSaving || isPending || !editTitle.trim() || !editUrl.trim()}
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
                <div className="flex items-center justify-between gap-3">
                  {/* KAN-447: title and description sit on one line, with the
                      link itself underneath. */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-ink)]">
                      {l.title}
                      {l.description && (
                        <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">{l.description}</span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] truncate max-w-xs">{l.url}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => startEdit(l)}
                        disabled={isPending}
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      >
                        Edit
                      </button>
                    )}
                    <button onClick={() => onRemove(l.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 bg-white rounded-lg border border-[var(--color-border)] p-4">
        <Field label="Title" value={title} onChange={setTitle} placeholder="Example: My birthday wishlist" />
        <Field label="Description (optional)" value={description} onChange={setDescription} placeholder="Example: things I've had my eye on all year" />
        <Field label="URL" value={url} onChange={setUrl} placeholder="Example: https://example.com/my-wishlist" />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Type</label>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm">
            <option value="wishlist">Wishlist</option>
            <option value="retailer">Favourite shop</option>
            <option value="article">Article</option>
            <option value="general">Other</option>
          </select>
        </div>
        <button onClick={handleAdd} disabled={isPending || !title.trim() || !url.trim()}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-40 transition-colors">
          + Add link
        </button>
      </div>
      {showContinue && <SaveButton onClick={onNext} isPending={false} label="Continue →" />}
    </div>
  );
}
