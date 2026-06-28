/**
 * KAN-337 — betaInviteLink / buildBetaInviteLink.
 *
 * The dashboard surfaces a shareable /join deep-link carrying the skip-the-
 * waitlist code. On the prod family (beta + prod share the public front door)
 * the link always points at checklyra.com; on dev/stage it uses the env origin;
 * and it is null when the feature is off (no LYRA_INVITE_CODE).
 */
let mockInviteCode = '';
let mockSiteUrl = 'https://dev.checklyra.com';
let mockIsProdFamily = false;

jest.mock('@/lib/env', () => ({
  env: {
    inviteCode: () => mockInviteCode,
    siteUrl: () => mockSiteUrl,
  },
}));
jest.mock('@/lib/beta-access/flow', () => ({
  isProdFamily: () => mockIsProdFamily,
}));

import { betaInviteLink, buildBetaInviteLink } from '@/lib/beta-access/invite-link';

beforeEach(() => {
  mockInviteCode = '';
  mockSiteUrl = 'https://dev.checklyra.com';
  mockIsProdFamily = false;
});

describe('KAN-337 buildBetaInviteLink', () => {
  it('builds a /join link with the URL-encoded code', () => {
    expect(buildBetaInviteLink('https://checklyra.com', 'LYRA BETA')).toBe(
      'https://checklyra.com/join?code=LYRA%20BETA',
    );
  });
  it('strips a trailing slash from the origin', () => {
    expect(buildBetaInviteLink('https://checklyra.com/', 'X')).toBe('https://checklyra.com/join?code=X');
  });
});

describe('KAN-337 betaInviteLink', () => {
  it('returns null when no code is configured (feature off)', () => {
    mockInviteCode = '';
    expect(betaInviteLink()).toBeNull();
  });
  it('points at checklyra.com on the prod family (beta + prod share the front door)', () => {
    mockInviteCode = 'ABC123';
    mockIsProdFamily = true;
    mockSiteUrl = 'https://beta.checklyra.com';
    expect(betaInviteLink()).toBe('https://checklyra.com/join?code=ABC123');
  });
  it("uses the env's own origin off the prod family (dev/stage)", () => {
    mockInviteCode = 'ABC123';
    mockIsProdFamily = false;
    mockSiteUrl = 'https://dev.checklyra.com';
    expect(betaInviteLink()).toBe('https://dev.checklyra.com/join?code=ABC123');
  });
});
