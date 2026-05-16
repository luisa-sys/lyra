'use client';

import { useEffect, useState } from 'react';

/**
 * KAN-69a: PWA install prompt.
 *
 * Browser support shape:
 *   - Chromium browsers (Chrome, Edge, Brave, Samsung Internet) fire a
 *     `beforeinstallprompt` event when the site is installable. We catch it,
 *     prevent the default mini-infobar, and stash the event so the user can
 *     trigger the prompt from a button at a moment of their choosing.
 *   - iOS Safari doesn't expose `beforeinstallprompt`. There's no API to
 *     trigger Add to Home Screen — only the user can do it from the Share
 *     menu. We show a one-time hint with the Share icon + instructions.
 *   - Desktop browsers: shown but de-emphasized; install on desktop is a
 *     real thing, just less commonly used.
 *
 * Anti-noise rules:
 *   - Only shown to users who DON'T already have the app installed (we
 *     detect via `display-mode: standalone` media query).
 *   - Once dismissed, stored in localStorage so the prompt doesn't keep
 *     reappearing. The user can still install via browser menu.
 *   - Defers initial render by a frame so it doesn't compete with the
 *     critical content for first paint.
 */

const DISMISS_KEY = 'lyra-pwa-install-dismissed';

// Chromium's beforeinstallprompt is not in the standard TypeScript DOM lib.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type Mode = 'hidden' | 'chromium' | 'ios';

export function InstallPrompt() {
  const [mode, setMode] = useState<Mode>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already running as an installed PWA.
    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }
    // Honour previous dismissal.
    if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY) === '1') {
      return;
    }

    const handler = (e: Event) => {
      // The Chromium mini-infobar would otherwise appear at the bottom of
      // the screen, which conflicts with our cookie-consent banner.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode('chromium');
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS Safari fallback: detect via UA + non-standalone display mode.
    // Imperfect but iOS doesn't expose a better signal short of feature
    // detection that's only meaningful AFTER install.
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !/Android/.test(ua);
    const isInWebView = /(WebView|wv)/.test(ua); // exclude embedded webviews
    if (isIOS && !isInWebView) {
      // Defer one frame so we don't compete with critical content.
      const t = setTimeout(() => setMode('ios'), 800);
      return () => {
        window.removeEventListener('beforeinstallprompt', handler);
        clearTimeout(t);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
    setMode('hidden');
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setMode('hidden');
  }

  if (mode === 'hidden') return null;

  return (
    <div
      role="dialog"
      aria-labelledby="install-prompt-title"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm z-40 bg-white rounded-2xl shadow-lg border border-stone-200 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0" aria-hidden>📲</span>
        <div className="flex-1 min-w-0">
          <p id="install-prompt-title" className="text-sm font-medium text-[var(--color-ink)]">
            Install Lyra
          </p>
          <p className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">
            {mode === 'chromium' ? (
              "Add Lyra to your home screen for a faster, full-screen experience."
            ) : (
              <>
                Tap <span aria-hidden>􀈂</span> Share, then &ldquo;Add to Home Screen&rdquo; to install Lyra.
              </>
            )}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {mode === 'chromium' && (
              <button
                type="button"
                onClick={install}
                className="px-3 py-1.5 rounded-full bg-[var(--color-lyra-sage)] text-white text-xs font-medium hover:bg-[var(--color-lyra-sage-hover)] transition-colors"
              >
                Install
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
            >
              {mode === 'chromium' ? 'Not now' : 'Got it'}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-stone-400 hover:text-stone-600 transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  );
}
