# UptimeRobot Monitoring Setup (KAN-163)

This is the one-time setup procedure for Lyra's external uptime monitoring. Once complete, UptimeRobot becomes the **primary signal** for environment availability and SSL-certificate expiry across all four envs (prod, beta, stage, dev) plus both MCP servers. The 6-hourly GitHub Actions health-check stays as a redundant secondary signal.

Total time: ~10 minutes for the human steps; the bootstrap script (step 3) provisions the actual monitors.

## 1. Sign up for UptimeRobot

Go to <https://uptimerobot.com/> and create an account on the **Free** plan. The free plan covers everything Lyra needs:

- Up to 50 monitors at a 5-minute interval
- HTTPS keyword & SSL expiry monitoring on every monitor
- Email alerts (no SMS, no Slack on free — that's fine for now)
- 2 months of detailed log retention

Use **`luisa@santos-stephens.com`** as the account email. Enable 2FA immediately under **My Settings → Two-Factor Authentication** — this is in the security review for KAN-163 and the account becomes a single-point-of-failure for outage detection if it gets compromised.

After signup, store the account credentials in 1Password under the existing "Lyra services" vault.

## 2. Generate a Main API key

1. In UptimeRobot, click your avatar (top right) → **My Settings**.
2. Scroll to **API Settings**.
3. Click **Create Main API Key**. Give it a label like `Lyra bootstrap (Claude)`.
4. Copy the key (it starts with `ur-`). Treat this like a password — it has full read/write on every monitor in the account.

The Main API key is what the bootstrap script needs. There's also a Read-Only API key option — don't use that one; the script needs to create monitors and alert contacts.

## 3. Run the bootstrap (founder, in your own shell)

**Run the bootstrap yourself, locally, with the key set only in your own shell — never paste the key into this chat, a Jira ticket, a commit, or a screenshot.** The Main API key from step 2 has full read/write on every monitor in the account, so treat it exactly like a password: it must never appear in Claude's chat history or anywhere else it could be captured and replayed. Claude does not need the key to help here — it can read the results after you run the script. (Step 4 below lists exactly which monitors and alert contacts the script creates.)

From a checkout of the lyra repo, dry-run first (writes nothing — it just prints the diff between the desired monitors/contacts and what already exists in the account):

```bash
UPTIMEROBOT_API_KEY=ur-xxxxxxxx \
ALERT_EMAILS=luisa@santos-stephens.com,ben@santos-stephens.com \
  node scripts/uptimerobot/bootstrap.js
```

When the dry-run looks right, re-run with `--apply` to create the missing monitors and alert contacts:

```bash
UPTIMEROBOT_API_KEY=ur-xxxxxxxx \
ALERT_EMAILS=luisa@santos-stephens.com,ben@santos-stephens.com \
  node scripts/uptimerobot/bootstrap.js --apply
```

The script:
- Verifies the API key works (calls `getAccountDetails`) before doing anything else
- Lists existing alert contacts and creates any missing ones (matches by email value, case-insensitive)
- Lists existing monitors and creates any missing ones (matches by `friendly_name`, exact)
- Flags URL drift on existing monitors as a manual review item rather than silently overwriting
- Defaults to dry-run; only writes when you pass `--apply`

It is idempotent — running it once or 100 times produces the same end state, so re-running `--apply` against an already-configured account is a no-op.

To keep the key out of your shell history, either prefix each command with a leading space (with `HISTCONTROL=ignorespace` set) or read it into an exported variable from a hidden prompt (`read -rs UPTIMEROBOT_API_KEY && export UPTIMEROBOT_API_KEY`) instead of typing it inline.

Once it reports green, continue to step 5 to verify the alert path. The key is not needed again after this — UptimeRobot runs from its own dashboard, and you can rotate the key at any time without affecting running monitors (see "Rotation and offboarding").

## 4. What the bootstrap creates

The bootstrap (step 3) creates two things:

**Alert contacts** (one per email, type=email):
- `luisa@santos-stephens.com`
- `ben@santos-stephens.com`

**Monitors** (HTTP, 5-minute interval, SSL expiry reminder enabled):

| Friendly name | URL |
| --- | --- |
| Lyra prod — checklyra.com | <https://checklyra.com/> |
| Lyra prod — privacy | <https://checklyra.com/privacy> |
| Lyra beta — beta.checklyra.com | <https://beta.checklyra.com/> |
| Lyra stage — stage.checklyra.com | <https://stage.checklyra.com/> |
| Lyra dev — dev.checklyra.com | <https://dev.checklyra.com/> |
| Lyra MCP prod — mcp.checklyra.com | <https://mcp.checklyra.com/health> |
| Lyra MCP dev — mcp-dev.checklyra.com | <https://mcp-dev.checklyra.com/health> |

The canonical list is in [`scripts/uptimerobot/lib.js`](../scripts/uptimerobot/lib.js) under `LYRA_MONITORS` — it's deliberately kept tiny and pure-data so the weekly report can cross-check UptimeRobot's view of the world against its own Section 1 endpoint health (KAN-165 follow-up).

## 5. Verify the alert path

Once the bootstrap reports green, induce a deliberate failure on `dev.checklyra.com` (the safest env to test) by temporarily renaming the Vercel project or pausing the deployment. UptimeRobot should fire an email alert to both addresses within ~10 minutes. Restore the deployment immediately after the alert lands.

This step is required by the KAN-163 acceptance criteria and confirms the email path actually works end-to-end (deliverability, not just config).

## 6. Add the dashboard link to lyra-project-reference

Once the bootstrap is done, replace the placeholder in [`docs/lyra-project-reference.jsx`](./lyra-project-reference.jsx) under the `monitoring` block with your real UptimeRobot dashboard URL (visible in the address bar after sign-in — typically `https://dashboard.uptimerobot.com/monitors`).

## Rotation and offboarding

The Main API key has full write access. Rotate it under the same conditions as `LYRA_BACKUP_PAT` (KAN-170): annually, plus immediately if you ever paste it anywhere it shouldn't be (chat history, screenshots, public commits). Rotation is non-disruptive — generating a new key and revoking the old one in **My Settings → API Settings** does not affect running monitors or alerts.

If Ben leaves the project, remove `ben@santos-stephens.com` from the alert contacts and re-run the bootstrap (or remove via dashboard). The script does not delete contacts — only adds — so removal is always a deliberate manual step.

## Reference

- UptimeRobot API v2: <https://uptimerobot.com/api/>
- KAN-163 ticket: <https://checklyra.atlassian.net/browse/KAN-163>
- Related: KAN-84 (production launch), KAN-63 (autonomous monitoring epic), KAN-165 (status dashboard).
