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

/**
 * Spike-only gate. Spike routes (under /api/convene/spike/) must NEVER run in
 * production, even if CONVENE_ENABLED is set. Tracked under KAN-204.
 */
export function isConveneSpikeAllowed(): boolean {
  return isConveneEnabled() && process.env.NODE_ENV !== 'production';
}
