/**
 * KAN-488 — the public profile's data access (spec v0.8 §1, §2 01–10, §3).
 *
 * The route file `src/app/[slug]/page.tsx` makes no database call of its own
 * (CTL-056); everything it shows is read here. ADR-010: the stored rows ARE
 * the published snapshot, so this reads the live tables, filtered down to
 * what a visitor may see, and hands them to the profile module's pure
 * `initialEditorState` + `buildPublicProfileView` — the same path the
 * editor's Preview draws, so the two cannot disagree about what is public.
 *
 * What a visitor can never receive, and where that is enforced:
 *   - unapproved AI gift suggestions — filtered in the item query itself, so
 *     such a row is never fetched (spec §03, §3);
 *   - affiliations the owner has not opted in — filtered in the affiliation
 *     query itself (spec §02, §1);
 *   - pre-v0.8 item categories the editor cannot show (KAN-490 mapped the
 *     public ones it could and archived the rest) — the item query asks only
 *     for the v0.8 categories;
 *   - members-only / draft items under the legacy hybrid visibility model —
 *     filtered here in JS after the read, for anonymous viewers.
 *
 * Reads use the service-role client; the profile row comes from the
 * `public_profiles` VIEW (SEC-104), whose body carries published + not
 * suspended, so an unpublished or suspended slug finds nothing.
 */

import { cache } from 'react';
import * as Sentry from '@sentry/nextjs';
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import {
  coerceSectionVisibility,
  isItemVisibleUnderHybridModel,
} from '@/modules/profile/section-visibility';
import {
  PUBLIC_ITEM_CATEGORIES,
  type LoadedAnswer,
  type LoadedItem,
  type LoadedProfile,
  type LoadedPrompt,
} from '@/modules/profile/editor/editor-state';
import type { ManualOfMe } from '@/modules/profile/manual-of-me-fields';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

type ViewRow = Database['public']['Views']['public_profiles']['Row'];

/**
 * One row of the `public_profiles` view. `billboard` is optional: the row is
 * read with `*`, and an environment that has not yet run the KAN-488 view
 * migration simply returns no such key.
 */
export type PublicProfileRow = Omit<ViewRow, 'id' | 'slug' | 'display_name' | 'section_visibility'> & {
  id: string;
  slug: string;
  display_name: string;
  section_visibility: Record<string, string> | null;
  billboard?: string | null;
};

/**
 * The view row for a slug, or null. Wrapped in React `cache` so the page and
 * `generateMetadata` share one read per request.
 */
export const loadPublicProfileRow = cache(async (slug: string): Promise<PublicProfileRow | null> => {
  const { data } = await createServiceRoleClient()
    .from('public_profiles')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (!data || !data.id || !data.slug) return null;
  return data as PublicProfileRow;
});

/**
 * KAN-490 / ADR-011 — where an unknown public slug should permanently
 * redirect to, or null (404).
 *
 * Called only after `loadPublicProfileRow(slug)` found nothing. Two cases:
 *   1. Case: IDs are stored lower-case and unique without regard to case, so
 *      a mixed-case request whose lower-case form is a live profile redirects
 *      to that lower-case ID.
 *   2. History: the v0.8 conversion (migration
 *      20261123130000_kan490_v08_data_migration.sql) recorded every old slug
 *      in `profile_slug_history`, keyed by its lower-cased form
 *      (`old_slug_key`). The target is read back from the `public_profiles`
 *      VIEW, so only a published, not-suspended profile is ever a target
 *      (SEC-104); a draft or suspended owner yields null and the page 404s.
 *
 * No loops: a returned target is always a slug that `loadPublicProfileRow`
 * finds (it was just read from the same view), and a target equal to the
 * requested slug is refused. Service-role reads: the history table has RLS on
 * and no policies (members and visitors cannot read it).
 *
 * A failed read still ends in null (the page 404s rather than erroring for an
 * old link) but is reported to Sentry, never swallowed (KAN-351).
 */
export async function resolveLegacySlug(slug: string): Promise<string | null> {
  const key = slug.toLowerCase();
  const supabase = createServiceRoleClient();
  const report = (step: string, error: unknown) =>
    Sentry.captureException(error, {
      tags: { area: 'public-profile', step: `legacy-slug:${step}`, ticket: 'KAN-490' },
      extra: { slug },
    });

  if (key !== slug) {
    const { data: live, error: liveError } = await supabase
      .from('public_profiles')
      .select('slug')
      .eq('slug', key)
      .maybeSingle();
    if (liveError) {
      report('case', liveError);
    } else {
      const liveSlug = (live as { slug?: string | null } | null)?.slug;
      if (liveSlug && liveSlug !== slug) return liveSlug;
    }
  }

  // `profile_slug_history` is not in the generated types until the KAN-490
  // migration is applied to dev and `npm run gen:db-types` is re-run; until
  // then this one read goes through the untyped client. Remove the cast after
  // regeneration (same pattern as KAN-489).
  const untyped = supabase as unknown as SupabaseClient;
  const { data: history, error: historyError } = await untyped
    .from('profile_slug_history')
    .select('profile_id')
    .eq('old_slug_key', key)
    .maybeSingle();
  if (historyError) {
    report('history', historyError);
    return null;
  }
  const profileId = (history as { profile_id?: string | null } | null)?.profile_id;
  if (!profileId) return null;

  const { data: target, error: targetError } = await supabase
    .from('public_profiles')
    .select('slug')
    .eq('id', profileId)
    .maybeSingle();
  if (targetError) {
    report('target', targetError);
    return null;
  }
  const targetSlug = (target as { slug?: string | null } | null)?.slug;
  if (!targetSlug || targetSlug === slug) return null;
  return targetSlug;
}

