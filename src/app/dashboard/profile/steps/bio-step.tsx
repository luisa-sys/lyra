'use client';

import { useState } from 'react';
import { SaveButton, type WizardProfile } from './types';

export function BioStep({ profile, onSave, isPending }: {
  profile: WizardProfile;
  onSave: (data: Record<string, string>) => void;
  isPending: boolean;
}) {
  const [bio, setBio] = useState(profile.bio_short || '');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">About you</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">A short bio so people get a sense of who you are.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Short bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={300}
          className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent resize-none"
          placeholder="I'm a primary school teacher who loves hiking, terrible puns, and finding the best flat white in town."
        />
        <p className="text-xs text-[var(--color-muted)] mt-1">{bio.length}/300</p>
      </div>
      <SaveButton onClick={() => onSave({ bio_short: bio })} isPending={isPending} label="Save & continue" />
    </div>
  );
}
