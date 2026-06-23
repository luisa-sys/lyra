/**
 * KAN-282: Didit age-verification webhook.
 *
 * Didit POSTs the verification decision here (signed). We verify the HMAC
 * signature, map the decision to an age_status, and persist it (service-role).
 * Idempotent: re-delivery for the same session just re-writes the same status.
 *
 * No selfie/biometric is received or stored — only the status + session ref.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyWebhookSignature,
  normaliseDecision,
  mapDecisionToAgeStatus,
} from '@/lib/age/didit';
import { setProfileAgeStatus, profileExists } from '@/lib/age/age-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig =
    req.headers.get('x-signature') ??
    req.headers.get('x-didit-signature') ??
    req.headers.get('x-hub-signature-256');

  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // vendor_data is the profile id we set when creating the session.
  const profileId = String(body.vendor_data ?? body.vendorData ?? '').trim();
  const sessionId = String(body.session_id ?? body.id ?? '').trim() || null;
  if (!profileId || !(await profileExists(profileId))) {
    // 200 so the provider doesn't retry forever on an unknown ref; logged for ops.
    console.warn('[didit-webhook] unknown or missing vendor_data profile id');
    return NextResponse.json({ ok: true, ignored: 'unknown profile' });
  }

  const status = mapDecisionToAgeStatus(normaliseDecision(body.decision ?? body));
  // 'pending' is not a terminal outcome — don't overwrite with it from a webhook.
  if (status === 'pending') {
    return NextResponse.json({ ok: true, status });
  }

  const result = await setProfileAgeStatus(profileId, status, sessionId);
  if (!result.ok) {
    console.error('[didit-webhook] failed to persist age_status:', result.error);
    return NextResponse.json({ error: 'persist failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status });
}
