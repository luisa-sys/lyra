/**
 * KAN-466 — the security-lockdown inventory must agree with itself.
 *
 * The drift this ticket was raised from: `lyra-admin-mcp-server` is a deployed,
 * prod-service-role-holding, highest-privilege service that appeared in NO
 * inventory in docs/. Two failures made that possible and neither could go red:
 *
 *  1. The inventory line in ARCHITECTURE.md and the "N services to verify
 *     (KAN-24)" count are written in two places, by hand, and nothing compared
 *     them. A ticket adding one and forgetting the other reads as complete.
 *  2. A provider entry claimed coverage that its CYBER_LOCKDOWN.md checklist did
 *     not deliver — §Railway named `lyra-mcp-server` as *the* service while three
 *     exist. That is the SEC-79 presence-badge shape one level down: the badge is
 *     on the provider, and the hole is inside it.
 *
 * So this asserts both directions of the claim ARCHITECTURE.md now makes:
 * the inventory enumerates PROVIDERS, its stated count matches its enumeration,
 * every enumerated provider has a checklist section, and the provider that
 * absorbs an extra deployed service actually names that service.
 *
 * Mutation-proven (see the PR): reverting §Railway's service list to
 * `lyra-mcp-server` alone reddens the coverage case; changing "7 services" to 8
 * without touching the enumeration reddens the count case.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ARCH = fs.readFileSync(path.join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8');
const LOCKDOWN = fs.readFileSync(path.join(ROOT, 'docs/CYBER_LOCKDOWN.md'), 'utf8');

/**
 * The enumeration is the line immediately following the inventory heading.
 * Parsed rather than restated here — a copy in the test is a copy that drifts.
 */
function inventoryEntries() {
  const m = ARCH.match(
    /^### Service inventory for security lockdown\n(.+)$/m
  );
  if (!m) throw new Error('inventory heading or its enumeration line not found in docs/ARCHITECTURE.md');
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "Supabase (x3)" -> "Supabase"; "Atlassian/Jira" -> "Atlassian". */
function providerName(entry) {
  return entry.replace(/\s*\(.*?\)\s*/g, '').split('/')[0].trim();
}

const lockdownHeadings = LOCKDOWN.split('\n')
  .filter((l) => l.startsWith('## '))
  .map((l) => l.slice(3).trim());

describe('security-lockdown inventory (KAN-466)', () => {
  const entries = inventoryEntries();

  // Failure mode 4: a parameterised test over an empty list registers nothing
  // and an empty suite is green. Assert the corpus before iterating it.
  test('the inventory enumerates a plausible number of providers', () => {
    expect(entries.length).toBeGreaterThanOrEqual(5);
  });

  test('the stated KAN-24 count equals the number of enumerated providers', () => {
    const m = ARCH.match(/2FA audit incomplete — (\d+) services to verify \(KAN-24\)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(entries.length);
  });

  test.each(entries)('provider %s has a checklist section in CYBER_LOCKDOWN.md', (entry) => {
    const name = providerName(entry);
    expect(name.length).toBeGreaterThan(0);
    const matched = lockdownHeadings.filter((h) => h.startsWith(name));
    expect(matched.length).toBeGreaterThan(0);
  });

  test('§Railway covers all three deployed Railway services, not just the user-facing one', () => {
    const start = LOCKDOWN.indexOf('\n## Railway\n');
    expect(start).toBeGreaterThan(-1);
    const rest = LOCKDOWN.slice(start + 1);
    const end = rest.indexOf('\n## ', 1);
    const section = end === -1 ? rest : rest.slice(0, end);

    // The admin MCP is in the lockdown estate BY BEING INSIDE THIS SECTION.
    // If it is not named here, ARCHITECTURE.md's "covered under Railway"
    // decision is a presence badge and the count of 7 is not honest.
    for (const service of ['lyra-mcp-server', 'lyra-mcp-dev', 'lyra-admin-mcp-server']) {
      expect(section).toContain(service);
    }
    // The admin service holds the prod service-role key and sits behind
    // Cloudflare Access; a checklist that names it but never checks the edge
    // is coverage in name only.
    expect(section).toContain('admin-mcp.checklyra.com');
    expect(section).toContain('ALLOW_CF_ACCESS_OFF');
  });
});

describe('ARCHITECTURE.md knows lyra-admin-mcp-server exists (KAN-466)', () => {
  test('it is a System Components entry with its own heading, not a passing mention', () => {
    const headings = ARCH.split('\n').filter((l) => /^#{2,3} /.test(l));
    expect(headings.some((h) => h.includes('lyra-admin-mcp-server'))).toBe(true);
  });

  test('the External Services Railway row names it', () => {
    const row = ARCH.split('\n').find((l) => /^\| Railway \|/.test(l));
    expect(row).toBeDefined();
    expect(row).toContain('lyra-admin-mcp-server');
  });
});
