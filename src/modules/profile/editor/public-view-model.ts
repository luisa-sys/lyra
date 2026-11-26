/**
 * KAN-487 — v0.8 public profile view-model (spec v0.8 §1 "Do not show empty
 * fields, unanswered questions or empty sections publicly", §2 sections
 * 01–10, §3 "All links must use http/https"; plan §A "Pure logic").
 *
 * `buildPublicProfileView(state, { audience })` turns an `EditorState` into a
 * render-ready model. It is pure: no Supabase calls, no `'use client'`, no
 * server-only imports. The editor's Preview renders it (audience
 * `'owner-preview'`); step 5 reuses it for the public page (`'public'`).
 *
 * Rules:
 *   - Sections come out in spec order (01 About Me … 10 Billboard). Every
 *     empty field is null / absent and every empty section is dropped.
 *   - Affiliations appear ONLY when `showOnProfile` is true — for BOTH
 *     audiences (spec §1: never include hidden data in visitor previews).
 *   - AI gift suggestions appear ONLY when `approved`, grouped under
 *     "AI suggested" (spec §03).
 *   - Text is kept verbatim (line breaks preserved); whitespace-only counts
 *     as empty. Exception (KAN-487 line-break decision): item titles other
 *     than a quote are single-line, so their whitespace is collapsed exactly
 *     as the save will store it — the preview never shows a break the public
 *     page drops. Descriptions and quote text keep their breaks.
 *   - Country is shown as its English name (`countries.ts`); a legacy
 *     free-text value that is not a code is shown as stored.
 *   - Links pass `parseMemberUrl` (http/https only) or are dropped; lists the
 *     spec gives no link field (causes, proud_of, quotes, not-for-me,
 *     problems) never carry one.
 *   - Random Q&A shows answered questions only, with the preset's own
 *     wording (also for presets deactivated after answering).
 */

import { countryName } from '@/modules/profile/countries';
import { itemTitleIsMultiline } from '@/modules/profile/field-validation';
import { parseMemberUrl } from '@/modules/profile/member-url';
import type { ManualOfMeField } from '@/modules/profile/manual-of-me-fields';
import type {
  AffiliationType,
  EditorRow,
  EditorState,
  ListKey,
  PresetQuestionRow,
  CustomQuestionRow,
} from './editor-state';

// ── Model ───────────────────────────────────────────────────────────────

export type PublicViewAudience = 'owner-preview' | 'public';

export interface PublicViewOptions {
  audience: PublicViewAudience;
}

/** One list entry. `url` is a validated http/https link or null. */
export interface PublicEntry {
  title: string;
  description: string | null;
  url: string | null;
  /** Legacy favourite_custom group name (muted tag), Others only. */
  tag: string | null;
}

export interface PublicAboutSection {
  id: 'about';
  label: 'About Me';
  photoUrl: string | null;
  displayName: string | null;
  lyraId: string | null;
  headline: string | null;
  city: string | null;
  country: string | null;
  intro: string | null;
  causes: string[];
  proudOf: string[];
}

export interface PublicAffiliationEntry {
  name: string;
  location: string | null;
  description: string | null;
}

export interface PublicAffiliationGroup {
  type: AffiliationType;
  label: 'Schools' | 'Organisations' | 'Communities';
  entries: PublicAffiliationEntry[];
}

export interface PublicAffiliationsSection {
  id: 'affiliations';
  label: 'Where you might know me from';
  groups: PublicAffiliationGroup[];
}

export interface PublicGiftsSection {
  id: 'gifts';
  label: 'Gifts: Things I love, can’t get enough of, or have been dreaming about';
  preference: string | null;
  userGifts: PublicEntry[];
  aiGroupLabel: 'AI suggested';
  aiSuggested: PublicEntry[];
}

export interface PublicListSection<I extends string, L extends string> {
  id: I;
  label: L;
  entries: PublicEntry[];
}

export type PublicNotForMeSection = PublicListSection<'notforme', 'Things that aren’t really for me'>;
export type PublicTipsSection = PublicListSection<'tips', 'Tips & life hacks I can share'>;
export type PublicProblemsSection = PublicListSection<'problems', 'Problems I’m trying to solve — ideas welcome'>;

export interface PublicUnderstandItem {
  field: ManualOfMeField;
  label: string;
  text: string;
}

export interface PublicUnderstandSection {
  id: 'understand';
  label: 'To understand me a little better';
  items: PublicUnderstandItem[];
}

export type FavouriteListKey = 'fav_quotes' | 'fav_screen' | 'fav_books' | 'fav_places' | 'fav_others';

export interface PublicFavouriteGroup {
  key: FavouriteListKey;
  label: string;
  /** For Quotes: title = the quote, description = author / speaker / character. */
  entries: PublicEntry[];
}

export interface PublicFavouritesSection {
  id: 'favourites';
  label: 'A few of my favourite things';
  groups: PublicFavouriteGroup[];
}

export interface PublicQuestionItem {
  question: string;
  answer: string;
}

