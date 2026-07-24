/**
 * KAN-274 / KAN-276 / KAN-278 — env helpers for the beta access programme.
 *
 * These pin the INERT-by-default contract:
 *   - cookieDomain() → undefined unless COOKIE_DOMAIN is set, then the value.
 *   - betaRoutingEnabled() → only true for the literal string 'true'.
 *   - betaAppUrl / betaQueueNotifyEmail have the documented defaults.
 *
 * `env` reads process.env lazily (functions, not module-load constants), so
 * we can mutate process.env per-test and re-require.
 */

describe('KAN-274 env.cookieDomain', () => {
  const ORIGINAL = process.env.COOKIE_DOMAIN;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = ORIGINAL;
    jest.resetModules();
  });

  test('returns undefined when COOKIE_DOMAIN is unset (host-scoped default)', () => {
    delete process.env.COOKIE_DOMAIN;
    const { env } = require('@/lib/env');
    expect(env.cookieDomain()).toBeUndefined();
  });

  test('returns undefined when COOKIE_DOMAIN is empty string', () => {
    process.env.COOKIE_DOMAIN = '';
    const { env } = require('@/lib/env');
    expect(env.cookieDomain()).toBeUndefined();
  });

  test('returns the value when COOKIE_DOMAIN is set', () => {
    process.env.COOKIE_DOMAIN = '.checklyra.com';
    const { env } = require('@/lib/env');
    expect(env.cookieDomain()).toBe('.checklyra.com');
  });
});

describe('KAN-278 env.betaRoutingEnabled', () => {
  const ORIGINAL = process.env.BETA_ROUTING_ENABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BETA_ROUTING_ENABLED;
    else process.env.BETA_ROUTING_ENABLED = ORIGINAL;
    jest.resetModules();
  });

  test('false when unset (inert by default)', () => {
    delete process.env.BETA_ROUTING_ENABLED;
    const { env } = require('@/lib/env');
    expect(env.betaRoutingEnabled()).toBe(false);
  });

  test('false for any value other than the literal "true"', () => {
    process.env.BETA_ROUTING_ENABLED = 'TRUE';
    const { env } = require('@/lib/env');
    expect(env.betaRoutingEnabled()).toBe(false);
    process.env.BETA_ROUTING_ENABLED = '1';
    jest.resetModules();
    const { env: env2 } = require('@/lib/env');
    expect(env2.betaRoutingEnabled()).toBe(false);
  });

  test('true only for the exact string "true"', () => {
    process.env.BETA_ROUTING_ENABLED = 'true';
    const { env } = require('@/lib/env');
    expect(env.betaRoutingEnabled()).toBe(true);
  });
});

describe('KAN-276 env beta defaults', () => {
  const ORIGINAL_URL = process.env.BETA_APP_URL;
  const ORIGINAL_EMAIL = process.env.BETA_QUEUE_NOTIFY_EMAIL;

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.BETA_APP_URL;
    else process.env.BETA_APP_URL = ORIGINAL_URL;
    if (ORIGINAL_EMAIL === undefined) delete process.env.BETA_QUEUE_NOTIFY_EMAIL;
    else process.env.BETA_QUEUE_NOTIFY_EMAIL = ORIGINAL_EMAIL;
    jest.resetModules();
  });

  test('betaAppUrl defaults to https://beta.checklyra.com', () => {
    delete process.env.BETA_APP_URL;
    const { env } = require('@/lib/env');
    expect(env.betaAppUrl()).toBe('https://beta.checklyra.com');
  });

  test('betaAppUrl honours an override', () => {
    process.env.BETA_APP_URL = 'https://beta.example.test';
    const { env } = require('@/lib/env');
    expect(env.betaAppUrl()).toBe('https://beta.example.test');
  });

  test('betaQueueNotifyEmail defaults to luisa@santos-stephens.com', () => {
    delete process.env.BETA_QUEUE_NOTIFY_EMAIL;
    const { env } = require('@/lib/env');
    expect(env.betaQueueNotifyEmail()).toBe('luisa@santos-stephens.com');
  });
});
