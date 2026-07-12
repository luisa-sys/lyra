/**
 * Retention sweep orchestrator (SEC-74 · UK-GDPR Art. 5(1)(e)).
 *
 * Runs each enforced retention/purge job and collects a structured summary.
 * A job that throws is recorded in `errors[]` and does not abort the other jobs
 * (same resilience pattern as the Convene post-event sweep) — but the sweep
 * never masks a failure as success: any error is surfaced in the response and
 * makes the cron route return a non-2xx so the failure is visible, not silent.
 *
 * Currently enforced:
 *   - affiliate_clicks raw events (proposed 13-month window).
 * Follow-up legs of SEC-74 (decomposed): waitlist KV `expirationTtl`
 * (Cloudflare maintenance worker — ops/two-step deploy), past-gathering purge
 * (cascade/anonymise policy call), and the moderation/audit-log retention
 * window. Add them here as they land.
 */

import {
  runAffiliateClicksRetention,
  type AffiliateClicksRetentionSummary,
} from './affiliate-clicks';

export interface RetentionSweepSummary {
  jobs: AffiliateClicksRetentionSummary[];
  errors: string[];
}

export async function runRetentionSweep(): Promise<RetentionSweepSummary> {
  const summary: RetentionSweepSummary = { jobs: [], errors: [] };

  try {
    summary.jobs.push(await runAffiliateClicksRetention());
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : 'affiliate_clicks: unknown error');
  }

  return summary;
}
