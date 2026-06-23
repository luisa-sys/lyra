/**
 * /.well-known/oauth-authorization-server — KAN-88 OAuth AS metadata.
 *
 * RFC 8414. Returned by GET as application/json. Clients (claude.ai,
 * Claude Desktop, MCP Inspector) fetch this to discover where to
 * authorize, exchange tokens, register, and revoke.
 *
 * This endpoint is public — no auth needed. It's effectively a
 * configuration document.
 */

import { NextResponse } from 'next/server';
import { oauthConfig } from '@/lib/oauth/config';

export const dynamic = 'force-dynamic'; // env-driven URLs — never cache

export async function GET() {
  return NextResponse.json(
    {
      issuer: oauthConfig.issuer(),
      authorization_endpoint: oauthConfig.authorizationEndpoint(),
      token_endpoint: oauthConfig.tokenEndpoint(),
      registration_endpoint: oauthConfig.registrationEndpoint(),
      revocation_endpoint: oauthConfig.revocationEndpoint(),
      jwks_uri: oauthConfig.jwksUri(), // SEC-33: RS256 public keys for token verification

      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // PKCE is mandatory in OAuth 2.1; we accept S256 only (not 'plain').
      code_challenge_methods_supported: ['S256'],
      // Public clients only for MVP — claude.ai is a confidential client
      // in practice but PKCE protects it adequately.
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: oauthConfig.supportedScopes,
      // RFC 8628 device flow not supported.
      // RFC 7592 client config endpoint not supported (clients can't update
      // themselves post-registration in MVP).
      service_documentation: `${oauthConfig.issuer()}/docs/mcp-oauth`,
      ui_locales_supported: ['en-GB'],
    },
    {
      headers: {
        // Allow MCP clients to discover us cross-origin.
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    }
  );
}
