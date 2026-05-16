/**
 * SPIKE — KAN-204. Throwaway. Returns one free/busy block from the user's
 * primary Google Calendar to prove the round trip works.
 */

import { NextResponse } from 'next/server';
import { createClient as createSupabaseServer } from '@/lib/supabase-server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneSpikeAllowed } from '@/lib/convene/flags';
import { refreshAccessToken } from '@/lib/convene/google/oauth';
import { getFreeBusy } from '@/lib/convene/google/calendar';
import { vaultReadRefreshToken } from '@/lib/convene/vault';

export async function GET() {
  if (!isConveneSpikeAllowed()) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 });
  }

  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const admin = createSupabaseAdmin(
    env.supabaseUrl(),
    env.supabaseServiceRoleKey(),
    { auth: { persistSession: false } }
  );
  const { data: conn, error: connErr } = await admin
    .from('convene_spike_oauth_connections')
    .select('refresh_token_secret_id')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .maybeSingle();

  if (connErr || !conn) {
    return NextResponse.json({ error: 'not_connected' }, { status: 404 });
  }

  const refreshToken = await vaultReadRefreshToken(conn.refresh_token_secret_id);
  const tokens = await refreshAccessToken(refreshToken);

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const busy = await getFreeBusy(tokens.access_token, now, sevenDaysLater);

  return NextResponse.json({
    user_id: user.id,
    window: { start: now.toISOString(), end: sevenDaysLater.toISOString() },
    busy_block_count: busy.length,
    sample_block: busy[0] ?? null,
  });
}
