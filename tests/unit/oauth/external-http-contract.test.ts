/**
 * OAuth AS — the external HTTP contract. Prerequisite for the `oauth-as`
 * extraction (modularisation plan §8 D2, re-opened by RE-DECISION-2026-08-09).
 *
 * WHY THIS EXISTS
 * ---------------
 * The plan makes one thing a hard precondition of moving this module:
 *
 *   "Pin the external HTTP contract with a test first — claude.ai, Claude
 *    Desktop and both Railway services are outside CI."
 *
 * In the App Router a route's URL **is** its directory path under `src/app/`.
 * So relocating `src/app/oauth/token/route.ts` silently changes a live URL that
 * four consumers outside this repository depend on, and nothing in this repo
 * would fail.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `metadata.test.ts` already asserts the advertised endpoints:
 *
 *   expect(body.token_endpoint).toBe('https://dev.checklyra.com/oauth/token')
 *
 * That pins what the discovery document **says**. It does not pin that anything
 * answers there. Both sides are computed from `oauthConfig`, so if the route
 * file moved, the metadata would keep advertising `/oauth/token`, that
 * assertion would keep passing, and the endpoint would 404 — a green suite
 * describing a broken authorisation server.
 *
 * This file closes the loop: for every endpoint the AS advertises, a real
 * handler must exist at the path the URL implies. Mutation-proven by moving
 * `token/route.ts` and watching this redden while `metadata.test.ts` stayed
 * green.
 *
 * SCOPE
 * -----
 * This asserts route **existence and addressability**, not behaviour — the
 * twelve sibling files in `tests/unit/oauth/` cover behaviour. Existence is the
 * property a file move breaks, and the only one nothing else was checking.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { oauthConfig } from '@/lib/oauth/config';
import { SRC } from '../../support/source-paths';

const ROOT = resolve(__dirname, '../../..');
const APP = SRC.app;
const NEXT_CONFIG = 'next.config.ts';

/** The path part of an advertised absolute endpoint URL. */
const pathOf = (url: string): string => new URL(url).pathname;

/**
 * Every rewrite `next.config.ts` declares, as source → destination.
 *
 * Read from the file text rather than by importing the config: the module is
 * ESM/TS with Next-specific resolution, and the thing under test is the
 * committed declaration, not a runtime object.
 */
function rewrites(): Map<string, string> {
  const text = readFileSync(resolve(ROOT, NEXT_CONFIG), 'utf-8');
  const out = new Map<string, string>();
  const re = /source:\s*'([^']+)'\s*,\s*destination:\s*'([^']+)'/g;
  for (const m of text.matchAll(re)) out.set(m[1], m[2]);
  return out;
}

/** Resolve a URL path to the App Router file that must serve it, or null. */
function handlerFor(urlPath: string): string | null {
  const base = `${APP}${urlPath}`;
  for (const candidate of [
    `${base}/route.ts`,
    `${base}/route.tsx`,
    `${base}/page.tsx`,
  ]) {
    if (existsSync(resolve(ROOT, candidate))) return candidate;
  }
  return null;
}

/** Advertised endpoints, derived from the AS config — never hand-listed. */
const ADVERTISED: Record<string, string> = {
  authorization_endpoint: oauthConfig.authorizationEndpoint(),
  token_endpoint: oauthConfig.tokenEndpoint(),
  registration_endpoint: oauthConfig.registrationEndpoint(),
  revocation_endpoint: oauthConfig.revocationEndpoint(),
  jwks_uri: oauthConfig.jwksUri(),
};

describe('OAuth AS external HTTP contract', () => {
  it('advertises the endpoints this test claims to cover (not vacuous)', () => {
    // If oauthConfig were refactored so these came back empty or undefined,
    // every loop below would pass over nothing. Pin the shape first.
    expect(Object.keys(ADVERTISED)).toHaveLength(5);
    for (const [name, url] of Object.entries(ADVERTISED)) {
      expect(`${name}=${url}`).toMatch(/=https?:\/\//);
    }
  });

  it.each(['token_endpoint', 'registration_endpoint', 'revocation_endpoint'])(
    'has a handler serving the advertised %s',
    (name) => {
      const p = pathOf(ADVERTISED[name]);
      const handler = handlerFor(p);

      // A null here means the AS advertises a URL nothing answers on. That is
      // exactly what relocating the file out of src/app/ would produce.
      expect(`${p} -> ${handler ?? 'NO HANDLER'}`).toBe(`${p} -> ${handler}`);
      expect(handler).not.toBeNull();
    },
  );

  it('has a page serving the advertised authorization_endpoint', () => {
    // This one is a rendered page, not a route handler — and it is the reason
    // the oauth extraction trips the KAN-411 UI/copy gate.
    const p = pathOf(ADVERTISED.authorization_endpoint);
    expect(handlerFor(p)).toBe(`${APP}${p}/page.tsx`);
  });

  it('serves jwks_uri through a declared rewrite to a real handler', () => {
    // The canonical path is '.'-prefixed, which Next will not route as a
    // folder, so it is served via an internal rewrite (SEC-33). Two things can
    // break independently: the rewrite can be dropped, or its destination can
    // move. Assert both.
    const p = pathOf(ADVERTISED.jwks_uri);
    const dest = rewrites().get(p);

    expect(`${p} rewrite`).toBe(dest ? `${p} rewrite` : `${p} rewrite MISSING`);
    expect(dest).toBeDefined();
    expect(handlerFor(dest as string)).not.toBeNull();
  });

  it('serves the AS metadata document through a declared rewrite', () => {
    // /.well-known/oauth-authorization-server is how every MCP client
    // discovers this server. It is not in oauthConfig because it is the
    // document that publishes oauthConfig, so it is named here explicitly.
    const source = '/.well-known/oauth-authorization-server';
    const dest = rewrites().get(source);

    expect(dest).toBeDefined();
    expect(handlerFor(dest as string)).not.toBeNull();
  });

  it('keeps every advertised endpoint on the issuer origin', () => {
    // RFC 8414: metadata URLs must share the issuer's origin. A move that
    // introduced a differently-derived base URL would break client validation
    // before it broke anything visible here.
    const issuer = new URL(oauthConfig.issuer()).origin;
    for (const [name, url] of Object.entries(ADVERTISED)) {
      expect(`${name}:${new URL(url).origin}`).toBe(`${name}:${issuer}`);
    }
  });
});
