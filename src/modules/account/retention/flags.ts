/**
 * Data-retention feature flag (SEC-74 · UK-GDPR Art. 5(1)(e)).
 *
 * The retention sweep enforces the deletion windows published in the privacy
 * policy / RETENTION_SCHEDULE.md. It is gated behind this flag and defaults
 * OFF so the purge jobs never delete anything until Luisa has confirmed the
 * retention windows and explicitly enables them per environment
 * (`RETENTION_ENABLED=true`). Same pattern as the Convene flag.
 *
 * While off, the retention cron route returns 404 and no rows are ever purged.
 */
export function isRetentionEnabled(): boolean {
  return process.env.RETENTION_ENABLED === 'true';
}
