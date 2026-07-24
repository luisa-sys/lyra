/**
 * KAN-276 / KAN-277 — beta access programme helpers.
 *
 * This module is a plain `.ts` (NOT 'use server') so it can export the
 * constants, types and sync helpers that the callback route, the admin
 * queue action and the tests all share — see CLAUDE.md gotcha #18.
 *
 * Flow (confirmed architecture, shared-cookie approach):
 *   1. A user signs up / first authenticates. On their first authenticated
 *      landing we move their profile from beta_access_status='none' to
 *      'requested' (`ensureBetaRequested`) and email Luisa.
 *   2. On prod (IS_BETA_DEPLOY !== 'true') we route them to the beta deploy,
 *      gated behind BETA_ROUTING_ENABLED so it's inert until cutover
 *      (`betaRoutingTarget`).
 *   3. An admin approves them in /admin/beta-queue → status='approved',
 *      is_beta_eligible=true, and they get the "you're in" email.
 *
 * Everything that talks to Resend degrades gracefully (logs, never throws):
 * a failed email must never break a user's sign-in.
 */

import { env } from '@/lib/env';
import { sendTransactionalEmail } from '@/lib/email/transactional';

export type BetaAccessStatus = 'none' | 'requested' | 'approved';

/**
 * A minimal Supabase-like client surface this module needs. Kept structural
 * so callers can pass either the cookie-auth server client or the
 * service-role admin client, and tests can pass a fake.
 */
export interface BetaAccessDbClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{
          data: { beta_access_status?: string | null } | null;
          error?: unknown;
        }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error?: unknown }>;
    };
  };
}

/**
 * Idempotently move a user's profile into the beta queue.
 *
 * Transitions beta_access_status 'none' → 'requested' and stamps
 * beta_requested_at. Never downgrades an 'approved' (or already 'requested')
 * profile — the update is guarded by a `.eq('beta_access_status', 'none')`
 * in the caller's query shape via reading first, so a re-run is a no-op.
 *
 * Returns whether a NEW request transition happened (true only on the
 * none→requested edge), so the caller knows when to fire the notify email.
 */
export async function ensureBetaRequested(
  db: BetaAccessDbClient,
  userId: string
): Promise<{ transitioned: boolean; previousStatus: BetaAccessStatus | null }> {
  const { data, error } = await db
    .from('profiles')
    .select('beta_access_status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return { transitioned: false, previousStatus: null };
  }

  const previousStatus = (data.beta_access_status ?? 'none') as BetaAccessStatus;

  // Only the 'none' → 'requested' edge is a real transition. 'requested'
  // and 'approved' are left exactly as they are (never downgrade).
  if (previousStatus !== 'none') {
    return { transitioned: false, previousStatus };
  }

  const { error: updateError } = await db
    .from('profiles')
    .update({
      beta_access_status: 'requested',
      beta_requested_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    return { transitioned: false, previousStatus };
  }

  return { transitioned: true, previousStatus };
}

/** Build the absolute admin beta-queue URL for the notify email. */
export function betaQueueAdminUrl(): string {
  return `${env.siteUrl().replace(/\/$/, '')}/admin/beta-queue`;
}

/**
 * Email Luisa that someone joined the beta queue. Degrades gracefully —
 * logs on failure (including no-api-key), never throws.
 */
export async function notifyBetaQueueJoined(opts: {
  who: string;
}): Promise<void> {
  const to = env.betaQueueNotifyEmail();
  const adminUrl = betaQueueAdminUrl();
  const subject = `${opts.who} joined the beta queue`;
  const html =
    `<p><strong>${escapeHtml(opts.who)}</strong> just joined the Lyra beta queue.</p>` +
    `<p><a href="${adminUrl}">Review the beta queue →</a></p>`;
  const text = `${opts.who} just joined the Lyra beta queue.\n\nReview: ${adminUrl}`;

  const result = await sendTransactionalEmail({ to, subject, html, text });
  if (!result.ok) {
    console.warn(
      `[beta-access] beta-queue notify email not sent (${result.code}): ${result.detail ?? ''}`
    );
  }
}

/**
 * Email an approved user that they're in. Degrades gracefully.
 */
export async function notifyBetaApproved(opts: {
  to: string;
  displayName?: string | null;
}): Promise<void> {
  const betaUrl = env.betaAppUrl().replace(/\/$/, '');
  const name = opts.displayName?.trim() || 'there';
  const subject = `You're in — welcome to the Lyra beta`;
  const html =
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>You've been approved for the Lyra beta. You can start using it now:</p>` +
    `<p><a href="${betaUrl}">Open Lyra →</a></p>`;
  const text =
    `Hi ${name},\n\n` +
    `You've been approved for the Lyra beta. Start here: ${betaUrl}`;

  const result = await sendTransactionalEmail({ to: opts.to, subject, html, text });
  if (!result.ok) {
    console.warn(
      `[beta-access] beta-approved email not sent (${result.code}): ${result.detail ?? ''}`
    );
  }
}

/**
 * Decide where to route a user after sign-in on PROD.
 *
 * Returns the beta app URL (with the original path appended) when:
 *   - this is NOT the beta deploy (IS_BETA_DEPLOY !== 'true'), AND
 *   - BETA_ROUTING_ENABLED === 'true' (inert until cutover).
 * Otherwise returns null (stay where you are).
 *
 * `path` is appended so a deep link survives the hop. Pure + sync so the
 * callback route and middleware can both use it and it's trivially testable.
 */
export function betaRoutingTarget(path: string): string | null {
  const isBetaDeploy = process.env.IS_BETA_DEPLOY === 'true';
  if (isBetaDeploy) return null;
  if (!env.betaRoutingEnabled()) return null;

  const base = env.betaAppUrl().replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
