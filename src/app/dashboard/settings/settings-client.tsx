'use client';

import { useState, useTransition, useEffect } from 'react';
import { exportUserData, deleteAccount, generateApiKey, listApiKeys, revokeApiKey } from './actions';

export function SettingsClient() {
  const [isPending, startTransition] = useTransition();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<Array<{ id: string; key_prefix: string; name: string; created_at: string; last_used_at: string | null }>>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    startTransition(async () => {
      const result = await listApiKeys();
      if (result.keys) setKeys(result.keys);
    });
  }, []);

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

  const handleGenerateKey = () => {
    startTransition(async () => {
      const result = await generateApiKey('AI Companion');
      if (result.key) {
        setNewKey(result.key);
        const updated = await listApiKeys();
        if (updated.keys) setKeys(updated.keys);
      }
    });
  };

  const handleRevokeKey = (keyId: string) => {
    startTransition(async () => {
      await revokeApiKey(keyId);
      const updated = await listApiKeys();
      if (updated.keys) setKeys(updated.keys);
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* API Keys */}
      <div className="bg-white rounded-xl border border-stone-200 p-6">
        <h2 className="text-lg font-medium text-[var(--color-ink)] mb-1">API Keys</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">
          Generate API keys so AI companions (Claude, ChatGPT, etc.) can update your profile on your behalf.
        </p>

        {newKey && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm font-medium text-amber-800 mb-2">Copy this key now — you won&apos;t see it again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white px-3 py-2 rounded border border-amber-300 font-mono break-all">{newKey}</code>
              <button
                onClick={() => handleCopy(newKey)}
                className="px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors whitespace-nowrap"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-amber-600 hover:underline">Dismiss</button>
          </div>
        )}

        {keys.length > 0 && (
          <div className="space-y-2 mb-4">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between bg-stone-50 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-mono text-[var(--color-ink)]">{k.key_prefix}...</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    Created {new Date(k.created_at).toLocaleDateString('en-GB')}
                    {k.last_used_at && ` · Last used ${new Date(k.last_used_at).toLocaleDateString('en-GB')}`}
                  </p>
                </div>
                <button
                  onClick={() => handleRevokeKey(k.id)}
                  disabled={isPending}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleGenerateKey}
          disabled={isPending}
          className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending ? 'Generating...' : 'Generate API key'}
        </button>

        <details className="mt-4">
          <summary className="text-xs text-[var(--color-muted)] cursor-pointer hover:text-[var(--color-ink)]">How to connect your AI companion</summary>
          <div className="mt-2 p-3 bg-stone-50 rounded-lg text-xs text-[var(--color-muted)] space-y-2">
            <p><strong>Claude.ai:</strong> Settings → Connectors → Add <code>https://mcp.checklyra.com/mcp</code></p>
            <p><strong>Claude Desktop:</strong> Add to claude_desktop_config.json:</p>
            <pre className="bg-white p-2 rounded text-[10px] overflow-x-auto">{`"lyra": { "command": "npx", "args": ["mcp-remote", "https://mcp.checklyra.com/mcp"] }`}</pre>
            <p>Then use your API key when the AI companion asks for it, or include it in your prompt.</p>
          </div>
        </details>
      </div>

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
