/**
 * KAN-199 / KAN-200: V2 rationale composer.
 *
 * Every V2 recommendation carries a `rationale` string ≤ 280 characters
 * that the UI + MCP response payload + email templates can surface. It
 * tells the buyer *why* this specific product is being recommended for
 * this specific recipient.
 *
 * Composition:
 *   <V1 reason> + <product-specific rationale fragment>
 *
 * Example:
 *   "Anna mentioned books are a comfort." + "an Etsy gift card so they can
 *    pick something handmade or personalised that fits exactly"
 *
 * The output is shaped for natural English — we prepend a leading "Because"
 * if the V1 reason doesn't already start with one, then capitalise the
 * result and clip to 280 chars.
 */

import type { ProductCandidate, ConceptInput } from './types';

const MAX_LEN = 280;

export function composeRationale(c: ProductCandidate): string {
  const v1Reason = pickPrimaryReason(c.concept);
  const productFragment = (c.rationaleFragment ?? '').trim();

  // If we have neither, fall back to category-level boilerplate.
  if (!v1Reason && !productFragment) {
    return capitalise(
      `a ${c.concept.categoryKey.replace(/_/g, ' ')} gift that fits — ${c.title}`,
    ).slice(0, MAX_LEN);
  }

  // Compose the two halves.
  const parts: string[] = [];
  if (v1Reason) parts.push(prefixBecause(v1Reason));
  if (productFragment) parts.push(productFragment);

  const joined = parts.join(' Try ');
  return capitalise(joined).slice(0, MAX_LEN);
}

/** Choose the most concrete V1 reason — V1 emits short-to-medium strings,
 *  some more meaningful than others. Prefer the longest non-trivial one,
 *  capped at half the budget so the product fragment has room. */
function pickPrimaryReason(concept: ConceptInput): string | null {
  const reasons = concept.reasons.filter((r) => r && r.length > 5);
  if (reasons.length === 0) return null;
  const longest = reasons.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.slice(0, Math.floor(MAX_LEN / 2));
}

function prefixBecause(reason: string): string {
  // Avoid "Because You" — V1 often emits "You ..." style strings; we don't
  // know the buyer is the recipient. Keep the phrase as-is but lower-case
  // the leading letter so it joins cleanly.
  const trimmed = reason.trim();
  if (/^(because|since|given)\b/i.test(trimmed)) return trimmed;
  if (/^[A-Z]/.test(trimmed)) {
    return `because ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
  }
  return `because ${trimmed}`;
}

function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
