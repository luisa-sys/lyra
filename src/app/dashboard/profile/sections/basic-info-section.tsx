'use client';

/**
 * KAN-220 — Basic Info section for the single-page profile editor.
 *
 * Autosave version of `IdentityStep`. The legacy IdentityStep stays in
 * `steps/` for the legacy wizard at `/dashboard/profile/legacy` and the
 * existing tests; this new component is what the single-page form uses.
 *
 * Differences from IdentityStep:
 *   - Field changes auto-save after a debounce (800ms). No Save button.
 *   - Status indicator in the section header shows Saving… / Saved /
 *     Save failed.
 *   - Avatar upload still fires on file pick (no autosave needed —
 *     uploads are immediate).
 *   - Delivery country still autosaves on change (already independent
 *     server action; see KAN-186).
 *
 * State shape: a single `draft` object so the autosave hook debounces
 * across ALL fields together — if the user types in display_name then
 * immediately switches to headline, ONE save fires 800ms after the
 * last keystroke (not two).
 */

import { useRef, useState, useTransition } from 'react';
import { Field, type WizardProfile } from '../steps/types';
import { updateProfileFields, uploadAvatar } from '../actions';
import { resolveCityFromPostcode } from '../city-actions';
import { AutoSaveStatusLabel, useAutoSave } from './use-auto-save';

interface BasicInfoDraft {
  display_name: string;
  headline: string;
  city: string;
  country: string;
}

export function BasicInfoSection({ profile }: { profile: WizardProfile }) {
  const [draft, setDraft] = useState<BasicInfoDraft>({
    display_name: profile.display_name || '',
    headline: profile.headline || '',
    city: profile.city || '',
    country: profile.country || 'GB',
  });

  const [preview, setPreview] = useState<string | null>(profile.avatar_url || null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingAvatar, startUploadAvatar] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const status = useAutoSave(draft, async (v) => {
    return updateProfileFields({
      display_name: v.display_name,
      headline: v.headline,
      city: v.city,
      country: v.country,
    });
  });

  const set = <K extends keyof BasicInfoDraft>(key: K, value: BasicInfoDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // KAN-341 — postcode→town lookup. The postcode lives in local state only and is
  // discarded immediately after the lookup; we store just the resolved city.
  const [postcodeInput, setPostcodeInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, startLookup] = useTransition();

  const handlePostcodeLookup = () => {
    const pc = postcodeInput.trim();
    if (!pc) return;
    setLookupError(null);
    startLookup(async () => {
      const result = await resolveCityFromPostcode(pc);
      if (result.success) {
        set('city', result.city);
        setPostcodeInput('');
      } else {
        setLookupError(result.error);
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setUploadError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    const fd = new FormData();
    fd.append('avatar', file);
    startUploadAvatar(async () => {
      await uploadAvatar(fd);
    });
  };

  return (
    <div className="space-y-6">
      {/* Status indicator — rendered inline so the user can see autosave fire */}
      <div className="flex justify-end">
        <AutoSaveStatusLabel status={status} />
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative w-20 h-20 rounded-full overflow-hidden bg-[var(--color-sage)] flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- KAN-220: preview is a FileReader data: URL or Supabase Storage public URL; not an asset that benefits from the Next/Image optimizer.
            <img src={preview} alt="Profile photo" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl text-white font-[family-name:var(--font-serif)]">
              {draft.display_name ? draft.display_name.charAt(0).toUpperCase() : '?'}
            </span>
          )}
        </button>
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingAvatar}
            className="text-sm text-[var(--color-sage)] hover:underline cursor-pointer disabled:opacity-50"
          >
            {preview ? 'Change photo' : 'Add a photo'}
          </button>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">JPEG, PNG, WebP or GIF. Max 5MB.</p>
          {uploadError && <p className="text-xs text-red-500 mt-0.5">{uploadError}</p>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <div className="space-y-4">
        <Field
          label="Display name"
          value={draft.display_name}
          onChange={(v) => set('display_name', v)}
          placeholder="Sarah Ashworth"
        />
        <Field
          label="Headline"
          value={draft.headline}
          onChange={(v) => set('headline', v)}
          placeholder="Mum, teacher, coffee lover"
        />
        {/* KAN-341 — optional: resolve your town from a postcode (postcode never stored). */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">
            Find your town from a postcode{' '}
            <span className="font-normal text-[var(--color-muted)]">(optional)</span>
          </label>
          <div className="flex gap-2">
            <input
              value={postcodeInput}
              onChange={(e) => setPostcodeInput(e.target.value)}
              placeholder="e.g. SW1A 1AA"
              autoComplete="off"
              className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
            />
            <button
              type="button"
              onClick={handlePostcodeLookup}
              disabled={lookingUp || !postcodeInput.trim()}
              className="shrink-0 px-4 py-2 rounded-lg bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] disabled:opacity-50 transition-colors"
            >
              {lookingUp ? 'Finding…' : 'Find town'}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            We use your postcode once to fill in your town — we never store it.
          </p>
          {lookupError && <p className="mt-1 text-xs text-red-500">{lookupError}</p>}
        </div>
        <Field
          label="City"
          value={draft.city}
          onChange={(v) => set('city', v)}
          placeholder="London"
        />
        <Field
          label="Country"
          value={draft.country}
          onChange={(v) => set('country', v)}
          placeholder="GB"
        />
      </div>
    </div>
  );
}
