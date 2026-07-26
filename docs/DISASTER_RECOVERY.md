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
| 4 | **`backup-complete.yml` (NEW, SEC-23)** | **`public` + `auth` + `storage` + roles + storage blobs + KV**, **age-encrypted** | **Daily** once commissioned (ships dispatch-only — §8) | GitHub artifact + **R2 WORM (write-only key, COMPLIANCE lock)** | ✅ **designed to** — see §5 |

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

## 7. The "new domain to test recovery?" decision — DECIDED: `*.vercel.app`

You do **not** need a new domain for Tiers A or B (container / throwaway project,
no public DNS).

**Decision (2026-06-23):** drills use the **provider-issued `*.vercel.app` URL** —
zero cost, and it proves the thing we care about most: *the app + data come back*.
A Tier C drill deploys the recovered build to its default `lyra-recovery-*.vercel.app`
preview URL pointed at the freshly-restored Supabase project, and we smoke-test
login + a profile there. We accept that this does **not** rehearse the DNS cutover
(repointing `checklyra.com` away from a compromised Cloudflare account); that
remains a documented manual step in §5.3 to perform only during a real incident.

> If we later want to rehearse the DNS cutover too, register a cheap standby
> domain (~£10/yr) at a *different* registrar and publish there first. Out of
> scope for now per the decision above.

## 8. Operational prerequisites (founder actions — see SEC tickets)

`backup-complete.yml` and the WORM/compromise guarantees need secrets that only
the founder can provision. The workflow ships **dispatch-only**; until the
secrets exist it would **fail loud** if run (by design — a false-green backup is
worse). Commission it in this order, then flip the nightly schedule on:

**1. Encryption key — generate OFFLINE (do not paste the private key anywhere online):**
```bash
age-keygen -o lyra-backup.key        # save lyra-backup.key in your password manager — this is the break-glass key
grep 'public key' lyra-backup.key    # copy the "age1..." public recipient
```
Set the **public** recipient as a repo secret (value is the `age1…` string):
```bash
gh secret set BACKUP_AGE_RECIPIENTS --repo luisa-sys/lyra --body 'age1…'
```

> The age **PUBLIC** recipient, the R2/Supabase **endpoint URLs**, and the R2
> **bucket name** are NOT sensitive (fine to `--body` inline). The R2/Supabase/KV
> **keys + tokens** ARE secrets — run `gh secret set NAME --repo luisa-sys/lyra`
> and paste the value at the prompt so it never lands in shell history.
>
> **Multiple break-glass holders:** `BACKUP_AGE_RECIPIENTS` may hold several
> whitespace-separated `age1…` recipients — the workflow encrypts to all of them.

**2. WORM bucket + a dedicated R2 key (Cloudflare R2 dashboard):**
- **Create the bucket FIRST** (e.g. `lyra-backups-worm`) with **Object Lock
  enabled at creation** (it can NEVER be added or downgraded later), mode
  **COMPLIANCE** (Governance can be bypassed by the account holder), default
  retention **exactly 30 days**.
  > ⚠️ **Irreversible — check the unit.** COMPLIANCE retention can only ever be
  > *increased*, never shortened or removed, by anyone (including the Cloudflare
  > root account). A "**Years**" fat-finger instead of "**Days**" permanently
  > locks auth password hashes + waitlist PII for that whole span, at growing
  > cost, with no remediation. Confirm the selector reads **Days** and the value
  > is **30** before saving.
- **Verify the lock on the EMPTY bucket BEFORE any write** — confirm the bucket
  shows Object Lock = *Compliance*, retention *30 days*. If anything is wrong,
  delete + recreate now (once objects are written they are permanently locked).
- Mint a **dedicated** R2 API token (Manage R2 API Tokens → Create) with
  **Object Read & Write**, scoped to this bucket only.
  > R2 tokens have no per-verb "PutObject-only" scope — Object R/W is the
  > narrowest write option and it *can* delete + read. **WORM is enforced solely
  > by Object Lock COMPLIANCE on the bucket, not by the token.** Keep it a
  > SEPARATE token from the day-to-day `R2_ACCESS_KEY_ID` so its blast radius is
  > isolated; confidentiality of the readable objects rests on the age encryption.
- (Optional, via an **admin** R2 credential in the dashboard — NOT this CI token)
  add a lifecycle **Expire after ~37 days** rule so dailies don't accumulate
  forever once past their lock window.
