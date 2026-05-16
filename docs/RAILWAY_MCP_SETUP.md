# Railway MCP Connector Setup (KAN-103)

> Deploy the community Railway MCP server (Travis-Gilbert/Railway-mcp) onto Railway itself and add it as a custom connector in Claude.ai. Closes the operational gap: every Lyra service has a Claude connector EXCEPT Railway, and that gap is what forces dashboard trips for deploy status / log retrieval / variable management.

## Why this exists

The official `@railway/mcp-server` is stdio-only — works with Claude Desktop / Code, but cannot be added as a `claude.ai` custom connector. The community fork Travis-Gilbert/Railway-mcp speaks `streamable-http` and exposes 17 tools (services, deployments, variables, logs, domains, projects), which is exactly what we need from the web Claude.

## Pre-flight checks (do these before clicking Deploy)

- [ ] Railway account 2FA verified (see `docs/CYBER_LOCKDOWN.md` Railway section)
- [ ] A fresh Railway API token created with **least-privilege scope** — only the workspace that contains `lyra-mcp-server`, NOT account-wide:
  - <https://railway.com/account/tokens> → New Token → scope to workspace
  - Copy the token immediately (only shown once)
- [ ] Decide on a public hostname. Options:
  - `mcp-railway.checklyra.com` (recommended — fits existing CNAME pattern + tells you what it is)
  - The default `<project>.up.railway.app` subdomain (simpler but harder to remember)

## Deployment steps

1. **Fork the upstream repo** to `luisa-sys/Railway-mcp` so we have a stable revision pinned (the community repo can rebase / break):
   ```bash
   gh repo fork Travis-Gilbert/Railway-mcp --clone=false --remote=false
   ```
   Or use the GitHub UI fork button.

2. **Pin a known-good commit.** In your fork:
   - Note the current HEAD commit on `main`
   - Create a `lyra-prod` branch from it and use that as Railway's deploy source

3. **Create a new Railway service from the fork.** In the Railway dashboard:
   - New Project → Deploy from GitHub repo → `luisa-sys/Railway-mcp`
   - Branch: `lyra-prod`
   - Root directory: `/` (or whatever the README specifies)
   - Build command: as per repo's `package.json` (probably `npm install && npm run build`)
   - Start command: as per repo's README (probably `npm start`)

4. **Set environment variables on the new Railway service:**
   - `RAILWAY_API_TOKEN` = the workspace-scoped token from pre-flight
   - `PORT` = (Railway sets this automatically — leave alone unless the README says otherwise)
   - Mark `RAILWAY_API_TOKEN` as **sealed** so it can never be read back, only overwritten

5. **Generate a public domain:**
   - Railway service → Settings → Networking → Generate Domain
   - If using a custom hostname, also add a CNAME in Cloudflare:
     - `mcp-railway` → `<service>.up.railway.app`
     - Proxy: **OFF** (orange-cloud breaks streamable-http with chunked transfer in some configs — verify by testing both ways)
     - Add the custom domain in the Railway Networking section

6. **Verify the service is up:**
   ```bash
   curl -sI https://mcp-railway.checklyra.com/mcp     # or the up.railway.app URL
   # Expect HTTP 200 (or 405 if it only accepts POST — that's fine, just a smoke check)
   ```

7. **Add the connector in Claude.ai:**
   - Settings → Connectors → Add custom connector
   - URL: `https://mcp-railway.checklyra.com/mcp`
   - Auth: depends on the upstream repo — likely none (token is server-side) but check the README
   - Save

8. **Smoke test from a fresh Claude.ai conversation:**
   - "List my Railway services" → should return at least `lyra-mcp-server`
   - "Show recent deployments of `lyra-mcp-server`" → should show the latest deploys
   - "Show the last 50 log lines from `lyra-mcp-server`" → should stream logs
   - "What environment variables does `lyra-mcp-server` have?" → should list variable NAMES only (values masked if the upstream repo masks them — verify)

## Security considerations

- The Railway API token has high blast radius — it can deploy/restart/destroy any service in the scoped workspace. **Sealed env var only.** Never echo, never log, never commit.
- The MCP server itself is publicly reachable. The upstream community repo MAY accept unauthenticated MCP requests. Before going live, confirm:
  - Does the upstream support an auth mechanism (token in header)? If yes, enable it and put the auth header in Claude.ai's custom connector config.
  - If not, the public URL is effectively a backdoor to your Railway account. Mitigate with **Cloudflare Access in front** (zero-trust auth via email magic link, scoped to luisa@santos-stephens.com only):
    - Cloudflare → Zero Trust → Access → Applications → Add a self-hosted application
    - Hostname: `mcp-railway.checklyra.com`
    - Policy: allow only `luisa@santos-stephens.com`
    - This MAY break Claude.ai's connector flow — if so, switch to a header-based token instead, generated and stored in Cloudflare KV.

- Log retention: confirm Railway's default service log retention is OK for this — if not, lower it.

- **Rotation:** put RAILWAY_API_TOKEN in `docs/SECURITY_ROTATION.md` with quarterly cadence. Update on rotation.

## Monitoring

- Add the new Railway service to `docs/UPTIMEROBOT_SETUP.md` and re-run the bootstrap so it gets a monitor.
- The Workers/Cloudflare alert path will already cover the CNAME / Cloudflare side; only the Railway service itself needs new monitoring.

## Acceptance criteria (KAN-103)

- [ ] Service deployed on Railway, reachable on a stable URL
- [ ] Claude.ai custom connector configured and connected
- [ ] Smoke test passes — list services, deployments, logs from a Claude.ai conversation
- [ ] Auth posture documented (token / Cloudflare Access / both) — no unauthenticated public access
- [ ] `docs/SECURITY_ROTATION.md` updated with `RAILWAY_API_TOKEN` entry
- [ ] `docs/CYBER_LOCKDOWN.md` Railway section ticked off

## Reference

- Upstream: <https://github.com/Travis-Gilbert/Railway-mcp>
- Official Railway MCP (stdio-only, not usable here): <https://github.com/railwayapp/mcp>
- Lyra runbook: `docs/RUNBOOK.md`
- Security baseline: `docs/SECURITY_ROTATION.md`, `docs/CYBER_LOCKDOWN.md`

## Decision log

When you complete the deployment, append a line here so we have an audit trail of what was actually deployed (not just what was planned):

```
YYYY-MM-DD — deployed from commit <SHA> on luisa-sys/Railway-mcp@lyra-prod — public URL <URL> — auth posture <none|token|cf-access>
```
