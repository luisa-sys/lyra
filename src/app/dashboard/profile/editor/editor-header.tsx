'use client';

/**
 * KAN-487 — v0.8 profile editor header (plan §A component tree
 * `editor-header.tsx`; spec v0.8 §1).
 *
 * Logo (to the dashboard), any extra links the editor passes in (the Convene
 * link when its flag is on, kept from the previous editor), "View public
 * profile ↗" only while the profile is
 * published, and "Back to dashboard". The "Use legacy wizard" link is
 * retired: the wizard stays reachable by URL until PR3 deletes it.
 */

import Image from 'next/image';
import Link from 'next/link';

export interface EditorHeaderProps {
  isPublished: boolean;
  /** The stored CheckLyra ID (the public URL path). */
  publicSlug: string;
  /** Extra nav links, rendered first (e.g. the flag-gated Convene link). */
  extraLinks?: React.ReactNode;
}

export const HEADER_LINK_FOCUS =
  'rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';

export function EditorHeader({ isPublished, publicSlug, extraLinks }: EditorHeaderProps) {
  return (
    <header className="border-b border-[var(--color-border)] bg-white">
      <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
        <Link href="/dashboard" className={`flex items-center ${HEADER_LINK_FOCUS}`}>
          <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
        </Link>
        <nav aria-label="Profile editor" className="flex items-center gap-4">
          {extraLinks}
          {isPublished && publicSlug !== '' && (
            <Link
              href={`/${publicSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm text-[var(--color-sage)] hover:underline ${HEADER_LINK_FOCUS}`}
            >
              View public profile ↗
            </Link>
          )}
          <Link
            href="/dashboard"
            className={`text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors ${HEADER_LINK_FOCUS}`}
          >
            Back to dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}
