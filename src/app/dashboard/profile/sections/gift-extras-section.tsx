'use client';

/**
 * KAN-443 — the two parts of the gifts redesign that are not the list itself:
 *
 *   1. An optional "I'd rather choose my own" line. Teachers in particular told
 *      us a wish-list can feel presumptuous; one sentence saying "a book token
 *      is always welcome" is a kinder answer than an empty section.
 *
 *   2. Saying "not for me" to a single auto-generated suggestion. Until now a
 *      member could curate their own gift list but not the suggestions Lyra
 *      generated alongside it, so one that misread them sat on their public
 *      profile permanently.
 *
 * The suggestions are passed in already computed — `getRecommendations` is a
 * pure function over the profile and items the editor page has already loaded,
 * so surfacing them here costs no extra query.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { WizardProfile } from '../steps/types';
import { updateProfileFields, dismissGiftSuggestion, restoreGiftSuggestion } from '../actions';
import { giftVoucherHintPayload, GIFT_VOUCHER_HINT_MAX_LENGTH } from '@/modules/profile/profile-fields';
import { useAutoSave } from './use-auto-save';
import { SectionSaveBar } from './section-save-bar';

/** One auto-generated suggestion, as the editor needs it. */
export interface GiftSuggestionView {
  /** Stable concept identity — see src/lib/recommend/dismissals.ts. */
  key: string;
  title: string;
  description: string;
  /** Whether the member has already said "not for me" to this one. */
  dismissed: boolean;
}

export function GiftExtrasSection({
  profile,
  suggestions,
}: {
  profile: WizardProfile;
  suggestions: GiftSuggestionView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hint, setHint] = useState(profile.gift_voucher_hint ?? '');
  const [error, setError] = useState<string | null>(null);

  // The value we last know to be IN the database. Seeded from the loaded row
  // and advanced on every successful save.
  //
  // It cannot be read from `profile` alone: a member who types a hint and then
  // clears it in the same sitting would still see the loaded value (null) as
  // "stored", so `giftVoucherHintPayload` would omit the key and the text they
  // just deleted would survive. Tracking what we actually wrote keeps the
  // omit-vs-clear decision truthful without a re-fetch.
  const lastWrittenRef = useRef<string | null>(profile.gift_voucher_hint ?? null);

  const { status, flush } = useAutoSave(hint, async (value: string) => {
    const payload = giftVoucherHintPayload(value, lastWrittenRef.current);
    // Nothing to say about the column — see giftVoucherHintPayload. Reporting
    // success here is honest: there is no pending change to persist.
    if (!('gift_voucher_hint' in payload)) return { success: true };
    const res = await updateProfileFields(payload);
    if (res.success) lastWrittenRef.current = payload.gift_voucher_hint ?? null;
    return res;
  });

  const runSuggestionChange = (action: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.success) router.refresh();
      else setError(res.error ?? 'Could not save that. Please try again.');
    });
  };

  const shown = suggestions.filter((s) => !s.dismissed);
  const hidden = suggestions.filter((s) => s.dismissed);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SectionSaveBar status={status} onSave={flush} />
        <div>
          <label
            htmlFor="gift_voucher_hint"
            className="block text-sm font-medium text-[var(--color-ink)] mb-1"
          >
            If you&apos;d rather choose (optional)
          </label>
          <input
            id="gift_voucher_hint"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={GIFT_VOUCHER_HINT_MAX_LENGTH}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
            placeholder="Example: a book token is always welcome"
          />
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Some people would sooner pick their own thing. Say so here and it shows on your profile.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-[var(--color-ink)]">Ideas Lyra suggests</h3>
        <p className="text-xs text-[var(--color-muted)]">
          Put together from what you&apos;ve shared, and shown on your profile. If one isn&apos;t you,
          say so and it goes.
        </p>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        {suggestions.length === 0 && (
          <p className="text-xs text-[var(--color-muted)]">
            Nothing yet — add a few things you love above and ideas will start to appear.
          </p>
        )}

        {shown.length > 0 && (
          <ul className="space-y-1">
            {shown.map((s) => (
              <li
                key={s.key}
                className="flex items-start justify-between gap-3 py-2 border-b border-dashed border-[#ece7df] last:border-0"
              >
                <span className="text-[14.5px] leading-snug min-w-0">
                  <b className="font-semibold text-[var(--color-ink)]">{s.title}</b>
                  {s.description && <span className="text-[var(--color-muted)]"> — {s.description}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => runSuggestionChange(() => dismissGiftSuggestion(s.key))}
                  disabled={isPending}
                  className="shrink-0 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  Not for me
                </button>
              </li>
            ))}
          </ul>
        )}

        {hidden.length > 0 && (
          <div className="pt-2">
            <p className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-1">
              Hidden
            </p>
            <ul className="space-y-1">
              {hidden.map((s) => (
                <li key={s.key} className="flex items-start justify-between gap-3 py-1">
                  <span className="text-[14.5px] text-[var(--color-muted)] leading-snug min-w-0">
                    {s.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => runSuggestionChange(() => restoreGiftSuggestion(s.key))}
                    disabled={isPending}
                    className="shrink-0 text-xs text-[var(--color-sage)] hover:underline disabled:opacity-40"
                  >
                    Show again
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
