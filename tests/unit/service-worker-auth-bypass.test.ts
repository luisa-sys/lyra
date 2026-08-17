/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the fetch- and
 * activate-handler scans in tests/unit/pwa-service-worker.test.ts.
 *
 * WHY IT MATTERS
 * --------------
 * A service worker that intercepts an authed response can serve it back to a
 * different person on the same device. `public/sw.js` therefore refuses to
 * touch `/api`, `/oauth`, `/auth`, `/dashboard`, `/r/`, `/login`, `/signup`,
 * `/reset-password` and `/forgot-password`.
 *
 * WHAT THE SCAN CANNOT SEE
 * ------------------------
 * It asserts six `url.pathname.startsWith('…')` literals — and nothing else:
 *
 *   1. It never checks the guard **returns**. Keep the whole `if (…)` condition
 *      and delete the `return;` inside it and all six regexes still match,
 *      while every authed request starts being intercepted. That is the entire
 *      security property, and the scan is blind to it.
 *   2. Three of the nine paths — `/signup`, `/reset-password`,
 *      `/forgot-password` — are not asserted at all.
 *   3. The **cache allowlist is entirely unasserted**. Nothing stops `.html`
 *      being added to it, which would put rendered pages in a shared cache.
 *
 * HOW IT RUNS
 * -----------
 * `public/sw.js` is a browser worker script, not a module — there is nothing to
 * import. It is executed for real in a `node:vm` sandbox with a stub
 * `ServiceWorkerGlobalScope`, and the registered handlers are captured and
 * driven. The real file runs; nothing here reimplements it (CTL-038).
 *
 * MUTATION PROOF (2026-08-02, each reverted):
 *
 *   | mutation to public/sw.js                        | this suite | old scan |
 *   |-------------------------------------------------|------------|----------|
 *   | delete the `return;` in the auth guard           | 10 failed  | 21 PASS  |
 *   | drop `/dashboard` from the skip list             | 2 failed   | 1 failed |
 *   | cache rendered HTML as well as static assets     | 1 failed   | 21 PASS  |
 *   | `!n.endsWith(CACHE_VERSION)` -> `n.endsWith(…)`  | 1 failed   | 21 PASS  |
 *
 * Row 2 is worth stating plainly: **the scan does catch that one.** Dropping a
 * path removes the literal it greps for, so it is not blind to everything, and
 * this file is not a wholesale replacement for it.
 *
 * Row 1 is why the file exists. Deleting one `return;` while leaving the
 * condition intact removes the entire security property — every authed request
 * becomes interceptable — and all six of the scan's regexes still match. It
 * greps for the *test*, never for the *consequence*.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths.json';

const ORIGIN = 'https://checklyra.com';

type Handler = (event: Record<string, unknown>) => void;

interface Harness {
  handlers: Record<string, Handler>;
  deleted: string[];
  cachePuts: string[];
  skipWaitingCalled: boolean;
  claimCalled: boolean;
  setCacheKeys: (keys: string[]) => void;
}

/** Execute the REAL worker in a sandbox and capture what it registers. */
function loadWorker(): Harness {
  const source = readFileSync(resolve(__dirname, '../..', SRC.sw), 'utf-8');

  const handlers: Record<string, Handler> = {};
  const deleted: string[] = [];
  const cachePuts: string[] = [];
  let cacheKeys: string[] = [];
  const state = { skipWaiting: false, claim: false };

  const caches = {
    open: async () => ({
      addAll: async () => undefined,
      put: async (req: { url: string }) => void cachePuts.push(req.url),
    }),
    keys: async () => cacheKeys,
    delete: async (n: string) => void deleted.push(n),
    match: async () => undefined,
  };

  const self = {
    addEventListener: (name: string, fn: Handler) => void (handlers[name] = fn),
    skipWaiting: () => void (state.skipWaiting = true),
    clients: { claim: () => void (state.claim = true) },
    location: { origin: ORIGIN },
    caches,
  };

  const sandbox = {
    self,
    caches,
    URL,
    Promise,
    Error,
    console,
    fetch: async () => ({ ok: true, clone: () => ({}) }),
  };
  runInContext(source, createContext(sandbox));

  return {
    handlers,
    deleted,
    cachePuts,
    get skipWaitingCalled() {
      return state.skipWaiting;
    },
    get claimCalled() {
      return state.claim;
    },
    setCacheKeys: (k: string[]) => void (cacheKeys = k),
  } as Harness;
}

