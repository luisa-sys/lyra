/**
 * SEC-73: the public privacy policy must disclose every active sub-processor
 * (Resend, Railway, Google, Cloudflare, Supabase, Vercel) and must accurately
 * describe how Lyra establishes that a user is 18+. The policy must stay in
 * sync with the internal sub-processor register (docs/compliance/SUBPROCESSORS.md).
 *
 * KAN-407 (2026-07-20): the biometric age-assurance assertions below were
 * INVERTED, not deleted. Lyra removed the Didit facial age-estimation check, so
 * a policy that still described biometric special-category processing would be
 * describing something that does not happen — the opposite compliance failure.
 * The suite now locks in the absence of that processing, and Didit is no longer
 * an active sub-processor.
 *
 * These are compliance-locking assertions (UK GDPR Arts. 9, 13-14). If one
 * breaks, raise with Luisa before changing it — do not weaken the assertion.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('SEC-73: privacy policy — sub-processor disclosure', () => {
  const filePath = path.join(root, 'src/app/(legal)/privacy/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('names every active infrastructure processor', () => {
    for (const vendor of ['Supabase', 'Vercel', 'Cloudflare', 'Railway', 'Resend', 'Google']) {
      expect(content).toContain(vendor);
    }
  });

  test('describes what each newly-added processor does', () => {
    expect(content).toMatch(/Railway/);
    expect(content).toMatch(/MCP/); // Railway hosts the MCP servers
    expect(content).toMatch(/Resend/);
    expect(content).toMatch(/transactional email|sign-in link/i);
    expect(content).toMatch(/Google[^]*?(sign-in|calendar)/i);
  });

  test('no longer claims data never leaves the UK/EU', () => {
    // The old wording ("We do not transfer data outside the UK/EU") was
    // inaccurate given US-based processors. It must be gone.
    expect(content).not.toMatch(/do not transfer data outside the UK\/EU/i);
  });

  test('discloses the international-transfer safeguard', () => {
    expect(content).toMatch(/UK Addendum/i);
    expect(content).toMatch(/Standard Contractual Clauses|International Data Transfer Agreement/i);
  });
});

describe('KAN-407: privacy policy — 18+ self-declaration (no biometric)', () => {
  const filePath = path.join(root, 'src/app/(legal)/privacy/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('has a dedicated age section', () => {
    expect(content).toContain('<h2>Age (18+)</h2>');
  });

  test('states plainly that the user confirms they are 18 or over', () => {
    expect(content).toMatch(/18 or over/i);
    expect(content).toMatch(/confirm/i);
  });

  test('is honest that this is a self-declaration, not a verified check', () => {
    // Overstating a self-declaration as a verified age check would itself be a
    // misleading-notice problem. Lock the honesty in.
    expect(content).toMatch(/self-declaration/i);
    expect(content).toMatch(/not an independently verified check|not a verified/i);
  });

  test('states that no DOB, document, or biometric is collected', () => {
    expect(content).toMatch(/do not ask for your date of birth/i);
    expect(content).toMatch(/identity documents/i);
    expect(content).toMatch(/facial scanning|biometric/i);
  });

  test('states Lyra holds no Art. 9 special-category data', () => {
    expect(content).toMatch(/no special-category data/i);
    expect(content).toContain('Article 9');
  });

  test('names no age-verification vendor at all', () => {
    // Simplicity principle (founder, 2026-07-21): the policy describes what Lyra
    // does NOW. Users never needed to know about the retired provider, so no
    // vendor name — including the removed one — belongs in the user-facing copy.
    expect(content).not.toContain('Didit');
  });

  test('makes no claim that Lyra performs — or ever performed — a biometric or provider age check', () => {
    expect(content).not.toMatch(/Art\. 9\(2\)\(a\)/);
    expect(content).not.toMatch(/we (use|run) (a )?biometric/i);
    // No "age band" anywhere: not as a current collection, and no longer as a
    // past-tense change note either (that note was removed for simplicity).
    expect(content).not.toMatch(/age band/i);
  });
});

describe('SEC-73: policy stays in sync with the sub-processor register', () => {
  const registerPath = path.join(root, 'docs/compliance/SUBPROCESSORS.md');
  const policyPath = path.join(root, 'src/app/(legal)/privacy/page.tsx');

  test('register exists', () => {
    expect(fs.existsSync(registerPath)).toBe(true);
  });

  test('every processor vendor named in the policy also appears in the register', () => {
    const register = fs.readFileSync(registerPath, 'utf8');
    const policy = fs.readFileSync(policyPath, 'utf8');
    for (const vendor of ['Supabase', 'Vercel', 'Cloudflare', 'Railway', 'Resend', 'Google']) {
      expect(policy).toContain(vendor);
      expect(register).toContain(vendor);
    }
  });
});
