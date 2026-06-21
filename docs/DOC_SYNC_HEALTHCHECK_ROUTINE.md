# Doc-Sync Health-Check — Claude Code routine

> **Ticket:** KAN-249 (the doc-sync job this watches) · runs **weekdays** · mirrors the structure of `DAILY_SECURITY_CHECK_ROUTINE.md`.
> Confluence space **TWC**, cloudId `fde496ba-2db8-481a-8544-39d6e9122101`.

This routine health-checks the **KAN-249 Confluence doc-sync automation** — the weekday job that keeps a 7-page TWC doc tree in step with `luisa-sys/lyra` and `luisa-sys/lyra-mcp-server` `main`. It catches the failure mode where the log claims "in sync" but a repo's real `main` has moved ahead (the 2026-06-19 stall, when `lyra-mcp-server` was stuck at `c2451b9d`).

## How the run is split

| Layer | Driven by | Covers |
|---|---|---|
| Read recorded state | agent, **Atlassian** connector | Doc Sync Log (page `19922947`), KAN-249 comments, tools page (`19955714`) |
| Real `main` SHAs | agent, **GitHub** connector (`get_commit` ref `main`) | the source of truth to compare against |
| Compare + day logic | `scripts/doc-sync-healthcheck.sh` | match / weekend-grace / weekday-FAIL, exit codes |

## ⚠️ Prerequisite — same as the security routine

Routines clone the **default branch** (`main`); the script lives on `develop` (and reaches `main` only via release promotion). **The routine prompt's first lines must check out `develop`** (see Step 6), or the run will say the script "doesn't exist" and improvise.

## Setup

- **Connectors:** keep **Atlassian** + **GitHub**; remove the rest.
- **Network:** if the agent passes real SHAs from the GitHub connector (recommended, per the prompt), the script needs **no** network. Only if you let the script fetch SHAs itself does it need `api.github.com` (already in the **Trusted** default allowlist).
- **Schedule:** **Weekdays** at your local time (the job itself runs weekdays; checking then matches its cadence). The script still handles weekend runs gracefully.
- **Permissions:** leave "Allow unrestricted branch pushes" OFF. This check is **read-only** — it reports; it does not edit Confluence or push. No env secrets needed.

## The routine prompt

```
First run: git fetch origin develop && git checkout develop
Then verify scripts/doc-sync-healthcheck.sh exists; if not, STOP and say the checkout
failed — do NOT improvise.

Health-check the KAN-249 Confluence doc-sync job (Atlassian cloudId
fde496ba-2db8-481a-8544-39d6e9122101). READ-ONLY.

1. Read the Doc Sync Log table on Confluence page 19922947; take the MOST RECENT row's
   date + lyra SHA + lyra-mcp-server SHA + summary. Also read the latest KAN-249 comments.
2. Get the REAL latest main SHAs via the GitHub connector:
   get_commit(luisa-sys/lyra, main) and get_commit(luisa-sys/lyra-mcp-server, main).
3. Run: bash scripts/doc-sync-healthcheck.sh <rec_lyra> <rec_mcp> <real_lyra> <real_mcp>
   (pass all four short SHAs; the script applies the weekday/weekend logic).
4. Confirm Confluence page 19955714 still lists BOTH lyra_update_school AND
   lyra_update_manual_of_me. If either is missing -> FAIL.
5. Report CONCISELY:
   - PASS: quote the latest row's date + both SHAs and confirm they match real main.
   - OK (weekend): "OK — weekend, job idle", plus latest recorded state and whether docs
     are currently in sync with both repos' main (note any commit the Monday run must pick up).
   - FAIL: what's wrong + likely cause (missed/stalled commit, job not running, or a tool
     dropped from page 19955714). Name the specific repo + SHAs.
   Keep it short.
```

## PASS / OK / FAIL rules (encoded in the script + this prompt)

- **PASS** — the latest log row's SHAs equal both repos' real `main` (docs in sync, nothing undocumented).
- **OK — weekend, job idle** — today is Sat/Sun and no row dated today; report the latest recorded state and whether docs currently match real `main`. A `main` that advanced *today* is expected to be picked up at the next weekday run.
- **FAIL** —
  - the latest row claims "in sync"/"no changes" but a repo's real `main` is **ahead** of the recorded SHA on a **weekday** (job missed/stalled — the 2026-06-19 `c2451b9d` mode); or
  - it's a weekday, `main` advanced, and **no new log row** was added for the most recent expected run (job not running); or
  - `lyra_update_school` or `lyra_update_manual_of_me` is **missing** from page `19955714`.

## Baseline (for drift reference)

As of the 2026-06-20 manual run: lyra `main` `abe4bb17`, lyra-mcp-server `main` `60e8cbbd` (PR #70 / `60e8cbbd` — June-2026 profile-redesign data points, incl. the two write tools above). Earlier baseline `c2451b9d` (mcp) was the pre-#70 SHA.
