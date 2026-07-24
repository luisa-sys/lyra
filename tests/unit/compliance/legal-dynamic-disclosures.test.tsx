/**
 * KAN-408: the public privacy + cookie policies disclose the Sovrn affiliate
 * processor IFF paid referrals are enabled for this environment. These tests
 * drive the pages off a mocked GLOBAL SWITCH TABLE and assert the rendered
 * affiliate disclosure appears/disappears with the switch.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// @swc/jest compiles the legal pages with the classic JSX runtime (they don't
// import React themselves — Next uses the automatic runtime in prod), so make
// React resolvable as a global for the React.createElement calls at render time.
(globalThis as unknown as { React: typeof React }).React = React;

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) =>
    React.createElement('a', { href: String(href) }, children),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt?: string; src: unknown }) =>
    React.createElement('img', { alt, src: String(src) }),
}));

const mockGetGlobalSwitches = jest.fn();
jest.mock('@/lib/features/global-switches-service', () => ({
  getGlobalSwitches: (...a: unknown[]) => mockGetGlobalSwitches(...a),
}));

import PrivacyPolicyPage from '@/app/(legal)/privacy/page';
import CookiePolicyPage from '@/app/(legal)/cookies/page';

type Switches = { mcp: boolean; convene: boolean; paid_gift_links: boolean; age_verification: boolean };
const withPaid = (on: boolean): Switches => ({
  mcp: true,
  convene: true,
  paid_gift_links: on,
  age_verification: false,
});

beforeEach(() => jest.clearAllMocks());

async function privacyHtml(paidOn: boolean): Promise<string> {
  mockGetGlobalSwitches.mockResolvedValue(withPaid(paidOn));
  return renderToStaticMarkup(await PrivacyPolicyPage());
}
async function cookiesHtml(paidOn: boolean): Promise<string> {
  mockGetGlobalSwitches.mockResolvedValue(withPaid(paidOn));
  return renderToStaticMarkup(await CookiePolicyPage());
}

describe('privacy policy — affiliate disclosure driven by the global switch (KAN-408)', () => {
  it('paid referrals ON → Sovrn affiliate section present', async () => {
    const html = await privacyHtml(true);
    expect(html).toContain('Affiliate partners');
    expect(html).toContain('Sovrn Commerce');
    // core processors always disclosed
    expect(html).toContain('Supabase');
  });

  it('paid referrals OFF → Sovrn affiliate section removed, core processors intact', async () => {
    const html = await privacyHtml(false);
    expect(html).not.toContain('Sovrn');
    expect(html).not.toContain('Affiliate partners');
    expect(html).toContain('Supabase');
    expect(html).toContain('Vercel');
  });
});

describe('cookie policy — affiliate section driven by the global switch (KAN-408)', () => {
  it('paid referrals ON → Sovrn affiliate-cookies section present', async () => {
    const html = await cookiesHtml(true);
    expect(html).toContain('Affiliate links');
    expect(html).toContain('Sovrn Commerce');
  });

  it('paid referrals OFF → affiliate-cookies section removed, essential-cookies content intact', async () => {
    const html = await cookiesHtml(false);
    expect(html).not.toContain('Sovrn');
    expect(html).not.toContain('Affiliate links');
    expect(html).toContain('essential cookies');
  });
});
