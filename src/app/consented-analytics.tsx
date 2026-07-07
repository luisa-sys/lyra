'use client';

import { useSyncExternalStore } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import {
  analyticsAllowed,
  getConsentSnapshot,
  getServerConsentSnapshot,
  subscribeConsent,
} from './consent-state';

/**
 * SEC-72 — gate Vercel Analytics + Speed Insights behind the cookie-consent
 * choice. Previously both mounted unconditionally in layout.tsx, so the
 * banner's "Essential only" button changed nothing ("consent theatre"). Now
 * they render only once the visitor has chosen "Accept all"; declining, or
 * not choosing yet, keeps them off. The banner dispatches a 'storage' event
 * on every choice, which re-runs this component through useSyncExternalStore.
 */
export function ConsentedAnalytics() {
  const consent = useSyncExternalStore(
    subscribeConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  );

  if (!analyticsAllowed(consent)) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
