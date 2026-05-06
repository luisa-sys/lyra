#!/usr/bin/env node
/**
 * KAN-163: bootstrap UptimeRobot monitors for all Lyra environments.
 *
 *   UPTIMEROBOT_API_KEY=ur-xxxxxx                                       \
 *   ALERT_EMAILS=luisa@santos-stephens.com,ben@santos-stephens.com      \
 *     node scripts/uptimerobot/bootstrap.js [--apply]
 *
 * Default mode is DRY-RUN: no writes happen, the script prints the diff
 * between desired state and what's already in UptimeRobot. Pass `--apply`
 * to actually create the missing monitors and alert contacts.
 *
 * Idempotent: re-running with --apply against an already-configured
 * account is a no-op (matched by friendly_name / email value).
 */

'use strict';

const {
  ALERT_CONTACT_TYPE,
  LYRA_MONITORS,
  makeClient,
  planContactDiff,
  planMonitorDiff,
} = require('./lib');

const APPLY = process.argv.includes('--apply');

function log(msg) {
  console.log(msg);
}

async function main() {
  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  const alertEmails = (process.env.ALERT_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!apiKey) {
    log('::error::UPTIMEROBOT_API_KEY is not set in env. Refusing to run.');
    log('See docs/UPTIMEROBOT_SETUP.md for how to obtain and pass the key.');
    process.exit(1);
  }
  if (alertEmails.length === 0) {
    log('::error::ALERT_EMAILS is empty. Pass a comma-separated list of recipient emails.');
    process.exit(1);
  }

  const client = makeClient({ apiKey });

  log(APPLY ? '⚙️  Mode: APPLY (will write to UptimeRobot)' : '🧪 Mode: DRY-RUN (no writes; pass --apply to commit)');
  log('');

  // Sanity-check the API key works AND returns a free-or-better account.
  const account = await client.getAccountDetails();
  const acct = account.account || {};
  log(`Account: ${acct.email || '(no email)'}  monitor limit: ${acct.monitor_limit ?? '?'}  used: ${acct.up_monitors ?? '?'}+${acct.down_monitors ?? '?'}+${acct.paused_monitors ?? '?'}`);
  log('');

  // Alert contacts first — newMonitor needs their IDs.
  const contactsResp = await client.getAlertContacts();
  const contactDiff = planContactDiff(contactsResp.alert_contacts || [], alertEmails);

  log(`Alert contacts: ${contactDiff.present.length} present, ${contactDiff.toCreate.length} to create`);
  for (const p of contactDiff.present) {
    log(`  ✅ ${p.value} (id ${p.id}, status ${p.status})`);
  }
  for (const c of contactDiff.toCreate) {
    log(`  ➕ would create: ${c.value}`);
  }

  const createdContactIds = [];
  if (APPLY) {
    for (const c of contactDiff.toCreate) {
      const res = await client.newAlertContact({
        friendlyName: c.value,
        type: ALERT_CONTACT_TYPE.EMAIL,
        value: c.value,
      });
      const id = res.alertcontact?.id;
      log(`  + created contact ${c.value} (id ${id})`);
      createdContactIds.push(id);
    }
  }

  // Build the contact-id list to attach to monitors. Format required by
  // UptimeRobot is `id_threshold_recurrence-id_threshold_recurrence-...`
  // — for plain email alerts, threshold=0 (immediate) and recurrence=0
  // (no re-alerting) is what we want.
  const allContactIds = [
    ...contactDiff.present.map((p) => p.id),
    ...createdContactIds,
  ];
  const alertContactsParam = allContactIds.map((id) => `${id}_0_0`).join('-');
  log('');

  // Monitors next.
  const monitorsResp = await client.getMonitors();
  const monitorDiff = planMonitorDiff(monitorsResp.monitors || [], LYRA_MONITORS);

  log(`Monitors: ${monitorDiff.unchanged.length} unchanged, ${monitorDiff.toUpdate.length} need update, ${monitorDiff.toCreate.length} to create`);
  for (const u of monitorDiff.unchanged) {
    log(`  ✅ ${u.friendlyName} (id ${u.id})`);
  }
  for (const u of monitorDiff.toUpdate) {
    if (u.reason === 'url-mismatch') {
      log(`  ⚠️  ${u.friendlyName} (id ${u.id}) URL drift: have=${u.currentUrl} want=${u.desiredUrl} — review manually`);
    } else if (u.reason === 'custom-http-statuses-mismatch') {
      log(`  🔧 ${u.friendlyName} (id ${u.id}) custom_http_statuses drift: have='${u.currentCustomHttpStatuses}' want='${u.desiredCustomHttpStatuses}' — will reconcile on --apply`);
    } else {
      log(`  ⚠️  ${u.friendlyName} (id ${u.id}) needs update (reason: ${u.reason})`);
    }
  }
  for (const c of monitorDiff.toCreate) {
    const extras = c.customHttpStatuses ? ` (custom_http_statuses=${c.customHttpStatuses})` : '';
    log(`  ➕ would create: ${c.friendlyName} → ${c.url}${extras}`);
  }

  if (APPLY) {
    // UptimeRobot throttles newMonitor (~1 req/3s on free tier).
    // Throttle locally + retry on 429 with longer backoff so the script
    // is reliable end-to-end without operator intervention.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const callWithRetry = async (fn, label) => {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err) {
          attempt++;
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('429') && attempt <= 4) {
            const wait = 10000 * attempt;
            log(`  ⏳ 429 from UptimeRobot on ${label}, sleeping ${wait}ms before retry ${attempt}/4`);
            await sleep(wait);
            continue;
          }
          throw err;
        }
      }
    };

    for (let i = 0; i < monitorDiff.toCreate.length; i++) {
      const c = monitorDiff.toCreate[i];
      const res = await callWithRetry(
        () =>
          client.newMonitor({
            friendlyName: c.friendlyName,
            url: c.url,
            alertContacts: alertContactsParam,
            customHttpStatuses: c.customHttpStatuses,
          }),
        `newMonitor(${c.friendlyName})`
      );
      log(`  + created monitor ${c.friendlyName} (id ${res.monitor?.id})`);
      if (i < monitorDiff.toCreate.length - 1) {
        await sleep(4000);
      }
    }

    // Reconcile custom_http_statuses drift (e.g. SSO env was added later
    // and existing monitors don't have the override). URL drift stays a
    // manual review — that's intentional per planMonitorDiff's contract.
    const statusUpdates = monitorDiff.toUpdate.filter(
      (u) => u.reason === 'custom-http-statuses-mismatch'
    );
    for (let i = 0; i < statusUpdates.length; i++) {
      const u = statusUpdates[i];
      await callWithRetry(
        () =>
          client.editMonitor({
            id: u.id,
            customHttpStatuses: u.desiredCustomHttpStatuses,
          }),
        `editMonitor(${u.friendlyName} custom_http_statuses)`
      );
      log(`  ✏️  edited ${u.friendlyName} (id ${u.id}) custom_http_statuses → ${u.desiredCustomHttpStatuses}`);
      if (i < statusUpdates.length - 1) {
        await sleep(4000);
      }
    }
  }

  log('');
  log(APPLY ? '✅ Done.' : 'ℹ️  Dry-run complete. Re-run with --apply to commit changes.');
}

main().catch((err) => {
  log(`::error::Bootstrap failed: ${err.message}`);
  process.exit(1);
});
