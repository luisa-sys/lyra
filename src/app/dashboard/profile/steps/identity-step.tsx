'use client';

import { useState, useRef } from 'react';
import { Field, SaveButton, type WizardProfile } from './types';

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
      </div>
      <SaveButton
        onClick={() => onSave({ display_name: name, headline, city, country })}
        isPending={isPending}
        label="Save & continue"
      />
    </div>
  );
}
