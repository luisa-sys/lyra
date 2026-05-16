/**
 * Flag behaviour for Convene (KAN-203).
 */

import { isConveneEnabled, isConveneSpikeAllowed } from '@/lib/convene/flags';

describe('convene/flags', () => {
  const originalEnabled = process.env.CONVENE_ENABLED;
  const originalVercelEnv = process.env.VERCEL_ENV;

  afterEach(() => {
    process.env.CONVENE_ENABLED = originalEnabled;
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  function setVercelEnv(value: string | undefined) {
    if (value === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = value;
    }
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
    it('is allowed when enabled and VERCEL_ENV=preview (Vercel preview deploys, incl. dev.checklyra.com)', () => {
      process.env.CONVENE_ENABLED = 'true';
      setVercelEnv('preview');
      expect(isConveneSpikeAllowed()).toBe(true);
    });

    it('is allowed when enabled and VERCEL_ENV=development (Vercel `vercel dev`)', () => {
      process.env.CONVENE_ENABLED = 'true';
      setVercelEnv('development');
      expect(isConveneSpikeAllowed()).toBe(true);
    });

    it('is allowed when enabled and VERCEL_ENV is unset (local Next.js dev / jest)', () => {
      process.env.CONVENE_ENABLED = 'true';
      setVercelEnv(undefined);
      expect(isConveneSpikeAllowed()).toBe(true);
    });

    it('is REFUSED on Vercel production even when enabled', () => {
      process.env.CONVENE_ENABLED = 'true';
      setVercelEnv('production');
      expect(isConveneSpikeAllowed()).toBe(false);
    });

    it('is refused when feature flag is off (any VERCEL_ENV)', () => {
      delete process.env.CONVENE_ENABLED;
      for (const v of ['production', 'preview', 'development', undefined]) {
        setVercelEnv(v);
        expect(isConveneSpikeAllowed()).toBe(false);
      }
    });
  });
});
