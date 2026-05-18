/**
 * Microsoft OAuth initiate — KAN-211 P7.
 *
 * Mirrors /api/convene/oauth/google/initiate. Generates a state token,
 * stores it in oauth_connect_state with provider='microsoft', and
 * redirects (or returns JSON for MCP) to Microsoft's authorize URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient as createSupabaseServer } from '@/lib/supabase-server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isConveneEnabled } from '@/lib/convene/flags';
import { buildAuthorizeUrl } from '@/lib/convene/microsoft/oauth';

export async function GET(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ error: 'convene_disabled' }, { status: 404 });
  }

  const sb = await createSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const state = randomBytes(32).toString('base64url');
  const admin = createSupabaseAdmin(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
  // ownership-ok: writing the user's own state row (KAN-211)
  const { error } = await admin.from('oauth_connect_state').insert({
    state,
    user_id: user.id,
    provider: 'microsoft',
  });
  if (error) {
    return NextResponse.json(
      { error: 'state_persist_failed', detail: error.message },
      { status: 500 }
    );
  }

  const wantsJson = req.headers.get('accept')?.includes('application/json');
  const authorizeUrl = buildAuthorizeUrl(state);
  if (wantsJson) {
    return NextResponse.json({ authorize_url: authorizeUrl, state });
  }
  return NextResponse.redirect(authorizeUrl);
}
