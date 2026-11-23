/**
 * KAN-490 / ADR-011 — old (pre-v0.8) slugs and mixed-case IDs redirect
 * permanently to the current CheckLyra ID; only ever to a published, not
 * suspended profile; never in a loop.
 *
 * Behavioural: the real `resolveLegacySlug` and the real
 * `src/app/[slug]/page.tsx` run against the per-statement Supabase mock,
 * whose fixture rows are filtered by each statement's OWN `.eq()` calls. The
 * `profiles` BASE table holds the draft and suspended targets that the
 * `public_profiles` view does not, so a resolver that read the base table
 * instead of the view would redirect to them and turn these tests red.
 *
 * Every expected value is a literal written here (CLAUDE.md failure mode 10).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

const mockState: {
  rows: Record<string, Array<Record<string, unknown>>>;
  errors: Record<string, unknown>;
} = { rows: {}, errors: {} };

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) =>
    React.createElement('a', { href: String(href) }, children),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, src }: { alt?: string; src: unknown }) => React.createElement('img', { alt, src: String(src) }),
}));
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  permanentRedirect: (url: string) => {
    throw new Error(`NEXT_PERMANENT_REDIRECT ${url}`);
  },
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
jest.mock('@/modules/platform/env', () => ({ env: { siteUrl: () => 'https://checklyra.com' } }));
jest.mock('@/modules/platform/supabase-service', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  const harness = require('../support/supabase-statement-mock');
  return {
    createServiceRoleClient: () =>
      harness.createStatementMockClient({
        getUserId: () => null,
        rows: (t: string) => mockState.rows[t],
        error: (t: string) => mockState.errors[t] ?? null,
      }),
  };
});
jest.mock('@/modules/platform/supabase-server', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
  const harness = require('../support/supabase-statement-mock');
  return { createClient: async () => harness.createStatementMockClient({ getUserId: () => null }) };
});

import * as Sentry from '@sentry/nextjs';
import Page from '@/app/[slug]/page';
import { resolveLegacySlug } from '@/modules/public-profile/load-public-profile';
import { statementLog } from '../support/supabase-statement-mock';
import { aliceRows } from '../support/kan488-public-profile-fixture';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

/** The view: published + not suspended only (as the SEC-104 view body does). */
const VIEW = [
  { id: 'p-maya', slug: 'maya_patel_a0000000', display_name: 'Maya' },
  { id: 'p-rosa', slug: 'rosa_martinez_a0000000', display_name: 'Rosa' },
  { id: 'p-loop', slug: 'loop_id', display_name: 'Loop' },
];

/** The base table additionally holds a draft and a suspended profile. */
const BASE = [
  ...VIEW.map((r) => ({ ...r, is_published: true, is_suspended: false })),
  { id: 'p-draft', slug: 'draft_new_id', display_name: 'Draft', is_published: false, is_suspended: false },
  { id: 'p-susp', slug: 'susp_new_id', display_name: 'Susp', is_published: true, is_suspended: true },
];

const HISTORY = [
  { old_slug: 'maya-patel-a0000000', old_slug_key: 'maya-patel-a0000000', profile_id: 'p-maya' },
  // Stored in its original case; only the lower-cased key matches a request.
  { old_slug: 'Rosa-Martínez-A0000000', old_slug_key: 'rosa-martínez-a0000000', profile_id: 'p-rosa' },
  { old_slug: 'draft-old-1a2b3c4d', old_slug_key: 'draft-old-1a2b3c4d', profile_id: 'p-draft' },
  { old_slug: 'susp-old-1a2b3c4d', old_slug_key: 'susp-old-1a2b3c4d', profile_id: 'p-susp' },
  // A history row pointing at a profile whose CURRENT ID is the same text.
  { old_slug: 'loop_id', old_slug_key: 'loop_id', profile_id: 'p-loop' },
];

beforeEach(() => {
  statementLog.reset();
  (Sentry.captureException as jest.Mock).mockClear();
  mockState.errors = {};
  mockState.rows = { public_profiles: VIEW, profiles: BASE, profile_slug_history: HISTORY };
});

