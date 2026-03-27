'use client';

import { useState, useTransition } from 'react';
import { exportUserData, deleteAccount } from './actions';

export function SettingsClient() {
  const [isPending, startTransition] = useTransition();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  const handleExport = () => {
    startTransition(async () => {
      const data = await exportUserData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lyra-data-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  const handleDelete = () => {
    if (deleteText !== 'DELETE') return;
    startTransition(async () => {
      await deleteAccount();
    });
  };

  return (
    <>
      {/* Data Export */}
      <div className="bg-white rounded-xl border border-stone-200 p-6">
        <h2 className="text-lg font-medium text-[var(--color-ink)] mb-1">Export your data</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Download all your Lyra data in JSON format. This includes your profile, preferences, gift ideas, school affiliations, and links.
        </p>
        <button
          onClick={handleExport}
          disabled={isPending}
          className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending ? 'Exporting...' : 'Download my data'}
        </button>
      </div>

      {/* Delete Account */}
      <div className="bg-white rounded-xl border border-red-200 p-6">
        <h2 className="text-lg font-medium text-red-700 mb-1">Delete your account</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Permanently delete your account and all associated data. This action cannot be undone. Your profile, preferences, gift ideas, school affiliations, and links will be permanently removed.
        </p>
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 rounded-lg border border-red-300 text-red-700 text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-red-700 font-medium">
              Type DELETE to confirm permanent account deletion:
            </p>
            <input
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full max-w-xs px-3 py-2 rounded-lg border border-red-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleteText !== 'DELETE' || isPending}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {isPending ? 'Deleting...' : 'Permanently delete everything'}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); }}
                className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
