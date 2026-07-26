/**
 * SEC-96: the admin "External monitoring" badges must reflect real config, not
 * raw env-var presence. Pin the honest logic:
 *   - Sentry: green only when the DSN AND IS_SENTRY_ENABLED='true' (mirrors
 *     instrumentation.ts) — the DSN alone would be green while no server errors ship.
 *   - UptimeRobot: account-wide, green by default, decoupled from the
 *     Production-only UPTIMEROBOT_API_KEY (so the dev/staging admin no longer
 *     falsely reads "not configured"); only UPTIMEROBOT_ENABLED='false' disables.
 *   - Public status page: not a configurable integration -> no pill.
 */
import { getMonitoringIntegrations } from '@/app/admin/monitoring/integration-status';

const row = (env: Record<string, string | undefined>, name: string) =>
  getMonitoringIntegrations(env).find((i) => i.name === name)!;

describe('getMonitoringIntegrations (SEC-96 honest badges)', () => {
  describe('Sentry (errors)', () => {
    it('is configured only when the DSN AND IS_SENTRY_ENABLED=true', () => {
      expect(
        row({ NEXT_PUBLIC_SENTRY_DSN: 'https://x@sentry.io/1', IS_SENTRY_ENABLED: 'true' }, 'Sentry (errors)')
          .configured,
      ).toBe(true);
    });

    it('is NOT configured when the DSN is set but the enable flag is off/missing', () => {
      expect(row({ NEXT_PUBLIC_SENTRY_DSN: 'https://x@sentry.io/1' }, 'Sentry (errors)').configured).toBe(false);
      expect(
        row({ NEXT_PUBLIC_SENTRY_DSN: 'https://x@sentry.io/1', IS_SENTRY_ENABLED: 'false' }, 'Sentry (errors)')
          .configured,
      ).toBe(false);
    });

    it('is NOT configured when the flag is on but there is no DSN', () => {
      expect(row({ IS_SENTRY_ENABLED: 'true' }, 'Sentry (errors)').configured).toBe(false);
    });
  });

  describe('UptimeRobot (uptime)', () => {
    it('is configured by default (account-wide) with no env at all', () => {
      expect(row({}, 'UptimeRobot (uptime)').configured).toBe(true);
    });

    it('is configured WITHOUT the Production-only key present (dev/staging parity — the SEC-96 bug)', () => {
      // No UPTIMEROBOT_API_KEY, as on the dev/staging deployments.
      expect(row({ IS_SENTRY_ENABLED: 'true' }, 'UptimeRobot (uptime)').configured).toBe(true);
    });

    it('is turned off only by an explicit UPTIMEROBOT_ENABLED=false', () => {
      expect(row({ UPTIMEROBOT_ENABLED: 'false' }, 'UptimeRobot (uptime)').configured).toBe(false);
      expect(row({ UPTIMEROBOT_ENABLED: 'true' }, 'UptimeRobot (uptime)').configured).toBe(true);
    });
  });

  describe('Public status page', () => {
    it('is a link-only row (no configured pill)', () => {
      expect(row({}, 'Public status page').configured).toBeUndefined();
    });
  });

  it('returns the three integrations in a stable order', () => {
    expect(getMonitoringIntegrations({}).map((i) => i.name)).toEqual([
      'Sentry (errors)',
      'UptimeRobot (uptime)',
      'Public status page',
    ]);
  });
});
