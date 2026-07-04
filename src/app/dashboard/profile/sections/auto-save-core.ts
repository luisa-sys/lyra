/**
 * KAN-404 (#8/#9) — framework-agnostic core of the auto-save status
 * transition, shared by the debounced timer path AND the eager flush()
 * path in `use-auto-save.tsx`.
 *
 * Kept free of React so the saving→saved / saving→error contract can be
 * unit-tested directly (the project's jest env is `node`, so hooks that
 * touch the DOM can't be rendered). Both call sites go through this one
 * function so the two paths can never drift.
 */

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type AutoSaveResult =
  | { success: true }
  | { success: false; error: string }
  | void;

/**
 * Run a single save: flip to 'saving', await the save, then settle on
 * 'saved' (success / void) or 'error' (an `{ success: false }` result or a
 * throw). Never rejects — the status is the only channel for failure so
 * callers (a debounce timer, a Save-button click) don't need try/catch.
 */
export async function runSave<T>(
  save: (v: T) => Promise<AutoSaveResult>,
  value: T,
  setStatus: (s: AutoSaveStatus) => void,
): Promise<void> {
  setStatus('saving');
  try {
    const result = await save(value);
    if (result && 'success' in result && result.success === false) {
      setStatus('error');
    } else {
      setStatus('saved');
    }
  } catch {
    setStatus('error');
  }
}
