/**
 * KAN-295 exit-gate audit — consolidation write-up presence/structure test.
 *
 * The 2026-07 security audit re-run was executed as five read-only autopilot
 * legs (DB / app-route / MCP / CI-CD / workstation) whose evidence lives in the
 * KAN-295 Jira comments. docs/SECURITY_AUDIT_2026-07.md consolidates those legs
 * into one repo-side artefact. This test guards that artefact against silent
 * deletion or hollowing-out (a placeholder/stub would defeat the point — cf.
 * the Workflow & Backup Integrity Policy: a summary that looks present but is
 * empty is worse than no summary).
 *
 * It asserts structure only — not prose wording — so ordinary edits to the
 * narrative don't break it, but a missing leg, a dropped finding, or a stub do.
 */

const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, '../..', 'docs/SECURITY_AUDIT_2026-07.md');

describe('KAN-295 audit consolidation doc (docs/SECURITY_AUDIT_2026-07.md)', () => {
  let doc;

  beforeAll(() => {
    doc = fs.readFileSync(DOC, 'utf8');
  });

  it('exists and is not a stub', () => {
    expect(fs.existsSync(DOC)).toBe(true);
    // Real consolidation, not a placeholder: comfortably over the KAN-167
    // "too-short stub" floor.
    expect(doc.split('\n').length).toBeGreaterThan(60);
  });

  it('is anchored to KAN-295 and the 2026-06-21 baseline', () => {
    expect(doc).toMatch(/KAN-295/);
    expect(doc).toMatch(/2026-06-21/);
  });

  it('documents all five read-only legs', () => {
    for (const leg of [
      /Database/i,
      /App-route|server-action/i,
      /MCP-tool layer/i,
      /CI\/CD/i,
      /Workstation/i,
    ]) {
      expect(doc).toMatch(leg);
    }
  });

  it('tabulates every new finding filed this cycle (SEC-80..86)', () => {
    for (const key of ['SEC-80', 'SEC-81', 'SEC-82', 'SEC-83', 'SEC-84', 'SEC-85', 'SEC-86']) {
      expect(doc).toMatch(new RegExp(key));
    }
  });

  it('records the sole High finding and the workstation PASS', () => {
    expect(doc).toMatch(/High/);
    // Leg E produced no findings — the doc must say so, not imply findings.
    expect(doc).toMatch(/PASS/);
  });

  it('has a non-regressed baseline section', () => {
    expect(doc).toMatch(/non-regressed/i);
    // F-numbers from the baseline report must be cited as still-holding.
    expect(doc).toMatch(/F-01|F-13|F-22/);
  });

  it('is honest that this is not the KAN-295 sign-off', () => {
    // The exit-gate go/no-go + the dated Confluence page remain Luisa-gated;
    // the doc must not claim the audit is closed.
    expect(doc).toMatch(/not the KAN-295 sign-off|Luisa-gated|not the .* sign-off/i);
    expect(doc).toMatch(/In Progress/);
  });
});
