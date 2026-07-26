/**
 * SEC-96: honest derivation of the admin "External monitoring" badges.
 *
 * The prior version derived each badge from raw env-var *presence*, which was
 * misleading in two ways:
 *   - Sentry showed "configured" whenever NEXT_PUBLIC_SENTRY_DSN was set, even
 *     if server-side capture was off. Server/edge Sentry (instrumentation.ts)
 *     only initialises when BOTH the DSN AND IS_SENTRY_ENABLED === 'true' — so
 *     the badge now requires both, matching what actually ships errors.
 *   - UptimeRobot showed "configured" only where UPTIMEROBOT_API_KEY was present
 *     in that deployment's env. But the key is Production-scoped, so the dev /
 *     staging admin read "not configured" even though those endpoints ARE
 *     monitored — UptimeRobot watches the whole platform from one account, with
 *     the monitor list committed in scripts/uptimerobot/lib.js. "Configured"
 *     for UptimeRobot is an account-wide SETUP fact, not a per-deployment
 *     secret-presence fact, so it defaults to true and is decoupled from the
 *     secret. Set UPTIMEROBOT_ENABLED='false' to reflect a decommissioned
 *     account.
 *
 * `configured === undefined` marks a row that is NOT a configurable integration
 * (our own public status page) — rendered as a plain link, not a green pill, so
 * we don't fake a config signal for something that isn't configured (the
 * /status page's own live health probes are the real signal there).
 *
 * Kept as a pure, env-injectable function so it is unit-testable without
 * rendering the server component.
 */
export type MonitoringIntegration = {
  name: string;
  href: string;
  /** true/false renders a configured pill; undefined => link-only (not configurable). */
  configured?: boolean;
};

export function getMonitoringIntegrations(
  env: Record<string, string | undefined> = process.env,
): MonitoringIntegration[] {
  // Sentry server/edge capture needs BOTH the DSN and the enable flag (mirrors
  // instrumentation.ts) — DSN-only would read green while zero server errors
  // actually ship.
  const sentryConfigured =
    Boolean(env.NEXT_PUBLIC_SENTRY_DSN) && env.IS_SENTRY_ENABLED === 'true';

  // UptimeRobot is account-wide: configured by default (monitors are provisioned
  // + committed), decoupled from the Production-only secret so the dev/staging
  // admin no longer falsely reads "not configured". Only an explicit
  // UPTIMEROBOT_ENABLED='false' turns it off.
  const uptimeConfigured = env.UPTIMEROBOT_ENABLED !== 'false';

  return [
    { name: 'Sentry (errors)', href: 'https://sentry.io', configured: sentryConfigured },
    {
      name: 'UptimeRobot (uptime)',
      href: 'https://dashboard.uptimerobot.com',
      configured: uptimeConfigured,
    },
    // Our own public status page — not a "configurable" integration; link only.
    { name: 'Public status page', href: 'https://checklyra.com/status' },
  ];
}
