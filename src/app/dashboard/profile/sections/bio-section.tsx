'use client';

/**
 * KAN-220 — Bio section for the single-page profile editor.
 *
 * Autosave version of `BioStep`. Single textarea (bio_short, max 300 chars)
 * with debounced auto-save. Status indicator at the top.
 */

import { useState } from 'react';
import type { WizardProfile } from '../steps/types';
import { updateProfileFields } from '../actions';
import { AutoSaveStatusLabel, useAutoSave } from './use-auto-save';

export function BioSection({ profile }: { profile: WizardProfile }) {
  const [bio, setBio] = useState(profile.bio_short || '');

  const status = useAutoSave(bio, async (v) => updateProfileFields({ bio_short: v }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AutoSaveStatusLabel status={status} />
      </div>
      <div>
        <label htmlFor="bio_short" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
          Short bio
        </label>
        <textarea
          id="bio_short"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={600}
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent resize-none"
          placeholder="I'm a primary school teacher who loves hiking, terrible puns, and finding the best flat white in town."
        />
        <p className="text-xs text-[var(--color-muted)] mt-1">{bio.length}/600</p>
      </div>
    </div>
  );
}
