/**
 * KAN-487 — v0.8 profile editor: shared state TYPES and the initial-state
 * builder (spec v0.8 §01–§10; plan §A "Pure logic", §B "Payload").
 *
 * Every other editor module (reducer, diff, validator, preview view-model,
 * server actions) imports its shapes from here, so this file holds types and
 * one pure builder only: no Supabase calls, no `'use client'`, no server-only
 * imports. Safe from both client and server code.
 *
 * Rules applied by `initialEditorState` (plan §A):
 *   - AI gift rows (`origin = 'ai'`) go to `aiGifts`, never into `gift_ideas`.
 *     They are approved/deleted only through `ai_gifts` in the payload.
 *   - Legacy (pre-v0.8) item categories — likes, dislikes, helpful_to_know,
 *     boundaries, questions, billboard, dietary, mobility, transport,
 *     availability_pattern, allergies — are left out of every editable list
 *     and stay untouched in the database (KAN-490 owns them).
 *   - Gifts start with ONE empty row when there are none; "Things that aren't
 *     really for me" starts with THREE blank rows when there are none.
 *   - The CheckLyra ID field is empty while `slug_confirmed` is false: the
 *     signup placeholder `user_<hex>` passes the format check, so
 *     `slug_confirmed` is the only marker that an ID was chosen.
 *   - Answers to presets that have since been deactivated are kept.
 *   - Custom questions are ordered by `sort_order`, then `created_at`.
 */

import type { Database } from '@/types/database';
import {
  MANUAL_OF_ME_FIELDS,
  type ManualOfMe,
  type ManualOfMeField,
} from '@/modules/profile/manual-of-me-fields';

// ── DB row shapes (generated types) ─────────────────────────────────────

type Tables = Database['public']['Tables'];
export type ItemCategory = Database['public']['Enums']['item_category'];
type ProfileDbRow = Tables['profiles']['Row'];
type ItemDbRow = Tables['profile_items']['Row'];
type AffiliationDbRow = Tables['school_affiliations']['Row'];
type PromptDbRow = Tables['conversation_starter_prompts']['Row'];

// ── Loader input ────────────────────────────────────────────────────────

/** The `profiles` columns the editor reads (the loader selects `*`). */
export type LoadedProfileRow = Pick<
  ProfileDbRow,
  | 'id'
  | 'display_name'
  | 'slug'
  | 'slug_confirmed'
  | 'first_published_at'
  | 'is_published'
  | 'avatar_url'
  | 'headline'
  | 'city'
  | 'country'
  | 'bio_short'
  | 'gift_voucher_hint'
  | 'billboard'
  | 'updated_at'
>;

export type LoadedItem = Pick<
  ItemDbRow,
  'id' | 'category' | 'title' | 'description' | 'url' | 'group_label' | 'origin' | 'approved'
> &
  Partial<Pick<ItemDbRow, 'sort_order' | 'created_at'>>;

export type LoadedAffiliation = Pick<
  AffiliationDbRow,
  'id' | 'affiliation_type' | 'school_name' | 'school_location' | 'description' | 'show_on_profile'
> &
  Partial<Pick<AffiliationDbRow, 'created_at'>>;

/**
 * An active preset prompt. `answer_max` is optional because the loader reads
 * `*` so a database without the column yet does not 42703 the editor (KAN-484).
 */
export type LoadedPrompt = Pick<PromptDbRow, 'id' | 'prompt' | 'sort_order'> & {
  answer_max?: number | null;
  is_active?: boolean | null;
};

/**
 * One answer as `page.tsx` maps it today (`conversationAnswers`): the joined
 * preset wording or the custom question is already in `prompt`.
 * `sort_order` / `created_at` arrive once the PR2 loader passes them.
 */
export interface LoadedAnswer {
  id: string;
  prompt_id: string | null;
  answer: string;
  prompt: string;
  custom_prompt: string | null;
  answer_max: number | null;
  sort_order?: number | null;
  created_at?: string | null;
}

/** Everything `src/app/dashboard/profile/page.tsx` loads for the editor. */
export interface LoadedProfile {
  profile: LoadedProfileRow;
  items: ReadonlyArray<LoadedItem>;
  schools: ReadonlyArray<LoadedAffiliation>;
  manualOfMe: ManualOfMe | null;
  /** Active presets only (the loader filters `is_active = true`). */
  conversationPrompts: ReadonlyArray<LoadedPrompt>;
  conversationAnswers: ReadonlyArray<LoadedAnswer>;
}

