/**
 * KAN-488 — what a public profile tells search engines and link previews
 * (spec v0.8 §1 "Never include hidden data in public HTML, metadata …", §3).
 *
 * Pure. Built only from fields the visible About section shows: display
 * name, the CheckLyra ID URL, headline and photo. Nothing from the intro,
 * no address and no assumed country — metadata is copied and cached by
 * third parties, so it carries the smallest public subset.
 */

import { parseMemberUrl } from '@/modules/profile/member-url';

export interface PublicProfileMetaInput {
  slug: string;
  display_name: string;
  headline: string | null;
  avatar_url: string | null;
}

export interface PublicProfileMeta {
  /** `<name> — Lyra` */
  title: string;
  name: string;
  /** The headline, or `<name>'s Lyra profile`. */
  description: string;
  /** The headline only (null when empty). */
  headline: string | null;
  /** `<siteUrl>/<slug>` */
  url: string;
  /** A validated http/https photo URL, or null. */
  image: string | null;
}

function textOrNull(v: string | null | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function buildPublicProfileMeta(row: PublicProfileMetaInput, siteUrl: string): PublicProfileMeta {
  const name = row.display_name;
  const headline = textOrNull(row.headline);
  const photo = textOrNull(row.avatar_url);
  const parsedPhoto = photo === null ? null : parseMemberUrl(photo);
  return {
    title: `${name} — Lyra`,
    name,
    description: headline ?? `${name}'s Lyra profile`,
    headline,
    url: `${siteUrl}/${row.slug}`,
    image: parsedPhoto && parsedPhoto.ok ? parsedPhoto.url : null,
  };
}
