/**
 * KAN-489 — AI gift suggestions: check every suggestion BEFORE it is stored
 * (spec v0.8 §03 limits title 100 / description 250, §05 no contact details,
 * founder decision "no affiliate links / no URLs in V1", §3 moderation).
 *
 * Per item, in order — a failing item is dropped on its own, the rest carry on:
 *   1. the member-item validators for `gift_ideas`: limits 100 / 250, HTML
 *      stripped, whitespace normalised, and the KAN-486 contact-detail filter
 *      (email, phone, postcode, street address);
 *   2. AI-only checks the member path does not need: no URL of any form
 *      (`http(s)://`, `www.`, any `name.tld` with a 2–24 letter TLD, a
 *      spelled-out "example dot com") and no `@handle`;
 *   3. nothing on the member's avoid list ("Things that aren't really for
 *      me"): a suggestion whose title or description contains an avoided
 *      title as whole words is dropped — the prompt asks for this too, but
 *      the prompt is not trusted to enforce it;
 *   4. no duplicates — case-insensitive against the member's gifts, the AI
 *      suggestions already held, and earlier items in the same batch;
 *   5. content moderation with an audit row (`moderateAndAudit`, fields
 *      `profile_items.ai_title` / `profile_items.ai_description`).
 *
 * Moderation runs HERE, at generation, because approving later carries only
 * the row id: the text that is approved is exactly the text checked now.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateItemDescription, validateItemTitle } from '@/modules/profile/field-validation';
import { moderateAndAudit } from '@/modules/audit/moderation-audit';
import type { AiSuggestion } from './types';

export type Moderate = typeof moderateAndAudit;

const URL_SCHEME_RE = /\b[a-z][a-z0-9+.-]*:\/\//i;
const WWW_RE = /\bwww\./i;
// A bare domain such as example.com, shop.co.uk, kites.club or gifts.store/item.
// Any TLD of 2–24 letters, not an allowlist: new TLDs (.club, .art, .fun …)
// appear constantly. Prose like "e.g.", "p.m." or "3.5" has no 2-letter
// label after a dot, so it passes; "word.Word" with no space is dropped, which
// costs one suggestion at worst.
const BARE_DOMAIN_RE = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b/i;
// "example dot com", "example [dot] com", "example (dot) co uk", "example[.]com".
const SPELLED_DOMAIN_RE = /(?:\bdot\b|\[dot\]|\(dot\)|\[\.\])\s*(?:com|net|org|io|uk|shop|store)\b/i;
const HANDLE_RE = /(?:^|[\s(])@[a-z0-9_.]{2,}/i;

/** True when the text carries a link, a domain or a social handle. */
export function containsLinkOrHandle(text: string): boolean {
  return (
    URL_SCHEME_RE.test(text) ||
    WWW_RE.test(text) ||
    BARE_DOMAIN_RE.test(text) ||
    SPELLED_DOMAIN_RE.test(text) ||
    HANDLE_RE.test(text)
  );
}

/** Lower-case words (Latin letters incl. accents, digits) joined by single spaces. */
function words(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();
}

/** Avoid-list entries shorter than this are ignored (too likely to match by accident). */
export const AVOID_MIN_LENGTH = 3;

/** True when `text` contains one of the avoided titles as whole words. */
export function mentionsAvoided(text: string, avoid: readonly string[]): boolean {
  const hay = ` ${words(text)} `;
  return avoid.some((a) => {
    const needle = words(a);
    return needle.length >= AVOID_MIN_LENGTH && hay.includes(` ${needle} `);
  });
}

/** Case- and whitespace-insensitive key for duplicate checks. */
export function dedupeKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface FilterContext {
  existingTitles: readonly string[];
  /** The member's "Things that aren't really for me" titles. */
  avoid: readonly string[];
  profileId: string | null;
}

export interface FilterResult {
  kept: AiSuggestion[];
  droppedByFilter: number;
}

export async function filterSuggestions(
  supabase: SupabaseClient,
  items: readonly AiSuggestion[],
  ctx: FilterContext,
  moderate: Moderate = moderateAndAudit,
): Promise<FilterResult> {
  const seen = new Set(ctx.existingTitles.map(dedupeKey));
  const kept: AiSuggestion[] = [];
  let dropped = 0;

  for (const item of items) {
    const title = validateItemTitle('gift_ideas', item.title);
    const description = validateItemDescription('gift_ideas', item.description);
    if (!title.ok || title.value === null || !description.ok) {
      dropped += 1;
      continue;
    }
    const t = title.value;
    const d = description.value;
    if (containsLinkOrHandle(t) || (d !== null && containsLinkOrHandle(d))) {
      dropped += 1;
      continue;
    }
    if (mentionsAvoided(t, ctx.avoid) || (d !== null && mentionsAvoided(d, ctx.avoid))) {
      dropped += 1;
      continue;
    }
    const key = dedupeKey(t);
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }

    const titleMod = await moderate(supabase, {
      text: t,
      fieldType: 'public',
      field: 'profile_items.ai_title',
      profileId: ctx.profileId,
      source: 'web_app',
    });
    if (!titleMod.ok) {
      dropped += 1;
      continue;
    }
    if (d !== null) {
      const descMod = await moderate(supabase, {
        text: d,
        fieldType: 'public',
        field: 'profile_items.ai_description',
        profileId: ctx.profileId,
        source: 'web_app',
      });
      if (!descMod.ok) {
        dropped += 1;
        continue;
      }
    }

    seen.add(key);
    kept.push({ title: t, description: d });
  }

  return { kept, droppedByFilter: dropped };
}