```bash
gh secret set R2_BACKUP_WRITEONLY_ACCESS_KEY_ID     --repo luisa-sys/lyra   # paste at prompt
gh secret set R2_BACKUP_WRITEONLY_SECRET_ACCESS_KEY --repo luisa-sys/lyra   # paste at prompt
gh secret set R2_BACKUP_ENDPOINT --repo luisa-sys/lyra --body 'https://<account-id>.r2.cloudflarestorage.com'
gh secret set R2_BACKUP_BUCKET   --repo luisa-sys/lyra --body 'lyra-backups-worm'
```

**3. Supabase Storage S3 keys** (Supabase → Project → Storage → S3 access keys).
**Deferrable** while `storage.objects = 0` (the workflow honestly warn-skips) —
but the daily backup will **fail loud every night from the first user upload
onward** until all three are set, so provision them at the storage-go-live
milestone, **atomically** (a partial set fails the guard):
```bash
gh secret set SUPABASE_STORAGE_S3_ENDPOINT   --repo luisa-sys/lyra --body 'https://<ref>.supabase.co/storage/v1/s3'
gh secret set SUPABASE_STORAGE_S3_ACCESS_KEY --repo luisa-sys/lyra   # paste at prompt
gh secret set SUPABASE_STORAGE_S3_SECRET_KEY --repo luisa-sys/lyra   # paste at prompt
```

**4. Cloudflare KV (waitlist) export token** — a **Workers KV Storage: Read**
scoped token (gotcha #13: KV is a separate scope; the existing DNS-scoped
`CLOUDFLARE_API_TOKEN` will silently fail KV reads — do NOT reuse it):
```bash
gh secret set CLOUDFLARE_KV_API_TOKEN    --repo luisa-sys/lyra   # paste at prompt (KV:read scope)
# CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_KV_NAMESPACE_ID are already set — verify only:
gh secret list --repo luisa-sys/lyra | grep -E 'CLOUDFLARE_(ACCOUNT_ID|KV_NAMESPACE_ID)'
# expected namespace id: c7bdc8624f0a4bd5b0a8ad36e9f93d96 (lyra-interest-emails)
```

**5. `SUPABASE_DB_URL` MUST be a SESSION connection** (port 5432 / "Direct
connection"), NOT the 6543 pooler — `pg_dumpall --roles-only` cannot run over the
pooler. ⚠️ `SECURITY_ROTATION.md` documents this same secret as the 6543 pooler
(correct for the weekly public-only `backup-database.yml`, **wrong here**). The
integrity gate now **fails loud** if roles were skipped, so a pooler URL will
turn the smoke-test red (not silently green). If you cannot repoint the shared
secret without disturbing the weekly backup, give this workflow its own session
URL secret. You cannot read the value back — the smoke-test (step 6) verifies it.

**6. Smoke-test (dispatch-only — does NOT arm the schedule), then verify:**
```bash
gh workflow run backup-complete.yml --repo luisa-sys/lyra
gh run watch "$(gh run list --workflow=backup-complete.yml --repo luisa-sys/lyra -L1 --json databaseId -q '.[0].databaseId')" --repo luisa-sys/lyra
```
The run **must be green**, AND open it to confirm the integrity gate output:
- `manifest: … auth_users=<N>` with **N ≥ 1** and **`roles=captured`** (proves the
  5432/session URL — a `skipped:…` here means the DB URL is the 6543 pooler);
- `kv: <M> key(s) exported` with **M ≥ 1** (proves KV:read scope + right namespace);
- storage step recorded `skipped:no-creds:empty-bucket` (expected while 0 objects);
- `Encrypt artifacts` produced only `.age` files; the uploaded artifact has **no
  plaintext**; `Upload to R2 WORM` printed `✓` per object under `complete/<ts>/`.

Deliberate opt-outs (only if genuinely applicable): re-dispatch with
`allow_empty_kv=true` (waitlist truly empty) or `allow_skipped_roles=true`
(Supabase→Supabase-only restore accepted).

**7. Arm the daily schedule** — only after a green smoke-test with `roles=captured`
+ KV non-empty. Uncomment the two `schedule:` lines at the top of
`.github/workflows/backup-complete.yml` and ship that 1-line change **through the
normal PR pipeline** (not an admin-merge — release-supervision policy).
