/**
 * Flag behaviour for Convene (KAN-203).
 */

import { isConveneEnabled, isConveneSpikeAllowed } from '@/lib/convene/flags';

describe('convene/flags', () => {
  const originalEnabled = process.env.CONVENE_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.CONVENE_ENABLED = originalEnabled;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
    });
  });

  function setNodeEnv(value: string) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
    });
  }

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

  describe('isConveneSpikeAllowed', () => {
    it('is allowed when enabled and NODE_ENV=development', () => {
      process.env.CONVENE_ENABLED = 'true';
      setNodeEnv('development');
      expect(isConveneSpikeAllowed()).toBe(true);
    });

    it('is allowed when enabled and NODE_ENV=test', () => {
      process.env.CONVENE_ENABLED = 'true';
      setNodeEnv('test');
      expect(isConveneSpikeAllowed()).toBe(true);
    });

    it('is REFUSED in production even when enabled', () => {
      process.env.CONVENE_ENABLED = 'true';
      setNodeEnv('production');
      expect(isConveneSpikeAllowed()).toBe(false);
    });

    it('is refused when feature flag is off', () => {
      delete process.env.CONVENE_ENABLED;
      setNodeEnv('development');
      expect(isConveneSpikeAllowed()).toBe(false);
    });
  });
});
