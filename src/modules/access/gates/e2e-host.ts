/**
 * SEC-201 — the grey-cloud E2E aliases answer only to the test harness.
 *
 * `e2e-dev.checklyra.com` (develop) and `e2e-stage.checklyra.com` (staging) are
 * DNS-only CNAMEs straight to Vercel (KAN-348, docs/E2E_AUTHED_CF_BYPASS.md).
 * They exist because Cloudflare Bot Fight Mode challenges GitHub runner IPs on
 * the proxied hosts, and the free plan cannot except it. The side effect: their
 * traffic never passes through Cloudflare, so the Cloudflare Access apps that
 * gate dev.checklyra.com and stage.checklyra.com CANNOT cover them. Until this
 * gate, both served the full develop/staging app to anyone (found 2026-11-26
 * while fixing SEC-192).
 *
 * So on an `e2e-*` host, the request must carry `x-lyra-e2e-gate` equal to the
 * server-side `E2E_HOST_GATE_SECRET`. Everything else gets a bare 404 — the
 * same answer as a host that does not exist, which is what a walk-up visitor
 * should learn.
 *
 * FAIL CLOSED. If the secret is unset on the deployment, an e2e host answers
 * 404 to everyone, harness included. A missing env var must never reopen the
 * aliases; a red E2E run is the correct, loud symptom.
 *
 * FIRST IN THE PIPELINE. Ahead of the SEC-36 404, the PKCE redirect and the
 * rate limiter, because nothing on these hosts — not even a redirect — should
 * be served to an unauthenticated caller. It is typed `Gate<EdgeContext>`, so
 * it cannot consult a session even by mistake.
 *
 * Every other host returns `null` here and is unaffected.
 */
import { NextResponse } from 'next/server';
import type { EdgeContext } from '../context';
import type { Gate } from '../gate';

/** The header the harness sends. Fixed, so only the value is secret. */
export const E2E_GATE_HEADER = 'x-lyra-e2e-gate';

/** `e2e-dev.checklyra.com`, `e2e-stage.checklyra.com`, and any future `e2e-*` alias. */
const E2E_HOST = /^e2e-[a-z0-9-]+\.checklyra\.com$/;

/** Host header, lowercased, without a port. */
export function isE2eHost(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, '');
  return E2E_HOST.test(host);
}

/**
 * Constant-time string comparison. The edge runtime has no
 * crypto.timingSafeEqual, so compare every byte and fold the differences.
 * Length is not secret (the secret's length is fixed), so an early length
 * mismatch is fine.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

export const e2eHost: Gate<EdgeContext> = {
  id: 'e2e-host',
  ticket: 'SEC-201',
  why: 'The grey-cloud E2E aliases bypass Cloudflare Access; only the test harness may use them.',
  run: (ctx) => {
    if (!isE2eHost(ctx.request.headers.get('host'))) return null;
    const secret = ctx.env.e2eHostGateSecret;
    if (!secret) return notFound();
    const presented = ctx.request.headers.get(E2E_GATE_HEADER);
    if (presented === null || !constantTimeEqual(presented, secret)) return notFound();
    return null;
  },
};
