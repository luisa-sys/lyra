'use client';

/**
 * KAN-309 / KAN-311: bulk-select island for the user-management console.
 *
 * The admin pages are server components; multi-select needs client state, so
 * this island renders BOTH the bulk toolbar AND the row checkboxes inside one
 * <form action={bulkUserAction}>. Selected rows submit as `ids`; the
 * "select all N matching this filter" toggle instead submits `selectAll=true`
 * plus the current filter, and the server re-materialises the IDs itself.
 *
 * A confirm() dialog states the exact count + action before anything fires.
 */

import { useState } from 'react';
import Link from 'next/link';
import { bulkUserAction } from './actions';
import { BULK_ACTIONS, type BulkActionConfig, type UserFilter } from './users-actions-shared';
import { userStatusBadge, accessBadge, publishBadge } from './status-badges';

export interface BulkUserRow {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  slug: string;
  created_at: string;
  user_status: 'not_applied' | 'waitlist' | 'live';
  access_tier: 'beta' | 'prod';
  is_published: boolean;
  age_status: string | null;
  is_suspended: boolean;
  is_admin: boolean;
  has_revoked_ga_feature: boolean;
  // legacy columns still returned during the transition; not rendered.
  access_stage?: 'waitlist' | 'beta' | 'live';
  early_access?: boolean;
}

function actionLabel(value: string): string {
  return BULK_ACTIONS.find((a) => a.value === value)?.label ?? value;
}

export default function BulkBar({
  rows,
  total,
  selfProfileId,
  filter,
  ageGateOn,
}: {
  rows: BulkUserRow[];
  total: number;
  selfProfileId: string;
  filter: UserFilter;
  ageGateOn: boolean;
}) {
  const selectable = rows.filter((r) => r.id !== selfProfileId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [action, setAction] = useState<string>('');

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const togglePage = () => {
    setSelected((prev) => {
      if (selectable.every((r) => prev.has(r.id))) return new Set();
      return new Set(selectable.map((r) => r.id));
    });
  };

  const effectiveCount = selectAllMatching ? total : selected.size;
  const cfg: BulkActionConfig | undefined = BULK_ACTIONS.find((a) => a.value === action);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!action) {
      e.preventDefault();
      alert('Choose an action first.');
      return;
    }
    if (effectiveCount === 0) {
      e.preventDefault();
      alert('Select at least one user.');
      return;
    }
    const reason = (e.currentTarget.elements.namedItem('reason') as HTMLInputElement | null)?.value?.trim();
    if (cfg?.requiresReason && !reason) {
      e.preventDefault();
      alert(`A reason is required to ${actionLabel(action).toLowerCase()}.`);
      return;
    }
    const ok = confirm(`${actionLabel(action)} — ${effectiveCount} user${effectiveCount === 1 ? '' : 's'}?`);
    if (!ok) e.preventDefault();
  };

  return (
    <form action={bulkUserAction} onSubmit={onSubmit} className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-[var(--color-border)] bg-white">
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
          <input type="checkbox" checked={allPageSelected} onChange={togglePage} />
          Select page
        </label>

        {total > selectable.length && (
          <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={selectAllMatching}
              onChange={(e) => setSelectAllMatching(e.target.checked)}
            />
            Select all {total} matching
          </label>
        )}

        <select
          name="action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
        >
          <option value="">Bulk action…</option>
          {BULK_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>

        <input
          name="reason"
          type="text"
          maxLength={500}
          placeholder={cfg?.requiresReason ? 'Reason (required)' : 'Reason (optional)'}
          className="flex-1 min-w-[180px] p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
        />

        <button
          type="submit"
          disabled={!action || effectiveCount === 0}
          className={
            'px-4 py-2 rounded-full text-white text-sm font-medium transition-colors ' +
            (cfg?.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--color-sage)] hover:opacity-90') +
            (!action || effectiveCount === 0 ? ' opacity-40 cursor-not-allowed' : '')
          }
        >
          Apply{effectiveCount > 0 ? ` (${effectiveCount})` : ''}
        </button>

        {/* select-all + filter passthrough (read server-side only when selectAll=true) */}
        {selectAllMatching && <input type="hidden" name="selectAll" value="true" />}
        <input type="hidden" name="f_search" value={filter.search ?? ''} />
        <input type="hidden" name="f_stage" value={filter.stage ?? ''} />
        <input type="hidden" name="f_early" value={filter.early === null ? '' : String(filter.early)} />
        <input type="hidden" name="f_suspended" value={filter.suspended === null ? '' : String(filter.suspended)} />
        <input type="hidden" name="f_admin" value={filter.admin === null ? '' : String(filter.admin)} />
      </div>

      {/* Rows */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">No users match.</p>
        ) : (
          rows.map((u) => {
            const isSelf = u.id === selfProfileId;
            const st = userStatusBadge(u);
            const ac = accessBadge(u.access_tier);
            const pb = publishBadge(u, ageGateOn);
            return (
              <div key={u.id} className="flex items-center gap-3 p-4">
                <input
                  type="checkbox"
                  name="ids"
                  value={u.id}
                  checked={selected.has(u.id)}
                  onChange={() => toggle(u.id)}
                  disabled={isSelf || selectAllMatching}
                  aria-label={`Select ${u.display_name ?? u.slug}`}
                  className={isSelf ? 'invisible' : ''}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--color-ink)] truncate">
                    <span className="font-medium">{u.display_name ?? '(no name)'}</span>{' '}
                    <span className="text-[var(--color-muted)]">/{u.slug}</span>
                  </p>
                  <p className="text-xs text-[var(--color-muted)] truncate">
                    {u.email ?? '(no email)'} ·{' '}
                    {new Date(u.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* User status · Access · Publish — fixed-width so they line up as columns */}
                  <span className={'w-24 text-center text-xs px-2 py-0.5 rounded-full ' + st.cls} title="User status">
                    {st.label}
                  </span>
                  <span className={'w-14 text-center text-xs px-2 py-0.5 rounded-full ' + ac.cls} title="Access tier">
                    {ac.label}
                  </span>
                  <span className={'w-20 text-center text-xs px-2 py-0.5 rounded-full ' + pb.cls} title="Publish status">
                    {pb.label}
                  </span>
                  {u.has_revoked_ga_feature && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700" title="A default-on feature is turned off for this user">
                      features disabled
                    </span>
                  )}
                  <Link
                    href={`/admin/users/${u.slug}`}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    View →
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </form>
  );
}
