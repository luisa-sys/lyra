'use client';

/**
 * KAN-487 — v0.8 profile editor: which list rows are expanded, kept across a
 * save (PR2 review minor "rows collapse after a save").
 *
 * A save rewrites every new row's key (`new:<uuid>`) to its stored id. The
 * form publishes the accumulated `idMap` through `SaveKeyMapContext`; this
 * hook reads its expanded set through `remapKeySet`, so a row that was open
 * under its `new:` key is still open under its id.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { remapKeySet } from '@/modules/profile/editor/editor-shell';

/** Every `new:` key → stored id mapping returned by this session's saves. */
export const SaveKeyMapContext = createContext<Readonly<Record<string, string>>>({});

export function useExpandedRows(initial: () => Iterable<string>): {
  expanded: ReadonlySet<string>;
  setOpen: (key: string, open: boolean) => void;
} {
  const keyMap = useContext(SaveKeyMapContext);
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set(initial()));
  const expanded = useMemo(() => remapKeySet(raw, keyMap), [raw, keyMap]);
  const setOpen = useCallback(
    (key: string, open: boolean) =>
      setRaw((prev) => {
        const next = new Set(remapKeySet(prev, keyMap));
        if (open) next.add(key);
        else next.delete(key);
        return next;
      }),
    [keyMap],
  );
  return { expanded, setOpen };
}
