/**
 * KAN-341 — postcode→city resolver (Google Places). Covers the pure extractor
 * and the fetch path (injected mock). The postcode is transient — never
 * persisted or logged; only the coarse city/region is returned.
 */
import { extractCity, lookupCityFromPostcode } from '@/lib/geo/places-city';

describe('KAN-341 extractCity', () => {
  it('prefers postal_town (UK) and includes the region', () => {
    expect(
      extractCity([
        { longText: 'London', types: ['postal_town'] },
        { longText: 'Greater London', types: ['administrative_area_level_1'] },
      ]),
    ).toEqual({ city: 'London', region: 'Greater London' });
  });

  it('falls back to locality, then administrative_area_level_2', () => {
    expect(extractCity([{ longText: 'Paris', types: ['locality'] }])).toEqual({ city: 'Paris', region: null });
    expect(extractCity([{ longText: 'Kent', types: ['administrative_area_level_2'] }])).toEqual({
      city: 'Kent',
      region: null,
    });
  });

  it('returns null when no locality component is present', () => {
    expect(extractCity([{ longText: 'High St', types: ['route'] }])).toBeNull();
    expect(extractCity([])).toBeNull();
  });
});

describe('KAN-341 lookupCityFromPostcode', () => {
  const ORIGINAL = process.env.GOOGLE_PLACES_API_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL;
  });

  it('returns null when the API key is not configured (no call made)', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchMock = jest.fn();
    expect(await lookupCityFromPostcode('SW1A 1AA', fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the city from a Places response (global free-text query)', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            addressComponents: [
              { longText: 'Manchester', types: ['postal_town'] },
              { longText: 'England', types: ['administrative_area_level_1'] },
            ],
          },
        ],
      }),
    });
    const result = await lookupCityFromPostcode('M1 1AE', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ city: 'Manchester', region: 'England' });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ textQuery: 'M1 1AE' });
    // Field mask is address components only (data minimisation — no lat/lng/place id).
    expect((init as RequestInit).headers).toMatchObject({ 'X-Goog-FieldMask': 'places.addressComponents' });
  });

  it('returns null on a non-OK response', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await lookupCityFromPostcode('X1', fetchMock as unknown as typeof fetch)).toBeNull();
  });

  it('returns null (does not throw) on a fetch error', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockRejectedValue(new Error('network'));
    expect(await lookupCityFromPostcode('X1', fetchMock as unknown as typeof fetch)).toBeNull();
  });

  it('returns null for an empty/whitespace postcode (no call made)', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const fetchMock = jest.fn();
    expect(await lookupCityFromPostcode('   ', fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
