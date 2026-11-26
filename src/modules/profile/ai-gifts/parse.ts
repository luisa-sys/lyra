/**
 * KAN-489 — AI gift suggestions: shape-check the model's JSON.
 *
 * PURE. Structured outputs should already match SUGGESTIONS_SCHEMA, but model
 * output is untrusted input: anything that is not
 * `{ suggestions: [{ title: string, description?: string }] }` is dropped
 * item by item. Whitespace is collapsed (titles to one line; descriptions keep
 * no line breaks either — they are shown on one line in the editor), and at
 * most MAX_SUGGESTIONS items are kept.
 */

import type { AiSuggestion } from './types';

export const MAX_SUGGESTIONS = 10;

function oneLine(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

export function parseSuggestions(json: unknown): AiSuggestion[] {
  if (typeof json !== 'object' || json === null) return [];
  const list = (json as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return [];
  const out: AiSuggestion[] = [];
  for (const item of list) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (typeof item !== 'object' || item === null) continue;
    const { title, description } = item as { title?: unknown; description?: unknown };
    if (typeof title !== 'string') continue;
    const t = oneLine(title);
    if (t === '') continue;
    const d = typeof description === 'string' ? oneLine(description) : '';
    out.push({ title: t, description: d === '' ? null : d });
  }
  return out;
}
