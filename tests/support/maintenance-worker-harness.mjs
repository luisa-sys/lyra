/**
 * Driver for tests/scripts/maintenance-worker-behaviour.test.js.
 *
 * WHY A SUBPROCESS HARNESS RATHER THAN A JEST IMPORT
 * ---------------------------------------------------
 * `scripts/lyra-maintenance-worker.js` is an ES module, and `jest.config.js`
 * transforms only `.ts`/`.tsx`. Adding a `.js` transform rule would change how
 * roughly a hundred existing `.js` test files execute — a jest.config change
 * that affects test behaviour, which the Test Integrity Policy puts behind
 * sign-off. Node runs the module natively, and `tests/scripts/` already
 * exercises `scripts/` by invoking rather than importing, so this follows the
 * convention already in the repo instead of loosening the harness.
 *
 * This file is a DRIVER, not a reimplementation. It builds requests and reports
 * what the real worker did. The distinction is the entire point of the ticket:
 * the suite this replaces re-declared the worker's `isValidEmail` and rate
 * limiter inside the test file and asserted against those copies, so stubbing
 * the worker's own versions left all 19 tests green.
 *
 * Emits one JSON object of observations on stdout. Assertions live in the test.
 */
import worker from '../../scripts/lyra-maintenance-worker.js';

const URL_BASE = 'https://checklyra.com/';

function makeKV() {
  const store = new Map();
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => void store.set(k, v),
  };
}

function post(email, ip, env) {
  return worker.fetch(
    new Request(URL_BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify({ email }),
    }),
    env,
  );
}

// The worker's rate-limit map is module-level, so every scenario uses a fresh
// IP. Sharing one would make results order-dependent.
let n = 0;
const nextIp = () => `203.0.113.${++n}`;

const out = {};

// --- validation -------------------------------------------------------------
{
  const kv = makeKV();
  const res = await post('not-an-email', nextIp(), { INTEREST_EMAILS: kv });
  out.invalid = { status: res.status, kvSize: kv.store.size };
}
{
  const kv = makeKV();
  const res = await post(`${'a'.repeat(250)}@example.com`, nextIp(), {
    INTEREST_EMAILS: kv,
  });
  out.tooLong = { status: res.status, kvSize: kv.store.size };
}
{
  const kv = makeKV();
  const res = await post('ada@example.com', nextIp(), { INTEREST_EMAILS: kv });
  out.valid = {
    status: res.status,
    keys: [...kv.store.keys()],
    record: JSON.parse(kv.store.get('ada@example.com') ?? '{}'),
  };
}
{
  const kv = makeKV();
  await post('  Ada@Example.COM  ', nextIp(), { INTEREST_EMAILS: kv });
  out.normalised = { keys: [...kv.store.keys()] };
}

// --- duplicate + fail-closed ------------------------------------------------
{
  const kv = makeKV();
  const ip = nextIp();
  await post('dup@example.com', ip, { INTEREST_EMAILS: kv });
  const first = kv.store.get('dup@example.com');
  const res = await post('DUP@example.com', ip, { INTEREST_EMAILS: kv });
  out.duplicate = {
    status: res.status,
    kvSize: kv.store.size,
    unchanged: kv.store.get('dup@example.com') === first,
  };
}
{
  const res = await post('ada@example.com', nextIp(), {});
  out.noKvBinding = { status: res.status };
}

// --- rate limiting ----------------------------------------------------------
{
  const kv = makeKV();
  const ip = nextIp();
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const r = await post(`user${i}@example.com`, ip, { INTEREST_EMAILS: kv });
    codes.push(r.status);
    if (r.status === 429) out.retryAfter = r.headers.get('Retry-After');
  }
  out.rateLimit = { codes };
}
{
  const kv = makeKV();
  const busy = nextIp();
  for (let i = 0; i < 6; i++) {
    await post(`b${i}@example.com`, busy, { INTEREST_EMAILS: kv });
  }
  const fresh = await post('innocent@example.com', nextIp(), {
    INTEREST_EMAILS: kv,
  });
  out.perIpIsolation = { freshStatus: fresh.status };
}

// --- SEC-21 F-23: escaping in the notification body -------------------------
{
  const kv = makeKV();
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ?? '' });
    return new Response('{}', { status: 200 });
  };
  try {
    // isValidEmail's local part is [^\s@]+, so this address IS valid and does
    // reach the notification body. escapeHtml is the only thing guarding it.
    await post('<b>x</b>@example.com', nextIp(), {
      INTEREST_EMAILS: kv,
      RESEND_API_KEY: 'test-key',
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  // Match the HOST exactly rather than substring-matching the URL. A
  // `.includes('api.resend.com')` test would also match
  // `https://api.resend.com.evil.test/`, which CodeQL flags as
  // js/incomplete-url-substring-sanitization — correctly, even here: picking
  // the wrong recorded call would make the escaping assertion below silently
  // examine the wrong payload.
  const isResend = (u) => {
    try {
      return new URL(u).hostname === 'api.resend.com';
    } catch {
      return false;
    }
  };
  const resend = sent.find((s) => isResend(s.url));
  // Split the payload: `html` is rendered as markup and is what escapeHtml
  // guards; `subject` is plain text in every mail client, so it legitimately
  // carries the raw address. Asserting over the whole serialised body would
  // conflate the two and fail on the safe one.
  const payload = resend ? JSON.parse(resend.body) : {};
  out.escaping = {
    calledResend: Boolean(resend),
    html: payload.html ?? '',
    subject: payload.subject ?? '',
  };
}

process.stdout.write(JSON.stringify(out));
