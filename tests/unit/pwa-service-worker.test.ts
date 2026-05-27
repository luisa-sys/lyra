/**
 * KAN-213 P9 — PWA service worker + Convene shortcuts tests.
 *
 * Structural tests on sw.js, offline.html, manifest.webmanifest, and
 * the registration component. Runtime SW behaviour (install/activate/
 * fetch interception) is exercised manually in a real browser after
 * deploy.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');

describe('public/sw.js (KAN-213 P9)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');

  test('exists + has a CACHE_VERSION constant for cache busting', () => {
    expect(src).toMatch(/CACHE_VERSION/);
  });

  test('registers install + activate + fetch handlers', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]install['"]/);
    expect(src).toMatch(/addEventListener\(\s*['"]activate['"]/);
    expect(src).toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  test('install calls skipWaiting so updates roll out immediately', () => {
    expect(src).toMatch(/skipWaiting/);
  });

  test('activate prunes old caches matching the lyra- prefix', () => {
    expect(src).toMatch(/caches\s*\.keys\(\)/);
    expect(src).toMatch(/n\.startsWith\(['"]lyra-['"]\)/);
    expect(src).toMatch(/caches\.delete/);
  });

  test('fetch handler skips auth-sensitive paths (api/oauth/auth/dashboard/r/login)', () => {
    expect(src).toMatch(/url\.pathname\.startsWith\(['"]\/api['"]\)/);
    expect(src).toMatch(/url\.pathname\.startsWith\(['"]\/oauth['"]\)/);
    expect(src).toMatch(/url\.pathname\.startsWith\(['"]\/auth['"]\)/);
    expect(src).toMatch(/url\.pathname\.startsWith\(['"]\/dashboard['"]\)/);
    expect(src).toMatch(/url\.pathname\.startsWith\(['"]\/r\/['"]\)/);
    expect(src).toMatch(/url\.pathname === ['"]\/login['"]/);
  });

  test('only handles GET — POSTs / API calls go straight to network', () => {
    expect(src).toMatch(/req\.method !== ['"]GET['"]/);
  });

  test('cross-origin requests bypass the SW', () => {
    expect(src).toMatch(/url\.origin !== self\.location\.origin/);
  });

  test('serves /offline.html on network-fail HTML navigations', () => {
    expect(src).toMatch(/\/offline\.html/);
    expect(src).toMatch(/req\.mode === ['"]navigate['"]/);
  });

  test('only caches static assets (png/svg/webmanifest/woff2) on the fly', () => {
    expect(src).toMatch(/\.png/);
    expect(src).toMatch(/\.svg/);
    expect(src).toMatch(/\.webmanifest/);
    expect(src).toMatch(/\.woff2/);
  });
});

describe('public/offline.html (KAN-213 P9)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/offline.html'), 'utf8');
  test('exists', () => {
    expect(src).toBeTruthy();
  });
  test('declares lang + viewport for iOS Safari', () => {
    expect(src).toMatch(/lang="en-GB"/);
    expect(src).toMatch(/viewport-fit=cover/);
  });
  test('links the manifest so it can still be installed offline', () => {
    expect(src).toMatch(/rel="manifest" href="\/manifest\.webmanifest"/);
  });
  test('uses inline styles only (no network needed)', () => {
    expect(src).not.toMatch(/<link rel="stylesheet"/);
  });
});

describe('manifest.webmanifest Convene shortcuts (KAN-213 P9)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
  test('has the Convene gatherings shortcut', () => {
    const urls = m.shortcuts.map((s: { url: string }) => s.url);
    expect(urls).toContain('/dashboard/convene/gatherings?source=pwa');
  });
  test('has the Convene connections shortcut', () => {
    const urls = m.shortcuts.map((s: { url: string }) => s.url);
    expect(urls).toContain('/dashboard/convene/connections?source=pwa');
  });
  test('original profile + search shortcuts preserved', () => {
    const urls = m.shortcuts.map((s: { url: string }) => s.url);
    expect(urls).toContain('/dashboard/profile?source=pwa');
    expect(urls).toContain('/search?source=pwa');
  });
});

describe('service-worker-register component (KAN-213 P9)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/service-worker-register.tsx'), 'utf8');
  test("declares 'use client'", () => {
    expect(src).toMatch(/^['"]use client['"]/);
  });
  test('skips when serviceWorker unsupported', () => {
    expect(src).toMatch(/['"]serviceWorker['"] in navigator/);
  });
  test('skips in dev (NODE_ENV !== production)', () => {
    expect(src).toMatch(/NODE_ENV !== ['"]production['"]/);
  });
  test("registers /sw.js with scope '/'", () => {
    expect(src).toMatch(/register\(['"]\/sw\.js['"],\s*\{\s*scope:\s*['"]\/['"]/);
  });
});

describe('layout wires the registration component (KAN-213 P9)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8');
  test('imports + renders ServiceWorkerRegister', () => {
    expect(src).toMatch(/import\s*\{\s*ServiceWorkerRegister\s*\}\s*from\s*['"]\.\/service-worker-register['"]/);
    expect(src).toMatch(/<ServiceWorkerRegister\s*\/>/);
  });
});
