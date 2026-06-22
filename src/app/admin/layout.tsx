/**
 * KAN-141: admin section root layout.
 *
 * Server-side admin gate — non-admins get `notFound()` (404). We
 * deliberately don't show a "you don't have access" page: revealing
 * that an admin section exists at all is information leakage. Anyone
 * who hits /admin while not an admin gets the same 404 as anyone who
 * hits /this-route-does-not-exist.
 *
 * The DB lookup happens here in the layout so every page under /admin
 * shares the same gate without each page repeating itself. The cost is
 * one extra row read per request — acceptable for an admin-only route
 * that won't see heavy traffic.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentAdmin } from '@/lib/admin';

export const metadata = {
  title: 'Admin — Lyra',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[var(--color-paper)]">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link
              href="/admin"
              className="text-sm font-semibold text-[var(--color-ink)] tracking-wide"
            >
              Lyra Admin
            </Link>
            <nav aria-label="Admin sections" className="flex items-center gap-6">
              <Link
                href="/admin"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Overview
              </Link>
              <Link
                href="/admin/users"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Users
              </Link>
              <Link
                href="/admin/moderation"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Moderation
              </Link>
              <Link
                href="/admin/reports"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Reports
              </Link>
              <Link
                href="/admin/monitoring"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Monitoring
              </Link>
              <Link
                href="/admin/audit"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Audit
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-muted)]">
              {admin.displayName ?? admin.email ?? 'admin'}
            </span>
            <Link
              href="/dashboard"
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
            >
              ↗ My profile
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
