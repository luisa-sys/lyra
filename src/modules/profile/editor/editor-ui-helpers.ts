/**
 * KAN-487 — v0.8 profile editor: small pure helpers behind the editor's
 * shared UI primitives (spec v0.8 §01–§10; plan §C "Every limited field…",
 * §D copy).
 *
 * The components under `src/app/dashboard/profile/editor/` stay thin: they
 * render these strings and decisions and dispatch reducer actions. Jest runs
 * without a DOM, so everything here is plain data in / data out.
 *
 * Rules:
 *   - Characters are counted with `countChars` (Unicode code points, what
 *     Postgres length() counts), never `.length` / `maxLength` (UTF-16).
 *   - A counter reads `{n} / {max}`; over the limit it is flagged so the UI
 *     turns it red-700 and shows the free-text "too long" message inline.
 *   - Add buttons are disabled at the cap with an `n of cap` note.
 *   - The undo row says "Removed '‹title›'." and expires 8 s after removal.
 *   - Section headings read `01 — About Me`.
 *   - A row with any validation error (`<rowKey>.<field>`) is shown expanded.
 */

import { countChars, tooLongError } from '@/modules/profile/free-text';
import { parseMemberUrl } from '@/modules/profile/member-url';

/** How long an undo row stays after a removal (plan §C: 8 s). */
export const UNDO_TTL_MS = 8000;

/** The longest row label shown in an undo message / summary title. */
export const SUMMARY_TITLE_MAX = 60;

/** The longest one-line description shown on a collapsed row. */
export const SUMMARY_DESCRIPTION_MAX = 120;

// ── Counters / limits ───────────────────────────────────────────────────

export interface CharCount {
  count: number;
  max: number;
  over: boolean;
  /** `{n} / {max}` */
  text: string;
}

export function charCount(value: string, max: number): CharCount {
  const count = countChars(value);
  return { count, max, over: count > max, text: `${count} / ${max}` };
}

/**
 * The inline error a field shows: the validator's error for that key when
 * there is one, otherwise the free-text "too long" message while the typed
 * text is over the limit (so the error appears live, before any save).
 */
export function liveFieldError(
  value: string,
  max: number | undefined,
  label: string,
  externalError: string | undefined,
): string | undefined {
  if (externalError) return externalError;
  if (max === undefined) return undefined;
  const n = countChars(value);
  return n > max ? tooLongError(label, n, max) : undefined;
}

/** `n of cap` beside a list's Add button, plus whether Add is disabled. */
export function capState(count: number, cap: number): { atCap: boolean; note: string } {
  return { atCap: count >= cap, note: `${count} of ${cap}` };
}

// ── Accessibility wiring ────────────────────────────────────────────────

/** Join the ids that describe a field; undefined when there are none. */
export function describedBy(...ids: ReadonlyArray<string | false | null | undefined>): string | undefined {
  const present = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  return present.length === 0 ? undefined : present.join(' ');
}

/** True when the validator reported an error on any field of this row. */
export function rowHasError(errors: Readonly<Record<string, string>>, rowKey: string): boolean {
  const prefix = `${rowKey}.`;
  return Object.keys(errors).some((k) => k.startsWith(prefix));
}

// ── Text shown on rows ──────────────────────────────────────────────────

/** Collapse whitespace to one line and cut at `max` code points with "…". */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return chars.slice(0, max - 1).join('').trimEnd() + '…';
}

/**
 * The name a row goes by on its summary line and in its undo message: its
 * title, or (no title yet) its description, on one line. '' when both are
 * blank.
 */
export function rowLabel(title: string, description = ''): string {
  const t = oneLine(title, SUMMARY_TITLE_MAX);
  return t !== '' ? t : oneLine(description, SUMMARY_TITLE_MAX);
}

/** Proposed copy (plan §D): "Removed '‹title›'." */
export function undoMessage(label: string): string {
  const l = oneLine(label, SUMMARY_TITLE_MAX);
  return l === '' ? 'Removed an empty entry.' : `Removed '${l}'.`;
}

/** Milliseconds left before an undo row removed at `at` expires (≥ 0). */
export function undoRemainingMs(at: number, now: number, ttl: number = UNDO_TTL_MS): number {
  return Math.max(0, at + ttl - now);
}

/**
 * A collapsed row's link chip: the text to show and, only when the link
 * passes the member-link rule (http/https, no credentials), an href. A link
 * that fails (e.g. `javascript:`) is shown as text, never made clickable.
 */
export function linkChip(url: string): { text: string; href: string | null } {
  const text = linkChipText(url);
  if (text === '') return { text, href: null };
  const parsed = parseMemberUrl(url);
  return { text, href: parsed.ok ? parsed.url : null };
}

/** The host a link chip shows (`www.` dropped); the raw text if unparseable. */
export function linkChipText(url: string): string {
  const raw = url.trim();
  if (raw === '') return '';
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
    return host.replace(/^www\./i, '') || raw;
  } catch {
    return raw;
  }
}

// ── Section cards ───────────────────────────────────────────────────────

/** `01 — About Me` (spec numbering, two digits, em dash). */
export function sectionHeadingText(n: number, label: string): string {
  return `${String(n).padStart(2, '0')} — ${label}`;
}

// ── Field context for screen readers ────────────────────────────────────

/**
 * Screen-reader-only text appended to an answer field's visible label
 * ("Your answer"), so each of the many answer fields names its question:
 * "Your answer" + ": Who you’d invite…". '' when the question is blank.
 */
export function answerLabelContext(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim();
  return q === '' ? '' : `: ${q}`;
}

/**
 * The screen-reader group label of one expanded list row, so repeated
 * "Title" / "Description" / "Link" labels carry their list and position:
 * "Gift ideas, entry 2 of 3".
 */
export function listRowGroupLabel(listName: string, index: number, total: number): string {
  return `${listName}, entry ${index + 1} of ${total}`;
}
