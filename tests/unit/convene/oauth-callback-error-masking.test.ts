/**
 * SEC-76 (web-oauth-6) + SEC-115 — no Convene OAuth route echoes internal
 * error detail to the caller.
 *
 * WHAT HAPPENED
 * -------------
 * SEC-76 fixed the two CALLBACK routes: they previously returned
 * `{ error: '<code>', detail: msg }` where `msg` could carry an upstream
 * provider response body or a Supabase/DB error string. They now log `msg`
 * server-side (via logStep) and return only the stable error code.
 *
 * The guard written alongside that fix listed its two targets by hand:
 *
 *     const callbacks = [SRC.callbackRoute, SRC.microsoftCallbackRoute];
 *
 * so it could only ever see the routes that happened to be in front of its
 * author. Both INITIATE routes carried the identical
 * `{ error: 'state_persist_failed', detail: error.message }` leak, on the same
 * line number, for the whole time this file reported green — SEC-115. That is
 * the same shape as the eight-ticket suspension-guard family in CLAUDE.md: a
 * fix applied at one call site and not its siblings.
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS
 * -------------------------------------
 *  1. **The corpus is DISCOVERED, never listed.** `git ls-files` over the
 *     Convene OAuth route directory is the corpus. A guard that names its
 *     targets will drift; a guard that discovers them cannot. A fifth provider
 *     added tomorrow is covered on the day its route file is committed, with
 *     nobody remembering to add it here.
 *  2. **The corpus is asserted non-empty and complete before it is iterated.**
 *     `describe.each([])` registers ZERO tests and an empty suite is green
 *     (catalogue failure mode 4) — so a discovery glob that silently stopped
 *     matching would turn this file into a no-op that still reports a tick.
 *  3. **Comments are stripped before matching.** `detail:` appears in the
 *     prose of the routes explaining why it must not appear in the code, so an
 *     unstripped `not.toMatch(/detail\s*:/)` would go red on the documentation
 *     of its own fix — and the mirror hazard, CTL-039, is that prose can
 *     SATISFY a positive assertion whose code has been deleted.
 *
 * The directory is derived from `SRC.callbackRoute` rather than written as a
 * fresh path literal, so a move of these routes is caught by the SRC manifest
 * integrity guard rather than silently narrowing this scan (gotcha #31).
 * Convene is permanently out of the KAN-415 modularisation, so in practice
 * these four paths are stable.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { SRC } from '../../support/source-paths';
import { stripComments } from '../../support/strip-comments';

const ROOT = path.join(__dirname, '..', '..', '..');

// src/app/api/convene/oauth — three levels up from <provider>/<leg>/route.ts.
const OAUTH_DIR = path.dirname(path.dirname(path.dirname(SRC.callbackRoute)));

/** Every tracked route file under the Convene OAuth tree. */
function discoverRoutes(): string[] {
  const out = execFileSync('git', ['ls-files', '--', `${OAUTH_DIR}/`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('/route.ts'))
    .sort();
}

const routes = discoverRoutes();
const callbacks = routes.filter((r) => r.includes('/callback/'));
const initiates = routes.filter((r) => r.includes('/initiate/'));

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'), '.ts');
}

describe('Convene OAuth route corpus', () => {
  // Assert the corpus BEFORE iterating it: an empty describe.each is green.
  test('discovers every Convene OAuth route', () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
    expect(callbacks.length).toBeGreaterThanOrEqual(2);
    expect(initiates.length).toBeGreaterThanOrEqual(2);
  });

  test('covers both legs of both providers', () => {
    for (const provider of ['google', 'microsoft']) {
      for (const leg of ['initiate', 'callback']) {
        expect(routes).toContain(`${OAUTH_DIR}/${provider}/${leg}/route.ts`);
      }
    }
  });

  test('the routes SEC-76 hand-listed are still in the discovered set', () => {
    expect(routes).toContain(SRC.callbackRoute);
    expect(routes).toContain(SRC.microsoftCallbackRoute);
    expect(routes).toContain(SRC.initiateRoute);
  });
});

describe.each(routes)('%s error masking', (rel) => {
  const src = read(rel);

  test('no error response includes a detail field', () => {
    // Catches `detail: msg`, `detail: e`, `detail:msg`, etc. in any response.
    expect(src).not.toMatch(/detail\s*:/);
  });

  test('the raw message is still logged server-side, not merely dropped', () => {
    // Masking must not lose the detail operationally — every route captures the
    // message and hands it to logStep. `reqId` is present on the callbacks and
    // absent on the initiates, so the arg list is matched loosely; `{ msg }` is
    // the part that matters.
    expect(src).toMatch(/logStep\([^)]*'\w+_failed',\s*\{\s*msg\s*[,}]/);
  });
});

describe.each(callbacks)('%s stable error codes', (rel) => {
  const src = read(rel);

  test('still returns the stable error codes', () => {
    expect(src).toMatch(/error:\s*'token_exchange_failed'/);
    expect(src).toMatch(/error:\s*'userinfo_failed'/);
    expect(src).toMatch(/error:\s*'persist_failed'/);
  });

  test('still logs the raw message server-side', () => {
    expect(src).toMatch(/logStep\(reqId, '\w+_failed', \{ msg \}\)/);
  });
});

describe.each(initiates)('%s stable error codes', (rel) => {
  const src = read(rel);

  test('still returns the stable state_persist_failed code', () => {
    expect(src).toMatch(/error:\s*'state_persist_failed'/);
  });
});