describe('KAN-490 resolveLegacySlug', () => {
  test('an old slug resolves to the current ID', async () => {
    expect(await resolveLegacySlug('maya-patel-a0000000')).toBe('maya_patel_a0000000');
  });

  test('lookup is by the lower-cased slug (mixed-case old slug)', async () => {
    expect(await resolveLegacySlug('MAYA-Patel-A0000000')).toBe('maya_patel_a0000000');
    expect(await resolveLegacySlug('Rosa-MARTÍNEZ-a0000000')).toBe('rosa_martinez_a0000000');
  });

  test('a history row matches on old_slug_key, not the stored original-case old_slug', async () => {
    expect(await resolveLegacySlug('rosa-martínez-a0000000')).toBe('rosa_martinez_a0000000');
    const history = statementLog.all.filter((s) => s.table === 'profile_slug_history');
    expect(history).toHaveLength(1);
    expect(history[0].eq).toEqual([['old_slug_key', 'rosa-martínez-a0000000']]);
  });

  test('a mixed-case form of a live ID resolves to the lower-case ID without touching the history', async () => {
    expect(await resolveLegacySlug('Maya_Patel_A0000000')).toBe('maya_patel_a0000000');
    expect(statementLog.all.map((s) => s.table)).toEqual(['public_profiles']);
  });

  test('never redirects to a draft or a suspended profile', async () => {
    expect(await resolveLegacySlug('draft-old-1a2b3c4d')).toBeNull();
    expect(await resolveLegacySlug('susp-old-1a2b3c4d')).toBeNull();
  });

  test('the target is read from the public_profiles view by the history row profile id', async () => {
    await resolveLegacySlug('maya-patel-a0000000');
    const reads = statementLog.all.map((s) => [s.table, s.eq]);
    expect(reads).toEqual([
      ['profile_slug_history', [['old_slug_key', 'maya-patel-a0000000']]],
      ['public_profiles', [['id', 'p-maya']]],
    ]);
  });

  test('no loop: a target equal to the requested slug is refused', async () => {
    expect(await resolveLegacySlug('loop_id')).toBeNull();
  });

  // Review minor 2 / KAN-351: a failed read is still a 404 for the visitor,
  // but it is reported, never swallowed.
  test('a failed history read resolves to null AND is reported to Sentry', async () => {
    const err = { message: 'boom', code: 'XX000' };
    mockState.errors = { profile_slug_history: err };
    expect(await resolveLegacySlug('maya-patel-a0000000')).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ tags: expect.objectContaining({ step: 'legacy-slug:history' }) }),
    );
  });

  test('a failed target or case read is reported to Sentry', async () => {
    const err = { message: 'view down', code: 'XX000' };
    mockState.errors = { public_profiles: err };
    expect(await resolveLegacySlug('maya-patel-a0000000')).toBeNull();
    expect(await resolveLegacySlug('Maya_Patel_A0000000')).toBeNull();
    const steps = (Sentry.captureException as jest.Mock).mock.calls.map((c) => c[1].tags.step);
    // The case read failed, so the history is tried; it has no row for the
    // lower-cased live ID, so no target read follows.
    expect(steps).toEqual(['legacy-slug:target', 'legacy-slug:case']);
  });

  test('a successful resolution reports nothing', async () => {
    await resolveLegacySlug('maya-patel-a0000000');
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  test('an unknown slug resolves to null', async () => {
    expect(await resolveLegacySlug('nobody-here')).toBeNull();
    expect(await resolveLegacySlug('NoBody')).toBeNull();
  });
});

describe('KAN-490 page — permanent redirects', () => {
  test('/<old slug> is a permanent redirect to /<current ID>', async () => {
    await expect(Page(params('maya-patel-a0000000'))).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT /maya_patel_a0000000',
    );
  });

  test('a percent-encoded accented old slug redirects (decoded before lookup)', async () => {
    await expect(Page(params('rosa-mart%C3%ADnez-a0000000'))).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT /rosa_martinez_a0000000',
    );
  });

  test('a mixed-case ID redirects to its lower-case form', async () => {
    await expect(Page(params('Maya_Patel_A0000000'))).rejects.toThrow(
      'NEXT_PERMANENT_REDIRECT /maya_patel_a0000000',
    );
  });

  test('an old slug of a draft or suspended profile is a 404, not a redirect', async () => {
    await expect(Page(params('draft-old-1a2b3c4d'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(Page(params('susp-old-1a2b3c4d'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  test('a live ID renders without consulting the slug history', async () => {
    mockState.rows = { ...aliceRows(), profile_slug_history: HISTORY };
    const html = renderToStaticMarkup(await Page(params('alice')));
    expect(html).toContain('>Alice Example</h1>');
    expect(statementLog.all.some((s) => s.table === 'profile_slug_history')).toBe(false);
  });
});
