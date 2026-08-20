/**
 * KAN-451 — schools: type-ahead picker, short description on add, and the
 * KAN-404 postcode rule that must survive both.
 *
 * Three subjects, all driven for real:
 *
 *   1. `src/modules/profile/geo/places-schools.ts` (pure picker logic) and its sibling
 *      `places-schools-lookup.ts` (the Places call). Every decision the React
 *      component makes lives in the pure module on purpose: the repo's jest
 *      environment is `node` with no DOM, and changing that is a Test-Integrity
 *      sign-off matter, so behaviour that would otherwise be untestable inside
 *      JSX is a pure function instead.
 *   2. `suggestAffiliations` — the server action, through a mocked Supabase
 *      client and an injected fetch.
 *   3. `addSchoolAffiliation` — description persistence and the postcode gate,
 *      asserted on the payload that actually reaches `.insert()`.
 *
 * MUTATION-VERIFIED (2026-08-03). Each of these eight edits, applied to the
 * real source and then reverted, turns this suite red:
 *   - deleting the `requiresPostcode(…) && !isSchoolPostcodeValid(…)` gate
 *     from `addSchoolAffiliation`                            → 3 failures
 *   - weakening `isSchoolPostcodeValid` to `s.length >= 2`   → 2 failures
 *   - dropping `description: sanitisedDesc` from the insert  → 7 failures
 *   - deleting the description moderation block              → 1 failure
 *   - removing the "add your own" option from
 *     `buildSuggestionOptions`                               → 4 failures
 *   - making `lookupPlaceSuggestions` rethrow instead of
 *     returning [] when the provider fails                   → 2 failures
 *   - letting `resolvePickedLocation` overwrite a postcode
 *     the member typed themselves                            → 1 failure
 *   - removing the auth check from `suggestAffiliations`     → 1 failure
 *
 * Note what is deliberately NOT asserted by reading source text: the SEC-100 /
 * BUGS-85 lesson is that a `toContain` over a file stays green when the feature
 * is deleted but the comment describing it survives. Everything below observes
 * the real module's behaviour.
 */

const mockInsertCapture = jest.fn();
const mockRevalidatePath = jest.fn();

const mockState: { userId: string | null } = { userId: 'kan451-user' };

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockImplementation(() =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: mockState.userId ? { id: mockState.userId } : null },
          }),
      },
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { id: 'profile-1' } }),
              }),
            }),
          };
        }
        if (table === 'school_affiliations') {
          return {
            insert: (data: unknown) => {
              mockInsertCapture(data);
              return Promise.resolve({ error: null });
            },
          };
        }
        // KAN-244 audit trail — moderateAndAudit writes a flag row whenever it
        // warns or blocks. Accepted (and ignored) so the moderation cases below
        // don't fill the run with swallowed-insert warnings; asserting on the
        // audit row is KAN-244's own suite, not this one.
        if (table === 'content_moderation_flags') {
          return { insert: () => Promise.resolve({ error: null }) };
        }
        throw new Error(`Unexpected table in mock: ${table}`);
      },
    }),
  ),
}));

import {
  MIN_SUGGEST_QUERY_LENGTH,
  MAX_SUGGESTIONS,
  buildSuggestionOptions,
  extractSuggestion,
  placeTypeForAffiliation,
  resolvePickedLocation,
  shouldSuggest,
  type PlaceSuggestion,
} from '@/modules/profile/geo/places-schools';
import { lookupPlaceSuggestions } from '@/modules/profile/geo/places-schools-lookup';
import { suggestAffiliations } from '@/app/dashboard/profile/affiliation-search-actions';
import { addSchoolAffiliation } from '@/app/dashboard/profile/actions';
import { isSchoolPostcodeValid } from '@/app/dashboard/profile/affiliation-fields';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';
import { stripComments } from '../support/strip-comments';

// Each test gets its own user id so the in-memory per-user write rate limit
// (KAN-231, 30/min) can never make a later test fail for an earlier one's reason.
let userCounter = 0;

