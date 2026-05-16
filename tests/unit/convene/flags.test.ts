/**
 * Flag behaviour for Convene (KAN-203).
 *
 * The P0 spike's `isConveneSpikeAllowed` was removed in KAN-205 once the
 * spike routes were retired. Only `isConveneEnabled` remains.
 */

import { isConveneEnabled } from '@/lib/convene/flags';

describe('convene/flags', () => {
  const originalEnabled = process.env.CONVENE_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.CONVENE_ENABLED;
    } else {
      process.env.CONVENE_ENABLED = originalEnabled;
    }
  });

  describe('isConveneEnabled', () => {
    it('returns false by default', () => {
      delete process.env.CONVENE_ENABLED;
      expect(isConveneEnabled()).toBe(false);
    });

    it('returns false when explicitly set to "false"', () => {
      process.env.CONVENE_ENABLED = 'false';
      expect(isConveneEnabled()).toBe(false);
    });

    it('returns true only when literally "true"', () => {
      process.env.CONVENE_ENABLED = 'true';
      expect(isConveneEnabled()).toBe(true);
    });

    it('treats "1" / "yes" / "TRUE" as off (strict literal "true")', () => {
      for (const v of ['1', 'yes', 'TRUE', 'on']) {
        process.env.CONVENE_ENABLED = v;
        expect(isConveneEnabled()).toBe(false);
      }
    });
  });
});
