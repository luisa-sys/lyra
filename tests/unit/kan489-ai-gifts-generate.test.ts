/**
 * KAN-489 — one generation end to end (generate.ts), with fakes for the
 * loader, the claim, the model, moderation and the insert. The order is the
 * point: every check that can refuse without spending money runs before the
 * claim, and nothing reaches the model unless the server-side claim
 * succeeded (spec v0.8 §03 "up to 5 generations per profile-edit session",
 * enforced server-side).
 */

import { generateAiGiftSuggestions, isUuid, type GenerateDeps } from '@/modules/profile/ai-gifts/generate';
import type { GiftModel, ModelOutcome } from '@/modules/profile/ai-gifts/client';
import type { LoadedAiGiftSource } from '@/modules/profile/ai-gifts/source';
import type { ClaimResult, InsertResult } from '@/modules/profile/ai-gifts/store';
import type { AiSuggestion } from '@/modules/profile/ai-gifts/types';

const SESSION = '3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f';
// The current consent-note version, as a literal (failure mode 10): changing
// AI_CONSENT_VERSION must turn these tests red until they are updated.
const CONSENT = 'v1-2026-11-23';

function source(over: Partial<LoadedAiGiftSource> = {}): LoadedAiGiftSource {
  return {
    source: { fields: [{ tag: 'headline', text: 'Potter' }], avoid: [], existingGifts: [] },
    existingTitles: ['Mug'],
    aiCount: 0,
    profileId: 'p-1',
    ...over,
  };
}

function setup(opts: {
  loaded?: LoadedAiGiftSource | null;
  claim?: ClaimResult | Error;
  outcome?: ModelOutcome;
  suggestThrows?: Error;
  insert?: (kept: readonly AiSuggestion[]) => InsertResult;
  model?: null;
}) {
  const calls: string[] = [];
  const suggest = jest.fn(async () => {
    calls.push('model');
    if (opts.suggestThrows) throw opts.suggestThrows;
    return (
      opts.outcome ?? {
        ok: true as const,
        json: {
          suggestions: [
            { title: 'Kite', description: 'Fly it' },
            { title: 'mug', description: 'duplicate of a member gift' },
            { title: 'Map', description: 'see example.com' },
            { title: 'Clay', description: 'Air-dry clay set' },
          ],
        },
      }
    );
  });
  const model: GiftModel = { suggest };
  const claim = jest.fn(async (_s: unknown, _sessionId: string, _consent: string) => {
    void _s;
    void _sessionId;
    void _consent;
    calls.push('claim');
    if (opts.claim instanceof Error) throw opts.claim;
    return opts.claim ?? { ok: true as const, sessionRemaining: 3, monthlyRemaining: 17 };
  });
  const insert = jest.fn(async (_s: unknown, kept: readonly AiSuggestion[]) => {
    calls.push('insert');
    if (opts.insert) return opts.insert(kept);
    return {
      ok: true as const,
      inserted: kept.map((k, i) => ({ id: `id-${i}`, title: k.title, description: k.description })),
      droppedForCap: 0,
    };
  });
  const loadSource = jest.fn(async () => {
    calls.push('load');
    return opts.loaded === undefined ? source() : opts.loaded;
  });
  const deps: GenerateDeps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: {} as any,
    model: opts.model === null ? null : model,
    moderate: jest.fn(async () => ({ ok: true as const })),
    loadSource,
    claim,
    insert,
  };
  return { deps, calls, suggest, claim, insert, loadSource };
}

describe('generateAiGiftSuggestions — refusals that spend nothing', () => {
  it('not configured → no load, no claim, no model call', async () => {
    const t = setup({ model: null });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(t.calls).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['an older version', 'draft-2026-11-01'],
    ['empty', ''],
    ['not a string', 1],
  ])('consent version %s → consent_required, nothing runs (review fix: consent checked server-side)', async (_l, consentVersion) => {
    const t = setup({});
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion })).toEqual({
      ok: false,
      reason: 'consent_required',
    });
    expect(t.calls).toEqual([]);
  });

  it('a session id that is not a UUID → invalid_session, nothing runs', async () => {
    const t = setup({});
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: 'abc', consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'invalid_session',
    });
    expect(t.calls).toEqual([]);
  });

  it('no member-authored content → no_content, no claim', async () => {
    const t = setup({ loaded: source({ source: { fields: [], avoid: ['x'], existingGifts: [] } }) });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'no_content',
    });
    expect(t.calls).toEqual(['load']);
  });

  it('10 AI suggestions already held → cap_full, no claim', async () => {
    const t = setup({ loaded: source({ aiCount: 10 }) });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'cap_full',
    });
    expect(t.calls).toEqual(['load']);
  });

  it('9 held → the claim runs', async () => {
    const t = setup({ loaded: source({ aiCount: 9 }) });
    await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT });
    expect(t.calls).toContain('claim');
  });

  it('the profile cannot be loaded → failed, no claim', async () => {
    const t = setup({ loaded: null });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(t.calls).toEqual(['load']);
  });
});

