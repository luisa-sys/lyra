/**
 * KAN-69a: PWA manifest + meta-tag regression guards.
 *
 * Static tests that protect the PWA-installability invariants. If a
 * future refactor silently drops the manifest reference or breaks one of
 * the required icon sizes, "Add to Home Screen" stops working on iOS or
 * Android — and the failure is invisible without the test, since the
 * web app keeps loading fine.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf-8'));
}

describe('KAN-69a — PWA manifest invariants', () => {
  test('public/manifest.webmanifest exists and is valid JSON', () => {
    expect(existsSync(resolve(ROOT, 'public/manifest.webmanifest'))).toBe(true);
    expect(() => readJson('public/manifest.webmanifest')).not.toThrow();
  });

  test('manifest declares the required PWA fields', () => {
    const m = readJson('public/manifest.webmanifest');
    expect(m.name).toBeDefined();
    expect(m.short_name).toBeDefined();
    expect(m.start_url).toBeDefined();
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBeDefined();
    expect(m.background_color).toBeDefined();
    expect(m.icons).toBeDefined();
    expect(Array.isArray(m.icons)).toBe(true);
  });

  test('manifest includes BOTH 192x192 and 512x512 icons (Lighthouse PWA minimum)', () => {
    const m = readJson('public/manifest.webmanifest');
    const icons = m.icons as Array<{ sizes: string; purpose?: string }>;
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  test('manifest includes a maskable icon', () => {
    // Maskable icons let Android apply its adaptive-icon masks without
    // cropping the Lyra mark. Required for the "polish" Lighthouse score.
    const m = readJson('public/manifest.webmanifest');
    const icons = m.icons as Array<{ purpose?: string }>;
    const maskable = icons.find((i) => i.purpose === 'maskable');
    expect(maskable).toBeDefined();
  });

  test('every icon file referenced in the manifest actually exists on disk', () => {
    const m = readJson('public/manifest.webmanifest');
    const icons = m.icons as Array<{ src: string }>;
    for (const icon of icons) {
      const path = resolve(ROOT, 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(path)).toBe(true);
      // Sanity: PNG files should be non-trivial in size (>1 KB).
      const stat = statSync(path);
      expect(stat.size).toBeGreaterThan(1024);
    }
  });

  test('start_url points at the dashboard with a source param', () => {
    // Install-on-home-screen launches start_url. We send users to their
    // dashboard rather than the marketing homepage; the `source=pwa` is
    // a telemetry hook so we can measure how often the installed app
    // gets opened vs the web entry points.
    const m = readJson('public/manifest.webmanifest');
    expect(m.start_url).toMatch(/^\/dashboard.*source=pwa/);
  });

  test('layout.tsx wires up the manifest, viewport, and install prompt', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/layout.tsx'), 'utf-8');
    expect(src).toMatch(/manifest:\s*['"]\/manifest\.webmanifest['"]/);
    expect(src).toMatch(/export\s+const\s+viewport/);
    expect(src).toMatch(/InstallPrompt/);
    // Maps to manifest theme_color — must match or the chrome flashes
    // a different colour during the install transition.
    expect(src).toMatch(/themeColor:\s*['"]#5F7256['"]/);
  });

  test('install-prompt component exists and only renders client-side', () => {
    const path = resolve(ROOT, 'src/app/install-prompt.tsx');
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, 'utf-8');
    expect(src).toMatch(/^['"]use client['"]/);
    // beforeinstallprompt + display-mode are the Chromium signals.
    expect(src).toContain('beforeinstallprompt');
    expect(src).toContain('display-mode');
    // iOS fallback — instructional copy rather than an API trigger.
    expect(src).toMatch(/Share/);
  });
});
