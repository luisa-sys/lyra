'use client';

/**
 * KAN-487 — v0.8 profile editor unsaved-changes warning (spec v0.8 §1 "Warn
 * before abandoning unsaved changes"; plan §C "Unsaved-changes warning";
 * plan §D proposed copy).
 *
 * While `dirty`:
 *   - `beforeunload` asks the browser to confirm (it supplies its own text);
 *   - a document-level CAPTURE listener on clicks catches in-app `<a>` links
 *     (Next's `<Link>` included, since it renders an anchor) and asks
 *     `window.confirm(UNSAVED_COPY)`; Cancel stops the navigation.
 *     Which clicks are guarded is decided by the pure `shouldGuardLinkClick`
 *     (same-page hash links, new tabs, downloads and modified clicks pass);
 *   - Back / Forward: on becoming dirty a SENTINEL history entry (same URL,
 *     `state[HISTORY_GUARD_KEY] = true`) is pushed, so Back first lands on
 *     the editor's own entry and fires `popstate`. Then (`popstateStep`) the
 *     member is asked with the same copy: Cancel re-pushes the sentinel and
 *     stays; OK goes on back (`history.back()`). Same-page hash entries
 *     added while dirty are marked as sentinels too, so moving between them
 *     never asks. Once clean again the sentinel is popped
 *     (`historyGuardStep`).
 *
 * `allowLeave()` switches every guard off for a navigation the editor makes
 * itself (after Publish, or "Reload"), so the member is not asked twice.
 * Known gap (plan §H risk 8): `router.push` is not intercepted, and a
 * multi-step jump in the browser's history menu straight to another page is
 * routed by Next before the confirm can stop it.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  HISTORY_GUARD_KEY,
  UNSAVED_COPY,
  afterBackConfirm,
  historyGuardStep,
  isGuardState,
  popstateStep,
  shouldGuardLinkClick,
} from '@/modules/profile/editor/editor-shell';

function guardState(): Record<string, unknown> {
  const current = window.history.state;
  const base = typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};
  return { ...base, [HISTORY_GUARD_KEY]: true };
}

function pushSentinel(): void {
  window.history.pushState(guardState(), '', window.location.href);
}

export function useUnsavedGuard(dirty: boolean): { allowLeave: () => void } {
  const leaving = useRef(false);
  const ignoreNextPop = useRef(false);
  const dirtyRef = useRef(dirty);

  const allowLeave = useCallback(() => {
    leaving.current = true;
  }, []);

  // Sentinel entry: push on becoming dirty, pop once clean again.
  useEffect(() => {
    dirtyRef.current = dirty;
    if (dirty) leaving.current = false;
    const step = historyGuardStep({
      dirty,
      onSentinel: isGuardState(window.history.state),
      leaving: leaving.current,
    });
    if (step === 'push') {
      pushSentinel();
    } else if (step === 'pop') {
      ignoreNextPop.current = true;
      window.history.back();
    }
  }, [dirty]);

  // Back / Forward.
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const step = popstateStep({
        dirty: dirtyRef.current,
        landedOnSentinel: isGuardState(e.state),
        leaving: leaving.current,
        ignoreNext: ignoreNextPop.current,
      });
      ignoreNextPop.current = false;
      if (step === 'ignore') return;
      if (afterBackConfirm(window.confirm(UNSAVED_COPY)) === 'stay') {
        pushSentinel();
        return;
      }
      leaving.current = true;
      window.history.back();
    };
    // A same-page hash link followed while dirty: mark its entry as a
    // sentinel, so stepping back through hash entries never asks.
    const onHashChange = () => {
      if (dirtyRef.current && !leaving.current && !isGuardState(window.history.state)) {
        window.history.replaceState(guardState(), '', window.location.href);
      }
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  // Tab close / reload, and in-app links.
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      // Legacy browsers need a returnValue to show the prompt.
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || leaving.current) return;
      const target = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      const guard = shouldGuardLinkClick({
        href: target.href,
        target: target.getAttribute('target') ?? '',
        download: target.hasAttribute('download'),
        modified: e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        currentHref: window.location.href,
      });
      if (!guard) return;
      if (!window.confirm(UNSAVED_COPY)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      leaving.current = true;
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return { allowLeave };
}
