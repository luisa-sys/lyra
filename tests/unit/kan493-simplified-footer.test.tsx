/**
 * KAN-493 — simplified footer (About · Privacy · Terms · Contact) and the
 * legal pages folded into About, Privacy and Contact, with 308 redirects for
 * the old URLs. Founder decision 2026-11-25.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) =>
    React.createElement('a', { href: String(href), ...rest }, children),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt?: string; src: unknown }) =>
    React.createElement('img', { alt, src: String(src) }),
}));
const mockGetGlobalSwitches = jest.fn();
jest.mock('@/modules/features/global-switches-service', () => ({
  getGlobalSwitches: (...a: unknown[]) => mockGetGlobalSwitches(...a),
}));
jest.mock('@/app/(legal)/contact/contact-form', () => ({
  __esModule: true,
  ContactForm: () => React.createElement('form', { 'data-testid': 'contact-form' }),
}));
jest.mock('@/modules/guards/turnstile', () => ({ turnstileSiteKey: () => null }));

import { SRC } from '../support/source-paths';
import { Footer, FOOTER_LINKS } from '@/app/footer';
import { LEGAL_PAGE_REDIRECTS } from '@/modules/marketing-legal/legal-redirects';
import AboutPage from '@/app/(legal)/about/page';
import PrivacyPolicyPage from '@/app/(legal)/privacy/page';
import ContactPage from '@/app/(legal)/contact/page';

const root = path.join(__dirname, '../..');
const REMOVED = ['cookies', 'guidelines', 'safe', 'help', 'complaints', 'partners', 'accessibility'];

const switches = (paid: boolean) => ({ mcp: true, convene: true, paid_gift_links: paid, age_verification: false });

describe('KAN-493 footer', () => {
  const html = renderToStaticMarkup(React.createElement(Footer));
  const hrefs = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

  test('renders exactly About, Privacy, Terms, Contact, in that order', () => {
    expect(hrefs).toEqual(['/about', '/privacy', '/terms', '/contact']);
    expect(FOOTER_LINKS.map((l) => l.label)).toEqual(['About', 'Privacy', 'Terms', 'Contact']);
  });

  test('keeps the Companies Act company line', () => {
    expect(html).toContain('a trading name of CheckLyra Ltd');
    expect(html).toContain('company no. 16351012');
  });
});

describe('KAN-493 redirects', () => {
  test('maps each removed page to the section that now holds it', () => {
    expect(LEGAL_PAGE_REDIRECTS).toEqual([
      { source: '/cookies', destination: '/privacy#cookies' },
      { source: '/guidelines', destination: '/about#guidelines' },
      { source: '/safe', destination: '/about#safety' },
      { source: '/help', destination: '/about#help' },
      { source: '/complaints', destination: '/contact#complaints' },
      { source: '/partners', destination: '/privacy' },
      { source: '/accessibility', destination: '/about' },
    ]);
  });

  test('every destination is a fixed internal path (no open redirect)', () => {
    for (const r of LEGAL_PAGE_REDIRECTS) {
      expect(r.destination).toMatch(/^\/[a-z]/);
      expect(r.destination).not.toContain(':');
    }
  });

  test('next.config.ts serves them as permanent (308) redirects', () => {
    const cfg = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
    expect(cfg).toMatch(/async redirects\(\)\s*\{\s*return LEGAL_PAGE_REDIRECTS\.map\(\(r\) => \(\{ \.\.\.r, permanent: true \}\)\);/);
  });

  test('the removed pages are gone, so the redirect is what answers', () => {
    for (const name of REMOVED) {
      expect(fs.existsSync(path.join(root, SRC.app, '(legal)', name))).toBe(false);
    }
  });

  test('no source file links to a removed page', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          const re = new RegExp(`href=["'{\`]+/(${REMOVED.join('|')})["'#?\`}]`);
          if (re.test(src)) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(path.join(root, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('KAN-493 About holds Guidelines, Keeping people safe and Help', () => {
  const html = renderToStaticMarkup(React.createElement(AboutPage));

  test('has the three section anchors', () => {
    expect(html).toContain('id="guidelines"');
    expect(html).toContain('id="safety"');
    expect(html).toContain('id="help"');
  });

  test('keeps the no-contact-details rule and the report route', () => {
    expect(html).toContain('Keep your private details private');
    expect(html).toContain('See something that doesn');
    expect(html).toContain('href="/contact"');
  });

  test('states the corrected facts', () => {
    expect(html).toContain('someone searching for a school can still see');
    expect(html).toContain('What happens if something breaks these guidelines');
    expect(html).toContain('To publish, you need a photo, your name and a CheckLyra ID');
    expect(html).toContain('a public school or organisation');
    expect(html).toContain('href="/dashboard/settings"');
  });

  test('drops the out-of-date statements', () => {
    expect(html).not.toContain('collect or store your postcode');
    expect(html).not.toContain('isn&#x27;t available yet');
    expect(html).not.toMatch(/Children(&#x27;|’)s profiles/);
  });
});

describe('KAN-493 Privacy holds the Cookie Policy', () => {
  test('has a #cookies section listing the essential cookies', async () => {
    mockGetGlobalSwitches.mockResolvedValue(switches(false));
    const html = renderToStaticMarkup(await PrivacyPolicyPage());
    expect(html).toContain('id="cookies"');
    expect(html).toContain('sb-*-auth-token');
    expect(html).toContain('sb-*-auth-token-code-verifier');
    expect(html).toContain('__cf_bm');
    expect(html).toContain('Managing cookies');
    expect(html).toContain('href="/contact#complaints"');
  });

  test('affiliate disclosure (when on) has its own anchor and the affiliate cookies note', async () => {
    mockGetGlobalSwitches.mockResolvedValue(switches(true));
    const html = renderToStaticMarkup(await PrivacyPolicyPage());
    expect(html).toContain('id="affiliate-partners"');
    expect(html).toContain('Lyra does not set any cookies on your browser as part of this flow.');
  });
});

describe('KAN-493 Contact holds Complaints', () => {
  const html = renderToStaticMarkup(React.createElement(ContactPage));

  test('has the #complaints section with the report/complaint route', () => {
    expect(html).toContain('id="complaints"');
    expect(html).toContain('start your message with “Complaint”');
  });

  test('keeps the DUAA 30-day commitment and the ICO details', () => {
    expect(html).toContain('acknowledge your complaint within 30 days');
    expect(html).toContain('Data (Use and Access) Act 2025');
    expect(html).toContain('0303 123 1113');
    expect(html).toContain('Wycliffe House');
    expect(html).toContain('mailto:privacy@checklyra.com');
  });
});
