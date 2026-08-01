/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the source-text
 * scans over `instrumentation-client.ts` in tests/unit/sentry-scaffold.test.ts.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. No DSN means **no SDK at all**. This file's own header documents that the
 *     kill switch IS clearing `NEXT_PUBLIC_SENTRY_DSN` — so "the gate is
 *     present" and "the gate works" must not be the same assertion.
 *  2. `sendDefaultPii: false`. Lyra holds personal data belonging to minors;
 *     shipping default PII to a third-party processor is a data-protection
 *     fault, not a config preference.
 *  3. Session replay is off in both modes. Replay captures form input.
 *  4. **`beforeSend` actually scrubs.** SEC-55 exists because OAuth secrets and
 *     PII were reaching Sentry. The invariant is not that a `beforeSend` key is
 *     present — it is that the function registered with the SDK removes secrets
 *     from a real event.
 *  5. `onRouterTransitionStart` is a safe no-op when Sentry is off, rather than
 *     a live SDK handle.
 *
 * WHY THIS IS STRONGER
 * --------------------
 * The old block asserted `src.toContain('sendDefaultPii: false')` and
 * `src.toContain('beforeSend')`. Consider the single most damaging regression
 * available here — wiring the hook to identity:
 *
 *     beforeSend: (event) => event,        // SEC-55 undone
 *
 * `toContain('beforeSend')` still matches. Every OAuth token in every error
 * event then ships to a third party, and the scan stays green. Invariant 4 is
 * the only one of the two that can see it.
 *
 * MUTATION PROOF (2026-08-01, each reverted)
 *   * `beforeSend: (event) => event`            -> case 4 reddens; scan green
 *   * `sendDefaultPii: true`                    -> case 2 reddens
 *   * hoist `Sentry.init` out of `if (dsn)`     -> case 1 reddens; scan green,
 *     because the literal `if (dsn)` is still in the file above it
 *   * `replaysSessionSampleRate: 1`             -> case 3 reddens
 */

const init = jest.fn();
const captureRouterTransitionStart = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  init: (...args: unknown[]) => init(...args),
  captureRouterTransitionStart,
}));

type InitOptions = {
  dsn?: string;
  sendDefaultPii?: boolean;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
  beforeSend?: (event: unknown) => unknown;
  beforeBreadcrumb?: (crumb: unknown) => unknown;
};

/**
 * The module initialises Sentry as an import side effect, so each case needs a
 * fresh module registry with the environment already in place.
 */
async function load(dsn: string | undefined) {
  jest.resetModules();
  init.mockClear();
  if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
  return import('../../instrumentation-client');
}

const DSN = 'https://abc123@o1.ingest.sentry.io/42';
const optionsFromInit = () => init.mock.calls[0][0] as InitOptions;

const ORIGINAL_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
afterAll(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
});

describe('Sentry client initialisation (behavioural, KAN-414 F4)', () => {
  it('does NOT initialise the SDK when no DSN is configured', async () => {
    await load(undefined);

    // The documented kill switch, exercised rather than described.
    expect(init).not.toHaveBeenCalled();
  });

  it('does NOT initialise for an empty-string DSN', async () => {
    // Vercel yields '' rather than undefined for a cleared variable, so this is
    // the shape the kill switch actually meets in production.
    await load('');

    expect(init).not.toHaveBeenCalled();
  });

  it('initialises exactly once with a DSN present', async () => {
    await load(DSN);

    expect(init).toHaveBeenCalledTimes(1);
    expect(optionsFromInit().dsn).toBe(DSN);
  });

  it('never sends default PII', async () => {
    await load(DSN);

    expect(optionsFromInit().sendDefaultPii).toBe(false);
  });

  it('keeps session replay fully off in both sampling modes', async () => {
    await load(DSN);

    const opts = optionsFromInit();
    // Replay records form input. Both rates must be 0, not just the session one.
    expect(opts.replaysSessionSampleRate).toBe(0);
    expect(opts.replaysOnErrorSampleRate).toBe(0);
  });

  it('registers a beforeSend that REMOVES a secret from a real event (SEC-55)', async () => {
    await load(DSN);

    const beforeSend = optionsFromInit().beforeSend;
    expect(typeof beforeSend).toBe('function');

    const scrubbed = beforeSend!({
      message: 'oauth failure',
      request: {
        url: 'https://checklyra.com/api/oauth/token?client_secret=SUPERSECRET',
        headers: { authorization: 'Bearer SUPERSECRET' },
      },
    });

    // The claim is about the OUTPUT, which is the only thing a text scan
    // cannot reach: an identity beforeSend passes every scan and fails here.
    expect(JSON.stringify(scrubbed)).not.toContain('SUPERSECRET');
  });

  it('registers a beforeBreadcrumb that scrubs too', async () => {
    await load(DSN);

    const beforeBreadcrumb = optionsFromInit().beforeBreadcrumb;
    expect(typeof beforeBreadcrumb).toBe('function');

    const scrubbed = beforeBreadcrumb!({
      category: 'fetch',
      data: { url: 'https://checklyra.com/cb?code=AUTHCODE123' },
    });

    // Breadcrumbs are the quieter leak: they ship attached to unrelated errors.
    expect(JSON.stringify(scrubbed)).not.toContain('AUTHCODE123');
  });

  it('exposes a harmless no-op router hook when Sentry is off', async () => {
    const mod = await load(undefined);

    expect(typeof mod.onRouterTransitionStart).toBe('function');
    // Next.js calls this on every App Router navigation, so with Sentry off it
    // must absorb the call rather than reach a live SDK handle.
    expect(() => mod.onRouterTransitionStart('/dashboard', 'push')).not.toThrow();
    expect(captureRouterTransitionStart).not.toHaveBeenCalled();
  });

  it('wires the real router hook when Sentry is on', async () => {
    const mod = await load(DSN);

    expect(mod.onRouterTransitionStart).toBe(captureRouterTransitionStart);
  });
});
