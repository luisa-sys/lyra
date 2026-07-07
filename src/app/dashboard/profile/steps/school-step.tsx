'use client';

import { useState } from 'react';
import { Field, SaveButton, type WizardSchool } from './types';
import { isSchoolPostcodeValid } from '../affiliation-fields';

export function SchoolStep({ schools, onAdd, onRemove, onNext, isPending }: {
  schools: WizardSchool[];
  onAdd: (data: { school_name: string; school_location?: string; relationship?: string }) => void;
  onRemove: (id: string) => void;
  onNext: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [relationship, setRelationship] = useState('parent');
  const [locationError, setLocationError] = useState('');

  // KAN-404 — schools require a postcode (full or partial).
  const postcodeInvalid = !isSchoolPostcodeValid(location);

  const handleAdd = () => {
    if (!name.trim()) return;
    if (postcodeInvalid) {
      setLocationError(
        'Enter a postcode (full or partial) so people can tell schools with the same name apart.',
      );
      return;
    }
    onAdd({ school_name: name, school_location: location, relationship });
    setName('');
    setLocation('');
    setLocationError('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">School connections</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">Help other parents and teachers find you.</p>
      </div>

      {schools.length > 0 && (
        <div className="space-y-2">
          {schools.map((s: WizardSchool) => (
            <div key={s.id} className="flex items-center justify-between bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">{s.school_name}</p>
                <p className="text-xs text-[var(--color-muted)]">{s.relationship}{s.school_location ? ` · ${s.school_location}` : ''}</p>
              </div>
              <button onClick={() => onRemove(s.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-[var(--color-border)] p-4">
        <Field label="School name" value={name} onChange={setName} placeholder="Greenfield Primary" />
        <div>
          <Field
            label="Postcode"
            value={location}
            onChange={(v) => {
              setLocation(v);
              if (locationError) setLocationError('');
            }}
            placeholder="SW1A 1AA"
          />
          {locationError && (
            <p className="mt-1 text-xs text-red-500">{locationError}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Relationship</label>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm">
            <option value="parent">Parent</option>
            <option value="student">Student</option>
            <option value="alumni">Alumni</option>
            <option value="staff">Staff</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button onClick={handleAdd} disabled={isPending || !name.trim() || postcodeInvalid}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-40 transition-colors">
          + Add school
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}
