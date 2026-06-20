'use client';

/**
 * KAN-220 — Schools / Organisations / Communities section for the
 * single-page profile editor. Splits the legacy single-type SchoolStep
 * into three multi-input groups, matching the Python `lyra-app` UX
 * (`templates/edit_profile.html` — "Schools / Organisations / Communities
 * I'm part of"). All three use the same `school_affiliations` table
 * with the new `affiliation_type` column (migration 20260517010000).
 *
 * No autosave — each row is added/removed explicitly via the existing
 * `addSchoolAffiliation` / `removeSchoolAffiliation` server actions,
 * which fire on click (same instant-save pattern as the items step).
 */

import { useState, useTransition } from 'react';
import { Field, type WizardSchool } from '../steps/types';
import {
  AFFILIATION_LABELS,
  AFFILIATION_SINGULAR,
  type AffiliationType,
} from '../affiliation-fields';
import { addSchoolAffiliation, removeSchoolAffiliation, updateAffiliationVisibility } from '../actions';
import { useRouter } from 'next/navigation';

const AFFILIATION_ORDER: AffiliationType[] = ['school', 'organisation', 'community'];

export function AffiliationsSection({ schools }: { schools: WizardSchool[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const grouped = AFFILIATION_ORDER.reduce<Record<AffiliationType, WizardSchool[]>>(
    (acc, type) => {
      // Older rows pre-migration default to 'school' via the DB default,
      // but defend against missing/unknown values just in case.
      acc[type] = schools.filter((s) => (s.affiliation_type || 'school') === type);
      return acc;
    },
    { school: [], organisation: [], community: [] },
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-muted)]">
        Schools, organisations, and communities you&apos;re part of. These help the right people
        find you.
      </p>
      {/* KAN-267: affiliations are private by default. */}
      <div className="rounded-[9px] bg-[#e9efea] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--color-sage)]">
        These are <strong>hidden on your public profile</strong> by default — they&apos;re only used
        to help people who know you find you. Tick <em>&ldquo;Show on my profile&rdquo;</em> on any
        you&apos;re happy to display.
      </div>
      {AFFILIATION_ORDER.map((type) => (
        <AffiliationGroup
          key={type}
          type={type}
          items={grouped[type]}
          onAdd={(name, location) => {
            startTransition(async () => {
              const result = await addSchoolAffiliation({
                school_name: name,
                school_location: location || undefined,
                affiliation_type: type,
              });
              if (result.success) router.refresh();
            });
          }}
          onRemove={(id) => {
            startTransition(async () => {
              const result = await removeSchoolAffiliation(id);
              if (result.success) router.refresh();
            });
          }}
          onToggleVisibility={(id, show) => {
            startTransition(async () => {
              const result = await updateAffiliationVisibility(id, show);
              if (result.success) router.refresh();
            });
          }}
          isPending={isPending}
        />
      ))}
    </div>
  );
}

function AffiliationGroup({
  type, items, onAdd, onRemove, onToggleVisibility, isPending,
}: {
  type: AffiliationType;
  items: WizardSchool[];
  onAdd: (name: string, location: string) => void;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string, show: boolean) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), location.trim());
    setName('');
    setLocation('');
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--color-ink)]">
        {AFFILIATION_LABELS[type]}
      </h3>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="flex items-center justify-between bg-white rounded-lg border border-[var(--color-border)] px-4 py-3 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-ink)] truncate">{s.school_name}</p>
                {s.school_location && (
                  <p className="text-xs text-[var(--color-muted)] truncate">{s.school_location}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={s.show_on_profile}
                    onChange={(e) => onToggleVisibility(s.id, e.target.checked)}
                    disabled={isPending}
                    className="w-4 h-4 accent-[var(--color-sage)]"
                  />
                  Show on my profile
                </label>
                <button
                  onClick={() => onRemove(s.id)}
                  disabled={isPending}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-[var(--color-border)] p-4">
        <Field
          label={`${AFFILIATION_LABELS[type].slice(0, -1)} name`}
          value={name}
          onChange={setName}
          placeholder={
            type === 'school' ? 'Greenfield Primary' :
            type === 'organisation' ? 'Acme Ltd' :
            'Local running club'
          }
        />
        <Field
          label="Location (optional)"
          value={location}
          onChange={setLocation}
          placeholder="London"
        />
        <button
          onClick={handleAdd}
          disabled={isPending || !name.trim()}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-40 transition-colors"
        >
          + Add {AFFILIATION_SINGULAR[type]}
        </button>
      </div>
    </div>
  );
}
