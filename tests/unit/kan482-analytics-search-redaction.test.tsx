/**
 * KAN-482 — DPIA §2a AD-6: the `/search?q=` term must not reach Vercel
 * Analytics or Speed Insights. Two layers:
 *   1. the redaction function, on LITERAL URLs with LITERAL expectations;
 *   2. the wiring: the REAL ConsentedAnalytics is rendered (consent mocked to
 *      "accepted") with both Vercel components mocked to record their props,
 *      and the recorded `beforeSend` is fed a /search event. A component that
 *      drops the prop, or passes an identity function, goes red.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';

(globalThis as typeof globalThis & { React?: unknown }).React = React;

type Props = { beforeSend?: (e: { type: string; url: string }) => unknown };
const mockProps: Record<string, Props> = {};

jest.mock('@vercel/analytics/react', () => ({
  Analytics: (p: Props) => {
    mockProps.analytics = p;
    return null;
  },
}));
jest.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: (p: Props) => {
    mockProps.speed = p;
    return null;
  },
}));
jest.mock('@/app/consent-state', () => ({
  analyticsAllowed: (v: string) => v === 'accepted',
  getConsentSnapshot: () => 'accepted',
  getServerConsentSnapshot: () => 'accepted',
  subscribeConsent: () => () => {},
}));

import { ConsentedAnalytics } from '@/app/consented-analytics';
import { redactSearchTermFromUrl } from '@/modules/observability/analytics-redaction';

describe('redactSearchTermFromUrl', () => {
  test.each([
    ['https://checklyra.com/search?q=Zebedee%20Primary', 'https://checklyra.com/search'],
    ['https://checklyra.com/search/?q=x&page=2', 'https://checklyra.com/search/'],
    ['/search?q=x#top', '/search'],
    ['https://checklyra.com/search', 'https://checklyra.com/search'],
    // Positive controls: other routes keep their query untouched.
    ['https://checklyra.com/dashboard?tab=gifts', 'https://checklyra.com/dashboard?tab=gifts'],
    ['https://checklyra.com/research?q=keep', 'https://checklyra.com/research?q=keep'],
  ])('%s → %s', (input, expected) => {
    expect(redactSearchTermFromUrl(input)).toBe(expected);
  });
});

describe('ConsentedAnalytics wiring', () => {
  beforeAll(() => {
    renderToString(<ConsentedAnalytics />);
  });

  test.each(['analytics', 'speed'])('%s receives a beforeSend that strips the term', (which) => {
    const hook = mockProps[which]?.beforeSend;
    expect(typeof hook).toBe('function');
    const out = hook!({ type: 'pageview', url: 'https://checklyra.com/search?q=Zebedee%20Primary' });
    expect(JSON.stringify(out)).not.toMatch(/zebedee/i);
    expect(out).toEqual({ type: 'pageview', url: 'https://checklyra.com/search' });
  });
});
