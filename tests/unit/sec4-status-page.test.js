/**
 * SEC-4 — public status page.
 *
 * Structural guards: the page does a LIVE probe (not a hard-coded "operational"),
 * and it is reachable on every environment (exempt from the beta gate + allow-listed
 * in the maintenance worker).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const PAGE = fs.readFileSync(path.join(root, 'src/app/status/page.tsx'), 'utf8');
const MW = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8');
const WORKER = fs.readFileSync(path.join(root, 'scripts/lyra-maintenance-worker.js'), 'utf8');

describe('SEC-4 status page', () => {
  test('does a live MCP health probe, not a faked status', () => {
    expect(PAGE).toMatch(/mcp\.checklyra\.com\/health/);
    expect(PAGE).toMatch(/await fetch\(/);
    // honest: derives overall status from the probe results
    expect(PAGE).toMatch(/checks\.every/);
  });

  test('is exempt from the beta gate (public on beta)', () => {
    expect(MW).toMatch(/pathname === '\/status'/);
  });

  test('is allow-listed in the maintenance worker (reachable on prod)', () => {
    expect(WORKER).toMatch(/^\s*'\/status',\s*$/m);
  });
});
