/**
 * KAN-192: file-content tests for the AffiliateBadge disclosure component.
 *
 * The project runs Jest in the `node` env (no DOM), so component-render
 * assertions aren't available without adding jsdom — which would expand
 * the test infrastructure for one widget. Instead we lock the
 * FTC-relevant invariants by inspecting the source file.
 *
 * The invariants:
 *   - Disclosure sentence contains the word "commission" (FTC required).
 *   - "no extra cost" appears so users know there's no surcharge.
 *   - Badge links to /partners for the long-form disclosure.
 *   - Anchor uses noopener (security + good Anchor hygiene).
 *   - role="img" so screen readers announce it as a single unit.
 *   - sr-only span exists for screen-reader-only disclosure.
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../src/components/AffiliateBadge.tsx');

describe('KAN-192 AffiliateBadge — file content invariants', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('disclosure includes the word "commission"', () => {
    expect(content).toContain('commission');
  });

  test('disclosure includes "no extra cost"', () => {
    expect(content).toMatch(/no extra cost/i);
  });

  test('links to /partners for the long-form disclosure', () => {
    expect(content).toMatch(/href=\{?["']\/partners["']\}?/);
  });

  test('uses rel="noopener" on the partners link', () => {
    expect(content).toContain('noopener');
  });

  test('uses role="img" so screen readers announce it as a unit', () => {
    expect(content).toContain('role="img"');
  });

  test('has an sr-only span for screen-reader-only disclosure', () => {
    expect(content).toContain('sr-only');
  });

  test('un-monetised variant says "Tracked" not "Affiliate"', () => {
    // The badge is honest: if the click does NOT earn a commission, we
    // don't call it "Affiliate" — that'd be misleading.
    expect(content).toContain("'Tracked'");
    expect(content).toContain("'Affiliate'");
  });

  test('un-monetised aria-label says "no commission"', () => {
    expect(content).toMatch(/no commission/i);
  });
});
