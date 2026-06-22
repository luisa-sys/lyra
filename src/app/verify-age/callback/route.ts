/**
 * KAN-282: Didit returns the user here after the hosted selfie flow. We confirm
 * the decision server-side and persist age_status (the webhook is the
 * authoritative async path; this gives immediate UX). No biometric is received.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { env } from '@/lib/env';
import { fetchAgeDecision, normaliseDecision, mapDecisionToAgeStatus } from '@/lib/age/didit';
import { profileIdForUser, setProfileAgeStatus } from '@/lib/age/age-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const base = env.siteUrl();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${base}/login?next=/verify-age`);

  const profileId = await profileIdForUser(user.id);
  const sessionId =
    req.nextUrl.searchParams.get('session_id') ?? req.nextUrl.searchParams.get('sessionId');

  if (profileId && sessionId) {
    const decision = await fetchAgeDecision(sessionId);
    if (decision) {
      const status = mapDecisionToAgeStatus(normaliseDecision(decision));
      if (status !== 'pending') {
        await setProfileAgeStatus(profileId, status, sessionId);
      }
      if (status === 'passed') {
        return NextResponse.redirect(`${base}/dashboard/profile`);
      }
    }
  }
  return NextResponse.redirect(`${base}/verify-age`);
}
