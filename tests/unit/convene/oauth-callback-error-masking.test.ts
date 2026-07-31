/**
 * SEC-76 (web-oauth-6) — Convene OAuth callbacks don't echo internal error detail.
 *
 * Both the Google and Microsoft callback routes previously returned
 * `{ error: '<code>', detail: msg }` where `msg` could carry an upstream
 * provider response body or a Supabase/DB error string. That leaks internal
 * detail to the browser. The routes must now log `msg` server-side (via
 * logStep) but return only the stable error code. These source-string guards
 * pin that no error response re-introduces a `detail:` field.
 */

import fs from 'fs';
import path from 'path';
import { SRC } from '../../support/source-paths';

const ROOT = path.join(__dirname, '..', '..', '..');

const callbacks = [
  SRC.callbackRoute,
  SRC.microsoftCallbackRoute,
];

describe.each(callbacks)('%s error masking', (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  test('no error response includes a detail field', () => {
    // Catches `detail: msg`, `detail: e`, `detail:msg`, etc. in any response.
    expect(src).not.toMatch(/detail\s*:/);
  });

  test('still returns the stable error codes', () => {
    expect(src).toMatch(/error:\s*'token_exchange_failed'/);
    expect(src).toMatch(/error:\s*'userinfo_failed'/);
    expect(src).toMatch(/error:\s*'persist_failed'/);
  });

  test('still logs the raw message server-side', () => {
    // msg is captured and passed to logStep so detail is not lost operationally.
    expect(src).toMatch(/logStep\(reqId, '\w+_failed', \{ msg \}\)/);
  });
});
