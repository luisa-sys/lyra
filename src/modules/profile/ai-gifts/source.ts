/**
 * KAN-489 — AI gift suggestions (spec v0.8 §03 "based on user-authored
 * profile content"): load the MEMBER-AUTHORED text the model may see.
 *
 * Reads the SAVED rows with the member's own (RLS) client — never state sent
 * by the browser, so a member cannot smuggle text into the prompt that is not
 * on their profile, and unsaved edits are not shared.
 *
 * Included (all written by the member):
 *   - profiles: headline, bio_short, gift_voucher_hint (gift preferences),
 *     billboard;
 *   - profile_items with origin = 'user' in a v0.8 category
 *     (PUBLIC_ITEM_CATEGORIES) whose visibility is public or members-only.
 *     "Things that aren't really for me" (gifts_to_avoid) becomes the avoid
 *     list; the member's own gift titles become the no-duplicates list;
 *   - "To understand me a little better" (profile_manual_of_me);
 *   - Random Questions & Answers (question + answer).
 *
 * Never included: any AI row (approved or not), affiliations (schools,
 * organisations, communities — hidden ones above all), display name, CheckLyra
 * ID, city / country / postcode / delivery fields, the photo, and legacy
 * categories the v0.8 editor cannot show.
 *
 * Also returns `existingTitles` (member gifts + existing AI titles, for the
 * duplicate filter) and `aiCount` (AI rows held, pending or approved, for the
 * cap check before a claim is spent).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { MANUAL_OF_ME_FIELDS } from '@/modules/profile/manual-of-me-fields';
import { PUBLIC_ITEM_CATEGORIES } from '@/modules/profile/editor/editor-state';
import type { AiGiftSource, AiGiftSourceField } from './types';

/** Prompt tag per v0.8 item category (member-authored lists). */
const CATEGORY_TAG: Readonly<Record<string, string>> = {
  causes: 'cause_i_care_about',
  proud_of: 'something_i_am_proud_of',
  gift_ideas: 'gift_i_would_love',
  quotes: 'favourite_quote',
  favourite_media: 'favourite_film_or_show',
  plays: 'favourite_film_or_show',
  favourite_tv: 'favourite_film_or_show',
  favourite_books: 'favourite_book',
  favourite_places: 'favourite_place',
  favourite_venues: 'favourite_place',
  favourite_music: 'favourite_other',
  favourite_custom: 'favourite_other',
  life_hacks: 'tip_i_can_share',
  current_problems: 'problem_i_am_solving',
};

/** Prompt tag per Manual of Me column (§05 prompts). */
const MANUAL_TAG: Readonly<Record<string, string>> = {
  good_to_know: 'things_i_am_into',
  boundaries: 'my_boundaries',
  communication_style: 'how_i_communicate',
  working_preferences: 'if_you_come_to_my_house',
  energises_me: 'what_gives_me_energy',
  drains_me: 'what_drains_me',
};

const PROFILE_TAG: ReadonlyArray<readonly [string, string]> = [
  ['headline', 'headline'],
  ['bio_short', 'about_me'],
  ['gift_voucher_hint', 'gift_preferences'],
  ['billboard', 'billboard'],
];

const SHARED_VISIBILITY: ReadonlySet<string> = new Set(['public', 'members_only']);

export interface LoadedAiGiftSource {
  source: AiGiftSource;
  /** Member gift titles and every existing AI title (duplicate filter). */
  existingTitles: string[];
  /** AI rows held (pending + approved), for the cap of 10. */
  aiCount: number;
  profileId: string;
}

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Null when the member has no profile row (or the read failed). */
export async function loadMemberAuthoredSource(
  supabase: SupabaseClient,
  userId: string,
): Promise<LoadedAiGiftSource | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, headline, bio_short, gift_voucher_hint, billboard')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError || !profile) return null;
  const p = profile as Record<string, unknown>;
  const profileId = p.id as string;

  const [itemsRes, manualRes, answersRes] = await Promise.all([
    supabase
      .from('profile_items')
      .select('category, title, description, origin, visibility')
      .eq('profile_id', profileId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('profile_manual_of_me').select(MANUAL_OF_ME_FIELDS.join(', ')).eq('profile_id', profileId).maybeSingle(),
    supabase
      .from('profile_conversation_starters')
      .select('answer, custom_prompt, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(prompt)')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true }),
  ]);
  if (itemsRes.error) return null;

  const fields: AiGiftSourceField[] = [];
  for (const [column, tag] of PROFILE_TAG) {
    const text = clean(p[column]);
    if (text) fields.push({ tag, text });
  }

  const avoid: string[] = [];
  const existingGifts: string[] = [];
  const existingTitles: string[] = [];
  let aiCount = 0;
  const categories = new Set<string>(PUBLIC_ITEM_CATEGORIES);
  for (const raw of (itemsRes.data ?? []) as Array<Record<string, unknown>>) {
    const category = String(raw.category ?? '');
    const title = clean(raw.title);
    if (raw.origin === 'ai') {
      // AI rows are NEVER prompt input; they only count toward the cap and dedupe.
      if (category === 'gift_ideas') aiCount += 1;
      if (title) existingTitles.push(title);
      continue;
    }
    if (raw.origin !== 'user' || !categories.has(category) || !title) continue;
    const visibility = typeof raw.visibility === 'string' ? raw.visibility : 'public';
    if (!SHARED_VISIBILITY.has(visibility)) continue;
    if (category === 'gifts_to_avoid') {
      avoid.push(title);
      continue;
    }
    if (category === 'gift_ideas') {
      existingGifts.push(title);
      existingTitles.push(title);
    }
    const description = clean(raw.description);
    const tag = CATEGORY_TAG[category];
    if (tag) fields.push({ tag, text: description ? `${title} — ${description}` : title });
  }

  const manual = (manualRes.data ?? null) as Record<string, unknown> | null;
  if (manual) {
    for (const f of MANUAL_OF_ME_FIELDS) {
      const text = clean(manual[f]);
      if (text) fields.push({ tag: MANUAL_TAG[f] ?? f, text });
    }
  }

  for (const raw of (answersRes.data ?? []) as Array<Record<string, unknown>>) {
    const answer = clean(raw.answer);
    if (!answer) continue;
    const joined = raw.prompt as unknown;
    const joinedRow = (Array.isArray(joined) ? joined[0] : joined) as { prompt?: unknown } | null | undefined;
    const question = clean(raw.custom_prompt) || clean(joinedRow?.prompt);
    fields.push({ tag: 'question_and_answer', text: question ? `${question} — ${answer}` : answer });
  }

  return { source: { fields, avoid, existingGifts }, existingTitles, aiCount, profileId };
}
