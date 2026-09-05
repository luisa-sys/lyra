/**
 * SEC-4 — public status page.
 *
 * Structural guards: the page probes the MCP API live, and it is reachable on
 * every environment (exempt from the beta gate + allow-listed in the
 * maintenance worker).
 *
 * ⚠️ SCOPE — read before trusting this file as cover for "the status page is
 * honest". It is NOT. The header here used to claim the page "does a LIVE probe
 * (not a hard-coded 'operational')", which is true of the MCP row and false of
 * the Website row — the one SEC-96 instance 3 is about, which is still the
 * literal `{ ok: true, detail: 'Serving' }`. Prose asserting a property the code
 * does not have is exactly the shape CTL-039 exists to catch, and it read as
 * cover for the defect while the defect was live.
 *
 * Stated plainly rather than quietly fixed: nothing in this file asserts the
 * Website row. The readiness endpoint that lets it stop being a literal now
 * exists and is tested in `tests/unit/readiness-endpoint.test.ts`; wiring it
 * into this page is founder-owned under KAN-411 (`src/app/*.tsx`) and is
 * deliberately not done here.
 */
const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');
const { isExemptFrom } = require('@/modules/access/exemptions');

const root = path.join(__dirname, '../..');
const PAGE = fs.readFileSync(path.join(root, SRC.statusPage), 'utf8');
const MW = fs.readFileSync(path.join(root, SRC.middleware), 'utf8');
const WORKER = fs.readFileSync(path.join(root, SRC.lyraMaintenanceWorker), 'utf8');

describe('SEC-4 status page', () => {
  test('does a live MCP health probe, not a faked status', () => {
    expect(PAGE).toMatch(/mcp\.checklyra\.com\/health/);
    expect(PAGE).toMatch(/await fetch\(/);
    // honest: derives overall status from the probe results
    expect(PAGE).toMatch(/checks\.every/);
  });

  test('is exempt from the beta gate (public on beta)', () => {
    // REPOINTED, KAN-415 D4 C2b (approved 2026-08-09). This used to read
    // src/middleware.ts as source text and match `pathname === '/status'`. The
    // beta-gate exemptions moved into a declarative table, so that literal is
    // no longer in that file.
    //
    // The replacement is STRICTLY STRONGER. A toMatch on source text passes on
    // any stray mention — a comment, a variable name, a different gate's list —
    // whereas this asks the exemption table the actual question SEC-4 cares
    // about: is /status exempt from the beta gate? It would fail if the row
    // were deleted, if it were moved to the wrong gate, or if it were
    // misspelled, none of which the old assertion could distinguish.
    expect(isExemptFrom('beta-tier', '/status')).toBe(true);
    // And the inverse, which the old form could not express at all: /status is
    // NOT exempt from the suspension gate. A suspended user does not get a free
    // pass to the status page by virtue of it being public.
    expect(isExemptFrom('suspension', '/status')).toBe(false);
  });

  test('is allow-listed in the maintenance worker (reachable on prod)', () => {
    expect(WORKER).toMatch(/^\s*'\/status',\s*$/m);
  });
});
