/**
 * SEC-120 — the rate-limit bucket key must not be attacker-supplied.
 *
 * CONFIRMED LIVE 2026-08-04, which is what makes this more than hygiene:
 *   * `curl -sSI https://lyra-kohl.vercel.app/` -> HTTP 200, `server: Vercel`,
 *     **no `cf-ray`** — the origin answers directly, bypassing Cloudflare.
 *   * Vercel Deployment Protection is entirely off — no password, no Vercel
 *     Authentication, no trusted IPs.
 *
 * So an actor reaching the origin rotates `cf-connecting-ip` per request and
 * mints a fresh bucket each time. Mutation-proven before the fix: 0 of 200
 * blocked rotating, against 20 of 30 with a stable key.
 *
 * The endpoint that matters is `/oauth/register` — INTENTIONALLY UNAUTHENTICATED
 * by its own header, naming "Capped per-IP rate limit" as a mitigation, and
 * `sharedRateLimit` is genuinely cross-instance there, so the IP key is the
 * ONLY thing making the 5-clients/hour cap bite.
 *
 * WHY THE UNCONFIGURED BRANCH KEEPS LEGACY BEHAVIOUR
 * ---------------------------------------------------
 * Through Cloudflare, Vercel's `x-forwarded-for` is a CF EDGE ip. Switching an
 * unconfigured deployment to prefer it would bucket every real request by edge
 * IP and rate-limit the entire user base — trading an abuse vector for an
 * outage. So the hardening activates when the edge is configured, and until
 * then this is explicitly no worse than before. Case 1 pins that promise.
 */
import { clientIp, transitedCloudflare, CF_PROXY_HEADER } from '@/lib/client-ip';

const SECRET = 'edge-secret-abc';
const REAL = '203.0.113.9';
const SPOOF = '198.51.100.7';

const ORIGINAL = process.env.CF_PROXY_SECRET;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CF_PROXY_SECRET;
  else process.env.CF_PROXY_SECRET = ORIGINAL;
});

function headers(h: Record<string, string>): Headers {
  return new Headers(h);
}

describe('clientIp — unconfigured edge (legacy behaviour preserved)', () => {
  beforeEach(() => {
    delete process.env.CF_PROXY_SECRET;
  });

  it('keeps the legacy precedence so an unconfigured deploy is unchanged', () => {
    // The promise this file makes to the founder: shipping the fix before
    // configuring the edge changes nothing.
    expect(
      clientIp(headers({ 'cf-connecting-ip': REAL, 'x-forwarded-for': '10.0.0.1' })),
    ).toBe(REAL);
  });

  it('falls through to x-forwarded-for when no CF header is present', () => {
    expect(clientIp(headers({ 'x-forwarded-for': `${REAL}, 10.0.0.1` }))).toBe(REAL);
  });

  it('reports the request as NOT provably via Cloudflare', () => {
    expect(transitedCloudflare(headers({ 'cf-connecting-ip': REAL }))).toBe(false);
  });
});

describe('clientIp — configured edge', () => {
  beforeEach(() => {
    process.env.CF_PROXY_SECRET = SECRET;
  });

  it('trusts cf-connecting-ip when the shared secret matches', () => {
    const h = headers({ [CF_PROXY_HEADER]: SECRET, 'cf-connecting-ip': REAL });

    expect(transitedCloudflare(h)).toBe(true);
    expect(clientIp(h)).toBe(REAL);
  });

  it('IGNORES a spoofed cf-connecting-ip when the secret is absent', () => {
    // The attack: direct to the Vercel origin, forging the CF header.
    const h = headers({ 'cf-connecting-ip': SPOOF, 'x-forwarded-for': REAL });

    expect(clientIp(h)).toBe(REAL);
    expect(clientIp(h)).not.toBe(SPOOF);
  });

  it('IGNORES a spoofed cf-connecting-ip when the secret is WRONG', () => {
    const h = headers({
      [CF_PROXY_HEADER]: 'guessed-wrong',
      'cf-connecting-ip': SPOOF,
      'x-forwarded-for': REAL,
    });

    expect(clientIp(h)).toBe(REAL);
  });

  it('is not fooled by cf-ray alone — only the secret counts', () => {
    // cf-ray is trivially forgeable by anyone already forging
    // cf-connecting-ip, so it is deliberately not treated as evidence.
    const h = headers({
      'cf-ray': 'a25b7d890ce8edfa-LHR',
      'cf-connecting-ip': SPOOF,
      'x-forwarded-for': REAL,
    });

    expect(clientIp(h)).toBe(REAL);
  });

  it('defeats the rotation attack: many forged IPs collapse to one bucket', () => {
    // Before the fix this produced 200 distinct buckets and the cap never
    // fired. With the edge configured, every forged request keys on the
    // platform-set forwarded address instead.
    const keys = new Set(
      Array.from({ length: 200 }, (_, i) =>
        clientIp(headers({ 'cf-connecting-ip': `7.7.${i >> 8}.${i & 255}`, 'x-forwarded-for': REAL })),
      ),
    );

    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(REAL);
  });
});
