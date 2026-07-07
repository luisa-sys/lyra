/**
 * KAN-349 — the dashboard share widget has TWO versions: the existing
 * "Share beta access" card while the waitlist is in place (wording preserved),
 * and a sign-up-link version once the gate is removed. Plus publicSignupUrl.
 */
let mockInviteCode = '';
let mockSiteUrl = 'https://dev.checklyra.com';
let mockIsProdFamily = false;

jest.mock('@/lib/env', () => ({
  env: { inviteCode: () => mockInviteCode, siteUrl: () => mockSiteUrl },
}));
jest.mock('@/lib/beta-access/flow', () => ({ isProdFamily: () => mockIsProdFamily }));

import { publicSignupUrl } from '@/lib/beta-access/invite-link';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

beforeEach(() => {
  mockInviteCode = '';
  mockSiteUrl = 'https://dev.checklyra.com';
  mockIsProdFamily = false;
});

describe('KAN-349 publicSignupUrl', () => {
  it('points at checklyra.com/signup on the prod family', () => {
    mockIsProdFamily = true;
    mockSiteUrl = 'https://beta.checklyra.com';
    expect(publicSignupUrl()).toBe('https://checklyra.com/signup');
  });
  it("uses the env's own origin off the prod family (dev)", () => {
    expect(publicSignupUrl()).toBe('https://dev.checklyra.com/signup');
  });
});

describe('KAN-349 the existing beta share wording is preserved', () => {
  const shareBeta = read('src/app/dashboard/share-beta.tsx');
  it('keeps the exact "Share beta access" default title + waitlist description', () => {
    expect(shareBeta).toContain("title = 'Share beta access'");
    expect(shareBeta).toMatch(/skips the waitlist and drops them straight into the beta/);
  });
  it('supports a bare mode so it can embed in the W5 widget shell', () => {
    expect(shareBeta).toMatch(/bare\s*=\s*false/);
  });
});

describe('KAN-349 W5 renders both versions', () => {
  const widgets = read('src/app/dashboard/widgets/dashboard-widgets.tsx');
  it('shows the beta widget when a betaLink exists, else the sign-up version', () => {
    expect(widgets).toMatch(/ctx\.betaLink \?[\s\S]{0,400}ShareBeta inviteLink=\{ctx\.betaLink\}/);
    expect(widgets).toMatch(/inviteLink=\{ctx\.signupUrl\}[\s\S]{0,200}title="Share Lyra"/);
  });
});