// ── Lists ───────────────────────────────────────────────────────────────

export type ListKey =
  | 'causes'
  | 'proud_of'
  | 'gift_ideas'
  | 'gifts_to_avoid'
  | 'fav_quotes'
  | 'fav_screen'
  | 'fav_books'
  | 'fav_places'
  | 'fav_others'
  | 'life_hacks'
  | 'current_problems';

export interface ListCategoryDef {
  /** Every stored category shown in this list. */
  categories: readonly ItemCategory[];
  /** The category a NEW row in this list is written under. */
  newCategory: ItemCategory;
}

/**
 * ListKey → stored categories (spec v0.8 §01, §03, §04, §06, §07, §08).
 * Existing plays / favourite_tv rows show under Movies / Theatre / TV,
 * favourite_venues under Places, favourite_music under Others.
 */
export const LIST_CATEGORIES: Readonly<Record<ListKey, ListCategoryDef>> = {
  causes: { categories: ['causes'], newCategory: 'causes' },
  proud_of: { categories: ['proud_of'], newCategory: 'proud_of' },
  gift_ideas: { categories: ['gift_ideas'], newCategory: 'gift_ideas' },
  gifts_to_avoid: { categories: ['gifts_to_avoid'], newCategory: 'gifts_to_avoid' },
  fav_quotes: { categories: ['quotes'], newCategory: 'quotes' },
  fav_screen: { categories: ['favourite_media', 'plays', 'favourite_tv'], newCategory: 'favourite_media' },
  fav_books: { categories: ['favourite_books'], newCategory: 'favourite_books' },
  fav_places: { categories: ['favourite_places', 'favourite_venues'], newCategory: 'favourite_places' },
  fav_others: { categories: ['favourite_custom', 'favourite_music'], newCategory: 'favourite_custom' },
  life_hacks: { categories: ['life_hacks'], newCategory: 'life_hacks' },
  current_problems: { categories: ['current_problems'], newCategory: 'current_problems' },
};

/** List keys in spec order. */
export const LIST_KEYS: readonly ListKey[] = [
  'causes',
  'proud_of',
  'gift_ideas',
  'gifts_to_avoid',
  'fav_quotes',
  'fav_screen',
  'fav_books',
  'fav_places',
  'fav_others',
  'life_hacks',
  'current_problems',
];

/**
 * KAN-488 — every stored category a v0.8 list shows, flattened from
 * `LIST_CATEGORIES` in spec order. The public page reads only these, so a
 * legacy row the editor cannot show (KAN-490 owns them) is never fetched.
 */
export const PUBLIC_ITEM_CATEGORIES: readonly ItemCategory[] = LIST_KEYS.flatMap(
  (key) => LIST_CATEGORIES[key].categories,
);

/** The list a stored category belongs to, or null for a legacy category. */
export function listKeyForCategory(category: string): ListKey | null {
  for (const key of LIST_KEYS) {
    if ((LIST_CATEGORIES[key].categories as readonly string[]).includes(category)) return key;
  }
  return null;
}

/** One editable list entry. `key` is the DB id, or `new:<uuid>` for new rows. */
export interface EditorRow {
  key: string;
  id: string | null;
  category: ItemCategory;
  title: string;
  description: string;
  url: string;
  /** Legacy favourite_custom group name: shown as a muted tag, never edited. */
  groupLabel?: string | null;
}

/** An AI gift suggestion (`origin = 'ai'`), kept apart from member gifts. */
export interface AiGiftRow {
  id: string;
  title: string;
  description: string;
  url: string;
  approved: boolean;
}

// ── Affiliations ────────────────────────────────────────────────────────

export type AffiliationType = 'school' | 'organisation' | 'community';

export interface AffRow {
  key: string;
  id: string | null;
  affiliationType: AffiliationType;
  /** `school_name` column (used for all three types). */
  name: string;
  /** `school_location`: postcode for schools, free location otherwise. */
  location: string;
  description: string;
  showOnProfile: boolean;
}