export interface PublicQuestionsSection {
  id: 'starters';
  label: 'Random Questions & Answers';
  items: PublicQuestionItem[];
}

export interface PublicBillboardSection {
  id: 'billboard';
  label: 'Billboard';
  text: string;
}

export type PublicSection =
  | PublicAboutSection
  | PublicAffiliationsSection
  | PublicGiftsSection
  | PublicNotForMeSection
  | PublicUnderstandSection
  | PublicFavouritesSection
  | PublicTipsSection
  | PublicProblemsSection
  | PublicQuestionsSection
  | PublicBillboardSection;

export type PublicSectionId = PublicSection['id'];

export interface PublicProfileView {
  audience: PublicViewAudience;
  sections: PublicSection[];
}

// ── Constants (spec v0.8 wording) ───────────────────────────────────────

const AFFILIATION_GROUPS: ReadonlyArray<{ type: AffiliationType; label: PublicAffiliationGroup['label'] }> = [
  { type: 'school', label: 'Schools' },
  { type: 'organisation', label: 'Organisations' },
  { type: 'community', label: 'Communities' },
];

/** §05 prompts in spec order with spec labels. */
const UNDERSTAND_FIELDS: ReadonlyArray<{ field: ManualOfMeField; label: string }> = [
  { field: 'good_to_know', label: 'Good to know about me / Things I’m into' },
  { field: 'boundaries', label: 'My boundaries' },
  { field: 'communication_style', label: 'How I find communication easier' },
  { field: 'working_preferences', label: 'If you ever come to my house' },
  { field: 'energises_me', label: 'What gives me energy' },
  { field: 'drains_me', label: 'What drains me' },
];

/** §06 categories in fixed order. */
const FAVOURITE_GROUPS: ReadonlyArray<{ key: FavouriteListKey; label: string }> = [
  { key: 'fav_quotes', label: 'Quotes' },
  { key: 'fav_screen', label: 'Movies / Theatre / TV' },
  { key: 'fav_books', label: 'Books' },
  { key: 'fav_places', label: 'Places' },
  { key: 'fav_others', label: 'Others' },
];

/** Lists the spec gives no link field: a stored URL is never shown. */
const NO_LINK_LISTS: ReadonlySet<ListKey> = new Set<ListKey>([
  'causes',
  'proud_of',
  'gifts_to_avoid',
  'fav_quotes',
  'current_problems',
]);

// ── Helpers ─────────────────────────────────────────────────────────────

/** Verbatim text, or null when empty / whitespace-only. */
function textOrNull(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v;
}

/** An item title as stored: one line unless the category keeps breaks (quotes). */
function itemTitleOrNull(v: string | null | undefined, category: string): string | null {
  const t = textOrNull(v);
  if (t === null || itemTitleIsMultiline(category)) return t;
  return t.replace(/\s+/g, ' ').trim();
}

/** A validated http/https link, or null. */
function safeLink(v: string | null | undefined): string | null {
  if (textOrNull(v) === null) return null;
  const parsed = parseMemberUrl(v);
  return parsed.ok ? parsed.url : null;
}

function countryDisplay(v: string): string | null {
  const raw = textOrNull(v);
  if (raw === null) return null;
  return countryName(raw.trim()) ?? raw;
}

function photoUrl(state: EditorState, audience: PublicViewAudience): string | null {
  const p = state.photo;
  if (p.kind === 'stored') return safeLink(p.url);
  // A staged upload is not published yet: only the owner's preview shows it.
  if (p.kind === 'staged' && audience === 'owner-preview') return textOrNull(p.previewUrl);
  return null;
}

/** Completed entries of a list (rows without a title are dropped). */
function entries(state: EditorState, listKey: ListKey): PublicEntry[] {
  const out: PublicEntry[] = [];
  const noLink = NO_LINK_LISTS.has(listKey);
  for (const row of state.lists[listKey] as EditorRow[]) {
    const title = itemTitleOrNull(row.title, row.category);
    if (title === null) continue;
    out.push({
      title,
      description: textOrNull(row.description),
      url: noLink ? null : safeLink(row.url),
      tag: listKey === 'fav_others' ? textOrNull(row.groupLabel) : null,
    });
  }
  return out;
}

function titles(state: EditorState, listKey: ListKey): string[] {
  return entries(state, listKey).map((e) => e.title);
}

// ── Section builders (spec order) ───────────────────────────────────────

function aboutSection(state: EditorState, audience: PublicViewAudience): PublicAboutSection | null {
  const f = state.fields;
  const s: PublicAboutSection = {
    id: 'about',
    label: 'About Me',
    photoUrl: photoUrl(state, audience),
    displayName: textOrNull(f.display_name),
    lyraId: textOrNull(state.lyraId),
    headline: textOrNull(f.headline),
    city: textOrNull(f.city),
    country: countryDisplay(f.country),
    intro: textOrNull(f.bio_short),
    causes: titles(state, 'causes'),
    proudOf: titles(state, 'proud_of'),
  };
  const empty =
    s.photoUrl === null &&
    s.displayName === null &&
    s.lyraId === null &&
    s.headline === null &&
    s.city === null &&
    s.country === null &&
    s.intro === null &&
    s.causes.length === 0 &&
    s.proudOf.length === 0;
  return empty ? null : s;
}