describe('generateAiGiftSuggestions — the server-side claim gates the model', () => {
  it.each([
    ['session_limit', 0],
    ['monthly_limit', 2],
    ['cooldown', 4],
  ] as const)('claim refused (%s) → returned with the server count, model NOT called', async (reason, left) => {
    const t = setup({ claim: { ok: false, reason, sessionRemaining: left } });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason,
      sessionRemaining: left,
    });
    expect(t.suggest).not.toHaveBeenCalled();
    expect(t.insert).not.toHaveBeenCalled();
  });

  it('a suspended account (claim refusal without a count) → suspended, model NOT called', async () => {
    const t = setup({ claim: { ok: false, reason: 'suspended', sessionRemaining: null } });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'suspended',
    });
    expect(t.suggest).not.toHaveBeenCalled();
  });

  it('a claim ERROR fails closed: failed, model NOT called', async () => {
    const t = setup({ claim: { ok: false, reason: 'error' } });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(t.suggest).not.toHaveBeenCalled();
  });

  it('a claim that THROWS propagates (the action reports failed) and the model is NOT called', async () => {
    const t = setup({ claim: new Error('db down') });
    await expect(generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).rejects.toThrow('db down');
    expect(t.suggest).not.toHaveBeenCalled();
  });

  it('the claim is called with the session id', async () => {
    const t = setup({});
    await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT });
    expect(t.claim.mock.calls[0][1]).toBe(SESSION);
  });

  it('the claim records the consent version the member accepted', async () => {
    const t = setup({});
    await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT });
    expect(t.claim.mock.calls[0][2]).toBe('v1-2026-11-23');
  });
});

describe('generateAiGiftSuggestions — model outcome and storage', () => {
  it('happy path: load → claim → model → insert; kept items stored, counts reported', async () => {
    const t = setup({});
    const r = await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT });
    expect(t.calls).toEqual(['load', 'claim', 'model', 'insert']);
    expect(t.insert.mock.calls[0][1]).toEqual([
      { title: 'Kite', description: 'Fly it' },
      { title: 'Clay', description: 'Air-dry clay set' },
    ]);
    expect(r).toEqual({
      ok: true,
      inserted: [
        { id: 'id-0', title: 'Kite', description: 'Fly it' },
        { id: 'id-1', title: 'Clay', description: 'Air-dry clay set' },
      ],
      droppedForCap: 0,
      droppedByFilter: 2,
      sessionRemaining: 3,
      monthlyRemaining: 17,
    });
  });

  it('reports droppedForCap from the insert (e.g. 3 approved held + 10 asked → 7 stored, 3 did not fit)', async () => {
    const t = setup({
      outcome: { ok: true, json: { suggestions: Array.from({ length: 10 }, (_, i) => ({ title: `G${i}`, description: 'x' })) } },
      insert: (kept) => ({
        ok: true,
        inserted: kept.slice(0, 7).map((k, i) => ({ id: `n${i}`, title: k.title, description: k.description })),
        droppedForCap: kept.length - 7,
      }),
    });
    const r = await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT });
    expect(r.ok && r.inserted.length).toBe(7);
    expect(r.ok && r.droppedForCap).toBe(3);
  });

  it.each(['refused', 'busy', 'failed', 'not_configured'] as const)(
    'model outcome %s → returned with the session count, nothing inserted',
    async (reason) => {
      const t = setup({ outcome: { ok: false, reason } });
      expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
        ok: false,
        reason,
        sessionRemaining: 3,
      });
      expect(t.insert).not.toHaveBeenCalled();
    },
  );

  it('the model THROWING after a spent claim → failed WITH the session count (counter never overstates)', async () => {
    const t = setup({ suggestThrows: new Error('boom') });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'failed',
      sessionRemaining: 3,
    });
    expect(t.insert).not.toHaveBeenCalled();
  });

  it('the insert THROWING after a spent claim → failed WITH the session count', async () => {
    const t = setup({
      insert: () => {
        throw new Error('rpc down');
      },
    });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'failed',
      sessionRemaining: 3,
    });
  });

  it("the member's avoid list reaches the output filter (review fix)", async () => {
    const t = setup({
      loaded: source({ source: { fields: [{ tag: 'headline', text: 'Potter' }], avoid: ['Socks'], existingGifts: [] } }),
      outcome: {
        ok: true,
        json: {
          suggestions: [
            { title: 'Cashmere socks', description: 'Warm' },
            { title: 'Kite', description: 'Comes with fun socks' },
            { title: 'Clay', description: 'Air-dry clay set' },
          ],
        },
      },
    });
    const r = await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT });
    expect(t.insert.mock.calls[0][1]).toEqual([{ title: 'Clay', description: 'Air-dry clay set' }]);
    expect(r.ok && r.droppedByFilter).toBe(2);
  });

  it('insert failure → failed with the session count', async () => {
    const t = setup({ insert: () => ({ ok: false }) });
    expect(await generateAiGiftSuggestions(t.deps, { userId: 'u', sessionId: SESSION, consentVersion: CONSENT })).toEqual({
      ok: false,
      reason: 'failed',
      sessionRemaining: 3,
    });
  });
});

describe('isUuid', () => {
  it('accepts a v4 UUID only', () => {
    expect(isUuid(SESSION)).toBe(true);
    expect(isUuid(SESSION.toUpperCase())).toBe(true);
    expect(isUuid(`${SESSION}x`)).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
