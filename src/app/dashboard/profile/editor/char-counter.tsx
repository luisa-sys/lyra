'use client';

/**
 * KAN-487 — v0.8 profile editor: the `{n} / {max}` character counter
 * (spec v0.8 "All character limits include spaces"; plan §C, §E).
 *
 * Counts Unicode code points (`countChars`, what Postgres length() counts).
 * Over the limit the counter turns red-700; the inline error itself is shown
 * by the field (see text-field.tsx). Fields never use `maxLength`.
 * The counter is referenced from the field's `aria-describedby`, so it is
 * not a live region (announcing every keystroke would be noisy).
 */

import { charCount } from '@/modules/profile/editor/editor-ui-helpers';

export function CharCounter({ value, max, id }: { value: string; max: number; id: string }) {
  const c = charCount(value, max);
  return (
    <p
      id={id}
      className={`text-xs mt-1 tabular-nums ${c.over ? 'text-red-700 font-medium' : 'text-[var(--color-muted)]'}`}
    >
      {c.text}
      {c.over && <span className="sr-only"> (over the limit)</span>}
    </p>
  );
}
