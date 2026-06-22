/**
 * KAN-309 / KAN-311: unified user-management console.
 *
 * Lists ALL signups (not just the beta queue) with email, lifecycle stage and
 * early-access state, plus search (email / name / slug) and filters
 * (stage / suspended / admin). Bulk select + bulk actions live in the
 * <BulkBar> client island. Data comes from the admin-only `admin_list_users`
 * RPC (joins auth.users for email; admin-gated inside the function), called via
 * the admin's cookie session.
 */

import Link from 'next/link';
import { getCurrentAdmin, getAdminServiceClient } from '@/lib/admin';
import { createClient } from '@/lib/supabase-server';
import BulkBar, { type BulkUserRow } from './BulkBar';
import type { UserFilter } from './users-actions-shared';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const STAGES = ['waitlist', 'beta', 'live'] as const;

interface SearchParams {
  q?: string;
  stage?: string;
  early?: string;
  suspended?: string;
  admin?: string;
  filter?: string; // legacy links from the overview cards
  page?: string;
}

function buildFilter(sp: SearchParams): UserFilter {
  const stage = sp.stage && (STAGES as readonly string[]).includes(sp.stage) ? sp.stage : null;
  const suspended = sp.suspended === '1' || sp.filter === 'suspended' ? true : null;
  const admin = sp.admin === '1' || sp.filter === 'admin' ? true : null;
  const early = sp.early === '1' ? true : null;
  const search = sp.q && sp.q.trim().length ? sp.q.trim() : null;
  return { search, stage, early, suspended, admin };
}

async function listUsers(filter: UserFilter, page: number): Promise<{ rows: BulkUserRow[]; total: number; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: filter.search,
    p_stage: filter.stage,
    p_early: filter.early,
    p_suspended: filter.suspended,
    p_admin: filter.admin,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) {
    return { rows: [], total: 0, error: error.message };
  }
  const payload = (data ?? { rows: [], total: 0 }) as { rows: BulkUserRow[]; total: number };
  return { rows: payload.rows ?? [], total: payload.total ?? 0, error: null };
}

async function stageCounts(): Promise<{ waitlist: number; beta: number; live: number; suspended: number }> {
  const svc = getAdminServiceClient();
  const [waitlist, beta, live, suspended] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('access_stage', 'waitlist'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('access_stage', 'beta'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('access_stage', 'live'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_suspended', true),
  ]);
  return {
    waitlist: waitlist.count ?? 0,
    beta: beta.count ?? 0,
    live: live.count ?? 0,
    suspended: suspended.count ?? 0,
  };
}

function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        'text-xs px-3 py-1.5 rounded-full transition-colors ' +
        (active ? 'bg-[var(--color-ink)] text-white' : 'bg-[#f4efe7] text-[var(--color-muted)] hover:bg-[#ece7df]')
      }
    >
      {label}
    </Link>
  );
}

export default async function UsersConsolePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const admin = (await getCurrentAdmin())!; // layout already gated
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const filter = buildFilter(sp);

  const [{ rows, total, error }, counts] = await Promise.all([listUsers(filter, page), stageCounts()]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const noFilter = !filter.stage && !filter.suspended && !filter.admin && !filter.early;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Users
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          {total} {total === 1 ? 'signup' : 'signups'} match. Waitlist {counts.waitlist} · Beta {counts.beta} · Live {counts.live} · Suspended {counts.suspended}.
        </p>
      </header>

      <form className="flex flex-wrap gap-3 items-center" method="GET">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search email, name or slug…"
          className="flex-1 min-w-[220px] p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
        />
        {filter.stage && <input type="hidden" name="stage" value={filter.stage} />}
        {filter.suspended && <input type="hidden" name="suspended" value="1" />}
        {filter.admin && <input type="hidden" name="admin" value="1" />}
        {filter.early && <input type="hidden" name="early" value="1" />}
        <button
          type="submit"
          className="px-4 py-2 rounded-full bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors"
        >
          Search
        </button>
        <Link href="/admin/users" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          Clear
        </Link>
      </form>

      <nav aria-label="Filter" className="flex flex-wrap gap-2">
        <Chip href="/admin/users" label="All" active={noFilter && !filter.search} />
        <Chip href="/admin/users?stage=waitlist" label="Waitlist" active={filter.stage === 'waitlist'} />
        <Chip href="/admin/users?stage=beta" label="Beta" active={filter.stage === 'beta'} />
        <Chip href="/admin/users?stage=live" label="Live" active={filter.stage === 'live'} />
        <Chip href="/admin/users?early=1" label="Beta features" active={filter.early === true} />
        <Chip href="/admin/users?suspended=1" label="Suspended" active={filter.suspended === true} />
        <Chip href="/admin/users?admin=1" label="Admins" active={filter.admin === true} />
      </nav>

      {error ? (
        <p className="p-5 text-sm text-red-700 rounded-xl border border-red-200 bg-red-50">
          Could not load users: {error}
        </p>
      ) : (
        <BulkBar rows={rows} total={total} selfProfileId={admin.profileId} filter={filter} />
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex justify-between items-center text-sm">
          {page > 1 ? (
            <Link
              href={{ pathname: '/admin/users', query: { ...sp, page: page - 1 } }}
              className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              ← Previous
            </Link>
          ) : <span />}
          <span className="text-[var(--color-muted)]">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link
              href={{ pathname: '/admin/users', query: { ...sp, page: page + 1 } }}
              className="text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              Next →
            </Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
