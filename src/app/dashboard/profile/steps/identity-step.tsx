'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardProfile } from './types';

export function IdentityStep({ profile, onSave, isPending }: {
  profile: WizardProfile;
  onSave: (data: Record<string, string>) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(profile.display_name || '');
  const [headline, setHeadline] = useState(profile.headline || '');
  const [city, setCity] = useState(profile.city || '');
  const [country, setCountry] = useState(profile.country || 'GB');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Who are you?</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">The basics so people can find and recognise you.</p>
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
