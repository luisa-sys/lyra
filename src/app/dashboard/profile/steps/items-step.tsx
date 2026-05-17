'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardItem } from './types';

// KAN-143 — UI-visible visibility levels. Keep in sync with
// src/app/dashboard/profile/visibility.ts (VISIBILITY_LEVELS).
const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
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

export function ItemsStep({ title, description, categories, items, onAdd, onRemove, onUpdateVisibility, onNext, isPending }: {
  title: string; description: string; categories: string[]; items: WizardItem[];
  // KAN-219 — items now carry an optional URL (Python `lyra-app` parity).
  // Server-side `addProfileItem` runs the value through `sanitiseUrl`, which
  // rejects anything not http(s). UI emits the trimmed string; empty is
  // treated as "no URL".
  onAdd: (data: { category: string; title: string; description?: string; url?: string; visibility?: string }) => void;
  onRemove: (id: string) => void;
  onUpdateVisibility: (id: string, visibility: string) => void;
  onNext: () => void; isPending: boolean;
}) {
  const [category, setCategory] = useState(categories[0]);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemUrl, setItemUrl] = useState('');
  const [itemVisibility, setItemVisibility] = useState<string>('public');

  const categoryLabels: Record<string, string> = {
    likes: '💚 Like', dislikes: '💔 Dislike',
    gift_ideas: '🎁 Gift idea', gifts_to_avoid: '🚫 Avoid',
    boundaries: '🛑 Boundary', helpful_to_know: '💡 Helpful to know',
    favourite_books: '📖 Book', favourite_media: '🎬 Movie/Series',
    causes: '🌍 Cause', quotes: '💬 Quote',
    proud_of: '🏆 Proud of', life_hacks: '💡 Life hack',
    questions: '❓ Question', billboard: '📢 Billboard',
    // KAN-182: "Problems I'm trying to solve" — current
    // challenges / projects / interests for networking + collaboration.
    current_problems: '🧩 Currently solving',
  };

  const handleAdd = () => {
    if (!itemTitle.trim()) return;
    const trimmedUrl = itemUrl.trim();
    onAdd({
      category,
      title: itemTitle,
      ...(itemDesc ? { description: itemDesc } : {}),
      ...(trimmedUrl ? { url: trimmedUrl } : {}),
      visibility: itemVisibility,
    });
    setItemTitle('');
    setItemDesc('');
    setItemUrl('');
    setItemVisibility('public');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">{title}</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">{description}</p>
      </div>
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item: WizardItem) => (
            <div key={item.id} className="flex items-center justify-between bg-white rounded-lg border border-stone-200 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)]">
                  <span className="opacity-60">{categoryLabels[item.category] || item.category}</span> — {item.title}
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
              </div>
              <div className="flex items-center gap-2 ml-3">
                <label className="sr-only" htmlFor={`vis-${item.id}`}>Visibility</label>
                <select
                  id={`vis-${item.id}`}
                  aria-label={`Visibility for ${item.title}`}
                  value={visibilityShort[item.visibility] ? item.visibility : 'public'}
                  onChange={(e) => onUpdateVisibility(item.id, e.target.value)}
                  disabled={isPending}
                  className="text-xs px-2 py-1 rounded border border-stone-300 bg-white text-[var(--color-ink)]"
                >
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{visibilityShort[opt.value]}</option>
                  ))}
                </select>
                <button onClick={() => onRemove(item.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 bg-white rounded-lg border border-stone-200 p-4">
        {categories.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm">
              {categories.map((c: string) => (
                <option key={c} value={c}>{categoryLabels[c] || c}</option>
              ))}
            </select>
          </div>
        )}
        <Field label="Title" value={itemTitle} onChange={setItemTitle} placeholder="e.g. Dark chocolate, hiking boots" />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Description (optional)</label>
          <input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
            placeholder="Any extra detail" />
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
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
            placeholder="https://example.com/this-book"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1" htmlFor="new-item-visibility">
            Visibility
          </label>
          <select
            id="new-item-visibility"
            value={itemVisibility}
            onChange={(e) => setItemVisibility(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm"
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button onClick={handleAdd} disabled={isPending || !itemTitle.trim()}
          className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 disabled:opacity-40 transition-colors">
          + Add item
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}
