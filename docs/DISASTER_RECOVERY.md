# Disaster Recovery — Backup, Restore & Compromise Recovery

**Status:** engineering companion to the Confluence DR runbook
([TWC / Disaster Recovery & Backup/Restore Runbook](https://checklyra.atlassian.net/wiki/spaces/TWC/pages/27131914), SEC-5).
That page is the authoritative, founder-facing runbook; this file is the
in-repo, engineer-facing detail and the **recovery test plan**. Tracked under
**SEC-23**. Read both.

> **One-line truth:** backups run green every week, but until SEC-23 lands they
> (1) capture only the `public` schema — **not user accounts** (`auth`), uploaded
> files (`storage`), or the waitlist (KV); (2) are **weekly** (RPO ≈ 7 days); and
> (3) have **never been restored** — the "restore test" only re-dumped the live
> schema. This document closes those gaps and defines how we *prove* recovery.

---

## 1. Backup layers (defence in depth)

| # | Layer | Scope | Frequency | Lives where | Survives account compromise? |
|---|-------|-------|-----------|-------------|------------------------------|
| 1 | Supabase built-in backup | Whole DB incl. `auth` | Daily (plan-dependent), 7-day | Supabase account | ❌ same account as prod |
| 2 | `backup-database.yml` | `public` schema **+ data only** | Weekly Sun 02:00 | GitHub artifact (90d) + R2 | ⚠️ partial — same GitHub/CF accounts |
| 3 | `backup-platform.yml` | Repos, DNS, `public` schema-only, secret **names** | Weekly Sun 02:30 | GitHub artifact + R2 | ⚠️ partial |
| 4 | **`backup-complete.yml` (NEW, SEC-23)** | **`public` + `auth` + `storage` + roles + storage blobs + KV**, **age-encrypted** | **Daily 01:00** | GitHub artifact + **R2 WORM (write-only key, COMPLIANCE lock)** | ✅ **designed to** — see §5 |

Layer 4 is the one that matters in a hack: it is the only copy that is
**complete**, **encrypted with a key the attacker does not hold**, and written
to **immutable storage with a credential that cannot delete**. Layers 1–3 remain
as faster, lower-friction options for the common (non-malicious) cases.

## 2. RPO / RTO targets

| Metric | Current (pre-SEC-23) | Target | How SEC-23 gets there |
|--------|----------------------|--------|------------------------|
| **RPO** (max data loss) | ≈ 7 days (CI) | **≤ 24 h** | `backup-complete.yml` runs **daily**; consider Supabase PITR for minutes-level once on a paid plan |
| **RTO** (max downtime) | **unproven** | **≤ 4 h** | proven by the timed drills in §4 |

RPO/RTO are **goals until evidenced by a drill** (§4). Do not quote ≤4h to anyone
until a real drill has recorded it.

## 3. What each backup contains — and the gaps it closes

`scripts/backup-database.sh` dumps `--schema=public` only. Verified against the
real 2026-06-21 artifact: 38 `public` tables with data and RLS, **zero** `auth`
or `storage` objects. A restore from it yields profiles whose `user_id` points at
`auth.users` rows that do not exist — **nobody can log in.**

`scripts/backup-database-complete.sh` (SEC-23) captures `public` + `auth` +
`storage` + roles in one `pg_dump -Fc` archive plus a `MANIFEST_*.json` of
per-table row counts (the round-trip baseline the drill checks against). Because
the `auth` dump contains password hashes and tokens, the workflow **encrypts
every artifact with `age`** before it leaves CI.

## 4. Recovery test plan — how we prove restore works

Three tiers, increasing in fidelity and cost:

### Tier A — Automated weekly restore drill (`backup-restore-test.yml`)
Runs every Sunday with **no human and no prod secret**. It pulls the latest real
`backup-database.yml` artifact, restores it into a throwaway **Postgres 17
service container** (with the Supabase compat shim — roles, `auth.uid()`,
`auth.users` stub, `extensions`), and asserts the data round-trips: table count,
RLS-enabled count, and **per-table row counts** all match the dump. It records
the restore time as an RTO data point. A red run means the latest backup is not
restorable — treat all backups as suspect.

*Proves:* the `public` data is recoverable, continuously, automatically.
*Does not prove:* `auth`/`storage` recovery, or recovery under compromise (those
need the offline key — Tier C).

### Tier B — Quarterly throwaway-project restore (semi-manual)
Restore the **complete** encrypted backup into a brand-new, short-lived Supabase
project, decrypting with the offline `age` key. Verifies `auth` + `storage` +
roles actually come back and that login works end-to-end. Tear the project down
after. Record RTO. See §6.

### Tier C — Annual clean-room compromise drill (the real test)
The scenario the user actually cares about (§5). Assume the attacker holds
GitHub + Supabase + Cloudflare + Railway admin and has deleted/encrypted
everything they can reach. Recover **using only the WORM copy + the offline
key**, into infrastructure the attacker never had. This is the proof that we can
come back from a full breach.

## 5. Clean-room compromise recovery (Tier C) — step by step

**Pre-conditions that make this possible** (all are SEC-23 / KAN-121 deliverables):
1. **WORM copy exists** — `backup-complete.yml` writes daily to an R2 bucket with
   **Object Lock in COMPLIANCE retention** (not Governance — Governance can be
   bypassed by the account holder, i.e. the attacker). Nothing, including the
   Cloudflare root account, can delete a locked object before its retention
   expires.
2. **Write-only credential** — the R2 key in GitHub Actions can `PutObject` but
   **not** `DeleteObject`/`PutBucketLifecycle`. Compromising CI cannot wipe the
   backups.
3. **Offline encryption key** — the `age` **private** key is held only in the
   founder break-glass vault (offline / password manager), never in GitHub,
   Supabase, Cloudflare, or this repo. Backups are useless to the attacker and
   decryptable by us.
4. **Break-glass secret vault** — the *values* of the secrets needed to stand up
   a new environment (Supabase keys, Resend, Cloudflare token, OAuth client
   secret) live in an offline vault. `backup-platform.yml` backs up secret
   **names**, not values — `docs/SECURITY_ROTATION.md` is the re-issue index.

**Recovery procedure:**

1. **Declare incident.** Incident Lead (Luisa) authorises; open the IR log. Start
   the RTO clock.
2. **Stand up clean infrastructure the attacker never touched:**
   - New Supabase project (new account if the old one is compromised).
   - New GitHub repo from the offline repo bundle (or a fork the attacker lacks
     access to).
   - A **recovery domain** — do **not** wait on the compromised DNS. Use a
     pre-registered standby (e.g. `lyra-recovery.app`) or a Vercel/Cloudflare
     `*.vercel.app` URL; cut prod DNS over once the rebuild is verified and the
     Cloudflare account is re-secured. (See §7 for the domain decision.)
3. **Pull the WORM backup** with a *read* credential (separate again from the
   write-only one) into the clean environment.
4. **Decrypt** with the offline `age` private key.
5. **Restore** roles → `pg_restore` the complete dump (`auth` + `public` +
   `storage`) → sync storage blobs back → import KV.
6. **Re-issue all secrets** from the break-glass vault per
   `docs/SECURITY_ROTATION.md`; rotate everything (assume all old secrets are
   burned).
7. **Repoint** Vercel + Railway env to the new Supabase; restore DNS from
   `cloudflare-dns.json`.
8. **Smoke-test:** a user logs in (proves `auth` restored), a profile loads with
   its uploaded file (proves `storage`), one MCP read + write (proves API keys).
9. **Close:** record start/end → observed RTO; record the data-loss window →
   observed RPO; file in the IR log and §6 table here.

## 6. Drill log (evidence)

| Date | Tier | Backup used (date) | RTO observed | RPO observed | Result | Notes / run link |
|------|------|--------------------|--------------|--------------|--------|------------------|
| _pending_ | A | latest weekly | — | — | — | first run of new `backup-restore-test.yml` |
| _pending_ | C | latest WORM | — | — | — | first clean-room drill — schedule once layer 4 secrets exist |

> **How to evidence to a third party (investor / auditor / ICO):** keep, per
> drill — (a) this dated row, (b) the workflow run URL / step-summary for Tier A,
> (c) screenshots of the recovered app login + a restored profile for Tier B/C,
> (d) the observed RTO/RPO, (e) Incident Lead sign-off. That package *is* the
> proof; a green backup workflow alone is not.

## 7. The "new domain to test recovery?" decision

You do **not** need a new domain for Tiers A or B (container / throwaway project,
no public DNS). For Tier C you want recovery to be **independent of the possibly
compromised Cloudflare/DNS**, so:

- **Recommended:** pre-register a cheap **standby domain** (e.g.
  `lyra-recovery.app`, ~£10/yr) at a *different* registrar, parked. Drills and
  real recovery both publish there first; prod DNS is cut over last, only after
  the Cloudflare account is re-secured. This also lets a drill run end-to-end
  without touching live `checklyra.com`.
- **Cheaper:** use the provider-issued `*.vercel.app` URL for the drill — zero
  cost, proves the app + data come back, but doesn't rehearse the DNS cutover.

## 8. Operational prerequisites (founder actions — see SEC tickets)

`backup-complete.yml` and the WORM/compromise guarantees need secrets that only
the founder can provision. Until they exist the daily workflow **fails loud**
(by design — a false-green backup is worse). Provision:

- `BACKUP_AGE_RECIPIENTS` — age **public** key; keep the private key offline.
- `R2_BACKUP_WRITEONLY_ACCESS_KEY_ID` / `R2_BACKUP_WRITEONLY_SECRET_ACCESS_KEY` /
  `R2_BACKUP_ENDPOINT` / `R2_BACKUP_BUCKET` — a **write-only** R2 key on a bucket
  with **Object Lock COMPLIANCE**.
- `SUPABASE_STORAGE_S3_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY` — Supabase
  Storage S3 access (only required once files exist).
- `CLOUDFLARE_KV_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_KV_NAMESPACE_ID`
  — KV read scope for the waitlist export.
- Confirm `SUPABASE_DB_URL` is a **session** connection (port 5432), not the 6543
  pooler, so `pg_dumpall --roles-only` works.
