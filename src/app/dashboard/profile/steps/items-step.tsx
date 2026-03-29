'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardItem } from './types';

export function ItemsStep({ title, description, categories, items, onAdd, onRemove, onNext, isPending }: {
  title: string; description: string; categories: string[]; items: WizardItem[];
  onAdd: (data: { category: string; title: string; description?: string }) => void;
  onRemove: (id: string) => void; onNext: () => void; isPending: boolean;
}) {
  const [category, setCategory] = useState(categories[0]);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');

  const categoryLabels: Record<string, string> = {
    likes: '💚 Like', dislikes: '💔 Dislike',
    gift_ideas: '🎁 Gift idea', gifts_to_avoid: '🚫 Avoid',
    boundaries: '🛑 Boundary', helpful_to_know: '💡 Helpful to know',
  };

  const handleAdd = () => {
    if (!itemTitle.trim()) return;
    onAdd({ category, title: itemTitle, ...(itemDesc ? { description: itemDesc } : {}) });
    setItemTitle('');
    setItemDesc('');
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
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">
                  <span className="opacity-60">{categoryLabels[item.category] || item.category}</span> — {item.title}
                </p>
                {item.description && <p className="text-xs text-[var(--color-muted)] mt-0.5">{item.description}</p>}
              </div>
              <button onClick={() => onRemove(item.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
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
        <button onClick={handleAdd} disabled={isPending || !itemTitle.trim()}
          className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 disabled:opacity-40 transition-colors">
          + Add item
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}