// ── Questions ───────────────────────────────────────────────────────────

/** An answer to a preset prompt. Presets are never reordered. */
export interface PresetQuestionRow {
  kind: 'preset';
  key: string;
  id: string | null;
  promptId: string;
  prompt: string;
  answerMax: number | null;
  answer: string;
  /** False when the preset was deactivated after the member answered it. */
  isActive: boolean;
}

/** A member-written question. Ordered by `sortOrder`, then `createdAt`. */
export interface CustomQuestionRow {
  kind: 'custom';
  key: string;
  id: string | null;
  customPrompt: string;
  answer: string;
  sortOrder: number | null;
  createdAt: string | null;
}

export type QuestionRow = PresetQuestionRow | CustomQuestionRow;

/** An active preset (for the "Unanswered" list), in `sort_order`. */
export interface PresetPrompt {
  id: string;
  prompt: string;
  answerMax: number | null;
  sortOrder: number | null;
}

// ── Photo ───────────────────────────────────────────────────────────────

export type PhotoState =
  | { kind: 'stored'; url: string }
  | { kind: 'staged'; path: string; previewUrl: string }
  | { kind: 'removed' }
  | { kind: 'none' };

// ── Profile fields / Manual of Me ───────────────────────────────────────

/** Plain profile text fields; null in the DB becomes '' here. */
export interface ProfileFields {
  display_name: string;
  headline: string;
  city: string;
  /** ISO 3166-1 alpha-2 code, '' for not set, or a legacy free-text value. */
  country: string;
  bio_short: string;
  gift_voucher_hint: string;
  billboard: string;
}

export type ProfileFieldKey = keyof ProfileFields;

export type ManualOfMeState = Record<ManualOfMeField, string>;

// ── Undo ────────────────────────────────────────────────────────────────

export type UndoListKey = ListKey | 'affiliations' | 'questions';

/** The last removed row of a list, restorable at `index` (max 1 per list). */
export type UndoEntry =
  | { listKey: ListKey; row: EditorRow; index: number; at: number }
  | { listKey: 'affiliations'; row: AffRow; index: number; at: number }
  | { listKey: 'questions'; row: QuestionRow; index: number; at: number };

// ── Editor state ────────────────────────────────────────────────────────

export interface EditorState {
  profileId: string;
  /** `profiles.updated_at` at load / last save; sent as `base_updated_at`. */
  baseUpdatedAt: string | null;
  isPublished: boolean;
  firstPublishedAt: string | null;
  /** True once first published: the CheckLyra ID can no longer change. */
  lyraIdLocked: boolean;
  /** '' while `slug_confirmed` is false. */
  lyraId: string;
  fields: ProfileFields;
  photo: PhotoState;
  lists: Record<ListKey, EditorRow[]>;
  aiGifts: AiGiftRow[];
  affiliations: AffRow[];
  manualOfMe: ManualOfMeState;
  /** Answered presets (incl. deactivated) and custom questions. */
  questions: QuestionRow[];
  /** Active presets, in `sort_order`. */
  presets: PresetPrompt[];
  undo: Partial<Record<UndoListKey, UndoEntry>>;
}

// ── Save payload (plan §B) ──────────────────────────────────────────────

export type SaveMode = 'draft' | 'publish' | 'published';

export interface SaveProfilePatch {
  display_name?: string;
  headline?: string | null;
  city?: string | null;
  country?: string | null;
  bio_short?: string | null;
  gift_voucher_hint?: string | null;
  billboard?: string | null;
  /** Only while the ID is unlocked (`first_published_at is null`). */
  slug?: string;
}

/**
 * `avatar_url` is set by the server action only, never by the client. The
 * client names its staged upload with `staged_path`; the server action checks
 * it (`resolveStagedPhoto`), replaces it with `avatar_url`, and strips it.
 */
export type SavePhotoPayload =
  | { action: 'keep' }
  | { action: 'remove' }
  | { action: 'set'; staged_path?: string; avatar_url?: string };

export interface SaveItemUpsert {
  id?: string;
  client_key: string;
  category: ItemCategory;
  title: string;
  description: string | null;
  url: string | null;
  group_label: string | null;
}

