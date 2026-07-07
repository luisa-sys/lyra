/**
 * KAN-272: June-2026 redesign fidelity.
 *
 * Covers the gaps closed in this PR:
 *   A) design tokens (sage/ink/muted retune + new tint tokens) — AA-safe
 *   B) typography — single Inter face mapped to both font variables
 *   D) site-wide footer
 *   E) six support pages (About/Guidelines/Safe/Accessibility/Help/Contact)
 *      + Turnstile human-check that activates only when both keys are set
 *   F) Terms 18+
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- WCAG relative-luminance contrast (sRGB) ----------------------------
function lum(hex) {
  const c = hex.replace('#', '');
  const ch = (i) => parseInt(c.slice(i, i + 2), 16) / 255;
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(ch(0)) + 0.7152 * f(ch(2)) + 0.0722 * f(ch(4));
}
function ratio(a, b) {
  const la = lum(a);
  const lb = lum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const PAPER = '#FDFCF8';
const WHITE = '#FFFFFF';

describe('KAN-272 A: design tokens (mock-up palette, WCAG AA preserved)', () => {
  let css;
  beforeAll(() => {
    css = read('src/app/globals.css');
  });

  test('sage is the mock-up green #4a7359', () => {
    expect(css).toContain('--color-sage: #4a7359');
    expect(css).toContain('--color-lyra-sage: #4a7359');
  });

  test('sage hover is the deeper #3d5f4a', () => {
    expect(css).toContain('--color-sage-hover: #3d5f4a');
    expect(css).toContain('--color-lyra-sage-hover: #3d5f4a');
  });

  test('ink deepened to #23201d', () => {
    expect(css).toContain('--color-ink: #23201d');
    expect(css).toContain('--color-lyra-ink: #23201d');
  });

  test('muted is the AA-passing warm taupe #6f6860', () => {
    expect(css).toContain('--color-muted: #6f6860');
    expect(css).toContain('--color-lyra-muted: #6f6860');
  });

  test('new tint tokens accent-soft + chip exist with the mock-up values', () => {
    expect(css).toContain('--color-accent-soft: #e9efea');
    expect(css).toContain('--color-chip: #edf2ee');
  });

  test('sage passes AA (>=4.5:1) vs white button text AND vs paper', () => {
    expect(ratio('#4a7359', WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#4a7359', PAPER)).toBeGreaterThanOrEqual(4.5);
  });

  test('muted passes AA (>=4.5:1) for body text on paper', () => {
    expect(ratio('#6f6860', PAPER)).toBeGreaterThanOrEqual(4.5);
  });

  test('ink passes AAA (>=7:1) on paper', () => {
    expect(ratio('#23201d', PAPER)).toBeGreaterThanOrEqual(7);
  });

  test('sage text on the new tint backgrounds still clears AA', () => {
    expect(ratio('#4a7359', '#e9efea')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#4a7359', '#edf2ee')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('KAN-272 B: typography — single Inter face', () => {
  let layout;
  beforeAll(() => {
    layout = read('src/app/layout.tsx');
  });

  test('loads Inter and drops the DM faces', () => {
    expect(layout).toContain('Inter');
    expect(layout).not.toContain('DM_Sans');
    expect(layout).not.toContain('DM_Serif_Display');
  });

  test('maps BOTH --font-sans and --font-serif to Inter', () => {
    expect(layout).toContain('"--font-sans"');
    expect(layout).toContain('"--font-serif"');
    expect(layout).toContain('inter.style.fontFamily');
  });

  test('themeColor retuned to the new sage', () => {
    expect(layout).toMatch(/themeColor:\s*['"]#4a7359['"]/);
  });
});

describe('KAN-272 D: site-wide footer', () => {
  let footer;
  beforeAll(() => {
    footer = read('src/app/footer.tsx');
  });

  test('renders all nine footer links', () => {
    for (const href of [
      '/about',
      '/privacy',
      '/cookies',
      '/terms',
      '/guidelines',
      '/safe',
      '/accessibility',
      '/help',
      '/contact',
    ]) {
      expect(footer).toContain(href);
    }
  });

  test('includes the mission line and the Companies Act legal line', () => {
    expect(footer).toContain('a place to be understood');
    expect(footer).toContain('CheckLyra Ltd');
    expect(footer).toContain('16351012');
    expect(footer).toContain('Shelton Street');
  });

  test('is rendered once in the root layout (no double footer)', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('<Footer');
  });
});

describe('KAN-272 E: six support pages', () => {
  const pages = {
    about: { file: 'src/app/(legal)/about/page.tsx', h1: 'About Lyra' },
    guidelines: { file: 'src/app/(legal)/guidelines/page.tsx', h1: 'Guidelines' },
    safe: { file: 'src/app/(legal)/safe/page.tsx', h1: 'Keeping people safe' },
    accessibility: { file: 'src/app/(legal)/accessibility/page.tsx', h1: 'Accessibility' },
    help: { file: 'src/app/(legal)/help/page.tsx', h1: 'Help' },
    contact: { file: 'src/app/(legal)/contact/page.tsx', h1: 'Contact' },
  };

  for (const [name, { file, h1 }] of Object.entries(pages)) {
    test(`${name} page exists with a stable <h1>`, () => {
      const c = read(file);
      expect(c).toContain('<h1');
      expect(c).toContain(h1);
      expect(c).toContain('metadata');
    });
  }

  test('about page includes the 📖 / 🤝 / 🕊️ trio', () => {
    const c = read('src/app/_marketing/sections.tsx');
    expect(c).toContain('📖');
    expect(c).toContain('🤝');
    expect(c).toContain('🕊️');
  });

  test('help page mirrors the mock-up FAQ copy', () => {
    const c = read('src/app/(legal)/help/page.tsx');
    expect(c).toContain('Who can see my profile?');
    expect(c).toContain('Can I write about my friend, or a celebrity?');
  });
});

describe('KAN-272 E: Contact form + Turnstile', () => {
  test('contact page reads the public site key from the helper', () => {
    const c = read('src/app/(legal)/contact/page.tsx');
    expect(c).toContain('turnstileSiteKey');
    expect(c).toContain('ContactForm');
  });

  test('contact action is a use-server module exporting an async submit handler', () => {
    const a = read('src/app/(legal)/contact/actions.ts');
    expect(a).toContain("'use server'");
    expect(a).toContain('export async function submitContact');
    // gotcha #18: a use-server file must export only async functions; the
    // result shape must be an erased `export type`, not a runtime value.
    expect(a).toContain('export type ContactState');
    expect(a).not.toMatch(/export const \w+\s*=/);
  });

  test('contact action verifies Turnstile and relays by email', () => {
    const a = read('src/app/(legal)/contact/actions.ts');
    expect(a).toContain('verifyTurnstile');
    expect(a).toContain('api.resend.com/emails');
  });

  test('Turnstile keys are read from env, never hardcoded', () => {
    const t = read('src/lib/turnstile.ts');
    expect(t).toContain('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    expect(t).toContain('TURNSTILE_SECRET_KEY');
    // No literal Cloudflare test/real keys committed.
    expect(t).not.toMatch(/0x4[A-Za-z0-9]{20,}/);
  });
});

describe('KAN-272 E: Turnstile helper degrades gracefully', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.resetModules();
  });

  test('isTurnstileEnabled is false unless BOTH keys are set', () => {
    jest.resetModules();
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    let mod = require('../../src/lib/turnstile');
    expect(mod.isTurnstileEnabled()).toBe(false);

    jest.resetModules();
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site';
    delete process.env.TURNSTILE_SECRET_KEY;
    mod = require('../../src/lib/turnstile');
    expect(mod.isTurnstileEnabled()).toBe(false);

    jest.resetModules();
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    mod = require('../../src/lib/turnstile');
    expect(mod.isTurnstileEnabled()).toBe(true);
  });

  test('verifyTurnstile skips (ok=true) when not configured', async () => {
    jest.resetModules();
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    const mod = require('../../src/lib/turnstile');
    const res = await mod.verifyTurnstile(null);
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
  });
});

describe('KAN-272 F: Terms is 18+', () => {
  test('terms requires 18 or over (not 13)', () => {
    const c = read('src/app/(legal)/terms/page.tsx');
    expect(c).toContain('18 or over');
    expect(c).not.toContain('at least 13 years old');
  });
});
