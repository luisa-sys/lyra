/**
 * POST /oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * Clients like claude.ai POST their metadata (client_name, redirect_uris)
 * and receive a client_id (and optionally client_secret) to use in the
 * OAuth flow.
 *
 * This endpoint is INTENTIONALLY UNAUTHENTICATED — that's how DCR works
 * for public/dynamic clients. Rate limiting + the trust-on-first-use
 * model is what protects us; we can't refuse to register clients we
 * don't recognise because we *can't* recognise them yet.
 *
 * Mitigations against abuse:
 *   - RFC 7591 only — no extension fields acted upon.
 *   - HTTPS redirect URIs only (or http://localhost for native dev).
 *   - Capped per-IP rate limit (enforced in this handler — SEC-19/F-05).
 *   - Clients can be revoked by admin if abused.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  validateRegisterInput,
  createOauthClient,
  type RegistrationError,
} from '@/lib/oauth/clients';

export async function POST(req: NextRequest) {
  // SEC-19 / F-05: per-IP rate limit. DCR is unauthenticated and inserts an
  // oauth_clients row per call — cap it to stop DB-flooding and phishing-client
  // seeding on the Lyra-branded consent screen.
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const { limited, retryAfter } = rateLimit(`oauth-register:${ip}`, RATE_LIMITS.oauthRegister);
  if (limited) {
    return NextResponse.json(
      { error: 'too_many_requests', error_description: 'Too many client registrations. Please try again later.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
          'Retry-After': String(retryAfter ?? 3600),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: 'request body must be JSON' },
      { status: 400, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    );
  }

  const v = validateRegisterInput(body);
  if (!v.ok) {
    return errorResponse(v.error, 400);
  }

  let client;
  try {
    client = await createOauthClient(v.input);
  } catch (e) {
    return errorResponse(
      { code: 'invalid_client_metadata', description: e instanceof Error ? e.message : 'registration failed' },
      500
    );
  }

  // RFC 7591 §3.2.1 — return the full registered metadata to the client.
  return NextResponse.json(
    {
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      client_id_issued_at: client.client_id_issued_at,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      application_type: client.application_type,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      scope: client.scopes,
    },
    {
      status: 201,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    }
  );
}

function errorResponse(err: RegistrationError, status: number) {
  return NextResponse.json(
    { error: err.code, error_description: err.description },
    { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  );
}