export interface SaveAffiliationUpsert {
  id?: string;
  client_key: string;
  affiliation_type: AffiliationType;
  school_name: string;
  school_location: string | null;
  description: string | null;
  show_on_profile: boolean;
}

export interface SaveQuestionUpsert {
  id?: string;
  client_key: string;
  prompt_id?: string;
  custom_prompt?: string;
  answer: string;
  /** Custom questions only. */
  sort_order?: number;
}

/**
 * The save DIFF. An absent section is left untouched; deletes are explicit
 * id lists — never "absent means delete" (BUGS-74).
 */
export interface SavePayload {
  base_updated_at: string | null;
  profile?: SaveProfilePatch;
  photo?: SavePhotoPayload;
  items?: { upsert: SaveItemUpsert[]; delete: string[] };
  /** Approve/delete only; AI rows are never inserted through this payload. */
  ai_gifts?: { approve: string[]; delete: string[] };
  affiliations?: { upsert: SaveAffiliationUpsert[]; delete: string[] };
  /** The full object when present; null clears it. */
  manual_of_me?: ManualOfMe | null;
  questions?: { upsert: SaveQuestionUpsert[]; delete: string[] };
}

/** What `public.save_profile` returns. */
export interface SaveProfileRpcResult {
  updated_at: string;
  /** client_key → new row id, for inserted rows. */
  ids: Record<string, string>;
  /** e.g. `{ lyra_id: 'taken' }` in draft mode. */
  warnings: Record<string, string>;
  /** The STORED identity after the save (a refused ID is not written). */
  slug: string | null;
  slug_confirmed: boolean;
  avatar_url: string | null;
  is_published: boolean;
  first_published_at: string | null;
}

/** What the editor server actions return to the client. */
export type SaveResult =
  | {
      ok: true;
      idMap: Record<string, string>;
      updatedAt: string;
      warnings: Record<string, string>;
      /**
       * The STORED CheckLyra ID after the save. When `warnings.lyra_id` is
       * set the requested ID was refused, so this is the previous one.
       */
      slug: string | null;
      slugConfirmed: boolean;
      /** The stored `avatar_url` (a staged photo is now this URL). */
      avatarUrl: string | null;
      isPublished: boolean;
      firstPublishedAt: string | null;
    }
  | {
      ok: false;
      /** Member-facing message for the error callout. */
      error: string;
      /** Keyed `${clientKey}.${field}` or `profile.${field}`. */
      fieldErrors?: Record<string, string>;
    };

// ── Builders ────────────────────────────────────────────────────────────

const NEW_KEY_PREFIX = 'new:';

/** A fresh client key for a row that is not stored yet. */
export function newRowKey(): string {
  return NEW_KEY_PREFIX + crypto.randomUUID();
}

/** True for a key made by `newRowKey` (the row has no DB id yet). */
export function isNewRowKey(key: string): boolean {
  return key.startsWith(NEW_KEY_PREFIX);
}

/** A blank, unsaved row for a list. */
export function blankRow(listKey: ListKey): EditorRow {
  return {
    key: newRowKey(),
    id: null,
    category: LIST_CATEGORIES[listKey].newCategory,
    title: '',
    description: '',
    url: '',
  };
}

const INITIAL_BLANK_ROWS: Partial<Record<ListKey, number>> = {
  gift_ideas: 1, // §03: one empty input initially
  gifts_to_avoid: 3, // §04: three blank rows initially
};

function emptyLists(): Record<ListKey, EditorRow[]> {
  const lists = {} as Record<ListKey, EditorRow[]>;
  for (const key of LIST_KEYS) lists[key] = [];
  return lists;
}

function text(v: string | null | undefined): string {
  return v ?? '';
}