const ORIGINAL_KEY = process.env.GOOGLE_PLACES_API_KEY;

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockRevalidatePath.mockClear();
  userCounter += 1;
  mockState.userId = `kan451-user-${userCounter}`;
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_KEY;
});

function place(name: string, address?: string, postcode?: string) {
  return {
    displayName: { text: name },
    ...(address ? { formattedAddress: address } : {}),
    ...(postcode
      ? { addressComponents: [{ shortText: postcode, longText: postcode, types: ['postal_code'] }] }
      : {}),
  };
}

// ───────────────── 1. pure lookup + picker logic ─────────────────

describe('KAN-451: shouldSuggest', () => {
  test('waits for enough characters before a lookup is worth making', () => {
    expect(MIN_SUGGEST_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
    expect(shouldSuggest('Gr')).toBe(false);
    expect(shouldSuggest('Gre')).toBe(true);
  });

  test('whitespace does not count as typing', () => {
    expect(shouldSuggest('   ')).toBe(false);
    expect(shouldSuggest('  Greenfield  ')).toBe(true);
  });

  test('nullish input is not a lookup', () => {
    expect(shouldSuggest(null)).toBe(false);
    expect(shouldSuggest(undefined)).toBe(false);
    expect(shouldSuggest('')).toBe(false);
  });
});

describe('KAN-451: placeTypeForAffiliation', () => {
  test('schools are biased towards the school place type', () => {
    expect(placeTypeForAffiliation('school')).toBe('school');
  });

  test('organisations and communities search unrestricted', () => {
    // "organisation" and "community" have no meaningful provider type, so we
    // must not invent one — an unrestricted search finds a village hall.
    expect(placeTypeForAffiliation('organisation')).toBeNull();
    expect(placeTypeForAffiliation('community')).toBeNull();
    expect(placeTypeForAffiliation('')).toBeNull();
  });
});

describe('KAN-451: extractSuggestion', () => {
  test('takes the name, address and postal_code component', () => {
    expect(
      extractSuggestion(place('Greenfield Primary', '1 High St, London SW1A 1AA', 'SW1A 1AA')),
    ).toEqual({
      name: 'Greenfield Primary',
      address: '1 High St, London SW1A 1AA',
      postcode: 'SW1A 1AA',
    });
  });

  test('a result with no postcode still yields a pickable suggestion', () => {
    expect(extractSuggestion(place('Acme Ltd', '2 Low St'))).toEqual({
      name: 'Acme Ltd',
      address: '2 Low St',
      postcode: null,
    });
  });

  test('ignores non-postal address components', () => {
    expect(
      extractSuggestion({
        displayName: { text: 'Greenfield Primary' },
        addressComponents: [{ longText: 'London', types: ['postal_town'] }],
      }),
    ).toEqual({ name: 'Greenfield Primary', address: null, postcode: null });
  });

  test('a nameless result is dropped — nobody can pick it', () => {
    expect(extractSuggestion({ formattedAddress: '1 High St' })).toBeNull();
    expect(extractSuggestion({ displayName: { text: '   ' } })).toBeNull();
    expect(extractSuggestion({})).toBeNull();
  });
});

describe('KAN-451: buildSuggestionOptions always offers "add your own"', () => {
  const matches: PlaceSuggestion[] = [
    { name: 'Greenfield Primary', address: '1 High St', postcode: 'SW1A 1AA' },
    { name: 'Greenfield Academy', address: '2 Low St', postcode: 'M1 1AE' },
  ];

  test('the LAST option is always the member’s own wording', () => {
    const options = buildSuggestionOptions('Greenfields Free School', matches);
    expect(options).toHaveLength(3);
    expect(options[options.length - 1]).toEqual({
      kind: 'custom',
      name: 'Greenfields Free School',
    });
  });

  test('a school missing from the list can still be added', () => {
    // The whole point of the fallback: no matches at all must not be a dead end.
    const options = buildSuggestionOptions('Tiny Village Home-Ed Group', []);
    expect(options).toEqual([{ kind: 'custom', name: 'Tiny Village Home-Ed Group' }]);
  });

  test('the custom option carries the trimmed query verbatim, not a match', () => {
    const options = buildSuggestionOptions('  Greenfield Primary  ', matches);
    const custom = options.filter((o) => o.kind === 'custom');
    expect(custom).toHaveLength(1);
    expect(custom[0].name).toBe('Greenfield Primary');
  });

  test('real matches come first and keep their address + postcode', () => {
    const options = buildSuggestionOptions('Greenfield', matches);
    expect(options[0]).toEqual({
      kind: 'place',
      name: 'Greenfield Primary',
      address: '1 High St',
      postcode: 'SW1A 1AA',
    });
  });

  test('nothing typed → no option at all (an empty name is not addable)', () => {
    expect(buildSuggestionOptions('   ', [])).toEqual([]);
  });

  test('the list is capped so it stays readable', () => {
    const many: PlaceSuggestion[] = Array.from({ length: 20 }, (_, i) => ({
      name: `School ${i}`,
      address: null,
      postcode: null,
    }));
    const options = buildSuggestionOptions('School', many);
    expect(options.filter((o) => o.kind === 'place')).toHaveLength(MAX_SUGGESTIONS);
    // …and the fallback survives the cap.
    expect(options[options.length - 1].kind).toBe('custom');
  });
});

describe('KAN-451: resolvePickedLocation', () => {
  const picked: PlaceSuggestion = { name: 'Greenfield Primary', address: null, postcode: 'SW1A 1AA' };

  test('fills a blank postcode from the picked place', () => {
    expect(resolvePickedLocation(picked, '')).toBe('SW1A 1AA');
    expect(resolvePickedLocation(picked, '   ')).toBe('SW1A 1AA');
    expect(resolvePickedLocation(picked, null)).toBe('SW1A 1AA');
  });

  test('never overwrites a postcode the member typed themselves', () => {
    expect(resolvePickedLocation(picked, 'M1 1AE')).toBe('M1 1AE');
  });

  test('a place with no postcode leaves the field blank rather than guessing', () => {
    expect(resolvePickedLocation({ name: 'X', address: null, postcode: null }, '')).toBe('');
  });
});

// ───────────────── 2. the Places call itself ─────────────────

describe('KAN-451: lookupPlaceSuggestions', () => {
  const okResponse = (places: unknown[]) => ({ ok: true, json: async () => ({ places }) });

  test('returns the suggestions from a provider response', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([place('Greenfield Primary', '1 High St', 'SW1A 1AA')]));
    await expect(
      lookupPlaceSuggestions('Greenfield', 'school', fetchMock as unknown as typeof fetch),
    ).resolves.toEqual([
      { name: 'Greenfield Primary', address: '1 High St', postcode: 'SW1A 1AA' },
    ]);
  });

  test('asks only for name, address and address components (data minimisation)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([]));
    await lookupPlaceSuggestions('Greenfield', 'school', fetchMock as unknown as typeof fetch);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.addressComponents',
    });
  });

  test('biases a school search towards schools, and leaves others unrestricted', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse([]));
    await lookupPlaceSuggestions('Greenfield', 'school', fetchMock as unknown as typeof fetch);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      textQuery: 'Greenfield',
      includedType: 'school',
    });

    fetchMock.mockClear();
    await lookupPlaceSuggestions('Acme', 'organisation', fetchMock as unknown as typeof fetch);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ textQuery: 'Acme' });
    expect(body).not.toHaveProperty('includedType');
  });

  test('no key configured → no call, empty list (feature simply absent)', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchMock = jest.fn();
    await expect(
      lookupPlaceSuggestions('Greenfield', 'school', fetchMock as unknown as typeof fetch),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('too-short query → no call', async () => {
    const fetchMock = jest.fn();
    await expect(
      lookupPlaceSuggestions('Gr', 'school', fetchMock as unknown as typeof fetch),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a provider error degrades to an empty list — it never throws', async () => {
    const rejecting = jest.fn().mockRejectedValue(new Error('network'));
    await expect(
      lookupPlaceSuggestions('Greenfield', 'school', rejecting as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  test('a non-OK response degrades to an empty list', async () => {
    const notOk = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(
      lookupPlaceSuggestions('Greenfield', 'school', notOk as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  test('a malformed body degrades to an empty list', async () => {
    const malformed = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(
      lookupPlaceSuggestions('Greenfield', 'school', malformed as unknown as typeof fetch),
    ).resolves.toEqual([]);
  });

  test('nameless provider rows are dropped rather than rendered blank', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okResponse([{ formattedAddress: '1 High St' }, place('Real School')]));
    await expect(
      lookupPlaceSuggestions('School', 'school', fetchMock as unknown as typeof fetch),
    ).resolves.toEqual([{ name: 'Real School', address: null, postcode: null }]);
  });
});

// ───────────────── 3. the server action ─────────────────

describe('KAN-451: suggestAffiliations', () => {
  test('not authenticated → refused', async () => {
    mockState.userId = null;
    await expect(suggestAffiliations('Greenfield', 'school')).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    });
  });

  test('a too-short query is an empty list, not an error', async () => {
    await expect(suggestAffiliations('Gr', 'school')).resolves.toEqual({
      success: true,
      suggestions: [],
    });
  });

  test('no key configured → success with nothing, so the picker degrades quietly', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(suggestAffiliations('Greenfield Primary', 'school')).resolves.toEqual({
      success: true,
      suggestions: [],
    });
  });
});

// ───────────────── 4. description persistence on add ─────────────────

describe('KAN-451: addSchoolAffiliation persists the description', () => {
  test('a supplied description is sanitised and written to the row', async () => {
    const result = await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'SW1A 1AA',
      description: '<b>Year 2</b> teacher',
      affiliation_type: 'school',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Year 2 teacher' }),
    );
  });

  test('the description reaches the row for organisations and communities too', async () => {
    await addSchoolAffiliation({
      school_name: 'Acme Ltd',
      description: 'Ops team',
      affiliation_type: 'organisation',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Ops team' }),
    );
  });

  test('no description → NULL rather than an empty string', async () => {
    await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'SW1A 1AA',
      affiliation_type: 'school',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
    );
  });

  test('a whitespace-only description → NULL', async () => {
    await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'SW1A 1AA',
      description: '   ',
      affiliation_type: 'school',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
    );
  });

  test('a profane description is blocked and NOTHING is inserted', async () => {
    const result = await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'SW1A 1AA',
      description: 'fuck this place',
      affiliation_type: 'school',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/inappropriate language/i);
    }
    // The add path must not be a way round the moderation the edit path applies.
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('the description is capped like every other public field', async () => {
    // Varied words rather than a repeated character, so the length cap is what
    // is being measured and not the spam heuristic.
    const longNote = 'Year two teacher and reading lead for the lower school. '.repeat(20);
    expect(longNote.length).toBeGreaterThan(400);
    await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'SW1A 1AA',
      description: longNote,
      affiliation_type: 'school',
    });
    const written = mockInsertCapture.mock.calls[0][0] as { description: string };
    expect(written.description.length).toBeLessThanOrEqual(200);
  });
});

