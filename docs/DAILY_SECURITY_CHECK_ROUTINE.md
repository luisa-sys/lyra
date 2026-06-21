# Daily Security Check — Claude Code cloud-routine setup

> **Ticket:** KAN-296 (automation) · parent KAN-294 (the checklist) · runs `docs/DAILY_SECURITY_CHECK.md`
> Grounded in the official docs: [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) · [Routines](https://code.claude.com/docs/en/routines).

This is the **automation** for the daily security check. It runs as a **scheduled Claude Code routine** — a cloud session that spins up on a timer, clones the repo, runs the read-only probes, compares them to the baseline, files a BUGS ticket for anything new, and appends a run-log row via a `claude/`-branch PR.

---

## How the run is split

| Layer | Driven by | Covers |
|---|---|---|
| Deterministic HTTP / port probes | `scripts/daily-security-check.sh` (curl + shell) | §A web/edge, §C MCP transport — A1–A11, C1/C2/C7/C9 |
| MCP-tool probes | the **agent**, via the Supabase / GitHub / Cloudflare / Atlassian **connectors** | §B Supabase (B1–B9), §D/E GitHub & supply-chain, §A8 Cloudflare |
| Triage + reporting | the agent | compare to regression map, file tickets, append run log |

The script needs nothing but curl. The credentialed checks run through MCP **connectors**, whose traffic is routed through Anthropic's servers — so they need **no network-allowlist entry and no tokens in the container**.

---

## ⚠️ Prerequisite: the tooling must be on the branch the routine clones

A routine **clones the repository's *default branch*** each run (for `luisa-sys/lyra` that is **`main`**). The daily-check files currently live on PR **#329** (base `develop`), so they are **not on `main` yet** — which is exactly why your container's setup script reported `No such file or directory`.

Two ways to fix, pick one:

1. **Recommended — land the tooling, then point the prompt at `develop`.** Merge PR #329 to `develop`, and make the **first line of the routine prompt** check it out:
   ```
   git fetch origin develop --depth=1 && git checkout develop
   ```
   The GitHub proxy only restricts *pushes* to the working branch — fetching/checking out another branch to **read** is fine. Drop that line once the files reach `main` through a normal release promotion.
2. **Or wait for promotion.** Once `develop → … → main` carries these files to `main`, the default clone already has them and no checkout line is needed.

Until one of those is true, the routine has nothing to run.

---

## Step 1 — Setup script: leave it EMPTY

**Do not put `chmod +x scripts/daily-security-check.sh` (or any reference to a repo file) in the Setup script field.** That field runs as root *before* Claude starts, against the freshly-cloned **default branch**, so it fails hard (exit 1, aborting the session) whenever the file isn't there yet — which is what you hit.

You don't need a setup script at all:
- `curl`, `jq`, `git`, `ripgrep`, `bash` are **pre-installed** in the cloud image.
- The script is committed **executable** (git mode `100755`), and the prompt invokes it as `bash scripts/daily-security-check.sh`, so the exec bit doesn't even matter.

➡️ **Action: open the environment settings and clear the Setup script field** (then start a new session).

## Step 2 — Network access: Custom allowlist for the curl probes only

The default **Trusted** policy blocks `*.checklyra.com` (you get `403` + `x-deny-reason: host_not_allowed`). Edit the environment → **Network access** → **Custom** → **Allowed domains**, one per line:

```
checklyra.com
*.checklyra.com
mcp.checklyra.com
mcp-dev.checklyra.com
```

Tick **“Also include default list of common package managers.”**
- Add `*.supabase.co` **only** if you want the optional raw storage-enumeration curl (B5). It is **not** needed otherwise — the agent checks bucket flags/policies via the Supabase **connector** (the B5 SQL), which routes through Anthropic and needs no allowlist entry.
- **MCP connectors need no allowlist entries** — only the direct `curl` hosts above.

## Step 3 — Connectors: include only these four

On the routine form's **Connectors** tab, keep **Supabase, GitHub, Cloudflare, Atlassian** and **remove every other connector**. A routine can use *any* tool from an included connector (including writes) without asking — so the connector list is itself a scope control. Removing unused ones shrinks what the run can touch.

## Step 4 — Permissions: what's actually enforceable

There is **no read-only permission picker** for routines (autonomous sessions don't prompt for approval). The real guardrails are:

- **Leave “Allow unrestricted branch pushes” OFF** (the default). Claude can then only push `claude/`-prefixed branches — it **cannot** push to `main`/`beta`/`staging`/`develop`. The run-log change goes out as a PR from a `claude/` branch.
- **Put no write secrets in the environment.** There is no secrets store yet and env vars are visible to anyone who can edit the environment. This routine needs **none** — Supabase/GitHub/Cloudflare/Atlassian all authenticate through their connectors, not container env vars.
- **The prompt enforces read-only behaviour** (below). Be aware this is behavioural, not sandboxed: the Supabase connector *could* run a write query, so the prompt is explicit that it must not, and we don't ask it to.

## Step 5 — Schedule

In **Select a trigger → Schedule**, pick **Daily** at your local time (e.g. **07:00** — after the Sunday backup/restore jobs and before the workday). Times are entered in your zone and converted automatically. For a non-preset cadence, save the preset then run `/schedule update` in the CLI to set a cron expression (minimum interval is 1 hour). You can also create the whole thing conversationally with `/schedule daily security check at 7am`.

## Step 6 — The routine prompt

```
First, if scripts/daily-security-check.sh is not present on the checked-out branch,
run: git fetch origin develop --depth=1 && git checkout develop

You are running the daily security check for checklyra.com (KAN-294). Work READ-ONLY:
no probe may mutate prod; you may only (a) create Jira tickets and (b) append the run
log via a PR from a claude/ branch.

1. Run: bash scripts/daily-security-check.sh   (capture every PASS/FAIL/UNVERIFIED line).
2. Run the MCP-tool probes the script cannot, per docs/DAILY_SECURITY_CHECK.md:
   - Supabase get_advisors(type=security) AND the B1–B9 SQL on all three projects
     (llzkgprqewuwkiwclowi, uobmlkzrjkptwhttzmmi, ilprytcrnqyrsbsrfujj). Watch B3 (vault
     grants), B5 (storage SELECT policies), B9 + search_by_contact_hash (F-04/BUGS-45).
   - GitHub: open code-scanning + dependabot + secret-scanning alert counts for
     luisa-sys/lyra AND luisa-sys/lyra-mcp-server; branch protection on main/beta/staging
     and lyra-mcp-server@main; CODEOWNERS + SECURITY.md presence (E1–E6).
   - Cloudflare: kv/r2/workers list for the §A8 / DP-04 posture.
3. Compare EVERY result against the "Risk-Register regression map" and the last run-log
   row in docs/DAILY_SECURITY_CHECK.md. Treat UNVERIFIED as a soft-FAIL, never a pass.
4. For any NEW finding (a probe that newly FAILs, or a 🔴/🟠 not already covered by an
   open BUGS/SEC ticket — check Jira first), create a BUGS ticket: summary
   "[SEC][<sev>] <short>", the 6-section standard, labels security + risk-audit-2026-06.
   Do NOT fix anything; do NOT touch prod.
5. Append one run-log row to docs/DAILY_SECURITY_CHECK.md (date, runner=cloud-routine,
   🔴/🟠 counts, new tickets, one-line notes) and open a PR from a claude/ branch with
   only that change.
6. If any 🔴: put a clear "PAGE:" summary at the very top of your final reply.
   If clean: state "all green" with the PASS/UNVERIFIED counts; still append the log row.
```

---

## Output & alerting

- The run's session transcript + the run-log PR are the record. A **green run-list status only means the session didn't hit an infra error** — open the run (or read the `PAGE:` line) to see the actual result.
- **Optional next step (KAN-296 step 5):** add a Resend email on FAIL, reusing the `weekly-report.yml` Resend plumbing, so a red run reaches the inbox without opening the session — under the Workflow & Backup Integrity Policy (fail loud, never silent-skip).

## Why not a GitHub Action?

A cron Action can run `scripts/daily-security-check.sh` (the HTTP layer), but it can't drive the Supabase/GitHub/Cloudflare **connectors** or triage/file tickets with judgement — where most of the value is (B1–B9, the advisor sweep, branch-protection). The routine gets both halves. An Action remains a reasonable **fallback** for the pure-HTTP subset if you want a second, dumber signal.
