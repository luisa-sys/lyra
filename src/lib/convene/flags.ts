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
 *
 * Gate by VERCEL_ENV, not NODE_ENV: Next.js sets NODE_ENV=production for all
 * built bundles including Vercel preview deployments, so NODE_ENV would block
 * dev.checklyra.com as well as the real production site. VERCEL_ENV is set by
 * Vercel to 'production' | 'preview' | 'development'; for local Next.js dev
 * (no Vercel) it is undefined, which we treat as allowed.
 */
export function isConveneSpikeAllowed(): boolean {
  return isConveneEnabled() && process.env.VERCEL_ENV !== 'production';
}
