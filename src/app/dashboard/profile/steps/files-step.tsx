'use client';

import { useRef, useState } from 'react';
import { SaveButton, type WizardFile } from './types';

/**
 * KAN-142: files step in the profile wizard.
 *
 * Browser-side file picker (single-file at a time for v1; multi-select
 * is easy to add later if needed). The upload is a real form submit
 * targeting the `uploadProfileFile` server action — keeps the file
 * bytes inside the action via `FormData`, no separate fetch path.
 *
 * Visibility (public / members_only / draft) follows KAN-143; same
 * shape as the visibility controls on profile_items.
 *
 * 10-file cap is enforced at the DB layer; the UI mirrors it so the
 * user gets a clean message rather than a Postgres error.
 */

const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'public', label: '🌍 Public — anyone with the link' },
  { value: 'members_only', label: '🔒 Members only — signed-in users' },
  { value: 'draft', label: '✏️ Draft — only you can see this' },
];

const visibilityShort: Record<string, string> = {
  public: '🌍 Public',
  members_only: '🔒 Members',
  draft: '✏️ Draft',
  private: '✏️ Draft', // legacy enum value (pre-KAN-143)
};

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES_DISPLAY = ['jpeg', 'png', 'webp', 'gif', 'pdf'];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForMime(mime: string): string {
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  return '📎';
}

export function FilesStep({
  files,
  onUpload,
  onRemove,
  onUpdateVisibility,
  onNext,
  isPending,
}: {
  files: WizardFile[];
  onUpload: (formData: FormData) => void;
  onRemove: (id: string) => void;
  onUpdateVisibility: (id: string, visibility: string) => void;
  onNext: () => void;
  isPending: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<string>('public');
  const [clientError, setClientError] = useState<string | null>(null);

  const atCap = files.length >= MAX_FILES;

  function handlePick() {
    setClientError(null);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side guardrails — the server action revalidates everything,
    // but failing fast in the UI is friendlier than waiting for a round-trip.
    if (atCap) {
      setClientError(`File limit reached (${MAX_FILES}). Remove one to add another.`);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError(`File too large (${humanSize(file.size)}). Max ${humanSize(MAX_BYTES)}.`);
      e.target.value = '';
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('visibility', visibility);
    onUpload(fd);
    e.target.value = '';
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Files & media</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Up to {MAX_FILES} files (10 MB each). Formats: {ALLOWED_MIMES_DISPLAY.join(', ')}.
          Images render as thumbnails; PDFs as downloads.
        </p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between bg-white rounded-lg border border-[var(--color-border)] px-4 py-3"
            >
              <div className="flex-1 min-w-0 flex items-center gap-3">
                <span className="text-xl shrink-0" aria-hidden>{iconForMime(file.mime_type)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-ink)] truncate">{file.file_name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {file.mime_type} · {humanSize(file.size_bytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                <label className="sr-only" htmlFor={`file-vis-${file.id}`}>Visibility</label>
                <select
                  id={`file-vis-${file.id}`}
                  aria-label={`Visibility for ${file.file_name}`}
                  value={visibilityShort[file.visibility] ? file.visibility : 'public'}
                  onChange={(e) => onUpdateVisibility(file.id, e.target.value)}
                  disabled={isPending}
                  className="text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-white text-[var(--color-ink)]"
                >
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{visibilityShort[opt.value]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onRemove(file.id)}
                  disabled={isPending}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-[var(--color-border)] p-4">
        <p className="text-sm text-[var(--color-ink)] font-medium">
          {atCap ? `At limit (${files.length} / ${MAX_FILES})` : `Add a file (${files.length} / ${MAX_FILES})`}
        </p>

        <div>
          <label htmlFor="new-file-visibility" className="block text-sm font-medium text-[var(--color-ink)] mb-1">
            Visibility for the new file
          </label>
          <select
            id="new-file-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm"
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden
        />
        <button
          type="button"
          onClick={handlePick}
          disabled={isPending || atCap}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-40 transition-colors"
        >
          + Choose file…
        </button>

        {clientError && (
          <p role="alert" className="text-sm text-red-600">{clientError}</p>
        )}
      </div>

      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}
