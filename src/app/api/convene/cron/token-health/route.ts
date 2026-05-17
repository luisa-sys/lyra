/**
 * /api/convene/cron/token-health — KAN-206 P2.
 *
 * Vercel Cron route. Iterates active oauth_connections, refreshes each token
 * using the existing adapter path, and marks failures as status='error'.
 * Schedule lives in vercel.json (`/api/convene/cron/token-health` daily 03:30 UTC).
 *
 * Auth: Vercel Cron sets the `Authorization: Bearer ${CRON_SECRET}` header.
 * Reject any request that doesn't carry it (set CRON_SECRET in env).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneEnabled } from '@/lib/convene/flags';
import { getFreshAccessToken } from '@/lib/convene/oauth-connections';

const HEALTH_BATCH_SIZE = 50;
const HEALTH_CONCURRENCY = 5;

export const maxDuration = 60; // seconds

export async function GET(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ ok: false, error: 'convene_disabled' }, { status: 404 });
  }

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  const admin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });

  // Pick up active connections, oldest-checked-first.
  const { data: rows, error } = await admin
    .from('oauth_connections')
    .select('id, provider')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(HEALTH_BATCH_SIZE);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const summary = { checked: 0, healthy: 0, marked_error: 0, errors: [] as string[] };

  async function check(connectionId: string) {
    summary.checked++;
    try {
      await getFreshAccessToken(connectionId);
      summary.healthy++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      summary.marked_error++;
      summary.errors.push(`${connectionId}: ${msg.slice(0, 100)}`);
      await admin
        .from('oauth_connections')
        .update({ status: 'error' })
        .eq('id', connectionId);
    }
  }

  // Process in small concurrent batches to avoid hammering Google.
  const queue = [...(rows ?? [])];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < HEALTH_CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const row = queue.shift();
          if (!row) break;
          await check(row.id);
        }
      })()
    );
  }
  await Promise.all(workers);

  return NextResponse.json({ ok: true, summary });
}
