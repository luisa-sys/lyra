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
  requiresPostcode,
  isSchoolPostcodeValid,
  type AffiliationType,
} from '../affiliation-fields';
import {
  addSchoolAffiliation,
  removeSchoolAffiliation,
  updateAffiliationVisibility,
  updateSchoolAffiliation,
} from '../actions';
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
          // KAN-448: inline edit is awaited directly rather than fired into the
          // transition, so a moderation or postcode rejection comes back to the
          // row and is shown in place instead of being swallowed.
          onEdit={async (id, data) => {
            const result = await updateSchoolAffiliation(id, data);
            if (result.success) router.refresh();
            return result;
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
  type, items, onAdd, onRemove, onToggleVisibility, onEdit, isPending,
}: {
  type: AffiliationType;
  items: WizardSchool[];
  onAdd: (name: string, location: string) => void;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string, show: boolean) => void;
  // KAN-448 — edit an existing row's name / location / description. Returns
  // the action result so the row can surface a rejection in place.
  onEdit: (
    id: string,
    data: { school_name?: string; school_location?: string; description?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [locationError, setLocationError] = useState('');

  // KAN-448: inline edit state. Only one row edits at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const needsPostcode = requiresPostcode(type);
  const postcodeInvalid = needsPostcode && !isSchoolPostcodeValid(location);
  const editPostcodeInvalid = needsPostcode && !isSchoolPostcodeValid(editLocation);

  const namePlaceholder =
    type === 'school' ? 'Example: Greenfield Primary' :
    type === 'organisation' ? 'Example: Acme Ltd' :
    'Example: Local running club';
  const locationPlaceholder = needsPostcode ? 'Example: SW1A 1AA' : 'Example: London';
  const POSTCODE_HINT =
    'Enter a postcode (full or partial) so people can tell schools with the same name apart.';

  const handleAdd = () => {
    if (!name.trim()) return;
    // KAN-404 — schools require a valid postcode before we add the row.
    if (postcodeInvalid) {
      setLocationError(POSTCODE_HINT);
      return;
    }
    onAdd(name.trim(), location.trim());
    setName('');
    setLocation('');
    setLocationError('');
  };

  const startEdit = (s: WizardSchool) => {
    setEditingId(s.id);
    setEditName(s.school_name);
    setEditLocation(s.school_location ?? '');
    setEditDescription(s.description ?? '');
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    // KAN-404 — the postcode rule applies to an edit too, so a school can't
    // lose its postcode by being edited. The server enforces it as well.
    if (editPostcodeInvalid) {
      setEditError(POSTCODE_HINT);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const result = await onEdit(id, {
      school_name: editName.trim(),
      // Send location and description even when empty so the member can CLEAR
      // them (the action treats '' as null).
      school_location: editLocation.trim(),
      description: editDescription,
    });
    setEditSaving(false);
    if (result.success) {
      setEditingId(null);
      setEditError(null);
    } else {
      setEditError(result.error ?? 'Could not save. Please try again.');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--color-ink)]">
        {AFFILIATION_LABELS[type]}
      </h3>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
              {editingId === s.id ? (
                /* KAN-448: inline edit mode — reuses the add-form inputs. */
                <div className="space-y-3">
                  <Field
                    label="Name"
                    value={editName}
                    onChange={setEditName}
                    placeholder={namePlaceholder}
                  />
                  <Field
                    label={needsPostcode ? 'Postcode' : 'Location (optional)'}
                    value={editLocation}
                    onChange={(v) => {
                      setEditLocation(v);
                      if (editError) setEditError(null);
                    }}
                    placeholder={locationPlaceholder}
                  />
                  <Field
                    label="Description (optional)"
                    value={editDescription}
                    onChange={setEditDescription}
                    placeholder="Example: Class of 2008"
                  />
                  {editError && <p role="alert" className="text-xs text-red-600">{editError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(s.id)}
                      disabled={editSaving || isPending || !editName.trim()}
                      className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={editSaving}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-ink)] truncate">
                      {s.school_name}
                      {s.description && (
                        <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">{s.description}</span>
                      )}
                    </p>
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
                      type="button"
                      onClick={() => startEdit(s)}
                      disabled={isPending}
                      className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onRemove(s.id)}
                      disabled={isPending}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-[var(--color-border)] p-4">
        <Field
          label={`${AFFILIATION_LABELS[type].slice(0, -1)} name`}
          value={name}
          onChange={setName}
          placeholder={namePlaceholder}
        />
        <div>
          <Field
            label={needsPostcode ? 'Postcode' : 'Location (optional)'}
            value={location}
            onChange={(v) => {
              setLocation(v);
              if (locationError) setLocationError('');
            }}
            placeholder={locationPlaceholder}
          />
          {locationError && (
            <p className="mt-1 text-xs text-red-500">{locationError}</p>
          )}
        </div>
        <button
          onClick={handleAdd}
          disabled={isPending || !name.trim() || postcodeInvalid}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-40 transition-colors"
        >
          + Add {AFFILIATION_SINGULAR[type]}
        </button>
      </div>
    </div>
  );
}