export interface LoadPublicProfileOptions {
  /** Signed-in viewers also see members-only items (KAN-143). */
  isAuthenticated: boolean;
}

type ItemRow = LoadedItem & { visibility: string | null };

interface JoinedPreset {
  prompt?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
}

function joinedPreset(candidate: unknown): JoinedPreset | null {
  const row = Array.isArray(candidate) ? candidate[0] : candidate;
  return row && typeof row === 'object' ? (row as JoinedPreset) : null;
}

/**
 * Everything the public page renders for one profile row, shaped as the
 * editor's `LoadedProfile` so `initialEditorState` can build from it.
 * Throws (after reporting to Sentry) if any section read fails: a partial
 * outage must not render an incomplete profile as a clean 200 (KAN-351).
 */
export async function loadPublicProfile(
  row: PublicProfileRow,
  options: LoadPublicProfileOptions,
): Promise<LoadedProfile> {
  const supabase = createServiceRoleClient();
  const profileId = row.id;

  const [itemsRes, schoolsRes, manualOfMeRes, starterRowsRes] = await Promise.all([
    supabase
      .from('profile_items')
      .select('*')
      .eq('profile_id', profileId)
      .eq('approved', true)
      .in('origin', ['user', 'ai'])
      .in('category', [...PUBLIC_ITEM_CATEGORIES])
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('school_affiliations')
      .select('*')
      .eq('profile_id', profileId)
      .eq('show_on_profile', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('profile_manual_of_me')
      .select('communication_style, working_preferences, energises_me, drains_me, good_to_know, boundaries')
      .eq('profile_id', profileId)
      .maybeSingle(),
    supabase
      .from('profile_conversation_starters')
      // `*` so a database without `custom_prompt` / `sort_order` yet does not
      // fail the whole read (KAN-445).
      .select('*, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(prompt, sort_order, is_active)')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true }),
  ]);

  // Plain / maybeSingle reads: an error here is a real read failure, never a
  // legitimately absent row.
  const sectionReadErrors = (
    [
      ['profile_items', itemsRes.error],
      ['school_affiliations', schoolsRes.error],
      ['profile_manual_of_me', manualOfMeRes.error],
      ['profile_conversation_starters', starterRowsRes.error],
    ] as const
  ).filter((entry) => entry[1] != null);

  if (sectionReadErrors.length > 0) {
    for (const [table, error] of sectionReadErrors) {
      Sentry.captureException(error, {
        tags: { area: 'public-profile', table },
        extra: { slug: row.slug, profileId },
      });
    }
    throw new Error(
      `Public profile section reads failed for ${sectionReadErrors
        .map(([table]) => table)
        .join(', ')}`,
    );
  }

  const sectionVisibility = coerceSectionVisibility(row.section_visibility);
  const items = ((itemsRes.data ?? []) as ItemRow[]).filter((item) =>
    isItemVisibleUnderHybridModel(item, sectionVisibility, options.isAuthenticated),
  );

  const conversationAnswers: LoadedAnswer[] = [];
  const promptsById = new Map<string, LoadedPrompt>();
  for (const r of starterRowsRes.data ?? []) {
    const joined = joinedPreset((r as { prompt?: unknown }).prompt);
    const raw = r as Record<string, unknown>;
    const customPrompt = (raw.custom_prompt as string | null | undefined) ?? null;
    const promptId = (raw.prompt_id as string | null | undefined) ?? null;
    if (promptId !== null && customPrompt === null && joined) {
      promptsById.set(promptId, {
        id: promptId,
        prompt: joined.prompt ?? '',
        sort_order: joined.sort_order ?? 0,
        is_active: joined.is_active ?? true,
      });
    }
    conversationAnswers.push({
      id: raw.id as string,
      prompt_id: promptId,
      answer: (raw.answer as string | null) ?? '',
      prompt: customPrompt ?? joined?.prompt ?? '',
      custom_prompt: customPrompt,
      answer_max: null,
      sort_order: raw.sort_order as number | null | undefined,
      created_at: raw.created_at as string | null | undefined,
    });
  }

  return {
    profile: {
      id: profileId,
      display_name: row.display_name,
      slug: row.slug,
      // The page was reached by this slug and the view guarantees the
      // profile is published, so the ID is shown (spec §01).
      slug_confirmed: true,
      first_published_at: null,
      is_published: true,
      avatar_url: row.avatar_url,
      headline: row.headline,
      city: row.city,
      country: row.country,
      bio_short: row.bio_short,
      gift_voucher_hint: row.gift_voucher_hint,
      billboard: row.billboard ?? null,
      updated_at: row.updated_at ?? '',
    },
    items,
    schools: schoolsRes.data ?? [],
    manualOfMe: (manualOfMeRes.data as ManualOfMe | null) ?? null,
    conversationPrompts: [...promptsById.values()],
    conversationAnswers,
  };
}