function affiliationsSection(state: EditorState): PublicAffiliationsSection | null {
  // Hidden affiliations NEVER appear, whatever the audience.
  const visible = state.affiliations.filter((a) => a.showOnProfile === true);
  const groups: PublicAffiliationGroup[] = [];
  for (const g of AFFILIATION_GROUPS) {
    const groupEntries: PublicAffiliationEntry[] = [];
    for (const a of visible) {
      if (a.affiliationType !== g.type) continue;
      const name = textOrNull(a.name);
      if (name === null) continue;
      groupEntries.push({ name, location: textOrNull(a.location), description: textOrNull(a.description) });
    }
    if (groupEntries.length > 0) groups.push({ type: g.type, label: g.label, entries: groupEntries });
  }
  return groups.length === 0
    ? null
    : { id: 'affiliations', label: 'Where you might know me from', groups };
}

function giftsSection(state: EditorState): PublicGiftsSection | null {
  const preference = textOrNull(state.fields.gift_voucher_hint);
  const userGifts = entries(state, 'gift_ideas');
  const aiSuggested: PublicEntry[] = [];
  for (const g of state.aiGifts) {
    if (g.approved !== true) continue; // never publish an unapproved suggestion
    const title = itemTitleOrNull(g.title, 'gift_ideas');
    if (title === null) continue;
    aiSuggested.push({ title, description: textOrNull(g.description), url: safeLink(g.url), tag: null });
  }
  if (preference === null && userGifts.length === 0 && aiSuggested.length === 0) return null;
  return {
    id: 'gifts',
    label: 'Gifts: Things I love, can’t get enough of, or have been dreaming about',
    preference,
    userGifts,
    aiGroupLabel: 'AI suggested',
    aiSuggested,
  };
}

function listSection<I extends string, L extends string>(
  state: EditorState,
  listKey: ListKey,
  id: I,
  label: L,
): PublicListSection<I, L> | null {
  const list = entries(state, listKey);
  return list.length === 0 ? null : { id, label, entries: list };
}

function understandSection(state: EditorState): PublicUnderstandSection | null {
  const items: PublicUnderstandItem[] = [];
  for (const { field, label } of UNDERSTAND_FIELDS) {
    const text = textOrNull(state.manualOfMe[field]);
    if (text !== null) items.push({ field, label, text });
  }
  return items.length === 0 ? null : { id: 'understand', label: 'To understand me a little better', items };
}

function favouritesSection(state: EditorState): PublicFavouritesSection | null {
  const groups: PublicFavouriteGroup[] = [];
  for (const g of FAVOURITE_GROUPS) {
    const list = entries(state, g.key);
    if (list.length > 0) groups.push({ key: g.key, label: g.label, entries: list });
  }
  return groups.length === 0 ? null : { id: 'favourites', label: 'A few of my favourite things', groups };
}

function questionsSection(state: EditorState): PublicQuestionsSection | null {
  const order = new Map(state.presets.map((p, i) => [p.id, i]));
  const presets = state.questions
    .filter((q): q is PresetQuestionRow => q.kind === 'preset')
    .map((q, i) => ({ q, rank: order.get(q.promptId) ?? state.presets.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ q }) => q);
  const customs = state.questions.filter((q): q is CustomQuestionRow => q.kind === 'custom');

  const items: PublicQuestionItem[] = [];
  for (const q of presets) {
    const question = textOrNull(q.prompt);
    const answer = textOrNull(q.answer);
    if (question !== null && answer !== null) items.push({ question, answer });
  }
  for (const q of customs) {
    const question = textOrNull(q.customPrompt);
    const answer = textOrNull(q.answer);
    if (question !== null && answer !== null) items.push({ question, answer });
  }
  return items.length === 0 ? null : { id: 'starters', label: 'Random Questions & Answers', items };
}

function billboardSection(state: EditorState): PublicBillboardSection | null {
  const text = textOrNull(state.fields.billboard);
  return text === null ? null : { id: 'billboard', label: 'Billboard', text };
}

// ── Entry point ─────────────────────────────────────────────────────────

/** Render-ready public view of an editor state (spec v0.8 §01–§10). */
export function buildPublicProfileView(state: EditorState, options: PublicViewOptions): PublicProfileView {
  const sections: Array<PublicSection | null> = [
    aboutSection(state, options.audience),
    affiliationsSection(state),
    giftsSection(state),
    listSection(state, 'gifts_to_avoid', 'notforme', 'Things that aren’t really for me'),
    understandSection(state),
    favouritesSection(state),
    listSection(state, 'life_hacks', 'tips', 'Tips & life hacks I can share'),
    listSection(state, 'current_problems', 'problems', 'Problems I’m trying to solve — ideas welcome'),
    questionsSection(state),
    billboardSection(state),
  ];
  return {
    audience: options.audience,
    sections: sections.filter((s): s is PublicSection => s !== null),
  };
}