/** Drive the fetch handler; returns true if the SW INTERCEPTED the request. */
function intercepts(
  h: Harness,
  path: string,
  { method = 'GET', origin = ORIGIN } = {},
): boolean {
  let respondedWith = false;
  h.handlers.fetch({
    request: {
      url: `${origin}${path}`,
      method,
      mode: 'navigate',
      headers: { get: () => 'text/html' },
    },
    respondWith: (p: Promise<unknown>) => {
      respondedWith = true;
      // Swallow the stubbed-network rejection; interception is the claim.
      void Promise.resolve(p).catch(() => undefined);
    },
  });
  return respondedWith;
}

let sw: Harness;
beforeEach(() => {
  sw = loadWorker();
});

describe('service worker — never intercepts an authed response', () => {
  // Every path the worker lists, including the three the scan omits.
  const AUTH_PATHS = [
    '/api/profile',
    '/oauth/token',
    '/auth/callback',
    '/dashboard',
    '/dashboard/profile',
    '/r/abc123',
    '/login',
    '/signup',
    '/reset-password',
    '/forgot-password',
  ];

  it.each(AUTH_PATHS)('passes %s straight to the network', (path) => {
    // A cached authed response can be served to a different person on a shared
    // device. The guard must RETURN, not merely test the path.
    expect(intercepts(sw, path)).toBe(false);
  });

  it('does intercept an ordinary public page, so the guard is not a blanket opt-out', () => {
    // Without this, deleting the whole fetch handler would pass every case
    // above — the suite would prove nothing.
    expect(intercepts(sw, '/ada')).toBe(true);
  });

  it('ignores non-GET requests', () => {
    expect(intercepts(sw, '/ada', { method: 'POST' })).toBe(false);
  });

  it('ignores cross-origin requests', () => {
    expect(intercepts(sw, '/ada', { origin: 'https://evil.test' })).toBe(false);
  });
});

describe('service worker — cache hygiene', () => {
  it('install calls skipWaiting so a fix rolls out immediately', async () => {
    const waits: Promise<unknown>[] = [];
    sw.handlers.install({ waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);

    expect(sw.skipWaitingCalled).toBe(true);
  });

  it('activate prunes stale lyra- caches but keeps the current version', async () => {
    sw.setCacheKeys([
      'lyra-static-v0-old',
      'lyra-static-v1-2026-05-18',
      'someone-elses-cache',
    ]);
    const waits: Promise<unknown>[] = [];
    sw.handlers.activate({ waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);

    expect(sw.deleted).toContain('lyra-static-v0-old');
    // Deleting the live cache on every activate would evict the offline shell
    // the worker just installed; touching another origin's cache is worse.
    expect(sw.deleted).not.toContain('lyra-static-v1-2026-05-18');
    expect(sw.deleted).not.toContain('someone-elses-cache');
    expect(sw.claimCalled).toBe(true);
  });

  it('caches static assets but NOT rendered HTML', async () => {
    intercepts(sw, '/lyra-icon-192.png');
    intercepts(sw, '/ada');
    await new Promise((r) => setTimeout(r, 0));

    expect(sw.cachePuts.some((u) => u.endsWith('.png'))).toBe(true);
    // An HTML page in a shared cache is the same exposure as an authed
    // response, one step removed. The scan asserts nothing about this list.
    expect(sw.cachePuts.some((u) => u.endsWith('/ada'))).toBe(false);
  });
});
