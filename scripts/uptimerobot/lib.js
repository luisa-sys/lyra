/**
 * KAN-163: UptimeRobot API v2 client.
 *
 * Pure functions for the API surface we actually use. Designed to be
 * trivially mockable: the only side-effect is `httpClient(url, init)`, which
 * defaults to global `fetch` but can be injected for tests.
 *
 * UptimeRobot API reference: https://uptimerobot.com/api/
 * - All requests are POST with form-urlencoded body.
 * - `api_key` and `format=json` are required on every call.
 * - Free tier supports 50 monitors at a 5-minute minimum interval (300s).
 */

'use strict';

const API_BASE = 'https://api.uptimerobot.com/v2';

const MONITOR_TYPE = {
  HTTP: 1,
  KEYWORD: 2,
  PING: 3,
  PORT: 4,
  HEARTBEAT: 5,
};

const ALERT_CONTACT_TYPE = {
  SMS: 1,
  EMAIL: 2,
  TWITTER: 3,
  WEBHOOK: 5,
  PUSHBULLET: 6,
  ZAPIER: 7,
  PUSHOVER: 9,
  HTTP_NOTIFICATION: 10,
  VOICE_CALL: 11,
  SLACK: 11,
};

const FIVE_MINUTES = 300;

function makeFormBody(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

function makeClient({ apiKey, httpClient = (typeof fetch === 'function' ? fetch : null) } = {}) {
  if (!apiKey) {
    throw new Error('UPTIMEROBOT_API_KEY is required (set it in env or pass apiKey).');
  }
  if (!httpClient) {
    throw new Error('No fetch available — pass httpClient or run on Node 18+.');
  }

  async function call(path, body = {}) {
    const fullBody = makeFormBody({ api_key: apiKey, format: 'json', ...body });
    const res = await httpClient(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: fullBody,
    });
    if (!res.ok) {
      throw new Error(`UptimeRobot ${path}: HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    if (json.stat !== 'ok') {
      const errMsg = json.error?.message || json.error?.type || JSON.stringify(json.error);
      throw new Error(`UptimeRobot ${path} returned non-ok: ${errMsg}`);
    }
    return json;
  }

  return {
    getAccountDetails: () => call('getAccountDetails'),
    getAlertContacts: () => call('getAlertContacts'),
    newAlertContact: ({ friendlyName, type, value }) =>
      call('newAlertContact', {
        friendly_name: friendlyName,
        type,
        value,
      }),
    getMonitors: (search) =>
      call('getMonitors', search ? { search } : {}),
    newMonitor: ({
      friendlyName,
      url,
      type = MONITOR_TYPE.HTTP,
      interval = FIVE_MINUTES,
      alertContacts,
      sslExpirationReminder = 1,
      timeout = 30,
      httpMethodType = 1,
      customHttpStatuses,
    }) =>
      call('newMonitor', {
        friendly_name: friendlyName,
        url,
        type,
        interval,
        alert_contacts: alertContacts,
        ssl_expiration_reminder: sslExpirationReminder,
        timeout,
        http_method_type: httpMethodType,
        custom_http_statuses: customHttpStatuses,
      }),
    editMonitor: ({ id, alertContacts, interval, sslExpirationReminder = 1, customHttpStatuses }) =>
      call('editMonitor', {
        id,
        alert_contacts: alertContacts,
        interval,
        ssl_expiration_reminder: sslExpirationReminder,
        custom_http_statuses: customHttpStatuses,
      }),
  };
}

/**
 * Canonical Lyra monitor list. Single source of truth — used by both the
 * bootstrap script and any cross-check that compares UptimeRobot's view of
 * the world against weekly-report Section 1.
 *
 * Each entry: a `friendlyName` we use as the idempotency key (search by
 * exact match before creating), the URL the monitor should poll, and
 * optionally `customHttpStatuses` to override the default "200-299 = up,
 * 300-599 = down" classification.
 *
 * The `customHttpStatuses` format is UptimeRobot's: `<code>:<1|0>_<code>:<1|0>...`
 * where 1 = consider as "up", 0 = consider as "down".
 *
 * Why we override status mapping on dev/stage:
 * - dev.checklyra.com and stage.checklyra.com sit behind Vercel SSO,
 *   which returns 401 for unauthenticated traffic. UptimeRobot's free
 *   scraper has no way to authenticate, so it always sees 401. Without
 *   the override, both monitors stay falsely DOWN forever.
 * - The 401 means "Vercel SSO is alive and refusing me", which is
 *   exactly the signal we want for "the deployment is up". A real
 *   outage on those envs would return 502/503/timeout, which we still
 *   want to alert on.
 * - 403 is also accepted-as-up because Cloudflare bot challenge
 *   sometimes returns 403 to UptimeRobot's IPs (CLAUDE.md gotcha #7).
 */
const LYRA_MONITORS = Object.freeze([
  { friendlyName: 'Lyra prod — checklyra.com',         url: 'https://checklyra.com/' },
  { friendlyName: 'Lyra prod — privacy',               url: 'https://checklyra.com/privacy' },
  { friendlyName: 'Lyra beta — beta.checklyra.com',    url: 'https://beta.checklyra.com/' },
  { friendlyName: 'Lyra stage — stage.checklyra.com',  url: 'https://stage.checklyra.com/', customHttpStatuses: '200:1_401:1_403:1' },
  { friendlyName: 'Lyra dev — dev.checklyra.com',      url: 'https://dev.checklyra.com/',   customHttpStatuses: '200:1_401:1_403:1' },
  { friendlyName: 'Lyra MCP prod — mcp.checklyra.com', url: 'https://mcp.checklyra.com/health' },
  { friendlyName: 'Lyra MCP dev — mcp-dev.checklyra.com', url: 'https://mcp-dev.checklyra.com/health' },
]);

/**
 * Compute the diff between desired monitors and what UptimeRobot already
 * has. Pure function — given the existing monitor list and the desired
 * list, returns the actions to take. Tested without any HTTP.
 *
 * Match key: `friendly_name` (exact). UptimeRobot allows any URL change
 * later via editMonitor, but renaming is a manual concern.
 */
function planMonitorDiff(existing, desired) {
  const existingByName = new Map();
  for (const m of existing || []) {
    existingByName.set(m.friendly_name, m);
  }
  const toCreate = [];
  const toUpdate = [];
  const unchanged = [];
  for (const want of desired) {
    const have = existingByName.get(want.friendlyName);
    if (!have) {
      toCreate.push(want);
      continue;
    }
    // We don't reconcile the URL automatically — surface a manual flag
    // instead, because URL change usually means a real config decision.
    if (have.url !== want.url) {
      toUpdate.push({
        id: have.id,
        friendlyName: want.friendlyName,
        currentUrl: have.url,
        desiredUrl: want.url,
        reason: 'url-mismatch',
      });
      continue;
    }
    // Reconcile customHttpStatuses if it differs. UptimeRobot's API
    // returns `custom_http_statuses` as a string like "200-1_401-1_403-1"
    // (yes, with hyphens between code and flag, even though the API
    // accepts underscores on input). Normalise both sides for compare.
    const normalise = (s) => (s || '').replace(/[-_]/g, ':').replace(/(\d):/g, '$1:');
    const haveStatuses = normalise(have.custom_http_statuses);
    const wantStatuses = normalise(want.customHttpStatuses);
    if (haveStatuses !== wantStatuses) {
      toUpdate.push({
        id: have.id,
        friendlyName: want.friendlyName,
        currentCustomHttpStatuses: have.custom_http_statuses || '',
        desiredCustomHttpStatuses: want.customHttpStatuses || '',
        reason: 'custom-http-statuses-mismatch',
      });
      continue;
    }
    unchanged.push({ id: have.id, friendlyName: want.friendlyName });
  }
  return { toCreate, toUpdate, unchanged };
}

/**
 * Compute the diff between desired alert contacts and existing. Same shape
 * as planMonitorDiff. Match key: email value (case-insensitive).
 */
function planContactDiff(existing, desiredEmails) {
  const existingByValue = new Map();
  for (const c of existing || []) {
    if (c.type === ALERT_CONTACT_TYPE.EMAIL) {
      existingByValue.set(String(c.value).toLowerCase(), c);
    }
  }
  const toCreate = [];
  const present = [];
  for (const email of desiredEmails) {
    const have = existingByValue.get(email.toLowerCase());
    if (have) {
      present.push({ id: have.id, value: have.value, status: have.status });
    } else {
      toCreate.push({ value: email });
    }
  }
  return { toCreate, present };
}

module.exports = {
  API_BASE,
  MONITOR_TYPE,
  ALERT_CONTACT_TYPE,
  FIVE_MINUTES,
  LYRA_MONITORS,
  makeClient,
  makeFormBody,
  planMonitorDiff,
  planContactDiff,
};
