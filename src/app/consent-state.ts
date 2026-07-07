// SEC-72 — shared cookie-consent state.
//
// Single source of truth for how Lyra reads the visitor's cookie-consent
// choice, and for the one rule that decides whether non-essential analytics
// may run. The banner (cookie-consent.tsx) writes the choice; the analytics
// gate (consented-analytics.tsx) reads it through here so the two can never
// drift apart. Kept free of React-component imports so the pure decision is
// unit-testable in the node test environment.

/** localStorage key the banner writes and the gate reads. */
export const CONSENT_STORAGE_KEY = 'lyra-cookie-consent';

// 'pending' — SSR / not yet hydrated; 'none' — no choice made yet;
// 'accepted' — Accept all; 'declined' — Essential only.
export type ConsentValue = 'pending' | 'none' | 'accepted' | 'declined';

/** Client-side snapshot of the persisted choice. */
export function getConsentSnapshot(): ConsentValue {
  if (typeof window === 'undefined') return 'pending';
  return (localStorage.getItem(CONSENT_STORAGE_KEY) as ConsentValue) || 'none';
}

/** Server render always sees 'pending' so hydration matches. */
export function getServerConsentSnapshot(): ConsentValue {
  return 'pending';
}

/** cookie-consent.tsx dispatches a 'storage' event on every choice. */
export function subscribeConsent(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

/**
 * Non-essential analytics (Vercel Analytics + Speed Insights) may run ONLY
 * when the visitor has explicitly accepted. Every other state — no choice
 * yet, "Essential only" (declined), or SSR pending — means no analytics.
 * This is the line that makes the banner's "Essential only" button actually
 * do something instead of being consent theatre.
 */
export function analyticsAllowed(consent: ConsentValue): boolean {
  return consent === 'accepted';
}
