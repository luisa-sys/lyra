/**
 * PKCE verification — KAN-88 P4. RFC 7636.
 *
 * Compute S256(code_verifier) and compare to the code_challenge that
 * was stored when the auth code was issued. Constant-time equality
 * via timingSafeEqual.
 */
import { createHash, timingSafeEqual } from 'crypto';

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  // Per RFC 7636 §4.2: challenge = base64url(sha256(verifier)).
  const expected = createHash('sha256').update(codeVerifier).digest();
  // Decode the stored challenge from base64url.
  let challengeBuf: Buffer;
  try {
    challengeBuf = Buffer.from(codeChallenge, 'base64url');
  } catch {
    return false;
  }
  if (challengeBuf.length !== expected.length) return false;
  return timingSafeEqual(expected, challengeBuf);
}
