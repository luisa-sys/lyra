/**
 * Tests for the security audit workflow scripts and configuration.
 * KAN-150: Weekly security audit with email alerts.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

/** Helper: run python3 script with paths safely quoted for shell */
function runPython(scriptPath, ...args) {
  const quotedArgs = args.map(a => `'${a}'`).join(' ');
  return execSync(`python3 '${scriptPath}' ${quotedArgs}`, { encoding: 'utf8' });
}

describe('KAN-150: Security Audit Workflow', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/security-audit.yml');
  const emailScriptPath = path.join(__dirname, '../../scripts/audit-to-email.py');
  let workflowContent;
  let workflowYaml;

  beforeAll(() => {
    workflowContent = fs.readFileSync(workflowPath, 'utf8');
    workflowYaml = yaml.load(workflowContent);
  });

  describe('Workflow configuration', () => {
    test('workflow file exists', () => {
      expect(fs.existsSync(workflowPath)).toBe(true);
    });

    test('scheduled for Wednesday 07:00 UTC', () => {
      const schedule = workflowYaml.on.schedule;
      expect(schedule).toBeDefined();
      expect(schedule[0].cron).toBe('0 7 * * 3');
    });

    test('has workflow_dispatch for manual runs', () => {
      expect(workflowYaml.on.workflow_dispatch).toBeDefined();
    });

    test('uses SHA-pinned Actions (no version tags)', () => {
      const usesLines = workflowContent.match(/uses:\s+\S+/g) || [];
      usesLines.forEach(line => {
        // Each 'uses:' should have a SHA hash (40 hex chars), not just a tag
        expect(line).toMatch(/@[a-f0-9]{40}/);
      });
    });

    test('uses npm audit with --json flag', () => {
      expect(workflowContent).toContain('npm audit --json');
    });

    test('emails only when vulnerabilities are found', () => {
      // The email step should have a conditional
      expect(workflowContent).toContain("if: steps.report.outputs.has_vulns == 'true'");
    });

    test('uses RESEND_API_KEY secret', () => {
      expect(workflowContent).toContain('RESEND_API_KEY');
      expect(workflowContent).toContain('secrets.RESEND_API_KEY');
    });

    test('fails workflow on high/critical vulnerabilities', () => {
      expect(workflowContent).toContain('exit 1');
      expect(workflowContent).toContain('high_critical_count');
    });

    test('writes to step summary', () => {
      expect(workflowContent).toContain('$GITHUB_STEP_SUMMARY');
    });
  });

  describe('Email script (audit-to-email.py)', () => {
    test('script file exists', () => {
      expect(fs.existsSync(emailScriptPath)).toBe(true);
    });

    test('outputs no-vuln payload for clean audit', () => {
      // Create a clean audit result
      const cleanAudit = {
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }
        },
        vulnerabilities: {}
      };
      const tmpFile = path.join('/tmp', 'test-clean-audit.json');
      fs.writeFileSync(tmpFile, JSON.stringify(cleanAudit));

      const output = runPython(emailScriptPath, tmpFile);
      const result = JSON.parse(output.trim());
      expect(result.has_vulnerabilities).toBe(false);
      expect(result.to).toBeUndefined(); // No email fields when clean

      fs.unlinkSync(tmpFile);
    });

    test('outputs email payload for audit with high vulnerability', () => {
      const vulnAudit = {
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 0, total: 2 }
        },
        vulnerabilities: {
          'next': {
            name: 'next',
            severity: 'high',
            fixAvailable: true,
            via: [{ title: 'DoS via Server Components', url: 'https://github.com/advisories/GHSA-test' }]
          },
          'lodash': {
            name: 'lodash',
            severity: 'moderate',
            fixAvailable: true,
            via: [{ title: 'Prototype Pollution', url: 'https://github.com/advisories/GHSA-test2' }]
          }
        }
      };
      const tmpFile = path.join('/tmp', 'test-vuln-audit.json');
      fs.writeFileSync(tmpFile, JSON.stringify(vulnAudit));

      const output = runPython(emailScriptPath, tmpFile);
      const result = JSON.parse(output.trim());

      expect(result.has_vulnerabilities).toBe(true);
      expect(result.to).toEqual(['luisa@santos-stephens.com']);
      expect(result.from).toContain('Lyra Security');
      expect(result.subject).toContain('1 vulnerabilities found');
      expect(result.html).toContain('next');
      expect(result.html).toContain('HIGH');
      // Should NOT include moderate-only vulns in the table
      expect(result.html).not.toContain('MODERATE');

      fs.unlinkSync(tmpFile);
    });

    test('outputs email payload for critical vulnerability', () => {
      const criticalAudit = {
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 }
        },
        vulnerabilities: {
          'react': {
            name: 'react',
            severity: 'critical',
            fixAvailable: true,
            via: [{ title: 'RCE in Server Components', url: 'https://github.com/advisories/GHSA-crit' }]
          }
        }
      };
      const tmpFile = path.join('/tmp', 'test-critical-audit.json');
      fs.writeFileSync(tmpFile, JSON.stringify(criticalAudit));

      const output = runPython(emailScriptPath, tmpFile);
      const result = JSON.parse(output.trim());

      expect(result.has_vulnerabilities).toBe(true);
      expect(result.subject).toContain('1 vulnerabilities found');
      expect(result.html).toContain('CRITICAL');
      expect(result.html).toContain('#dc2626'); // Red colour for critical

      fs.unlinkSync(tmpFile);
    });

    test('handles invalid JSON gracefully', () => {
      const tmpFile = path.join('/tmp', 'test-bad-audit.json');
      fs.writeFileSync(tmpFile, 'not json');

      const output = runPython(emailScriptPath, tmpFile);
      const result = JSON.parse(output.trim());
      expect(result.has_vulnerabilities).toBe(false);

      fs.unlinkSync(tmpFile);
    });

    test('handles missing file gracefully', () => {
      const output = runPython(emailScriptPath, '/tmp/nonexistent-file-12345.json');
      const result = JSON.parse(output.trim());
      expect(result.has_vulnerabilities).toBe(false);
    });
  });
});
