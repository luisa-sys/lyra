# Daily Security Check — Claude Code cloud-routine setup

> **Ticket:** KAN-296 (automation) · parent KAN-294 (the checklist) · runs `docs/DAILY_SECURITY_CHECK.md`

This is the **automation** for the daily security check. It runs as a **scheduled Claude Code routine on the web** — a cloud container that spins up on a timer, clones the repo, runs the read-only probes, compares them to the baseline, files a BUGS ticket for anything new, and appends a run-log row. Chosen over a GitHub Action because the highest-value probes (Supabase `get_advisors`/SQL, GitHub/Cloudflare read APIs) run through MCP servers the agent already has, and the agent can triage + file tickets itself.

Background on routines, environments, network policy, and triggers: <https://code.claude.com/docs/en/claude-code-on-the-web>.

---

## How the run is split

| Layer | Driven by | Covers |
|---|---|---|
| Deterministic HTTP / port probes | `scripts/daily-security-check.sh` (plain shell + curl) | §A web/edge, §C MCP transport — A1–A9, C1/C2/C7 |
| MCP-tool probes | the **agent**, via Supabase / GitHub / Cloudflare MCP | §B Supabase (B1–B9), §D/E GitHub & supply-chain, §A8 Cloudflare |
| Triage + reporting | the agent | compare to regression map, file tickets, append run log |

The script is deliberately small and self-contained; everything that needs a credentialed MCP call is the agent's job so no long-lived API tokens have to live in the container.

---

## One-time prerequisites

### 1. Network egress allowlist (this is why our first manual run got 403s)

The routine's environment network policy **must allow** outbound HTTPS to:

```
checklyra.com
*.checklyra.com          (dev., stage., beta.)
mcp.checklyra.com
mcp-dev.checklyra.com
*.supabase.co            (storage-enumeration probe B5)
api.github.com           (only if the agent uses raw gh API; MCP path needs none)
api.cloudflare.com       (only if not using the Cloudflare MCP)
```

Pick the environment network policy that permits these hosts (or a custom allowlist). Without it the script correctly reports **UNVERIFIED**, never a false PASS — but you get no real coverage.

### 2. MCP servers enabled in the routine environment

- **Supabase** — `get_advisors`, `execute_sql` (SELECT), `list_migrations` on all three projects (`llzkgprqewuwkiwclowi`, `uobmlkzrjkptwhttzmmi`, `ilprytcrnqyrsbsrfujj`).
- **GitHub** — read: code-scanning alerts, dependabot alerts, secret-scanning, workflow runs, branches/branch-protection.
- **Cloudflare** — read: `kv_namespaces_list`, `r2_buckets_list`, `workers_list`.
- **Atlassian** — to file BUGS tickets and (optionally) append a Risk-Register note.

### 3. Secrets / tokens — least-privilege, **read-only**

- **No service-role keys. No write tokens. No `LYRA_RELEASE_PAT`.**
- Supabase access is via the Supabase MCP (scoped read) — no DB URL needed in the container.
- GitHub/Cloudflare read access is via their MCP servers; if you instead want the script to call raw APIs, provide a **fine-grained read PAT** (`code-scanning:read`, `dependabot:read`, `secret-scanning:read`, `contents:read`, `administration:read` for branch protection) and a **Cloudflare read token** (`Zone:Read`, `KV:Read`, `Workers:Read`).
- `LYRA_ANON_KEY_PROD` — the **public** Supabase anon key, only for the storage-enumeration probe (B5). It is public-by-design; safe to place in the env.

### 4. Setup script (SessionStart, optional)

```bash
chmod +x scripts/daily-security-check.sh
command -v jq >/dev/null || echo "note: jq not present (agent can parse JSON instead)"
```

---

## Create the routine

1. Open <https://claude.ai/code> → select **luisa-sys/lyra** → create a **scheduled routine** (Automations / Schedules).
2. **Schedule:** daily **06:00 UTC** (before the working day; after the Sunday 02:00–05:00 backup/restore jobs so their results are fresh).
3. **Base branch:** `develop` (read-only checkout). The run-log update lands on a throwaway branch via **draft PR**, never a direct push to a protected branch.
4. **Network policy:** the allowlist in §1.
5. **Permissions:** allow read-only `Bash` (curl + the script) and the read MCP tools above + Atlassian *create*; **deny** Supabase/Cloudflare/Vercel writes and any push to `main`/`beta`/`staging`.
6. **Prompt:** paste the trigger prompt below.

---

## The routine trigger prompt

```
You are running the daily security check for checklyra.com (KAN-294). Work READ-ONLY:
no probe may mutate prod; you may only (a) create Jira tickets and (b) append the run
log via a draft PR.

1. Run: bash scripts/daily-security-check.sh   (capture every PASS/FAIL/UNVERIFIED line).
2. Run the MCP-tool probes the script cannot, per docs/DAILY_SECURITY_CHECK.md:
   - Supabase get_advisors(type=security) AND the B1–B9 SQL on all three projects
     (llzkgprqewuwkiwclowi, uobmlkzrjkptwhttzmmi, ilprytcrnqyrsbsrfujj). Pay special
     attention to B3 (vault grants), B5 (storage SELECT policies), B9 (extra anon/auth
     definer fns), and the search_by_contact_hash grant (F-04 / BUGS-45).
   - GitHub: open code-scanning + dependabot + secret-scanning alert counts for
     luisa-sys/lyra AND luisa-sys/lyra-mcp-server; branch protection on main/beta/staging
     and lyra-mcp-server@main; CODEOWNERS + SECURITY.md presence (E1–E4).
   - Cloudflare: kv/r2/workers list for the §A8 / DP-04 posture.
3. Compare EVERY result against the "Risk-Register regression map" and the last run-log
   row in docs/DAILY_SECURITY_CHECK.md. Treat UNVERIFIED as a soft-FAIL, never a pass.
4. For any NEW finding (a probe that newly FAILs, or a 🔴/🟠 not already covered by an
   open BUGS/SEC ticket — check Jira first), create a BUGS ticket: summary
   "[SEC][<sev>] <short>", the 6-section standard, labels security + risk-audit-2026-06.
   Do NOT fix anything; do NOT touch prod.
5. Append one run-log row to docs/DAILY_SECURITY_CHECK.md (date, runner=cloud-routine,
   🔴/🟠 counts, new tickets, one-line notes) and open a DRAFT PR with only that change.
6. If any 🔴: put a clear "PAGE:" summary at the very top of your final reply.
   If clean: state "all green" with the PASS/UNVERIFIED counts; still append the log row.
```

---

## Output & alerting

- The routine session transcript + the draft PR's run-log row are the record.
- A 🔴 surfaces as the `PAGE:` line and (if subscribed) the session notification.
- **Optional next step (KAN-296 step 5):** add a Resend email on FAIL, reusing the
  `weekly-report.yml` Resend plumbing, so a red run reaches the inbox without opening the
  session. Keep it under the Workflow & Backup Integrity Policy — fail loud, never silent-skip.

## Why not a GitHub Action?

A cron Action can run `scripts/daily-security-check.sh` (the HTTP layer) fine, but it can't
drive the Supabase/GitHub/Cloudflare **MCP** probes or triage/file tickets with judgement —
which is where most of the value is (B1–B9, the advisor sweep, branch-protection). The cloud
routine gets both halves in one place. The Action remains a reasonable **fallback** for the
pure-HTTP subset if you want a second, dumber signal.