function isAffiliationType(v: string): v is AffiliationType {
  return v === 'school' || v === 'organisation' || v === 'community';
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareNullableText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareCustom(a: CustomQuestionRow, b: CustomQuestionRow): number {
  return compareNullableNumber(a.sortOrder, b.sortOrder) || compareNullableText(a.createdAt, b.createdAt);
}

function buildItems(items: ReadonlyArray<LoadedItem>): {
  lists: Record<ListKey, EditorRow[]>;
  aiGifts: AiGiftRow[];
} {
  const lists = emptyLists();
  const aiGifts: AiGiftRow[] = [];
  for (const item of items) {
    if (item.origin === 'ai') {
      aiGifts.push({
        id: item.id,
        title: item.title,
        description: text(item.description),
        url: text(item.url),
        approved: item.approved,
      });
      continue;
    }
    const listKey = listKeyForCategory(item.category);
    if (listKey === null) continue; // legacy category: untouched, not editable
    lists[listKey].push({
      key: item.id,
      id: item.id,
      category: item.category,
      title: item.title,
      description: text(item.description),
      url: text(item.url),
      groupLabel: item.group_label,
    });
  }
  for (const key of LIST_KEYS) {
    const blanks = INITIAL_BLANK_ROWS[key] ?? 0;
    if (lists[key].length === 0) {
      for (let i = 0; i < blanks; i++) lists[key].push(blankRow(key));
    }
  }
  return { lists, aiGifts };
}

function buildAffiliations(schools: ReadonlyArray<LoadedAffiliation>): AffRow[] {
  const rows: AffRow[] = [];
  for (const s of schools) {
    if (!isAffiliationType(s.affiliation_type)) continue;
    rows.push({
      key: s.id,
      id: s.id,
      affiliationType: s.affiliation_type,
      name: s.school_name,
      location: text(s.school_location),
      description: text(s.description),
      showOnProfile: s.show_on_profile,
    });
  }
  return rows;
}

function buildQuestions(loaded: LoadedProfile): { questions: QuestionRow[]; presets: PresetPrompt[] } {
  const presets: PresetPrompt[] = loaded.conversationPrompts
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      id: p.id,
      prompt: p.prompt,
      answerMax: p.answer_max ?? null,
      sortOrder: p.sort_order,
    }))
    .sort((a, b) => compareNullableNumber(a.sortOrder, b.sortOrder));
  const activeById = new Map(presets.map((p) => [p.id, p]));

  const presetRows: PresetQuestionRow[] = [];
  const customRows: CustomQuestionRow[] = [];
  for (const a of loaded.conversationAnswers) {
    if (a.custom_prompt !== null && a.custom_prompt !== undefined) {
      customRows.push({
        kind: 'custom',
        key: a.id,
        id: a.id,
        customPrompt: a.custom_prompt,
        answer: a.answer,
        sortOrder: a.sort_order ?? null,
        createdAt: a.created_at ?? null,
      });
    } else if (a.prompt_id !== null) {
      const active = activeById.get(a.prompt_id);
      presetRows.push({
        kind: 'preset',
        key: a.id,
        id: a.id,
        promptId: a.prompt_id,
        prompt: a.prompt || active?.prompt || '',
        answerMax: a.answer_max ?? active?.answerMax ?? null,
        answer: a.answer,
        isActive: active !== undefined,
      });
    }
  }
  customRows.sort(compareCustom);
  return { questions: [...presetRows, ...customRows], presets };
}

function buildManualOfMe(m: ManualOfMe | null): ManualOfMeState {
  const out = {} as ManualOfMeState;
  for (const f of MANUAL_OF_ME_FIELDS) out[f] = text(m?.[f]);
  return out;
}

/** Turn the loader's rows into the editor's starting state (plan §A). */
export function initialEditorState(loaded: LoadedProfile): EditorState {
  const p = loaded.profile;
  const { lists, aiGifts } = buildItems(loaded.items);
  const { questions, presets } = buildQuestions(loaded);
  return {
    profileId: p.id,
    baseUpdatedAt: p.updated_at,
    isPublished: p.is_published === true,
    firstPublishedAt: p.first_published_at,
    lyraIdLocked: p.first_published_at !== null,
    lyraId: p.slug_confirmed ? p.slug : '',
    fields: {
      display_name: text(p.display_name),
      headline: text(p.headline),
      city: text(p.city),
      country: text(p.country),
      bio_short: text(p.bio_short),
      gift_voucher_hint: text(p.gift_voucher_hint),
      billboard: text(p.billboard),
    },
    photo: p.avatar_url ? { kind: 'stored', url: p.avatar_url } : { kind: 'none' },
    lists,
    aiGifts,
    affiliations: buildAffiliations(loaded.schools),
    manualOfMe: buildManualOfMe(loaded.manualOfMe),
    questions,
    presets,
    undo: {},
  };
}
