/**
 * Convene feature flag.
 *
 * All Convene code must be gated behind this. Default: off.
 * Set CONVENE_ENABLED=true in env to enable in any environment.
 *
 * Tracked under KAN-203.
 */
export function isConveneEnabled(): boolean {
  return process.env.CONVENE_ENABLED === 'true';
}