// ───────────────── 5. the KAN-404 postcode rule still holds ─────────────────

describe('KAN-451: the school postcode requirement survives the picker work', () => {
  const POSTCODE_ERROR =
    'Schools need a postcode (full or partial) so people can tell schools with the same name apart.';

  test('isSchoolPostcodeValid still needs BOTH a letter and a digit', () => {
    // The disambiguating signal — a name-only "London" or a bare house number
    // cannot tell two same-named schools apart.
    expect(isSchoolPostcodeValid('SW1A 1AA')).toBe(true);
    expect(isSchoolPostcodeValid('M1')).toBe(true);
    expect(isSchoolPostcodeValid('London')).toBe(false);
    expect(isSchoolPostcodeValid('12345')).toBe(false);
    expect(isSchoolPostcodeValid('')).toBe(false);
    expect(isSchoolPostcodeValid(null)).toBe(false);
    expect(isSchoolPostcodeValid('A')).toBe(false);
    expect(isSchoolPostcodeValid('ABCDEFGHIJK12')).toBe(false);
  });

  test('a school added WITH a description but no postcode is still refused', async () => {
    // The description is the new field; it must not become a way in.
    const result = await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      description: 'Year 2 teacher',
      affiliation_type: 'school',
    });
    expect(result).toEqual({ success: false, error: POSTCODE_ERROR });
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('a school with a letters-only location is refused even with a description', async () => {
    const result = await addSchoolAffiliation({
      school_name: 'Greenfield Primary',
      school_location: 'London',
      description: 'Year 2 teacher',
      affiliation_type: 'school',
    });
    expect(result).toEqual({ success: false, error: POSTCODE_ERROR });
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('a suggestion with no postcode does not let a school through', async () => {
    // resolvePickedLocation leaves the field blank when the provider had no
    // postcode; the member must supply one, and the server is what enforces it.
    const picked: PlaceSuggestion = { name: 'Greenfield Primary', address: '1 High St', postcode: null };
    const location = resolvePickedLocation(picked, '');
    const result = await addSchoolAffiliation({
      school_name: picked.name,
      school_location: location || undefined,
      affiliation_type: 'school',
    });
    expect(result).toEqual({ success: false, error: POSTCODE_ERROR });
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  test('a postcode carried over from a picked suggestion is accepted and stored', async () => {
    const picked: PlaceSuggestion = {
      name: 'Greenfield Primary',
      address: '1 High St',
      postcode: 'SW1A 1AA',
    };
    const location = resolvePickedLocation(picked, '');
    const result = await addSchoolAffiliation({
      school_name: picked.name,
      school_location: location,
      description: 'Year 2 teacher',
      affiliation_type: 'school',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        school_name: 'Greenfield Primary',
        school_location: 'SW1A 1AA',
        description: 'Year 2 teacher',
        affiliation_type: 'school',
      }),
    );
  });

  test('organisations and communities keep an optional location', async () => {
    await addSchoolAffiliation({
      school_name: 'Local running club',
      description: 'Saturday runner',
      affiliation_type: 'community',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({ school_location: null, description: 'Saturday runner' }),
    );
  });
});

// ───────────── The editor is actually wired to the picker ─────────────

// Everything above tests the modules. NONE of it observes the member-facing
// half: reverting <AffiliationNamePicker> to the plain <Field> it replaced,
// and dropping `description` from the add call, BOTH left this suite green —
// so the whole feature could vanish from the UI with CI still passing.
// The repo has no component test library, so these are comment-stripped
// source assertions on the specific wiring whose removal is otherwise
// invisible. Comments are stripped so no comment can satisfy them (KAN-459).
describe('KAN-451: the add form is wired to the picker and the description', () => {
  const ROOT = resolve(__dirname, '../..');
  const section = stripComments(
    readFileSync(resolve(ROOT, SRC.profile, 'sections/affiliations-section.tsx'), 'utf-8'),
  );

  test('the picker component is imported AND rendered in the add form', () => {
    expect(section).toContain("from './affiliation-name-picker'");
    expect(section).toContain('<AffiliationNamePicker');
  });

  test('the add call passes the member-entered description through', () => {
    expect(section).toMatch(/addSchoolAffiliation\([\s\S]{0,400}?description,/);
  });

  test('the description input is present in the add form', () => {
    expect(section).toContain('setDescription');
  });
});
