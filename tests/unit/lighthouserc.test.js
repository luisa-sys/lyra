/**
 * Tests for the SEO-assertion-level gating in lighthouserc.cjs.
 *
 * Staging is `noindex` by design (KAN-175), so Lighthouse's SEO category
 * scores ~0.69 against any non-production target. The config now demotes
 * the SEO assertion from `error` to `warn` whenever the target host
 * isn't on `checklyra.com`, so the staging-tests workflow stops failing
 * on a false positive.
 */

const path = require('path');

const RC_PATH = path.resolve(__dirname, '../../lighthouserc.cjs');

function loadConfig({ targetUrl, bypass = 'test-bypass-token' }) {
  // The config is cached on first require; isolate the module registry so
  // each call re-reads process.env. jest.isolateModules() is the supported
  // way to do this without poking at require.cache directly.
  let mod;
  jest.isolateModules(() => {
    const prevUrl = process.env.LHCI_TARGET_URL;
    const prevBypass = process.env.VERCEL_AUTOMATION_BYPASS;
    process.env.LHCI_TARGET_URL = targetUrl;
    process.env.VERCEL_AUTOMATION_BYPASS = bypass;
    try {
      mod = require(RC_PATH);
    } finally {
      if (prevUrl === undefined) delete process.env.LHCI_TARGET_URL;
      else process.env.LHCI_TARGET_URL = prevUrl;
      if (prevBypass === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS;
      else process.env.VERCEL_AUTOMATION_BYPASS = prevBypass;
    }
  });
  return mod;
}

function seoAssertionFor(config) {
  return config.ci.assert.assertions['categories:seo'];
}

describe('lighthouserc.cjs — SEO assertion gating (KAN-176 follow-up)', () => {
  test('checklyra.com root → SEO is enforced at error level', () => {
    const cfg = loadConfig({ targetUrl: 'https://checklyra.com/' });
    expect(seoAssertionFor(cfg)).toEqual(['error', { minScore: 0.9 }]);
  });

  test('beta.checklyra.com → SEO is enforced at error level', () => {
    const cfg = loadConfig({ targetUrl: 'https://beta.checklyra.com/' });
    expect(seoAssertionFor(cfg)).toEqual(['error', { minScore: 0.9 }]);
  });

  test('staging Vercel preview URL → SEO drops to warn (deliberately noindex)', () => {
    const cfg = loadConfig({
      targetUrl: 'https://lyra-rfgj4k15s-luisa-sys-projects.vercel.app/',
    });
    expect(seoAssertionFor(cfg)).toEqual(['warn', { minScore: 0.9 }]);
  });

  test('dev.checklyra.com → SEO is enforced (still on the checklyra.com apex)', () => {
    // dev.checklyra.com is technically noindex too, but the URL-only
    // heuristic can't distinguish — keep this honest. If/when dev SEO
    // becomes noisy this test will tell us we need a smarter check.
    const cfg = loadConfig({ targetUrl: 'https://dev.checklyra.com/' });
    expect(seoAssertionFor(cfg)).toEqual(['error', { minScore: 0.9 }]);
  });

  test('stage.checklyra.com → SEO is enforced (apex match)', () => {
    // Same caveat as dev — apex match doesn't distinguish indexability
    // by subdomain. In practice staging-tests targets the Vercel direct
    // URL, not stage.checklyra.com, so this branch isn't hit by CI.
    const cfg = loadConfig({ targetUrl: 'https://stage.checklyra.com/' });
    expect(seoAssertionFor(cfg)).toEqual(['error', { minScore: 0.9 }]);
  });

  test('malformed URL → SEO drops to warn (safe default)', () => {
    const cfg = loadConfig({ targetUrl: 'not a url' });
    expect(seoAssertionFor(cfg)).toEqual(['warn', { minScore: 0.9 }]);
  });

  test('other Lighthouse categories stay at error regardless of target', () => {
    const cfg = loadConfig({
      targetUrl: 'https://lyra-rfgj4k15s-luisa-sys-projects.vercel.app/',
    });
    const a = cfg.ci.assert.assertions;
    expect(a['categories:performance']).toEqual(['error', { minScore: 0.8 }]);
    expect(a['categories:accessibility']).toEqual(['error', { minScore: 0.9 }]);
    expect(a['categories:best-practices']).toEqual(['error', { minScore: 0.9 }]);
  });

  test('missing LHCI_TARGET_URL → load throws', () => {
    expect(() =>
      jest.isolateModules(() => {
        const prev = process.env.LHCI_TARGET_URL;
        delete process.env.LHCI_TARGET_URL;
        process.env.VERCEL_AUTOMATION_BYPASS = 'x';
        try {
          require(RC_PATH);
        } finally {
          if (prev !== undefined) process.env.LHCI_TARGET_URL = prev;
        }
      }),
    ).toThrow(/LHCI_TARGET_URL is not set/);
  });

  test('missing VERCEL_AUTOMATION_BYPASS → load throws', () => {
    expect(() =>
      jest.isolateModules(() => {
        const prev = process.env.VERCEL_AUTOMATION_BYPASS;
        delete process.env.VERCEL_AUTOMATION_BYPASS;
        process.env.LHCI_TARGET_URL = 'https://checklyra.com/';
        try {
          require(RC_PATH);
        } finally {
          if (prev !== undefined) process.env.VERCEL_AUTOMATION_BYPASS = prev;
        }
      }),
    ).toThrow(/VERCEL_AUTOMATION_BYPASS is not set/);
  });
});
