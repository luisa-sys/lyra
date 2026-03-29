'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardLink } from './types';

export function LinksStep({ links, onAdd, onRemove, onNext, isPending }: {
  links: WizardLink[];
  onAdd: (data: { title: string; url: string; link_type?: string }) => void;
  onRemove: (id: string) => void; onNext: () => void; isPending: boolean;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [linkType, setLinkType] = useState('general');

  const handleAdd = () => {
    if (!title.trim() || !url.trim()) return;
    onAdd({ title, url, link_type: linkType });
    setTitle('');
    setUrl('');
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
            <div key={l.id} className="flex items-center justify-between bg-white rounded-lg border border-stone-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">{l.title}</p>
                <p className="text-xs text-[var(--color-muted)] truncate max-w-xs">{l.url}</p>
              </div>
              <button onClick={() => onRemove(l.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 bg-white rounded-lg border border-stone-200 p-4">
        <Field label="Title" value={title} onChange={setTitle} placeholder="My Amazon wishlist" />
        <Field label="URL" value={url} onChange={setUrl} placeholder="https://amazon.co.uk/hz/wishlist/..." />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Type</label>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm">
            <option value="wishlist">Wishlist</option>
            <option value="retailer">Favourite shop</option>
            <option value="article">Article</option>
            <option value="general">Other</option>
          </select>
        </div>
        <button onClick={handleAdd} disabled={isPending || !title.trim() || !url.trim()}
          className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 disabled:opacity-40 transition-colors">
          + Add link
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}
