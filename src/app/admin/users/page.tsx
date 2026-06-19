/**
 * KAN-141: /admin/users — list of profiles.
 *
 * Supports a `?filter=suspended` query to drill into the suspended set
 * (linked from the overview card) and a `?q=` text query for fuzzy name
 * / slug search. Pagination via `?page=` (10 per page) — the cursor is
 * created_at-keyed but offset is fine at the scale we're at.
 */

import Link from 'next/link';
import { getAdminServiceClient } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

interface UserRow {
  id: string;
  display_name: string | null;
  slug: string;
  is_published: boolean;
  is_suspended: boolean;
  is_admin: boolean;
  created_at: string;
}

async function listUsers(opts: { q?: string; filter?: string; page?: number }): Promise<{ rows: UserRow[]; total: number }> {
  const supabase = getAdminServiceClient();
  let q = supabase
    .from('profiles')
    .select('id, display_name, slug, is_published, is_suspended, is_admin, created_at', { count: 'exact' });

  if (opts.q && opts.q.trim().length > 0) {
    const search = opts.q.trim().replace(/[%_]/g, '');
    q = q.or(`display_name.ilike.%${search}%,slug.ilike.%${search}%`);
  }
  if (opts.filter === 'suspended') q = q.eq('is_suspended', true);
  if (opts.filter === 'admin') q = q.eq('is_admin', true);

  const page = Math.max(1, opts.page ?? 1);
  q = q.order('created_at', { ascending: false })
       .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const { data, count } = await q;
  return { rows: (data ?? []) as UserRow[], total: count ?? 0 };
}

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const { rows, total } = await listUsers({ q: sp.q, filter: sp.filter, page });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Users
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          {total} {total === 1 ? 'profile' : 'profiles'} {sp.filter ? `(${sp.filter})` : 'total'}.
        </p>
      </header>

      <form className="flex flex-wrap gap-3 items-center" method="GET">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search name or slug…"
          className="flex-1 min-w-[200px] p-2 text-sm rounded-lg border border-[var(--color-border)] bg-white"
        />
        {sp.filter && <input type="hidden" name="filter" value={sp.filter} />}
        <button
          type="submit"
          className="px-4 py-2 rounded-full bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors"
        >
          Search
        </button>
        <Link
          href="/admin/users"
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          Clear
        </Link>
      </form>

      <nav aria-label="Filter" className="flex gap-2">
        <Link
          href="/admin/users"
          className={
            'text-xs px-3 py-1.5 rounded-full transition-colors ' +
            (!sp.filter
              ? 'bg-[var(--color-ink)] text-white'
              : 'bg-[#f4efe7] text-[var(--color-muted)] hover:bg-[#ece7df]')
          }
        >
          All
        </Link>
        <Link
          href="/admin/users?filter=suspended"
          className={
            'text-xs px-3 py-1.5 rounded-full transition-colors ' +
            (sp.filter === 'suspended'
              ? 'bg-[var(--color-ink)] text-white'
              : 'bg-[#f4efe7] text-[var(--color-muted)] hover:bg-[#ece7df]')
          }
        >
          Suspended
        </Link>
        <Link
          href="/admin/users?filter=admin"
          className={
            'text-xs px-3 py-1.5 rounded-full transition-colors ' +
            (sp.filter === 'admin'
              ? 'bg-[var(--color-ink)] text-white'
              : 'bg-[#f4efe7] text-[var(--color-muted)] hover:bg-[#ece7df]')
          }
        >
          Admins
        </Link>
      </nav>

      <div className="rounded-xl border border-[var(--color-border)] bg-white divide-y divide-[var(--color-border)]">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">No users match.</p>
        ) : rows.map((u) => (
          <Link
            key={u.id}
            href={`/admin/users/${u.slug}`}
            className="block p-4 hover:bg-[var(--color-paper)] transition-colors"
          >
            <div className="flex items-baseline justify-between gap-4 mb-1">
              <p className="text-sm font-medium text-[var(--color-ink)] truncate">
                {u.display_name ?? '(no name)'}{' '}
                <span className="text-[var(--color-muted)]">/{u.slug}</span>
              </p>
              <div className="flex items-center gap-2 shrink-0">
                {u.is_admin && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Admin</span>
                )}
                {u.is_suspended ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">Suspended</span>
                ) : u.is_published ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">Published</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#f4efe7] text-[var(--color-muted)]">Draft</span>
                )}
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              Joined {new Date(u.created_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
          </Link>
        ))}
      </div>

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
