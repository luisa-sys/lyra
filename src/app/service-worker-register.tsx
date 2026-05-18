'use client';

/**
 * Service-worker registration — KAN-213 P9.
 *
 * Mounted once at root layout level. Registers /sw.js on first page
 * load and lets the browser's installability heuristics take over.
 *
 * Why a separate component (not inline in layout): server-side render
 * has no navigator, and putting 'use client' on layout.tsx would force
 * the entire tree to client-render. This component is the only client
 * boundary needed.
 *
 * Guards:
 *   - Skips entirely in dev (NEXT_PUBLIC_VERCEL_ENV) so the SW doesn't
 *     interfere with hot reload.
 *   - Skips when serviceWorker is unavailable (older browsers, certain
 *     embedded WebViews).
 *   - Fire-and-forget registration: errors are logged but never thrown.
 */

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    // Skip SW in local dev — Next.js's HMR is incompatible with aggressive
    // SW caching, and dev environments should never accidentally install
    // a long-lived SW that survives a deploy of broken code.
    if (
      process.env.NODE_ENV !== 'production' ||
      process.env.NEXT_PUBLIC_VERCEL_ENV === 'development'
    ) {
      return;
    }
    const controller = navigator.serviceWorker;
    controller
      .register('/sw.js', { scope: '/' })
      .then(() => {
        // No-op on success. Logging would clutter most users' devtools.
      })
      .catch((err) => {
        // Non-fatal — the app works fine without a SW.
        console.warn('[sw] registration failed:', err);
      });
  }, []);
  return null;
}
