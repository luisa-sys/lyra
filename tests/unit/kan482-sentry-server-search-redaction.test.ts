/**
 * KAN-482 — DPIA §2a AD-6: the public search term (`/search?q=`) must not
 * reach Sentry from the SERVER or EDGE runtime either. Drives the real
 * `register()` in instrumentation.ts with a mocked SDK and feeds each
 * registered hook a /search payload; asserts on the OUTPUT (an identity hook,
 * or one registered without WEB_SCRUB_OPTIONS, goes red here).
 * The browser init is covered in sentry-client-init-behaviour.test.ts.
 */

const mockInit = jest.fn();
jest.mock('@sentry/nextjs', () => ({ init: (...a: unknown[]) => mockInit(...a) }));

type Hook = (v: unknown) => unknown;
type Opts = { beforeSend?: Hook; beforeBreadcrumb?: Hook; beforeSendTransaction?: Hook };

const TERM = 'Zebedee Primary Uniquename';
const URL_WITH_TERM = `https://checklyra.com/search?q=${encodeURIComponent(TERM)}`;

const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

async function optionsFor(runtime: 'nodejs' | 'edge'): Promise<Opts> {
  jest.resetModules();
  mockInit.mockClear();
  process.env = {
    ...saved,
    NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
    IS_SENTRY_ENABLED: 'true',
    NEXT_RUNTIME: runtime,
  };
  const mod = await import('../../instrumentation');
  await mod.register();
  expect(mockInit).toHaveBeenCalledTimes(1);
  return mockInit.mock.calls[0][0] as Opts;
}

describe.each(['nodejs', 'edge'] as const)('%s runtime', (runtime) => {
  const leaks = (v: unknown) => /zebedee|uniquename/i.test(JSON.stringify(v));

  test('beforeSend removes the term from request.url and query_string', async () => {
    const o = await optionsFor(runtime);
    const out = o.beforeSend!({ request: { url: URL_WITH_TERM, query_string: `q=${TERM}` } });
    expect(leaks(out)).toBe(false);
    // Positive control: the input really did carry the term.
    expect(leaks({ request: { url: URL_WITH_TERM } })).toBe(true);
  });

  test('beforeBreadcrumb removes the term from a navigation breadcrumb', async () => {
    const o = await optionsFor(runtime);
    expect(leaks(o.beforeBreadcrumb!({ category: 'navigation', data: { from: '/', to: URL_WITH_TERM } }))).toBe(false);
  });

  test('beforeSendTransaction removes the term from a transaction', async () => {
    const o = await optionsFor(runtime);
    const out = o.beforeSendTransaction!({
      transaction: 'GET /search',
      request: { url: URL_WITH_TERM },
      spans: [{ data: { 'http.target': `/search?q=${TERM}` } }],
    });
    expect(leaks(out)).toBe(false);
    expect(JSON.stringify(out)).toContain('GET /search');
  });
});
