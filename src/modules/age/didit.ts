/**
 * KAN-282: Didit facial-age-estimation client + decision mapping.
 *
 * Hosted session flow (privacy-by-design — the selfie/biometric never touches
 * Lyra; we store only an age signal + the provider session reference):
 *   1. createAgeSession() → POST /v3/session/ → returns { id, url }
 *   2. redirect the user to session.url (Didit hosts the selfie capture)
 *   3. Didit calls our webhook (signed) AND redirects back to /verify-age/callback
 *   4. we read the decision (webhook payload or GET /v3/session/{id}/decision/)
 *      and map it to age_status via mapDecisionToAgeStatus().
 *
 * GRACEFUL DEGRADATION: with DIDIT_API_KEY / DIDIT_WORKFLOW_ID unset the feature
 * is inert — createAgeSession returns { ok:false, reason:'not_configured' } and
 * the /verify-age page shows "checks coming soon". So this ships dormant and is
 * switched on by setting the env vars (mirrors the Sovrn affiliate pattern).
 *
 * Challenge age: we treat an estimate >= CHALLENGE_AGE (23) as a confident adult
 * pass; below it (but not clearly under 18) routes to manual_review / the ID
 * fallback rather than admitting on a near-18 guess (Ofcom HEAA expectation).
 */
import crypto from 'node:crypto';

const DIDIT_BASE = process.env.DIDIT_API_BASE ?? 'https://verification.didit.me';
export const CHALLENGE_AGE = 23;

export type AgeStatusResult = 'passed' | 'failed' | 'manual_review' | 'pending';

export function isDiditConfigured(): boolean {
  return Boolean(process.env.DIDIT_API_KEY && process.env.DIDIT_WORKFLOW_ID);
}

export type CreateSessionResult =
  | { ok: true; sessionId: string; url: string }
  | { ok: false; reason: 'not_configured' | 'create_failed'; detail?: string };

/**
 * Create a hosted verification session. `vendorData` is our opaque reference
 * (the user/profile id) echoed back in the webhook; `callbackUrl` is where Didit
 * returns the user after capture.
 */
export async function createAgeSession(opts: {
  vendorData: string;
  callbackUrl: string;
}): Promise<CreateSessionResult> {
  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  if (!apiKey || !workflowId) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch(`${DIDIT_BASE}/v3/session/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: opts.vendorData,
        callback: opts.callbackUrl,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: 'create_failed', detail: detail.slice(0, 300) };
    }
    const data = (await res.json().catch(() => ({}))) as { session_id?: string; id?: string; url?: string };
    const sessionId = data.session_id ?? data.id;
    if (!sessionId || !data.url) {
      return { ok: false, reason: 'create_failed', detail: 'missing session id/url in response' };
    }
    return { ok: true, sessionId, url: data.url };
  } catch (e) {
    return { ok: false, reason: 'create_failed', detail: e instanceof Error ? e.message : 'unknown' };
  }
}

/** Fetch a session decision (server-side confirm after the callback). */
export async function fetchAgeDecision(sessionId: string): Promise<unknown | null> {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey || !sessionId) return null;
  try {
    const res = await fetch(`${DIDIT_BASE}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Normalised decision input. We keep parsing the raw Didit payload separate from
 * the policy so the policy is pure + unit-testable.
 */
export interface NormalisedDecision {
  /** Provider's high-level status, lower-cased (e.g. 'approved','declined','in_review'). */
  status?: string | null;
  /** Estimated age, if the provider returned one. */
  estimatedAge?: number | null;
}

/** Pull the bits we need out of Didit's decision payload (defensive). */
export function normaliseDecision(raw: unknown): NormalisedDecision {
  const d = (raw ?? {}) as Record<string, unknown>;
  const ageEst = (d.age_estimation ?? d.age_estimate ?? {}) as Record<string, unknown>;
  const statusRaw =
    (typeof d.status === 'string' && d.status) ||
    (typeof (d.decision as Record<string, unknown> | undefined)?.status === 'string'
      ? ((d.decision as Record<string, unknown>).status as string)
      : undefined) ||
    (typeof ageEst.status === 'string' ? (ageEst.status as string) : undefined);
  const ageRaw =
    (typeof ageEst.age === 'number' && ageEst.age) ||
    (typeof ageEst.estimated_age === 'number' && ageEst.estimated_age) ||
    (typeof d.age === 'number' ? (d.age as number) : undefined);
  return {
    status: statusRaw ? String(statusRaw).toLowerCase() : null,
    estimatedAge: typeof ageRaw === 'number' ? ageRaw : null,
  };
}

/**
 * Map a normalised decision to an age_status. Pure.
 *  - explicit decline / clearly-under-18 → failed
 *  - confident adult (estimate >= challengeAge, or provider 'approved') → passed
 *  - borderline / in-review / no estimate → manual_review (→ ID fallback)
 */
export function mapDecisionToAgeStatus(
  decision: NormalisedDecision,
  challengeAge: number = CHALLENGE_AGE,
): AgeStatusResult {
  const { status, estimatedAge } = decision;

  if (status === 'declined' || status === 'rejected' || status === 'failed') {
    return 'failed';
  }
  if (typeof estimatedAge === 'number') {
    if (estimatedAge < 18) return 'failed';
    if (estimatedAge >= challengeAge) return 'passed';
    // 18..challengeAge: not confident enough on a near-18 estimate.
    return 'manual_review';
  }
  if (status === 'approved' || status === 'verified' || status === 'passed') {
    return 'passed';
  }
  if (status === 'in_review' || status === 'pending' || status === 'in_progress') {
    return 'pending';
  }
  return 'manual_review';
}

/**
 * Verify a Didit webhook HMAC-SHA256 signature (timing-safe). Returns false on
 * any mismatch / missing secret / malformed header.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | undefined = process.env.DIDIT_WEBHOOK_SECRET,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  // header may be raw hex or prefixed (e.g. "sha256=...")
  const provided = signatureHeader.includes('=') ? signatureHeader.split('=').pop()! : signatureHeader;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided.trim(), 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}
