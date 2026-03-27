'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';

function getConsentSnapshot() {
  if (typeof window === 'undefined') return 'pending';
  return localStorage.getItem('lyra-cookie-consent') || 'none';
}

function getServerSnapshot() {
  return 'pending';
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

export function CookieConsent() {
  const consent = useSyncExternalStore(subscribe, getConsentSnapshot, getServerSnapshot);

  const accept = () => {
    localStorage.setItem('lyra-cookie-consent', 'accepted');
    window.dispatchEvent(new Event('storage'));
  };

  const decline = () => {
    localStorage.setItem('lyra-cookie-consent', 'declined');
    window.dispatchEvent(new Event('storage'));
  };

  if (consent !== 'none') return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-stone-200 shadow-lg">
      <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-[var(--color-muted)] flex-1">
          Lyra uses essential cookies for authentication. We also use anonymous analytics to improve the service.
          Read our <Link href="/privacy" className="text-[var(--color-sage)] hover:underline">Privacy Policy</Link>.
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={decline} className="px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors">
            Essential only
          </button>
          <button onClick={accept} className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
