/**
 * KAN-359 — Documentation Definition-of-Done guard.
 *
 * Asserts the Documentation DoD is present across the runbook, CLAUDE.md, the PR
 * template, and the quarterly test audit so the guardrail cannot be silently
 * removed. Pure file-content assertions (same style as backup.test.js /
 * security-rotation-doc.test.ts). Net-new coverage; changes no existing test.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('KAN-359: Documentation Definition-of-Done is documented', () => {
  test('docs/RUNBOOK.md has the Documentation Definition-of-Done section', () => {
    const content = read('docs/RUNBOOK.md');
    expect(content).toContain('Documentation Definition-of-Done');
    expect(content).toContain('system map');
    expect(content).toContain('DOC_SYNC_HEALTHCHECK_ROUTINE');
  });

  test('CLAUDE.md carries the Documentation Definition-of-Done close-out checklist', () => {
    const content = read('CLAUDE.md');
    expect(content).toContain('Documentation Definition-of-Done');
    expect(content).toContain('Docs are part of "done"');
  });

  test('PR template has the docs/system-map DoD checklist item', () => {
    const content = read('.github/PULL_REQUEST_TEMPLATE.md');
    expect(content).toMatch(/Docs \/ system map updated/);
    expect(content).toContain('KAN-359');
  });

  test('TEST_AUDIT_2026Q2 records the doc-DoD gate', () => {
    const content = read('docs/TEST_AUDIT_2026Q2.md');
    expect(content).toContain('Documentation Definition-of-Done');
    expect(content).toContain('doc-dod.test.js');
  });
});
