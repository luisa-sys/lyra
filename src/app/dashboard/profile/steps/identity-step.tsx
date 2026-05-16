'use client';

import { useState, useRef, useTransition } from 'react';
import { Field, SaveButton, type WizardProfile } from './types';
import { SUPPORTED_DELIVERY_COUNTRIES } from '@/lib/affiliate/country-codes';
import { updateDeliveryCountry } from '../delivery-country-actions';

export function IdentityStep({ profile, onSave, onUploadAvatar, isPending }: {
  profile: WizardProfile;
  onSave: (data: Record<string, string>) => void;
  onUploadAvatar: (formData: FormData) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(profile.display_name || '');
  const [headline, setHeadline] = useState(profile.headline || '');
  const [city, setCity] = useState(profile.city || '');
  const [country, setCountry] = useState(profile.country || 'GB');
  // KAN-186: separate from `country` (freeform display) — this is the
  // strict ISO-2 used by the recommender's eligibility filter.
  const [deliveryCountry, setDeliveryCountry] = useState<string>(
    profile.delivery_country_code || '',
  );
  const [deliveryCountryError, setDeliveryCountryError] = useState<string | null>(null);
  const [savingDeliveryCountry, startSavingDeliveryCountry] = useTransition();
  const [preview, setPreview] = useState<string | null>(profile.avatar_url || null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // Client-side validation
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setUploadError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image must be under 5MB.');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload
    const fd = new FormData();
    fd.append('avatar', file);
    onUploadAvatar(fd);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Who are you?</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">The basics so people can find and recognise you.</p>
      </div>

      {/* Avatar upload */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative w-20 h-20 rounded-full overflow-hidden bg-[var(--color-sage)] flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity shrink-0"
        >
          {preview ? (
            <img src={preview} alt="Profile photo" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl text-white font-[family-name:var(--font-serif)]">
              {name ? name.charAt(0).toUpperCase() : '?'}
            </span>
          )}
          <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
            <span className="text-white text-xs font-medium opacity-0 hover:opacity-100">Edit</span>
          </div>
        </button>
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-sm text-[var(--color-sage)] hover:underline cursor-pointer"
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
        <Field label="Display name" value={name} onChange={setName} placeholder="Sarah Ashworth" />
        <Field label="Headline" value={headline} onChange={setHeadline} placeholder="Mum, teacher, coffee lover" />
        <Field label="City" value={city} onChange={setCity} placeholder="London" />
        <Field label="Country" value={country} onChange={setCountry} placeholder="GB" />

        {/* KAN-186: delivery country — separate from the freeform `country`
            field above; this one is the strict ISO-2 the recommender uses to
            filter products that can ship to you. */}
        <div>
          <label htmlFor="delivery-country" className="block text-sm font-medium text-[var(--color-ink)]">
            Delivery country
          </label>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Where gift recommendations should be able to ship to. Leave blank to use the buyer&apos;s country.
          </p>
          <select
            id="delivery-country"
            value={deliveryCountry}
            onChange={(e) => {
              const next = e.target.value;
              setDeliveryCountry(next);
              setDeliveryCountryError(null);
              startSavingDeliveryCountry(async () => {
                const result = await updateDeliveryCountry(next || null);
                if (!result.success) {
                  setDeliveryCountryError(result.error ?? 'Could not save');
                }
              });
            }}
            disabled={savingDeliveryCountry}
            className="mt-1 block w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
          >
            <option value="">— Use buyer&apos;s country —</option>
            {SUPPORTED_DELIVERY_COUNTRIES.map(({ code, name: countryName }) => (
              <option key={code} value={code}>
                {countryName} ({code})
              </option>
            ))}
          </select>
          {deliveryCountryError && (
            <p className="text-xs text-red-500 mt-0.5">{deliveryCountryError}</p>
          )}
        </div>
      </div>
      <SaveButton
        onClick={() => onSave({ display_name: name, headline, city, country })}
        isPending={isPending}
        label="Save & continue"
      />
    </div>
  );
}
