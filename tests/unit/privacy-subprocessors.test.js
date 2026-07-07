/**
 * SEC-73: the public privacy policy must disclose every active sub-processor
 * (Didit, Resend, Railway, Google, Cloudflare, Supabase, Vercel) and must
 * transparently describe the biometric age-assurance step and its Art. 9
 * explicit-consent basis. The policy must stay in sync with the internal
 * sub-processor register (docs/compliance/SUBPROCESSORS.md).
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
    for (const vendor of ['Supabase', 'Vercel', 'Cloudflare', 'Railway', 'Resend', 'Didit', 'Google']) {
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

describe('SEC-73: privacy policy — biometric age assurance', () => {
  const filePath = path.join(root, 'src/app/(legal)/privacy/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('has a dedicated age-assurance section', () => {
    expect(content).toContain('Age assurance');
  });

  test('discloses the biometric facial age-estimation step', () => {
    expect(content).toMatch(/biometric/i);
    expect(content).toMatch(/facial age-estimation|selfie/i);
  });

  test('identifies the data as special category under Art. 9', () => {
    expect(content).toMatch(/special.category/i);
    expect(content).toContain('Art. 9');
  });

  test('states the lawful condition is explicit consent (Art. 9(2)(a))', () => {
    expect(content).toMatch(/explicit consent/i);
    expect(content).toContain('Art. 9(2)(a)');
  });

  test('states Lyra never receives or stores the raw biometric image', () => {
    expect(content).toMatch(/never<\/?\w+>?\s*(receives|receive)/i);
    expect(content.toLowerCase()).toContain('age band');
  });

  test('names Didit as the age-assurance processor', () => {
    expect(content).toContain('Didit');
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
    for (const vendor of ['Supabase', 'Vercel', 'Cloudflare', 'Railway', 'Resend', 'Didit', 'Google']) {
      expect(policy).toContain(vendor);
      expect(register).toContain(vendor);
    }
  });
});
